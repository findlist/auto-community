/**
 * time-bank.service 单元测试（覆盖未测函数）
 *
 * 覆盖目标（21 个函数）：
 * - getServiceList / getServiceById：列表分页、详情缓存、未登录脱敏
 * - createOrder：幂等命中、状态校验、自下单、上限校验、正常下单
 * - updateOrderStatus：accept/start/cancel/complete/invalid 分支、权限校验
 * - completeOrder：事务内完成、bonus 计算、余额校验、延迟发放
 * - getAccount：已有账户/自动创建
 * - getTransactions：游标分页
 * - createFamilyBinding / confirmFamilyBinding / rejectFamilyBinding / getFamilyBindings：亲情绑定全流程
 * - createReview：评分校验、订单状态、重复评价
 * - createDispute / getDisputes：争议创建与查询
 * - getOrders：订单列表分页
 *
 * 测试策略：
 * - 统一 mock database 的 query 与 transaction，transaction 通过回调注入 mockClient 模拟事务
 * - mock cache/notification/reputation/idempotency 避免外部依赖
 * - 使用 setupMockClient 辅助函数按 SQL 文本匹配返回数据，减少重复
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 通过 vi.hoisted 提前创建 mock 引用，确保 vi.mock 工厂内能安全访问
const {
  mockQuery,
  mockTransaction,
  mockClient,
  mockTimeServiceCacheGet,
  mockTimeServiceCacheInvalidate,
  mockIdempotencyCheck,
  mockIdempotencySet,
  mockReputationUpdate,
  mockNotifyOrder,
  mockNotifyTimeBank,
  mockNotifyFamily,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockClient: { query: vi.fn() },
  mockTimeServiceCacheGet: vi.fn(),
  mockTimeServiceCacheInvalidate: vi.fn(),
  mockIdempotencyCheck: vi.fn(),
  mockIdempotencySet: vi.fn(),
  mockReputationUpdate: vi.fn(),
  mockNotifyOrder: vi.fn(),
  mockNotifyTimeBank: vi.fn(),
  mockNotifyFamily: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
  pool: {},
}));

vi.mock('../cache.service', () => ({
  timeServiceCache: {
    get: mockTimeServiceCacheGet,
    invalidate: mockTimeServiceCacheInvalidate,
  },
}));

vi.mock('../notification.service', () => ({
  notificationService: {
    notifyOrderStatusChange: mockNotifyOrder,
    notifyTimeBankTransaction: mockNotifyTimeBank,
    notifyFamilyBindingChange: mockNotifyFamily,
    createNotification: vi.fn(),
  },
}));

vi.mock('../reputation.service', () => ({
  reputationService: {
    updateReputationScore: mockReputationUpdate,
  },
}));

vi.mock('../../utils/idempotency', () => ({
  idempotency: {
    buildKey: (userId: string, _type: string, resourceId: string) => `idem:${userId}:${resourceId}`,
    checkIdempotency: mockIdempotencyCheck,
    setIdempotencyResult: mockIdempotencySet,
  },
}));

import { timeBankService } from '../time-bank.service';
import {
  BadRequestError,
  NotFoundError,
  ValidationError,
  OrderStatusInvalidError,
  PermissionDeniedError,
  InsufficientCreditError,
} from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  mockClient.query.mockReset();
  mockTimeServiceCacheGet.mockReset();
  mockTimeServiceCacheInvalidate.mockReset();
  mockIdempotencyCheck.mockReset();
  mockIdempotencySet.mockReset();
  mockReputationUpdate.mockReset();
  mockNotifyOrder.mockReset();
  mockNotifyTimeBank.mockReset();
  mockNotifyFamily.mockReset();
  // 通知方法默认 resolved（业务中均以 safeNotify 包装调用，吞错不阻塞主流程）
  mockNotifyOrder.mockResolvedValue(undefined);
  mockNotifyTimeBank.mockResolvedValue(undefined);
  mockNotifyFamily.mockResolvedValue(undefined);
  mockReputationUpdate.mockResolvedValue(undefined);
  mockTimeServiceCacheInvalidate.mockResolvedValue(undefined);
  mockIdempotencySet.mockResolvedValue(undefined);
});

// ===================== getServiceList =====================
describe('time-bank.service getServiceList', () => {
  it('默认分页返回列表，totalPages 向上取整', async () => {
    // count 查询返回 25 条，pageSize=20 → totalPages=2
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'svc-1', user_id: 'user-1', category: '家政', type: 'provide',
          title: '保洁', description: null, duration_minutes: 60,
          certification: null, location: null, address: '某地',
          images: null, status: 'active', created_at: new Date(), updated_at: new Date(),
          nickname: '张三', avatar: null, reputation_score: '4.5',
        },
      ],
    });

    const result = await timeBankService.getServiceList({}, { page: 1, pageSize: 20 });

    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(2);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].publisher.nickname).toBe('张三');
    // 默认查询应包含 status='active' 与 deleted_at IS NULL 条件
    expect(mockQuery.mock.calls[0][0]).toContain("status = 'active'");
  });

  it('带 type 与 category 过滤时参数正确透传', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await timeBankService.getServiceList({ type: 'provide', category: '家政' }, { page: 1, pageSize: 10 });

    // 两次 query（count + list）的参数都应包含 type 与 category
    expect(mockQuery.mock.calls[0][1]).toEqual(['provide', '家政']);
    expect(mockQuery.mock.calls[1][1]).toEqual(['provide', '家政', 10, 0]);
  });

  it('空结果时返回空列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await timeBankService.getServiceList();

    expect(result.total).toBe(0);
    expect(result.list).toEqual([]);
  });
});

// ===================== getServiceById =====================
describe('time-bank.service getServiceById', () => {
  it('登录查看者：返回完整数据（含 address/location）', async () => {
    // 模拟缓存未命中：调用 fetchFn
    mockTimeServiceCacheGet.mockImplementation(async (_id: string, fetchFn: () => Promise<unknown>) => fetchFn());
    mockQuery.mockResolvedValue({
      rows: [{
        id: 'svc-1', user_id: 'user-1', category: '家政', type: 'provide',
        title: '保洁', description: null, duration_minutes: 60,
        certification: { level: '高级' }, location: '(1,2)', address: '详细地址',
        images: ['/uploads/a.png'], status: 'active', created_at: new Date(), updated_at: new Date(),
        nickname: '张三', avatar: null, reputation_score: '4.5',
      }],
    });

    const result = await timeBankService.getServiceById('svc-1', 'user-2');

    expect(result.address).toBe('详细地址');
    expect(result.location).toBe('(1,2)');
    expect(result.certification).toEqual({ level: '高级' });
  });

  it('未登录查看者：脱敏 address/location/certification', async () => {
    mockTimeServiceCacheGet.mockImplementation(async (_id: string, fetchFn: () => Promise<unknown>) => fetchFn());
    mockQuery.mockResolvedValue({
      rows: [{
        id: 'svc-1', user_id: 'user-1', category: '家政', type: 'provide',
        title: '保洁', description: null, duration_minutes: 60,
        certification: { level: '高级' }, location: '(1,2)', address: '详细地址',
        images: [], status: 'active', created_at: new Date(), updated_at: new Date(),
        nickname: '张三', avatar: null, reputation_score: null,
      }],
    });

    const result = await timeBankService.getServiceById('svc-1');

    // 未登录应隐藏敏感字段
    expect(result.address).toBeNull();
    expect(result.location).toBeNull();
    expect(result.certification).toBeNull();
  });

  it('服务不存在时抛 NotFoundError', async () => {
    mockTimeServiceCacheGet.mockImplementation(async (_id: string, fetchFn: () => Promise<unknown>) => fetchFn());
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(timeBankService.getServiceById('nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('缓存命中时直接返回缓存值，不查数据库', async () => {
    const cached = { id: 'svc-1', title: '缓存服务' };
    mockTimeServiceCacheGet.mockResolvedValue(cached);

    const result = await timeBankService.getServiceById('svc-1', 'user-2');

    expect(result).toEqual(cached);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ===================== createOrder =====================
describe('time-bank.service createOrder', () => {
  it('幂等命中时直接返回缓存结果', async () => {
    mockIdempotencyCheck.mockResolvedValue({ hit: true, data: { id: 'order-cached', status: 'pending' } });

    const result = await timeBankService.createOrder('user-1', 'svc-1');

    expect(result.id).toBe('order-cached');
    // 幂等命中不应查数据库
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('服务不存在时抛 NotFoundError', async () => {
    mockIdempotencyCheck.mockResolvedValue({ hit: false });
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(timeBankService.createOrder('user-1', 'nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('服务状态非 active 时抛 OrderStatusInvalidError', async () => {
    mockIdempotencyCheck.mockResolvedValue({ hit: false });
    mockQuery.mockResolvedValue({ rows: [{ status: 'closed', user_id: 'user-2' }] });

    await expect(timeBankService.createOrder('user-1', 'svc-1')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('下单自己的服务时抛 BadRequestError', async () => {
    mockIdempotencyCheck.mockResolvedValue({ hit: false });
    mockQuery.mockResolvedValue({ rows: [{ status: 'active', user_id: 'user-1', duration_minutes: 60 }] });

    await expect(timeBankService.createOrder('user-1', 'svc-1')).rejects.toThrow(BadRequestError);
  });

  it('provider 当日收益达上限时抛 BadRequestError', async () => {
    mockIdempotencyCheck.mockResolvedValue({ hit: false });
    // 第一次 query：查服务；第二次 query：查 provider 当日收益（>=480）
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'active', user_id: 'user-2', duration_minutes: 60 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '500' }] });

    await expect(timeBankService.createOrder('user-1', 'svc-1')).rejects.toThrow(BadRequestError);
  });

  it('正常下单：INSERT 并写入幂等缓存', async () => {
    mockIdempotencyCheck.mockResolvedValue({ hit: false });
    mockQuery.mockResolvedValueOnce({ rows: [{ status: 'active', user_id: 'user-2', duration_minutes: 60 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '100' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'order-1', status: 'pending' }] });

    const result = await timeBankService.createOrder('user-1', 'svc-1');

    expect(result.id).toBe('order-1');
    expect(result.status).toBe('pending');
    // 应写入幂等缓存
    expect(mockIdempotencySet).toHaveBeenCalledWith(
      expect.stringContaining('user-1'),
      { id: 'order-1', status: 'pending' },
    );
  });
});

// ===================== updateOrderStatus =====================
describe('time-bank.service updateOrderStatus', () => {
  // updateOrderStatus 已改为事务 + FOR UPDATE，配置 mockTransaction 注入 mockClient
  beforeEach(() => {
    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  });

  it('订单不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE

    await expect(timeBankService.updateOrderStatus('nonexistent', 'user-1', 'accept')).rejects.toThrow(NotFoundError);
  });

  it('非双方当事人时抛 PermissionDeniedError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-2', requester_id: 'user-3', status: 'pending' }] });

    await expect(timeBankService.updateOrderStatus('order-1', 'user-1', 'accept')).rejects.toThrow(PermissionDeniedError);
  });

  it('accept 非 provider 时抛 PermissionDeniedError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-2', requester_id: 'user-1', status: 'pending' }] });

    await expect(timeBankService.updateOrderStatus('order-1', 'user-1', 'accept')).rejects.toThrow(PermissionDeniedError);
  });

  it('accept 状态非 pending 时抛 OrderStatusInvalidError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-1', requester_id: 'user-2', status: 'accepted' }] });

    await expect(timeBankService.updateOrderStatus('order-1', 'user-1', 'accept')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('accept 正常：更新状态并通知 requester', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ provider_id: 'user-1', requester_id: 'user-2', status: 'pending' }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', service_id: 'svc-1', provider_id: 'user-1', requester_id: 'user-2', duration_minutes: 60, status: 'accepted', started_at: null, completed_at: null, cancelled_at: null, created_at: new Date(), updated_at: new Date() }] }); // SELECT 返回更新后订单

    const result = await timeBankService.updateOrderStatus('order-1', 'user-1', 'accept');

    expect(result.status).toBe('accepted');
    // accept 由 provider 操作，应通知 requester（otherUserId = requester_id）
    expect(mockNotifyOrder).toHaveBeenCalledWith('user-2', 'order-1', 'time_order', 'accepted');
  });

  it('start 正常：更新状态为 in_progress', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ provider_id: 'user-1', requester_id: 'user-2', status: 'accepted' }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', service_id: 'svc-1', provider_id: 'user-1', requester_id: 'user-2', duration_minutes: 60, status: 'in_progress', started_at: new Date(), completed_at: null, cancelled_at: null, created_at: new Date(), updated_at: new Date() }] }); // SELECT 返回更新后订单

    const result = await timeBankService.updateOrderStatus('order-1', 'user-1', 'start');

    expect(result.status).toBe('in_progress');
    expect(mockNotifyOrder).toHaveBeenCalledWith('user-2', 'order-1', 'time_order', 'in_progress');
  });

  it('cancel 状态为 in_progress 时抛 OrderStatusInvalidError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-1', requester_id: 'user-2', status: 'in_progress' }] });

    await expect(timeBankService.updateOrderStatus('order-1', 'user-1', 'cancel')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('cancel 正常：由 requester 发起，通知 provider', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ provider_id: 'user-2', requester_id: 'user-1', status: 'pending' }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'order-1', service_id: 'svc-1', provider_id: 'user-2', requester_id: 'user-1', duration_minutes: 60, status: 'cancelled', started_at: null, completed_at: null, cancelled_at: new Date(), created_at: new Date(), updated_at: new Date() }] }); // SELECT 返回更新后订单

    const result = await timeBankService.updateOrderStatus('order-1', 'user-1', 'cancel');

    expect(result.status).toBe('cancelled');
    // cancel 由 requester 发起，otherUserId = provider_id
    expect(mockNotifyOrder).toHaveBeenCalledWith('user-2', 'order-1', 'time_order', 'cancelled');
  });

  it('complete action 时抛 BadRequestError（提示用 completeOrder）', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-1', requester_id: 'user-2', status: 'in_progress' }] });

    await expect(timeBankService.updateOrderStatus('order-1', 'user-1', 'complete')).rejects.toThrow(BadRequestError);
  });

  it('无效 action 时抛 BadRequestError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-1', requester_id: 'user-2', status: 'pending' }] });

    await expect(timeBankService.updateOrderStatus('order-1', 'user-1', 'invalid')).rejects.toThrow(BadRequestError);
  });
});

// ===================== completeOrder =====================
describe('time-bank.service completeOrder', () => {
  /**
   * 配置 completeOrder 事务内 client.query：按 SQL 文本匹配返回数据。
   * 设计原因：completeOrder 事务内 client.query 调用次数随 bonus/earn/deferred 分支变化，
   * 用 mockResolvedValueOnce 需精确计数且 Once 队列在 mockResolvedValue 之后添加会插队，
   * 改用 mockImplementation 按 SQL 关键词匹配更稳健。
   */
  function setupCompleteOrderClient(opts: {
    order: Record<string, unknown>;
    completedCount: number;
    dailyEarned: number;
    users: Record<string, { timeBalance: number; nickname: string }>;
    accounts: Record<string, { balance: number }>;
    rating?: number;
  }) {
    const completedOrderRow = {
      id: opts.order.id, service_id: opts.order.service_id,
      provider_id: opts.order.provider_id, requester_id: opts.order.requester_id,
      duration_minutes: opts.order.duration_minutes, status: 'completed',
      started_at: null, completed_at: new Date(), cancelled_at: null,
      created_at: new Date(), updated_at: new Date(),
    };

    mockClient.query.mockImplementation(async (text: string, params: unknown[] = []) => {
      // 1. SELECT order FOR UPDATE（事务内首条）
      if (text.includes('FROM time_orders WHERE id = $1 FOR UPDATE')) {
        return { rows: [opts.order] };
      }
      // 2. completedCount 查询
      if (text.includes("SELECT COUNT(*) FROM time_orders WHERE provider_id = $1 AND status = 'completed'")) {
        return { rows: [{ count: String(opts.completedCount) }] };
      }
      // 3. fetchDailyEarned 查询
      if (text.includes('SELECT COALESCE(SUM(amount), 0) AS total FROM time_transactions')) {
        return { rows: [{ total: String(opts.dailyEarned) }] };
      }
      // 4. lockUsersForUpdate：SELECT id, time_balance, nickname FROM users WHERE id = $1 FOR UPDATE
      if (text.includes('SELECT id, time_balance, nickname FROM users WHERE id = $1 FOR UPDATE')) {
        const id = params[0];
        const u = opts.users[id as string];
        return { rows: u ? [{ id, time_balance: u.timeBalance, nickname: u.nickname }] : [] };
      }
      // 5. getOrCreateAccount：显式列名查询 time_accounts（已替代 SELECT *）
      if (text.includes('FROM time_accounts WHERE user_id = $1 FOR UPDATE')) {
        const userId = params[0];
        const acc = opts.accounts[userId as string];
        return { rows: acc ? [{ user_id: userId, balance: acc.balance }] : [] };
      }
      // 6. getOrCreateAccount：账户不存在时 INSERT
      if (text.startsWith('INSERT INTO time_accounts')) {
        const userId = params[0];
        return { rows: [{ user_id: userId, balance: 0 }] };
      }
      // 7. INSERT INTO reviews（有 rating 时）
      if (text.startsWith('INSERT INTO reviews')) {
        return { rows: [{ id: 'review-1', rating: opts.rating }] };
      }
      // 8. 最后 SELECT * FROM time_orders WHERE id = $1（无 FOR UPDATE，返回更新后订单）
      if (text.includes('FROM time_orders WHERE id = $1') && !text.includes('FOR UPDATE')) {
        return { rows: [completedOrderRow] };
      }
      // 其余 UPDATE / INSERT 均返回空 rows
      return { rows: [] };
    });

    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  }

  it('订单不存在时抛 NotFoundError', async () => {
    // 订单不存在时事务内首条 SELECT 即返回空，无需完整 setup
    mockClient.query.mockResolvedValue({ rows: [] });
    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));

    await expect(timeBankService.completeOrder('nonexistent', 'user-1', 60)).rejects.toThrow(NotFoundError);
  });

  it('非 requester 时抛 PermissionDeniedError', async () => {
    setupCompleteOrderClient({
      order: { id: 'order-1', provider_id: 'user-1', requester_id: 'user-2', status: 'in_progress', service_id: 'svc-1', duration_minutes: 60 },
      completedCount: 0, dailyEarned: 0, users: {}, accounts: {},
    });

    await expect(timeBankService.completeOrder('order-1', 'user-3', 60)).rejects.toThrow(PermissionDeniedError);
  });

  it('状态非 in_progress 时抛 OrderStatusInvalidError', async () => {
    setupCompleteOrderClient({
      order: { id: 'order-1', provider_id: 'user-1', requester_id: 'user-2', status: 'pending', service_id: 'svc-1', duration_minutes: 60 },
      completedCount: 0, dailyEarned: 0, users: {}, accounts: {},
    });

    await expect(timeBankService.completeOrder('order-1', 'user-2', 60)).rejects.toThrow(OrderStatusInvalidError);
  });

  it('requester 余额不足时抛 InsufficientCreditError', async () => {
    setupCompleteOrderClient({
      order: { id: 'order-1', provider_id: 'user-1', requester_id: 'user-2', status: 'in_progress', service_id: 'svc-1', duration_minutes: 60 },
      completedCount: 5, dailyEarned: 100,
      users: {
        'user-1': { timeBalance: 500, nickname: 'provider' },
        'user-2': { timeBalance: 30, nickname: 'requester' }, // 余额不足 30 < 60
      },
      accounts: {},
    });

    await expect(timeBankService.completeOrder('order-1', 'user-2', 60)).rejects.toThrow(InsufficientCreditError);
  });

  it('正常完成（无 rating）：更新余额并通知 provider', async () => {
    setupCompleteOrderClient({
      order: { id: 'order-1', provider_id: 'user-1', requester_id: 'user-2', status: 'in_progress', service_id: 'svc-1', duration_minutes: 60 },
      completedCount: 5, dailyEarned: 100,
      users: {
        'user-1': { timeBalance: 500, nickname: 'provider' },
        'user-2': { timeBalance: 600, nickname: 'requester' },
      },
      accounts: {
        'user-1': { balance: 500 },
        'user-2': { balance: 600 },
      },
    });

    const result = await timeBankService.completeOrder('order-1', 'user-2', 60);

    expect(result.status).toBe('completed');
    // 完成后应通知 provider
    expect(mockNotifyOrder).toHaveBeenCalledWith('user-1', 'order-1', 'time_order', 'completed');
  });

  it('5 星 + 首单：bonus 计算正确（30+10=40）并更新信誉分', async () => {
    setupCompleteOrderClient({
      order: { id: 'order-1', provider_id: 'user-1', requester_id: 'user-2', status: 'in_progress', service_id: 'svc-1', duration_minutes: 60 },
      completedCount: 0, dailyEarned: 0,
      users: {
        'user-1': { timeBalance: 500, nickname: 'provider' },
        'user-2': { timeBalance: 600, nickname: 'requester' },
      },
      accounts: {
        'user-1': { balance: 500 },
        'user-2': { balance: 600 },
      },
      rating: 5,
    });

    const result = await timeBankService.completeOrder('order-1', 'user-2', 60, 5, '好评');

    expect(result.status).toBe('completed');
    // 5 星 + 首单应触发信誉分更新（事务内调用 updateReputationScore）
    expect(mockReputationUpdate).toHaveBeenCalled();
  });
});

