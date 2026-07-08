/**
 * skill-order.service 单元测试
 *
 * 测试目标：
 * - createOrder 双花防护（幂等命中直接返回缓存 + freezeCredits 抛错时不创建订单）
 * - cancelOrder 退款（pending 状态仅解冻；accepted 状态解冻买家 + 扣回卖家）
 *
 * 测试策略：mock database / idempotency / credit.service / reputation.service，
 *           避免依赖真实数据库与 Redis。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：query / transaction 由测试控制返回值
vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: {},
}));

// mock idempotency 模块：避免依赖真实 Redis
vi.mock('../../utils/idempotency', () => ({
  idempotency: {
    buildKey: vi.fn().mockReturnValue('idempotency:user-1:skill_order:post-1'),
    checkIdempotency: vi.fn().mockResolvedValue({ hit: false }),
    setIdempotencyResult: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock reputation.service：避免依赖其内部实现
vi.mock('../reputation.service', () => ({
  reputationService: {
    updateReputationScore: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock notification.service：notifyOrderStatusChange 在 service 内以 fire-and-forget 方式调用，
// 必须 mock 避免 reach 真实 DB；同时 mock notifyOrderReceived 用于 acceptOrder 等场景
vi.mock('../notification.service', () => ({
  notificationService: {
    notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
    notifyOrderReceived: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock credit.service：避免依赖真实事务与余额计算
vi.mock('../credit.service', () => ({
  creditService: {
    freezeCredits: vi.fn().mockResolvedValue({ balance: 70 }),
    unfreezeCredits: vi.fn().mockResolvedValue({ balance: 100 }),
    settleCredits: vi.fn().mockResolvedValue({ sellerBalance: 100 }),
    deductCredits: vi.fn().mockResolvedValue({ balance: 50 }),
    earnCredits: vi.fn().mockResolvedValue({ balance: 100 }),
    checkBalance: vi.fn(),
    getCreditBalance: vi.fn(),
  },
}));

import { skillOrderService } from '../skill-order.service';
import { query, transaction } from '../../config/database';
import { idempotency } from '../../utils/idempotency';
import { creditService } from '../credit.service';
import { BadRequestError, NotFoundError, OrderStatusInvalidError, InsufficientCreditError, PermissionDeniedError } from '../../utils/errors';

const mockedQuery = vi.mocked(query);
const mockedTransaction = vi.mocked(transaction);
const mockedIdempotency = vi.mocked(idempotency);
const mockedCreditService = vi.mocked(creditService);

beforeEach(() => {
  vi.clearAllMocks();
  // 默认未命中幂等
  mockedIdempotency.checkIdempotency.mockResolvedValue({ hit: false });
});

describe('skill-order.service - createOrder 双花防护', () => {
  it('幂等命中时应直接返回缓存结果，不执行后续 DB 操作', async () => {
    const cached = { id: 'order-cached', postId: 'post-1', buyerId: 'user-1' };
    mockedIdempotency.checkIdempotency.mockResolvedValueOnce({ hit: true, data: cached });

    const result = await skillOrderService.createOrder('user-1', 'post-1');

    expect(result).toEqual(cached);
    // 不应执行 query / transaction / creditService
    expect(mockedQuery).not.toHaveBeenCalled();
    expect(mockedTransaction).not.toHaveBeenCalled();
    expect(mockedCreditService.freezeCredits).not.toHaveBeenCalled();
  });

  it('帖子不存在时应抛 NotFoundError 且不冻结积分', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    await expect(
      skillOrderService.createOrder('user-1', 'post-missing'),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(mockedCreditService.freezeCredits).not.toHaveBeenCalled();
    expect(mockedIdempotency.setIdempotencyResult).not.toHaveBeenCalled();
  });

  it('帖子状态非 active 时应抛 OrderStatusInvalidError', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'post-1', status: 'closed', user_id: 'seller-1', credit_price: 30 }],
    } as any);

    await expect(
      skillOrderService.createOrder('user-1', 'post-1'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });

  it('购买自己的帖子应抛 BadRequestError', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'post-1', status: 'active', user_id: 'user-1', credit_price: 30 }],
    } as any);

    await expect(
      skillOrderService.createOrder('user-1', 'post-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('帖子已过期时应抛 BadRequestError', async () => {
    // expires_at 早于当前时间
    const expired = new Date(Date.now() - 86400_000).toISOString();
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'post-1', status: 'active', user_id: 'seller-1', credit_price: 30, expires_at: expired }],
    } as any);

    await expect(
      skillOrderService.createOrder('user-1', 'post-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('freezeCredits 抛错（余额不足）时不创建订单、不写入幂等缓存', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'post-1', status: 'active', user_id: 'seller-1', credit_price: 80 }],
    } as any);

    // 模拟事务：直接执行 callback，让 creditService.freezeCredits 抛错
    mockedTransaction.mockImplementationOnce(async (cb: any) => cb({ query: vi.fn() }));
    mockedCreditService.freezeCredits.mockRejectedValueOnce(new InsufficientCreditError('积分余额不足'));

    await expect(
      skillOrderService.createOrder('user-1', 'post-1'),
    ).rejects.toBeInstanceOf(InsufficientCreditError);

    // 幂等缓存不应被写入（失败请求不应缓存）
    expect(mockedIdempotency.setIdempotencyResult).not.toHaveBeenCalled();
  });

  it('正常下单：冻结积分 → 创建订单 → 写入幂等缓存', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'post-1', status: 'active', user_id: 'seller-1', credit_price: 30 }],
    } as any);

    const insertedOrder = {
      id: 'order-1',
      post_id: 'post-1',
      buyer_id: 'user-1',
      seller_id: 'seller-1',
      credit_amount: 30,
      status: 'pending',
      completed_at: null,
      cancelled_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      dispute_reason: null,
      dispute_time: null,
      previous_status: null,
      resolution: null,
      resolved_at: null,
      resolved_by: null,
    };

    // mock 事务 client.query：INSERT INTO skill_orders 返回订单
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [insertedOrder] } as any),
    };
    mockedTransaction.mockImplementationOnce(async (cb: any) => cb(mockClient));

    const result = await skillOrderService.createOrder('user-1', 'post-1');

    // 应调用 freezeCredits 冻结 30 积分
    expect(mockedCreditService.freezeCredits).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      30,
      '技能订单冻结',
      'post-1',
      'skill_order',
    );
    // 应写入幂等缓存
    expect(mockedIdempotency.setIdempotencyResult).toHaveBeenCalledTimes(1);
    // 返回订单
    expect(result.id).toBe('order-1');
    expect(result.postId).toBe('post-1');
    expect(result.status).toBe('pending');
  });
});

describe('skill-order.service - cancelOrder 退款', () => {
  it('pending 状态取消：仅解冻买家积分，不扣回卖家', async () => {
    const order = {
      id: 'order-1',
      post_id: 'post-1',
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      credit_amount: 30,
      status: 'pending',
    };

    // mock 事务内 query 调用顺序：
    // 1. SELECT ... FOR UPDATE → 返回订单
    // 2. UPDATE status='cancelled'
    // 3. SELECT 返回更新后订单
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [order] } as any)         // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] } as any)               // UPDATE cancelled
        .mockResolvedValueOnce({ rows: [{ ...order, status: 'cancelled' }] } as any), // SELECT 返回
    };
    mockedTransaction.mockImplementationOnce(async (cb: any) => cb(mockClient));

    const result = await skillOrderService.cancelOrder('order-1', 'buyer-1');

    // 应调用 unfreezeCredits 退还买家
    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledWith(
      expect.anything(),
      'buyer-1',
      30,
      '技能订单取消退还',
      'order-1',
      'skill_order',
    );
    // 不应调用 deductCredits（pending 状态卖家尚未收入）
    expect(mockedCreditService.deductCredits).not.toHaveBeenCalled();
    expect(result.status).toBe('cancelled');
  });

  it('accepted 状态取消：解冻买家 + 扣回卖家（允许负债）', async () => {
    const order = {
      id: 'order-2',
      post_id: 'post-1',
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      credit_amount: 30,
      status: 'accepted',
    };

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [order] } as any)                                  // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] } as any)                                        // UPDATE cancelled
        .mockResolvedValueOnce({ rows: [{ credit_balance: 20 }] } as any)                  // SELECT 卖家余额
        .mockResolvedValueOnce({ rows: [{ ...order, status: 'cancelled' }] } as any),     // SELECT 返回
    };
    mockedTransaction.mockImplementationOnce(async (cb: any) => cb(mockClient));

    await skillOrderService.cancelOrder('order-2', 'seller-1');

    // 应调用 unfreezeCredits 退还买家
    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledWith(
      expect.anything(),
      'buyer-1',
      30,
      '技能订单取消退还',
      'order-2',
      'skill_order',
    );
    // 应调用 deductCredits 扣回卖家，allowNegative=true
    expect(mockedCreditService.deductCredits).toHaveBeenCalledWith(
      expect.anything(),
      'seller-1',
      30,
      // 卖家余额 20 < 30，描述应包含"负债"
      expect.stringContaining('负债'),
      'order-2',
      'skill_order',
      true,
    );
  });

  it('非买家/卖家取消应抛 PermissionDeniedError', async () => {
    const order = {
      id: 'order-3',
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      credit_amount: 30,
      status: 'pending',
    };
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [order] } as any),
    };
    mockedTransaction.mockImplementationOnce(async (cb: any) => cb(mockClient));

    await expect(
      skillOrderService.cancelOrder('order-3', 'stranger-1'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // 不应执行退款
    expect(mockedCreditService.unfreezeCredits).not.toHaveBeenCalled();
  });

  it('已完成订单无法取消，应抛 OrderStatusInvalidError', async () => {
    const order = {
      id: 'order-4',
      buyer_id: 'buyer-1',
      seller_id: 'seller-1',
      credit_amount: 30,
      status: 'completed',
    };
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [order] } as any),
    };
    mockedTransaction.mockImplementationOnce(async (cb: any) => cb(mockClient));

    await expect(
      skillOrderService.cancelOrder('order-4', 'buyer-1'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });

  it('订单不存在应抛 NotFoundError', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] } as any),
    };
    mockedTransaction.mockImplementationOnce(async (cb: any) => cb(mockClient));

    await expect(
      skillOrderService.cancelOrder('order-missing', 'buyer-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ===================== 工具函数：构造订单行 + 事务内 query 链式 mock =====================

// 构造一份完整 SkillOrderRow，避免每个用例重复填写 13 个字段
function buildOrderRow(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: 'order-1',
    post_id: 'post-1',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    credit_amount: '30',
    status: 'pending',
    completed_at: null,
    cancelled_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    dispute_reason: null,
    dispute_time: null,
    previous_status: null,
    resolution: null,
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

// mock 事务内 client.query 链式返回值：按 rows 数组顺序填充
function mockTransactionQuery(...rowsList: any[]) {
  const mockClient = {
    query: vi.fn(),
  };
  rowsList.forEach((rows) => {
    mockClient.query.mockResolvedValueOnce({ rows } as any);
  });
  mockedTransaction.mockImplementationOnce(async (cb: any) => cb(mockClient));
  return mockClient;
}

// ===================== acceptOrder =====================
describe('skill-order.service - acceptOrder', () => {
  it('pending 状态由卖家接受：调用 settleCredits 结算积分并通知买家', async () => {
    const order = buildOrderRow({ status: 'pending' });
    const updated = buildOrderRow({ status: 'accepted' });
    // 顺序：SELECT FOR UPDATE → UPDATE accepted → SELECT buyer 余额 → SELECT 返回
    mockTransactionQuery(
      [order],
      [],
      [{ credit_balance: 70 }],
      [updated],
    );

    const result = await skillOrderService.acceptOrder('order-1', 'seller-1');

    expect(mockedCreditService.settleCredits).toHaveBeenCalledWith(
      expect.anything(),
      'buyer-1',
      'seller-1',
      30,
      'order-1',
      'order',
    );
    expect(result.status).toBe('accepted');
  });

  it('非卖家调用应抛 PermissionDeniedError，不结算积分', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'pending' })]);
    await expect(
      skillOrderService.acceptOrder('order-1', 'stranger-1'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(mockedCreditService.settleCredits).not.toHaveBeenCalled();
  });

  it('非 pending 状态应抛 OrderStatusInvalidError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'completed' })]);
    await expect(
      skillOrderService.acceptOrder('order-1', 'seller-1'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });

  it('订单不存在应抛 NotFoundError', async () => {
    mockTransactionQuery([]);
    await expect(
      skillOrderService.acceptOrder('order-missing', 'seller-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('买家余额为负应抛 BadRequestError，不结算', async () => {
    mockTransactionQuery(
      [buildOrderRow({ status: 'pending' })],
      [],
      [{ credit_balance: -5 }],
    );
    await expect(
      skillOrderService.acceptOrder('order-1', 'seller-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockedCreditService.settleCredits).not.toHaveBeenCalled();
  });
});

// ===================== rejectOrder =====================
describe('skill-order.service - rejectOrder', () => {
  it('pending 状态由卖家拒绝：调用 unfreezeCredits 退还买家', async () => {
    const updated = buildOrderRow({ status: 'rejected' });
    // 顺序：SELECT FOR UPDATE → UPDATE rejected → SELECT 返回
    mockTransactionQuery([buildOrderRow({ status: 'pending' })], [], [updated]);

    const result = await skillOrderService.rejectOrder('order-1', 'seller-1');

    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledWith(
      expect.anything(),
      'buyer-1',
      30,
      '技能订单拒绝退还',
      'order-1',
      'skill_order',
    );
    expect(result.status).toBe('rejected');
  });

  it('非卖家调用应抛 PermissionDeniedError，不解冻积分', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'pending' })]);
    await expect(
      skillOrderService.rejectOrder('order-1', 'buyer-1'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(mockedCreditService.unfreezeCredits).not.toHaveBeenCalled();
  });

  it('非 pending 状态应抛 OrderStatusInvalidError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'completed' })]);
    await expect(
      skillOrderService.rejectOrder('order-1', 'seller-1'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });
});

// ===================== completeOrder =====================
describe('skill-order.service - completeOrder', () => {
  it('accepted 状态由买家完成 + 携带 rating：写入评价并更新信誉分', async () => {
    const updated = buildOrderRow({ status: 'completed' });
    // 顺序：SELECT FOR UPDATE → UPDATE completed → (INSERT review) → SELECT 返回
    const mockClient = mockTransactionQuery(
      [buildOrderRow({ status: 'accepted' })],
      [],
      [],
      [updated],
    );

    const result = await skillOrderService.completeOrder('order-1', 'buyer-1', 5, '很棒');

    // reviewedId 应为 seller-1（买家评价卖家）
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO reviews'),
      ['buyer-1', 'seller-1', 'order-1', 5, '很棒'],
    );
    expect(result.status).toBe('completed');
  });

  it('in_progress 状态由卖家完成 + 无 rating：不写评价不更新信誉分', async () => {
    const updated = buildOrderRow({ status: 'completed' });
    // 顺序：SELECT FOR UPDATE → UPDATE completed → SELECT 返回
    const mockClient = mockTransactionQuery(
      [buildOrderRow({ status: 'in_progress' })],
      [],
      [updated],
    );

    await skillOrderService.completeOrder('order-1', 'seller-1');

    // 不应调用 INSERT INTO reviews
    const insertCalls = mockClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO reviews'),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('非买家/卖家完成应抛 PermissionDeniedError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'accepted' })]);
    await expect(
      skillOrderService.completeOrder('order-1', 'stranger-1'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('非 accepted/in_progress 状态应抛 OrderStatusInvalidError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'pending' })]);
    await expect(
      skillOrderService.completeOrder('order-1', 'buyer-1'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });
});

// ===================== disputeOrder =====================
describe('skill-order.service - disputeOrder', () => {
  it('accepted 状态由买家发起争议：status 置为 disputed，记录 previous_status', async () => {
    const updated = buildOrderRow({ status: 'disputed', previous_status: 'accepted', dispute_reason: '卖家不响应' });
    // 顺序：SELECT FOR UPDATE → UPDATE disputed → SELECT 返回
    const mockClient = mockTransactionQuery(
      [buildOrderRow({ status: 'accepted' })],
      [],
      [updated],
    );

    const result = await skillOrderService.disputeOrder('order-1', 'buyer-1', '卖家不响应');

    // UPDATE SQL 应携带 previous_status 与 dispute_reason
    const updateCalls = mockClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes("status = 'disputed'"),
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual(['order-1', 'accepted', '卖家不响应']);
    expect(result.status).toBe('disputed');
    expect(result.previousStatus).toBe('accepted');
  });

  it('reason 为空应抛 BadRequestError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'accepted' })]);
    await expect(
      skillOrderService.disputeOrder('order-1', 'buyer-1', '   '),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('非买家/卖家发起应抛 PermissionDeniedError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'accepted' })]);
    await expect(
      skillOrderService.disputeOrder('order-1', 'stranger-1', '原因'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('非 accepted/in_progress 状态应抛 OrderStatusInvalidError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'pending' })]);
    await expect(
      skillOrderService.disputeOrder('order-1', 'buyer-1', '原因'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });
});

// ===================== resolveDispute =====================
describe('skill-order.service - resolveDispute', () => {
  it('action=continue：恢复 previous_status，不退款', async () => {
    const updated = buildOrderRow({ status: 'accepted', resolution: '继续履行' });
    // 顺序：SELECT FOR UPDATE → UPDATE status=previous → SELECT 返回
    const mockClient = mockTransactionQuery(
      [buildOrderRow({ status: 'disputed', previous_status: 'accepted' })],
      [],
      [updated],
    );

    const result = await skillOrderService.resolveDispute('order-1', 'admin-1', '继续履行', 'continue');

    expect(result.status).toBe('accepted');
    // 不应退款
    expect(mockedCreditService.unfreezeCredits).not.toHaveBeenCalled();
    // UPDATE SQL 应携带 previous_status
    const updateCalls = mockClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('resolved_at = NOW()'),
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual(['order-1', 'accepted', '继续履行', 'admin-1']);
  });

  it('action=refund：退款买家并取消订单', async () => {
    const updated = buildOrderRow({ status: 'cancelled', resolution: '裁决退款' });
    // 顺序：SELECT FOR UPDATE → UPDATE cancelled → SELECT 返回
    // unfreezeCredits 是 creditService 调用，不走 client.query
    mockTransactionQuery(
      [buildOrderRow({ status: 'disputed' })],
      [],
      [updated],
    );

    const result = await skillOrderService.resolveDispute('order-1', 'admin-1', '裁决退款', 'refund');

    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledWith(
      expect.anything(),
      'buyer-1',
      30,
      '争议裁决退款买家',
      'order-1',
      'skill_order',
    );
    expect(result.status).toBe('cancelled');
  });

  it('action=cancel：退款买家并取消订单（描述区分）', async () => {
    // 顺序：SELECT FOR UPDATE → UPDATE cancelled → SELECT 返回
    mockTransactionQuery(
      [buildOrderRow({ status: 'disputed' })],
      [],
      [buildOrderRow({ status: 'cancelled' })],
    );

    await skillOrderService.resolveDispute('order-1', 'admin-1', '裁决取消', 'cancel');

    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledWith(
      expect.anything(),
      'buyer-1',
      30,
      '争议裁决取消订单退款',
      'order-1',
      'skill_order',
    );
  });

  it('非法 action 应抛 BadRequestError', async () => {
    await expect(
      skillOrderService.resolveDispute('order-1', 'admin-1', '说明', 'invalid' as any),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('resolution 为空应抛 BadRequestError', async () => {
    await expect(
      skillOrderService.resolveDispute('order-1', 'admin-1', '   ', 'refund'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('非 disputed 状态应抛 OrderStatusInvalidError', async () => {
    mockTransactionQuery([buildOrderRow({ status: 'accepted' })]);
    await expect(
      skillOrderService.resolveDispute('order-1', 'admin-1', '说明', 'refund'),
    ).rejects.toBeInstanceOf(OrderStatusInvalidError);
  });
});

// ===================== getOrderList =====================
describe('skill-order.service - getOrderList', () => {
  it('返回分页列表：调用 query 两次（COUNT + LIST），组装 post/buyer/seller 关联字段', async () => {
    const orderRow = {
      ...buildOrderRow({ status: 'completed' }),
      post_title: '技能帖',
      post_images: ['img1'],
      post_credit_price: '30',
      buyer_nickname: '买家',
      buyer_avatar: 'b-avatar',
      seller_nickname: '卖家',
      seller_avatar: 's-avatar',
    };
    // COUNT + LIST 两次 query
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] } as any);
    mockedQuery.mockResolvedValueOnce({ rows: [orderRow] } as any);

    const result = await skillOrderService.getOrderList('buyer-1');

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].post.title).toBe('技能帖');
    expect(result.list[0].buyer.nickname).toBe('买家');
    expect(result.list[0].seller.nickname).toBe('卖家');
  });

  it('携带 status 筛选时 WHERE 条件追加 status 子句', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as any);
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    await skillOrderService.getOrderList('buyer-1', { status: 'completed' }, 2, 10);

    // 第二次 query（LIST）应包含 status = $X
    const listCall = mockedQuery.mock.calls[1];
    expect(listCall[0]).toContain('so.status = $');
  });
});

// ===================== getOrderById =====================
describe('skill-order.service - getOrderById', () => {
  it('正常返回订单详情：组装 post/buyer/seller 关联字段', async () => {
    const orderRow = {
      ...buildOrderRow({ status: 'completed' }),
      post_title: '技能帖详情',
      post_images: [],
      post_credit_price: '30',
      buyer_nickname: '买家A',
      buyer_avatar: null,
      seller_nickname: '卖家B',
      seller_avatar: null,
    };
    mockedQuery.mockResolvedValueOnce({ rows: [orderRow] } as any);

    const result = await skillOrderService.getOrderById('order-1', 'buyer-1');

    expect(result.id).toBe('order-1');
    expect(result.post.title).toBe('技能帖详情');
    expect(result.buyer.nickname).toBe('买家A');
  });

  it('订单不存在应抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    await expect(
      skillOrderService.getOrderById('order-missing', 'buyer-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('非买家/卖家查询应抛 PermissionDeniedError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [buildOrderRow()] } as any);
    await expect(
      skillOrderService.getOrderById('order-1', 'stranger-1'),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
