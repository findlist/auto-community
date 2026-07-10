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

beforeEach(() => {
  mockedQuery.mockReset();
  mockClient.query.mockReset();
  mockedTransaction.mockClear();
  mockedAi.mockReset();
  mockedAi.mockResolvedValue(null); // 默认 AI 不可用
  mockedIdempotency.mockReset();
  mockedIdempotency.mockResolvedValue({ hit: false });
  mockedNotify.mockClear();
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
      .mockResolvedValueOnce({ rows: [{ nickname: '李四' }] } as unknown as DbResult) // 响应者昵称
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
    expect(banSql).toContain("INTERVAL '7 days'");
    expect(banSql).toContain('ban_until = NOW()');
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
});