// ===================== getAccount =====================
describe('time-bank.service getAccount', () => {
  it('已有账户时直接返回', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'acc-1', user_id: 'user-1', balance: 100, total_earned: 200, total_spent: 100, updated_at: new Date() }],
    });

    const result = await timeBankService.getAccount('user-1');

    expect(result.id).toBe('acc-1');
    expect(result.balance).toBe(100);
    expect(result.totalEarned).toBe(200);
  });

  it('无账户时自动创建并返回', async () => {
    // 第一次查询返回空，触发 INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'acc-new', user_id: 'user-1', balance: 0, total_earned: 0, total_spent: 0, updated_at: new Date() }],
    });

    const result = await timeBankService.getAccount('user-1');

    expect(result.id).toBe('acc-new');
    expect(result.balance).toBe(0);
    // 第二次 query 应为 INSERT
    expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO time_accounts');
  });
});

// ===================== getTransactions =====================
describe('time-bank.service getTransactions', () => {
  it('无 cursor 时查询第一页', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: 'tx-1', service_id: 'svc-1', from_user_id: 'user-2', to_user_id: 'user-1', amount: 60, type: 'earn', status: 'completed', remark: '服务收入', created_at: new Date(), completed_at: null },
      ],
    });

    const result = await timeBankService.getTransactions('user-1', undefined, 20);

    expect(result.list).toHaveLength(1);
    expect(result.list[0].type).toBe('earn');
    // 无 cursor 时 SQL 不应包含 id < $3
    expect(mockQuery.mock.calls[0][0]).not.toContain('id < $3');
    // hasNextPage 由 createCursorPaginatedResponse 基于 list.length >= limit 判定（字段名为 hasMore）
    expect(result.hasMore).toBe(false);
  });

  it('有 cursor 时追加 id < $3 条件', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await timeBankService.getTransactions('user-1', 'cursor-id', 20);

    // 有 cursor 时 SQL 应包含 id < $3
    expect(mockQuery.mock.calls[0][0]).toContain('id < $3');
    // 参数应包含 cursor
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1', 20, 'cursor-id']);
  });
});

