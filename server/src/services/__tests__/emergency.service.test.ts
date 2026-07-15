/**
 * emergency.service 单元测试
 *
 * 测试目标：覆盖 classifyUrgency / createRequest / getRequests / getRequestById /
 *           respondToRequest / createReport / resolveFalseReport 的核心路径
 * 测试策略：mock database / ai.service / idempotency / notification.service 等，
 *           验证紧急程度降级、XSS 清洗、脱敏、状态校验、处罚映射等逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

const mockClient = {
  query: vi.fn(),
};

vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn((cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient)),
  pool: {},
}));

// mock ai.service：默认返回 null，模拟 AI 不可用走关键词降级
vi.mock('../ai.service', () => ({
  aiService: { callLLM: vi.fn().mockResolvedValue(null) },
}));

// mock idempotency：默认无缓存命中
vi.mock('../../utils/idempotency', () => ({
  idempotency: {
    buildKey: vi.fn((...args: string[]) => args.join(':')),
    checkIdempotency: vi.fn().mockResolvedValue({ hit: false }),
    setIdempotencyResult: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock notification.service：避免调用真实推送
vi.mock('../notification.service', () => ({
  notificationService: {
    notifyEmergencyResponse: vi.fn().mockResolvedValue(undefined),
    notifyReportResult: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock reputation.service
vi.mock('../reputation.service', () => ({
  reputationService: { updateReputationScore: vi.fn().mockResolvedValue(undefined) },
}));

// mock credit.service：验证 earnCredits 调用参数，避免真实 DB 操作
vi.mock('../credit.service', () => ({
  creditService: {
    earnCredits: vi.fn().mockResolvedValue({ balance: 100 }),
  },
}));

// mock sanitize：直接透传，避免 xss 库依赖
vi.mock('../../utils/sanitize', () => ({
  sanitizeObject: vi.fn(<T extends Record<string, unknown>>(data: T): T => data),
  sanitizeXss: vi.fn((v: unknown) => v),
  validateImageUrls: vi.fn(),
}));

// mock mask：固定返回脱敏字符串
vi.mock('../../utils/mask', () => ({
  maskPhone: vi.fn((phone: string) => `****${phone.slice(-4)}`),
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { emergencyService } from '../emergency.service';
import { query, transaction } from '../../config/database';
import { aiService } from '../ai.service';
import { idempotency } from '../../utils/idempotency';
import { notificationService } from '../notification.service';
import { creditService } from '../credit.service';
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  OrderStatusInvalidError,
  PermissionDeniedError,
} from '../../utils/errors';

const mockedQuery = vi.mocked(query);
const mockedTransaction = vi.mocked(transaction);

// 局部类型别名：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需 rows
// 用 as unknown as DbResult 替代 as unknown as DbResult 以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;
const mockedAi = vi.mocked(aiService.callLLM);
const mockedIdempotency = vi.mocked(idempotency.checkIdempotency);
const mockedNotify = vi.mocked(notificationService.notifyEmergencyResponse);
const mockedEarnCredits = vi.mocked(creditService.earnCredits);

beforeEach(() => {
  mockedQuery.mockReset();
  mockClient.query.mockReset();
  mockedTransaction.mockClear();
  mockedAi.mockReset();
  mockedAi.mockResolvedValue(null); // 默认 AI 不可用
  mockedIdempotency.mockReset();
  mockedIdempotency.mockResolvedValue({ hit: false });
  mockedNotify.mockClear();
  mockedEarnCredits.mockReset();
  mockedEarnCredits.mockResolvedValue({ balance: 100 });
});

describe('emergency.service - classifyUrgency', () => {
  it('AI 不可用时降级为关键词匹配：火灾 → critical', async () => {
    const level = await emergencyService.classifyUrgency('小区火灾', '邻居家里着火了');
    expect(level).toBe('critical');
  });

  it('AI 不可用时降级：漏水 → high', async () => {
    const level = await emergencyService.classifyUrgency('水管漏水', '楼上漏水严重');
    expect(level).toBe('high');
  });

  it('AI 不可用时降级：无关键词匹配 → low', async () => {
    const level = await emergencyService.classifyUrgency('咨询问题', '想了解一下政策');
    expect(level).toBe('low');
  });

  it('AI 返回合法级别时使用 AI 结果', async () => {
    mockedAi.mockResolvedValueOnce('high');
    const level = await emergencyService.classifyUrgency('标题', '描述');
    expect(level).toBe('high');
  });

  it('AI 返回非法值时降级为关键词匹配', async () => {
    mockedAi.mockResolvedValueOnce('invalid-level');
    const level = await emergencyService.classifyUrgency('心脏骤停', '需要急救');
    expect(level).toBe('critical');
  });
});

describe('emergency.service - createRequest', () => {
  it('创建求助记录并返回响应对象', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'e1',
        user_id: 'u1',
        type: 'emergency',
        category: '医疗',
        title: '心脏骤停',
        description: '需要急救',
        urgency: 'critical',
        location: null,
        address: '北京',
        contact_phone: '13800000000',
        is_anonymous: false,
        images: [],
        status: 'open',
        timeout_at: new Date('2026-01-01'),
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
      }],
    } as unknown as DbResult);

    const result = await emergencyService.createRequest('u1', {
      category: '医疗',
      title: '心脏骤停',
      description: '需要急救',
      address: '北京',
      contactPhone: '13800000000',
    });

    expect(result.id).toBe('e1');
    expect(result.urgency).toBe('critical'); // 关键词降级匹配
    // contactPhone 应脱敏（非响应者查看）
    expect(result.contactPhone).toContain('****');
  });

  it('传入 urgency 时直接使用，不调用 AI', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'e1', user_id: 'u1', type: 'emergency', category: '医疗',
        title: 't', description: 'd', urgency: 'medium',
        location: null, address: null, contact_phone: null,
        is_anonymous: false, images: [], status: 'open',
        timeout_at: new Date(), created_at: new Date(), updated_at: new Date(),
      }],
    } as unknown as DbResult);

    const result = await emergencyService.createRequest('u1', {
      category: '医疗',
      title: 't',
      description: 'd',
      urgency: 'medium',
    });

    expect(result.urgency).toBe('medium');
    expect(mockedAi).not.toHaveBeenCalled();
  });
});

describe('emergency.service - getRequests', () => {
  it('按 type/status 筛选并返回分页结构', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{
          id: 'e1', user_id: 'u1', type: 'emergency', category: '医疗',
          title: 't', description: 'd', urgency: 'high',
          location: null, address: null, contact_phone: '13800000000',
          is_anonymous: false, images: [], status: 'open',
          timeout_at: new Date(), created_at: new Date(), updated_at: new Date(),
        }],
      } as unknown as DbResult);

    const result = await emergencyService.getRequests({ type: 'emergency', status: 'open', page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    // COUNT SQL 应包含 type 与 status 条件
    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('er.type = $1');
    expect(countSql).toContain('er.status = $2');
  });

  it('deleted_at IS NULL 为必备条件', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await emergencyService.getRequests({ type: undefined, status: undefined, page: 1, pageSize: 20 });

    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('er.deleted_at IS NULL');
  });
});

describe('emergency.service - getRequestById', () => {
  it('求助不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(emergencyService.getRequestById('e-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('未登录查看者 contactPhone 置空，避免泄露 PII', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'e1', user_id: 'u1', type: 'emergency', category: '医疗',
          title: 't', description: 'd', urgency: 'high',
          location: null, address: null, contact_phone: '13800000000',
          is_anonymous: false, images: [], status: 'open',
          timeout_at: new Date(), created_at: new Date(), updated_at: new Date(),
        }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult)  // responses
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // reviews

    const result = await emergencyService.getRequestById('e1', undefined);
    expect(result.contactPhone).toBeNull();
  });

  it('响应者查看时返回完整 contactPhone', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'e1', user_id: 'u1', type: 'emergency', category: '医疗',
          title: 't', description: 'd', urgency: 'high',
          location: null, address: null, contact_phone: '13800000000',
          is_anonymous: false, images: [], status: 'responding',
          timeout_at: new Date(), created_at: new Date(), updated_at: new Date(),
        }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{
          id: 'r1', request_id: 'e1', responder_id: 'u-responder',
          message: '马上到', eta: 10, status: 'accepted',
          timeout_at: new Date(), arrived_at: null, completed_at: null,
          created_at: new Date(), updated_at: new Date(),
          responder_nickname: '李四', responder_avatar: null,
        }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // reviews

    const result = await emergencyService.getRequestById('e1', 'u-responder');
    // 响应者可见完整手机号
    expect(result.contactPhone).toBe('13800000000');
  });
});

describe('emergency.service - respondToRequest', () => {
  it('求助不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(
      emergencyService.respondToRequest('u1', 'e-x', { message: '帮忙' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('求助状态非 open/responding 抛 OrderStatusInvalidError', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'e1', user_id: 'u1', status: 'resolved' }],
    } as unknown as DbResult);

    await expect(
      emergencyService.respondToRequest('u1', 'e1', { message: '帮忙' }),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });

  it('重复响应抛 ConflictError', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'e1', user_id: 'u1', status: 'open' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as unknown as DbResult); // 已有响应

    await expect(
      emergencyService.respondToRequest('u1', 'e1', { message: '帮忙' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('成功响应后发送通知给求助者', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'e1', user_id: 'u-requester', status: 'open' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // 无重复响应
      .mockResolvedValueOnce({ rows: [{ nickname: '李四' }] } as unknown as DbResult); // 响应者昵称
    // INSERT emergency_responses + UPDATE emergency_requests 已包裹进 transaction，
    // 对应 mockClient.query 而非顶层 mockedQuery
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{
          id: 'r1', request_id: 'e1', responder_id: 'u1',
          message: '马上到', eta: 10, status: 'accepted',
          timeout_at: new Date(), arrived_at: null, completed_at: null,
          created_at: new Date(), updated_at: new Date(),
        }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // UPDATE 求助状态

    await emergencyService.respondToRequest('u1', 'e1', { message: '马上到', eta: 10 });

    // 应发送通知给求助者
    expect(mockedNotify).toHaveBeenCalledWith('u-requester', 'e1', '李四');
  });

  it('幂等命中时直接返回缓存结果', async () => {
    mockedIdempotency.mockResolvedValueOnce({ hit: true, data: { id: 'cached-r1' } });

    const result = await emergencyService.respondToRequest('u1', 'e1', { message: '帮忙' });

    expect(result).toEqual({ id: 'cached-r1' });
    // 命中后不应再查数据库
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

describe('emergency.service - createReport', () => {
  it('求助不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(emergencyService.createReport('u1', 'e-x', '虚假求助')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('重复举报抛 ConflictError', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [{ id: 'f1' }] } as unknown as DbResult); // 已举报

    await expect(emergencyService.createReport('u1', 'e1', '虚假求助')).rejects.toBeInstanceOf(ConflictError);
  });

  it('成功创建举报记录', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 'e1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // 无重复
      .mockResolvedValueOnce({
        rows: [{
          id: 'f1', request_id: 'e1', reporter_id: 'u1', reason: '虚假求助',
          evidence: null, status: 'pending', penalty: null,
          resolution: null, resolved_at: null, resolved_by: null,
          created_at: new Date(), updated_at: new Date(),
        }],
      } as unknown as DbResult);

    const result = await emergencyService.createReport('u1', 'e1', '虚假求助');
    expect(result.id).toBe('f1');
    expect(result.status).toBe('pending');
  });
});

describe('emergency.service - resolveFalseReport', () => {
  it('无效处罚类型抛 BadRequestError', async () => {
    await expect(
      emergencyService.resolveFalseReport('f1', 'admin-1', 'invalid-penalty', '处理意见'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('举报不存在抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await expect(
      emergencyService.resolveFalseReport('f-x', 'admin-1', 'warning', '处理意见'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('举报已处理（非 pending）抛 BadRequestError', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'f1', status: 'resolved', request_id: 'e1' }],
    } as unknown as DbResult);

    await expect(
      emergencyService.resolveFalseReport('f1', 'admin-1', 'warning', '处理意见'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('warning 类型：不修改用户状态，仅记录处罚结果', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ id: 'f1', status: 'pending', request_id: 'e1', reporter_id: 'u-reporter' }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-requester' }] } as unknown as DbResult) // 查询求助者
      .mockResolvedValueOnce({
        rows: [{
          id: 'f1', request_id: 'e1', reporter_id: 'u-reporter', reason: '虚假',
          evidence: null, status: 'resolved', penalty: 'warning',
          resolution: '仅警告', resolved_at: new Date(), resolved_by: 'admin-1',
          created_at: new Date(), updated_at: new Date(),
        }],
      } as unknown as DbResult); // UPDATE 举报

    const result = await emergencyService.resolveFalseReport('f1', 'admin-1', 'warning', '仅警告');

    expect(result.status).toBe('resolved');
    expect(result.penalty).toBe('warning');
    // warning 不应触发用户状态更新 SQL（仅 3 次查询：SELECT/SELECT/UPDATE 举报）
    expect(mockClient.query).toHaveBeenCalledTimes(3);
  });

  it('permanent 类型：永久封禁用户', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ id: 'f1', status: 'pending', request_id: 'e1', reporter_id: 'u-reporter' }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-requester' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{ id: 'f1', status: 'resolved', penalty: 'permanent', resolution: '永封', resolved_at: new Date(), resolved_by: 'admin-1', request_id: 'e1', reporter_id: 'u-reporter', reason: '虚假', evidence: null, created_at: new Date(), updated_at: new Date() }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // UPDATE users 永久封禁

    await emergencyService.resolveFalseReport('f1', 'admin-1', 'permanent', '永封');

    // 第 4 次调用应为永久封禁 SQL：status = 'permanent_banned', ban_until = NULL
    const banSql = mockClient.query.mock.calls[3][0];
    expect(banSql).toContain("status = $1");
    expect(banSql).toContain('ban_until = NULL');
    expect(mockClient.query.mock.calls[3][1]).toEqual(['permanent_banned', 'u-requester']);
  });

  it('ban_7d 类型：限时封禁，ban_until = NOW() + 7 days', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ id: 'f1', status: 'pending', request_id: 'e1', reporter_id: 'u-reporter' }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [{ user_id: 'u-requester' }] } as unknown as DbResult)
      .mockResolvedValueOnce({
        rows: [{ id: 'f1', status: 'resolved', penalty: 'ban_7d', resolution: '封7天', resolved_at: new Date(), resolved_by: 'admin-1', request_id: 'e1', reporter_id: 'u-reporter', reason: '虚假', evidence: null, created_at: new Date(), updated_at: new Date() }],
      } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // UPDATE users 限时封禁

    await emergencyService.resolveFalseReport('f1', 'admin-1', 'ban_7d', '封7天');

    const banSql = mockClient.query.mock.calls[3][0];
    // 参数化后 SQL 使用 $2::interval 占位符，不再含字面量 INTERVAL '7 days'
    expect(banSql).toContain("$2::interval");
    expect(banSql).toContain('ban_until = NOW() + $2::interval');
    // 参数列表：[status, interval, userId]
    expect(mockClient.query.mock.calls[3][1]).toEqual(['banned', '7 days', 'u-requester']);
  });
});

describe('emergency.service - updateResponseStatus', () => {
  it('响应记录不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(
      emergencyService.updateResponseStatus('u1', 'r-x', 'arrived'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('arrived 状态：非响应者本人抛 PermissionDeniedError', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', responder_id: 'u-responder', request_id: 'e1' }],
    } as unknown as DbResult);

    await expect(
      emergencyService.updateResponseStatus('u-other', 'r1', 'arrived'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('arrived 状态：响应者本人标记到达', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', responder_id: 'u1', request_id: 'e1' }],
    } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r1', request_id: 'e1', responder_id: 'u1',
        message: '到', eta: 5, status: 'arrived',
        timeout_at: new Date(), arrived_at: new Date(), completed_at: null,
        created_at: new Date(), updated_at: new Date(),
      }],
    } as unknown as DbResult);

    const result = await emergencyService.updateResponseStatus('u1', 'r1', 'arrived');
    expect(result.status).toBe('arrived');
  });

  it('无效状态抛 BadRequestError', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', responder_id: 'u1', request_id: 'e1' }],
    } as unknown as DbResult);

    await expect(
      emergencyService.updateResponseStatus('u1', 'r1', 'invalid'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('completed 状态：通过 creditService.earnCredits 发放积分（不手动 UPDATE+INSERT）', async () => {
    // 事务外查询响应记录
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);

    // 事务内查询顺序：
    // 1. SELECT emergency_requests FOR UPDATE → 求助者为 u1，type=emergency
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'e1', user_id: 'u1', type: 'emergency', status: 'responding' }],
    } as unknown as DbResult);
    // 2. SELECT emergency_responses FOR UPDATE → 响应者为 u-responder，状态 accepted
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);
    // 3. UPDATE 其他响应为 cancelled
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    // 4. UPDATE 当前响应为 completed RETURNING
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        id: 'r1', request_id: 'e1', responder_id: 'u-responder', message: '到',
        status: 'completed', eta: 5, timeout_at: new Date(), arrived_at: new Date(),
        completed_at: new Date(), created_at: new Date(), updated_at: new Date(),
      }],
    } as unknown as DbResult);
    // 5. UPDATE 求助状态为 resolved
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await emergencyService.updateResponseStatus('u1', 'r1', 'completed');
    expect(result.status).toBe('completed');

    // 验证 earnCredits 被调用（紧急求助基础 100 积分）
    expect(mockedEarnCredits).toHaveBeenCalledWith(
      mockClient,
      'u-responder',
      100,
      '完成求助奖励',
      'e1',
      'emergency',
    );
  });

  it('completed 状态：5 星评价额外奖励 10 积分', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);

    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'e1', user_id: 'u1', type: 'normal', status: 'responding' }],
    } as unknown as DbResult);
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    mockClient.query.mockResolvedValueOnce({
      rows: [{
        id: 'r1', request_id: 'e1', responder_id: 'u-responder', message: '到',
        status: 'completed', eta: 5, timeout_at: new Date(), arrived_at: new Date(),
        completed_at: new Date(), created_at: new Date(), updated_at: new Date(),
      }],
    } as unknown as DbResult);
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    // INSERT INTO reviews（有 reviewData 时）
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await emergencyService.updateResponseStatus('u1', 'r1', 'completed', {
      rating: 5,
      review: '非常感谢',
    });

    // 普通求助 50 + 5 星评价 10 = 60 积分
    expect(mockedEarnCredits).toHaveBeenCalledWith(
      mockClient,
      'u-responder',
      60,
      '完成求助奖励',
      'e1',
      'emergency',
    );
  });

  // ========== 并发安全测试：补全 updateResponseStatus FOR UPDATE 行锁场景 ==========
  // 设计原因：completed 路径用 transaction + 双层 FOR UPDATE 行锁防并发重复完成，
  // 必须覆盖锁内"状态已被另一并发请求改写"的场景，验证不会重复发放积分或写入重复评价

  it('completed 并发：锁内响应状态已变为 completed，抛 OrderStatusInvalidError 不重复发放积分', async () => {
    // 事务外查询响应记录（旧值，模拟并发场景下读到的 accepted 快照）
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);

    // 事务内锁查询：
    // 1. SELECT emergency_requests FOR UPDATE → 求助者 u1，状态仍为 responding
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'e1', user_id: 'u1', type: 'emergency', status: 'responding' }],
    } as unknown as DbResult);
    // 2. SELECT emergency_responses FOR UPDATE → 响应状态已被另一并发请求改为 completed
    //    触发 line 538 状态校验失败，应在调用任何 UPDATE 之前抛出
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'completed' }],
    } as unknown as DbResult);

    await expect(
      emergencyService.updateResponseStatus('u1', 'r1', 'completed'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);

    // 关键断言：未调用任何 UPDATE/INSERT（避免重复完成、重复发积分、重复写评价）
    // 上面只 mock 了 2 次 SELECT，若代码继续调用第 3 次 query 会拿到 undefined 引发错误
    // 此处显式断言 earnCredits 未被调用，确保积分不重复发放
    expect(mockedEarnCredits).not.toHaveBeenCalled();
  });

  it('completed 并发：锁内求助状态已变为 resolved，抛 OrderStatusInvalidError', async () => {
    // 事务外查询响应记录
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);

    // 事务内锁查询：
    // 1. SELECT emergency_requests FOR UPDATE → 求助状态已被另一并发请求改为 resolved
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'e1', user_id: 'u1', type: 'emergency', status: 'resolved' }],
    } as unknown as DbResult);
    // 2. SELECT emergency_responses FOR UPDATE → 响应状态仍为 accepted（在请求级联完成前）
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);

    await expect(
      emergencyService.updateResponseStatus('u1', 'r1', 'completed'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);

    expect(mockedEarnCredits).not.toHaveBeenCalled();
  });

  it('completed 权限：非求助者调用完成抛 PermissionDeniedError', async () => {
    // 事务外查询响应记录
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);

    // 事务内锁查询：
    // 1. SELECT emergency_requests FOR UPDATE → 求助者为 u1（不是调用者 u-other）
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'e1', user_id: 'u1', type: 'emergency', status: 'responding' }],
    } as unknown as DbResult);
    // 2. SELECT emergency_responses FOR UPDATE
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'r1', request_id: 'e1', responder_id: 'u-responder', status: 'accepted' }],
    } as unknown as DbResult);

    await expect(
      emergencyService.updateResponseStatus('u-other', 'r1', 'completed'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    expect(mockedEarnCredits).not.toHaveBeenCalled();
  });
});
