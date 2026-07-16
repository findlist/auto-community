/**
 * time-bank.service updateService SQL 注入防护测试（vitest 版）
 *
 * 设计原因：
 * - 原版使用 node:assert 自执行脚本风格，被 vitest.config.ts 排除，未纳入 CI 健康校验
 * - 原版复刻了一份 filterUpdateFields 函数，与 time-bank.service.ts 真实实现存在字段漂移
 *   （真实代码已扩展为 8 字段含 images，原复刻版本仅 7 字段）
 * - 重写为 vitest describe/it 风格，通过 vi.mock 调用真实 updateService 实现，
 *   测试守护的是真实代码而非过时复刻，确保白名单过滤逻辑变更时测试同步生效
 *
 * 覆盖范围：
 * - 服务不存在/非 owner/状态非法时的防御性边界
 * - 恶意字段名（含 SQL 关键字）被过滤，不进入 SET 子句
 * - 白名单外字段（user_id / created_at / is_admin 等）被忽略并触发告警
 * - 值通过参数化占位符（$1, $2...）传递，SQL 文本不含用户输入字面量
 * - 8 个白名单字段（含 images）可正常更新
 * - 空更新对象不执行 UPDATE，直接返回原 service
 * - undefined 字段被跳过
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 通过 vi.hoisted 提前创建 mock 引用，确保 vi.mock 工厂内能安全访问
const {
  mockQuery,
  mockTimeServiceCacheInvalidate,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTimeServiceCacheInvalidate: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

// mock database：仅暴露 updateService 实际使用的 query 函数
vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

// mock cache.service：避免真实 Redis 连接，仅断言 invalidate 被调用
vi.mock('../cache.service', () => ({
  timeServiceCache: {
    get: vi.fn(),
    invalidate: mockTimeServiceCacheInvalidate,
  },
}));

// mock notification.service：避免真实通知副作用
vi.mock('../notification.service', () => ({
  notificationService: {
    notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
    notifyTimeBankTransaction: vi.fn().mockResolvedValue(undefined),
    notifyFamilyBindingChange: vi.fn().mockResolvedValue(undefined),
    createNotification: vi.fn(),
  },
}));

// mock reputation.service：避免真实信誉计算副作用
vi.mock('../reputation.service', () => ({
  reputationService: {
    updateReputationScore: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock idempotency：updateService 不使用，但 import 期需可解析
vi.mock('../../utils/idempotency', () => ({
  idempotency: {
    buildKey: vi.fn(),
    checkIdempotency: vi.fn(),
    setIdempotencyResult: vi.fn(),
  },
}));

// mock logger：捕获 warn 调用以便断言可疑字段告警
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { timeBankService } from '../time-bank.service';
import {
  NotFoundError,
  PermissionDeniedError,
  OrderStatusInvalidError,
} from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
  mockTimeServiceCacheInvalidate.mockReset();
  mockTimeServiceCacheInvalidate.mockResolvedValue(undefined);
  mockLoggerWarn.mockReset();
});

// 构造一个合法的 active service 行数据（owner = 'user-1'）
function mockServiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    user_id: 'user-1',
    category: '家政',
    type: 'provide',
    title: '保洁服务',
    description: '专业保洁',
    duration_minutes: 60,
    certification: null,
    location: null,
    address: '某小区',
    images: [],
    status: 'active',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    deleted_at: null,
    ...overrides,
  };
}

describe('time-bank.service updateService SQL 注入防护', () => {
  it('服务不存在时抛 NotFoundError，不执行 UPDATE', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      timeBankService.updateService('nonexistent', 'user-1', { title: '新标题' }),
    ).rejects.toThrow(NotFoundError);

    // 仅一次 SELECT 调用，不应触发 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockTimeServiceCacheInvalidate).not.toHaveBeenCalled();
  });

  it('非 owner 调用时抛 PermissionDeniedError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });

    await expect(
      timeBankService.updateService('svc-1', 'attacker', { title: '恶意修改' }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('completed 状态抛 OrderStatusInvalidError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow({ status: 'completed' })] });

    await expect(
      timeBankService.updateService('svc-1', 'user-1', { title: '修改' }),
    ).rejects.toThrow(OrderStatusInvalidError);
  });

  it('closed 状态抛 OrderStatusInvalidError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow({ status: 'closed' })] });

    await expect(
      timeBankService.updateService('svc-1', 'user-1', { title: '修改' }),
    ).rejects.toThrow(OrderStatusInvalidError);
  });

  it('恶意字段名（title; DROP TABLE users; --）应被过滤，UPDATE SQL 不含危险关键字', async () => {
    // 第一次 query：SELECT 返回 service
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });
    // 第二次 query：UPDATE 返回更新后的行
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow({ title: '正常标题' })] });

    // 构造恶意 payload：键名为 SQL 注入片段，键值也是危险字符串
    const maliciousData = {
      'title; DROP TABLE users; --': 'malicious',
      title: '正常标题',
    };
    await timeBankService.updateService('svc-1', 'user-1', maliciousData);

    // 第二次 query 是 UPDATE，捕获 SQL 文本与参数
    const updateCall = mockQuery.mock.calls[1];
    const sqlText = updateCall[0] as string;
    const sqlParams = updateCall[1] as unknown[];

    // SET 子句不应包含任何 SQL 危险关键字
    expect(sqlText).not.toMatch(/DROP\s+TABLE/i);
    expect(sqlText).not.toMatch(/;\s*--/);
    // 仅 title 一个字段进入 SET
    expect(sqlText).toMatch(/title = \$1/);
    expect(sqlParams).toEqual(['正常标题', 'svc-1']);
  });

  it('白名单外字段（user_id / created_at / is_admin）应被忽略并触发 warn 告警', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow({ title: '新标题' })] });

    const data = {
      title: '新标题',
      user_id: 'attacker_user_id', // 白名单外
      created_at: '2020-01-01', // 白名单外
      is_admin: true, // 白名单外
    };
    await timeBankService.updateService('svc-1', 'user-1', data);

    const updateCall = mockQuery.mock.calls[1];
    const sqlText = updateCall[0] as string;
    const sqlParams = updateCall[1] as unknown[];

    // 仅 title 进入 SET 子句
    expect(sqlText).toMatch(/title = \$1/);
    expect(sqlParams).toEqual(['新标题', 'svc-1']);

    // warn 告警应记录所有可疑字段，便于安全审计追踪
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    const warnPayload = mockLoggerWarn.mock.calls[0][0] as { suspiciousFields: string[] };
    expect(warnPayload.suspiciousFields).toEqual(
      expect.arrayContaining(['user_id', 'created_at', 'is_admin']),
    );
    expect(warnPayload.suspiciousFields).toHaveLength(3);
  });

  it('值通过参数化占位符传递，SQL 文本不含用户输入字面量', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });

    // 值为典型 SQL 注入 payload，验证参数化查询天然防御
    const data = { title: "'; DROP TABLE users; --" };
    await timeBankService.updateService('svc-1', 'user-1', data);

    const updateCall = mockQuery.mock.calls[1];
    const sqlText = updateCall[0] as string;
    const sqlParams = updateCall[1] as unknown[];

    // SQL 文本中不应出现用户提供的危险值
    expect(sqlText).not.toMatch(/DROP\s+TABLE/i);
    expect(sqlText).not.toContain("';");
    // 危险值作为参数原样传递（参数化查询天然防注入）
    expect(sqlParams[0]).toBe("'; DROP TABLE users; --");
  });

  it('8 个白名单字段（含 images）全部可正常更新', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });

    // 8 个字段全部提供合法值
    const data = {
      type: 'provide',
      category: 'repair',
      title: '修水管',
      description: '专业修水管',
      duration_minutes: 60,
      address: '某小区',
      status: 'active',
      images: ['/uploads/test.png'], // 合法 URL，可通过 validateImageUrls
    };
    await timeBankService.updateService('svc-1', 'user-1', data);

    const updateCall = mockQuery.mock.calls[1];
    const sqlText = updateCall[0] as string;
    const sqlParams = updateCall[1] as unknown[];

    // SET 子句应包含 8 个字段的占位符（$1 ~ $8），$9 为 id
    // 占位符序号连续递增
    for (let i = 1; i <= 8; i++) {
      expect(sqlText).toMatch(new RegExp(`\\$${i}`));
    }
    // 参数数组应包含 8 个值 + 1 个 id
    expect(sqlParams).toHaveLength(9);
    expect(sqlParams[8]).toBe('svc-1');
    // 无可疑字段告警
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('空更新对象不执行 UPDATE，直接返回原 service', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });

    const result = await timeBankService.updateService('svc-1', 'user-1', {});

    // 仅一次 SELECT，不应触发 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // 返回的是原 service（toService 转换后的结构）
    expect(result.id).toBe('svc-1');
    expect(result.title).toBe('保洁服务');
    // 无缓存失效（无 UPDATE）
    expect(mockTimeServiceCacheInvalidate).not.toHaveBeenCalled();
  });

  it('undefined 字段被跳过，仅写入已定义字段', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [mockServiceRow({ title: '新标题' })] });

    // description 为 undefined，应被跳过
    const data = { title: '新标题', description: undefined };
    await timeBankService.updateService('svc-1', 'user-1', data);

    const updateCall = mockQuery.mock.calls[1];
    const sqlText = updateCall[0] as string;
    const sqlParams = updateCall[1] as unknown[];

    // SET 子句位于 UPDATE ... SET 与 WHERE 之间，仅应包含 title
    // 设计原因：RETURNING 子句必然列出全列表（含 description 列），不能对整段 SQL 断言
    const setClause = sqlText.match(/SET (.+?) WHERE/)?.[1] ?? '';
    expect(setClause).toMatch(/title = \$1/);
    expect(setClause).not.toMatch(/description/);
    expect(sqlParams).toEqual(['新标题', 'svc-1']);
  });
});