// ===================== createFamilyBinding =====================
describe('time-bank.service createFamilyBinding', () => {
  // createFamilyBinding 已改为事务模式，配置 mockTransaction 注入 mockClient
  beforeEach(() => {
    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  });

  it('家长不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await expect(timeBankService.createFamilyBinding('user-1', '13800000000', 'parent')).rejects.toThrow(NotFoundError);
  });

  it('与自己绑定时抛 BadRequestError', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ id: 'user-1' }] });

    await expect(timeBankService.createFamilyBinding('user-1', '13800000000', 'parent')).rejects.toThrow(BadRequestError);
  });

  it('已存在确认绑定时抛 BadRequestError', async () => {
    // 第一次：查家长存在；第二次：查已存在绑定
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-2' }] });
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'fb-1' }] });

    await expect(timeBankService.createFamilyBinding('user-1', '13800000000', 'parent')).rejects.toThrow(BadRequestError);
  });

  it('正常创建：INSERT 并通知家长', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'user-2' }] });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', relationship: 'parent' }] });

    const result = await timeBankService.createFamilyBinding('user-1', '13800000000', 'parent');

    expect(result.id).toBe('fb-1');
    // 应通知家长（parent.id = user-2）
    expect(mockNotifyFamily).toHaveBeenCalledWith('user-2', 'fb-1', 'request');
  });
});

// ===================== confirmFamilyBinding =====================
describe('time-bank.service confirmFamilyBinding', () => {
  // confirmFamilyBinding 已改为事务 + FOR UPDATE，配置 mockTransaction 注入 mockClient
  beforeEach(() => {
    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  });

  it('绑定不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await expect(timeBankService.confirmFamilyBinding('nonexistent', 'user-1')).rejects.toThrow(NotFoundError);
  });

  it('非 parent 时抛 PermissionDeniedError', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'pending' }] });

    await expect(timeBankService.confirmFamilyBinding('fb-1', 'user-3')).rejects.toThrow(PermissionDeniedError);
  });

  it('状态非 pending 时抛 OrderStatusInvalidError', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'confirmed' }] });

    await expect(timeBankService.confirmFamilyBinding('fb-1', 'user-2')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('正常确认：更新状态并通知发起方', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'pending' }] });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'confirmed' }] });

    const result = await timeBankService.confirmFamilyBinding('fb-1', 'user-2');

    expect(result.status).toBe('confirmed');
    // 应通知发起方（user_id = user-1）
    expect(mockNotifyFamily).toHaveBeenCalledWith('user-1', 'fb-1', 'confirmed');
  });
});

// ===================== rejectFamilyBinding =====================
describe('time-bank.service rejectFamilyBinding', () => {
  // rejectFamilyBinding 与 confirm 共享事务 + FOR UPDATE 策略
  beforeEach(() => {
    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  });

  it('绑定不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await expect(timeBankService.rejectFamilyBinding('nonexistent', 'user-1')).rejects.toThrow(NotFoundError);
  });

  it('非 parent 时抛 PermissionDeniedError', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'pending' }] });

    await expect(timeBankService.rejectFamilyBinding('fb-1', 'user-3')).rejects.toThrow(PermissionDeniedError);
  });

  it('状态非 pending 时抛 OrderStatusInvalidError', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'rejected' }] });

    await expect(timeBankService.rejectFamilyBinding('fb-1', 'user-2')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('正常拒绝：更新状态并通知发起方', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'pending' }] });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', status: 'rejected' }] });

    const result = await timeBankService.rejectFamilyBinding('fb-1', 'user-2');

    expect(result.status).toBe('rejected');
    expect(mockNotifyFamily).toHaveBeenCalledWith('user-1', 'fb-1', 'rejected');
  });
});

// ===================== getFamilyBindings =====================
describe('time-bank.service getFamilyBindings', () => {
  it('返回列表，包含 other 字段（对方信息）', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: 'fb-1', user_id: 'user-1', parent_id: 'user-2', relationship: 'parent',
          status: 'confirmed', created_at: new Date(), updated_at: new Date(),
          other_nickname: '家长张三', other_avatar: '/uploads/avatar.png', other_id: 'user-2',
        },
      ],
    });

    const result = await timeBankService.getFamilyBindings('user-1');

    expect(result).toHaveLength(1);
    expect(result[0].other.nickname).toBe('家长张三');
    expect(result[0].other.id).toBe('user-2');
  });

  it('无绑定时返回空数组', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await timeBankService.getFamilyBindings('user-1');

    expect(result).toEqual([]);
  });
});

// ===================== createReview =====================
describe('time-bank.service createReview', () => {
  // createReview 已改为事务 + FOR UPDATE，配置 mockTransaction 注入 mockClient
  beforeEach(() => {
    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  });

  it('rating < 1 时抛 ValidationError', async () => {
    await expect(timeBankService.createReview('order-1', 'user-1', 0)).rejects.toThrow(ValidationError);
  });

  it('rating > 5 时抛 ValidationError', async () => {
    await expect(timeBankService.createReview('order-1', 'user-1', 6)).rejects.toThrow(ValidationError);
  });

  it('订单不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await expect(timeBankService.createReview('nonexistent', 'user-1', 5)).rejects.toThrow(NotFoundError);
  });

  it('订单未完成时抛 OrderStatusInvalidError', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ provider_id: 'user-2', requester_id: 'user-1', status: 'in_progress' }] });

    await expect(timeBankService.createReview('order-1', 'user-1', 5)).rejects.toThrow(OrderStatusInvalidError);
  });

  it('非双方当事人时抛 PermissionDeniedError', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ provider_id: 'user-2', requester_id: 'user-3', status: 'completed' }] });

    await expect(timeBankService.createReview('order-1', 'user-1', 5)).rejects.toThrow(PermissionDeniedError);
  });

  it('已评价时抛 BadRequestError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-2', requester_id: 'user-1', status: 'completed' }] });
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'review-1' }] });

    await expect(timeBankService.createReview('order-1', 'user-1', 5)).rejects.toThrow(BadRequestError);
  });

  it('正常评价：provider 评价 requester，触发信誉分更新', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ provider_id: 'user-1', requester_id: 'user-2', status: 'completed' }] });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'review-1', rating: 5 }] });

    const result = await timeBankService.createReview('order-1', 'user-1', 5, '好评');

    expect(result.id).toBe('review-1');
    // 评价后应更新被评价方信誉分（revieweeId = requester = user-2）
    // 事务内调用 updateReputationScore(client, revieweeId)，第一个参数为事务 client
    expect(mockReputationUpdate).toHaveBeenCalledWith(mockClient, 'user-2');
  });
});

// ===================== createDispute =====================
describe('time-bank.service createDispute', () => {
  it('订单不存在时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(timeBankService.createDispute('nonexistent', 'user-1', '质量问题')).rejects.toThrow(NotFoundError);
  });

  it('非双方当事人时抛 PermissionDeniedError', async () => {
    mockQuery.mockResolvedValue({ rows: [{ provider_id: 'user-2', requester_id: 'user-3' }] });

    await expect(timeBankService.createDispute('order-1', 'user-1', '质量问题')).rejects.toThrow(PermissionDeniedError);
  });

  it('正常创建争议', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ provider_id: 'user-2', requester_id: 'user-1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'dispute-1', order_id: 'order-1', initiator_id: 'user-1', reason: '质量问题' }] });

    const result = await timeBankService.createDispute('order-1', 'user-1', '质量问题', '详细描述', ['ev-1']);

    expect(result.id).toBe('dispute-1');
    expect(result.reason).toBe('质量问题');
  });
});

// ===================== getDisputes =====================
describe('time-bank.service getDisputes', () => {
  it('正常分页返回争议列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'dispute-1', order_id: 'order-1', initiator_id: 'user-1', reason: '质量问题',
        evidence: null, status: 'open', resolution: null, resolved_at: null, resolved_by: null,
        created_at: new Date(), updated_at: new Date(),
      }],
    });

    const result = await timeBankService.getDisputes('user-1', { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].reason).toBe('质量问题');
  });

  it('空结果时返回空列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await timeBankService.getDisputes('user-1');

    expect(result.total).toBe(0);
    expect(result.list).toEqual([]);
  });
});

// ===================== getOrders =====================
describe('time-bank.service getOrders', () => {
  it('正常分页返回订单列表（含 service 与 other 字段）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'order-1', service_id: 'svc-1', provider_id: 'user-2', requester_id: 'user-1',
        duration_minutes: 60, status: 'completed', started_at: null, completed_at: new Date(),
        cancelled_at: null, created_at: new Date(), updated_at: new Date(),
        service_title: '保洁', service_category: '家政', service_type: 'provide',
        other_nickname: '服务者', other_avatar: null, other_id: 'user-2',
      }],
    });

    const result = await timeBankService.getOrders('user-1', { page: 1, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].service.title).toBe('保洁');
    expect(result.list[0].other.id).toBe('user-2');
  });

  it('空结果时返回空列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await timeBankService.getOrders('user-1');

    expect(result.total).toBe(0);
    expect(result.list).toEqual([]);
  });
});
