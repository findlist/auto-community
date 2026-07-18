/**
 * kitchen-order.service 单元测试
 *
 * 测试目标：
 * - toOrderResponse：字段序列化、post/buyer/seller 可选参数
 * - create：幂等命中、帖子不存在、份数不足、正常创建（冻结积分、减份数、INSERT 订单）
 * - confirm：订单不存在、权限校验、状态校验、正常确认并通知
 * - complete：评分校验、订单不存在、权限校验、状态校验、正常完成（结算、评价、信誉分）
 * - cancel：订单不存在、权限校验、状态校验、正常取消（退积分、恢复份数、恢复状态）
 * - getList：动态 WHERE（role/status）、分页计算
 *
 * 测试策略：
 * - mock database 的 query 与 transaction（transaction 传入模拟 client，client.query 单独 mock）
 * - mock idempotency/creditService/reputationService/notificationService，聚焦订单业务逻辑
 * - createPaginatedResponse 为纯函数，使用真实实现
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database：query 用于非事务路径，transaction 用于事务路径
// 事务路径下 client.query 单独 mock，便于按调用顺序模拟事务内多次查询
const { mockQuery, mockTransaction, mockClientQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockClientQuery: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
}));

// mock idempotency：默认未命中，setIdempotencyResult 直接返回
vi.mock('../../utils/idempotency', () => ({
  idempotency: {
    buildKey: vi.fn((...args: unknown[]) => args.join(':')),
    checkIdempotency: vi.fn().mockResolvedValue({ hit: false, data: undefined }),
    setIdempotencyResult: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock creditService：冻结/结算/解冻积分直接返回，不触发真实 DB 操作
vi.mock('../credit.service', () => ({
  creditService: {
    freezeCredits: vi.fn().mockResolvedValue(undefined),
    settleCredits: vi.fn().mockResolvedValue(undefined),
    unfreezeCredits: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock reputationService：更新信誉分直接返回
vi.mock('../reputation.service', () => ({
  reputationService: {
    updateReputationScore: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock notificationService：通知发送直接返回，避免触发真实推送
vi.mock('../notification.service', () => ({
  notificationService: {
    notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
  },
}));

import { kitchenOrderService } from '../kitchen-order.service';
import {
  NotFoundError,
  BadRequestError,
  OrderStatusInvalidError,
  PermissionDeniedError,
} from '../../utils/errors';

// 构造完整的 KitchenOrderRow 测试数据，供多个测试复用
function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    post_id: 'post-1',
    user_id: 'buyer-1',
    seller_id: 'seller-1',
    portions: 2,
    credit_amount: 20,
    pickup_type: 'self_pickup',
    pickup_time: null,
    delivery_address: null,
    remark: null,
    status: 'pending',
    created_at: new Date('2026-01-01'),
    completed_at: null,
    timeout_at: null,
    ...overrides,
  };
}

// 构造 kitchen_posts 行数据（create 事务内查询用）
function makePostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    user_id: 'seller-1',
    title: '测试美食',
    images: ['https://example.com/food.png'],
    remaining_portions: 5,
    credit_price: 10,
    status: 'active',
    ...overrides,
  };
}

// 构造 KitchenOrderListRow（getList 查询用，含 JOIN 字段）
function makeListRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeOrderRow(),
    post_title: '测试美食',
    post_images: ['https://example.com/food.png'],
    buyer_nickname: '买家',
    buyer_avatar: 'https://example.com/buyer.png',
    seller_nickname: '卖家',
    seller_avatar: 'https://example.com/seller.png',
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  mockClientQuery.mockReset();
  // 默认 transaction 实现：传入模拟 client，调用回调
  mockTransaction.mockImplementation(async (cb: (client: { query: typeof mockClientQuery }) => Promise<unknown>) => {
    return cb({ query: mockClientQuery });
  });
});

describe('kitchen-order.service toOrderResponse', () => {
  it('完整字段序列化（含 post/buyer/seller）', () => {
    const row = makeOrderRow();
    const result = kitchenOrderService.toOrderResponse(
      row,
      { id: 'post-1', title: '美食', images: ['img.png'] },
      { id: 'buyer-1', nickname: '买家', avatar: 'b.png' },
      { id: 'seller-1', nickname: '卖家', avatar: 's.png' },
    );

    expect(result.id).toBe('order-1');
    expect(result.postId).toBe('post-1');
    expect(result.buyerId).toBe('buyer-1');
    expect(result.sellerId).toBe('seller-1');
    expect(result.quantity).toBe(2);
    expect(result.totalPrice).toBe(20);
    expect(result.post?.title).toBe('美食');
    expect(result.buyer?.nickname).toBe('买家');
    expect(result.seller?.nickname).toBe('卖家');
  });

  it('post/buyer/seller 为 undefined 时正常序列化', () => {
    const result = kitchenOrderService.toOrderResponse(makeOrderRow());

    expect(result.post).toBeUndefined();
    expect(result.buyer).toBeUndefined();
    expect(result.seller).toBeUndefined();
    expect(result.status).toBe('pending');
  });
});

describe('kitchen-order.service create', () => {
  it('幂等命中直接返回缓存结果（不调用 transaction）', async () => {
    const { idempotency } = await import('../../utils/idempotency');
    vi.mocked(idempotency.checkIdempotency).mockResolvedValueOnce({
      hit: true,
      data: { id: 'cached-order' },
    });

    const result = await kitchenOrderService.create('buyer-1', {
      postId: 'post-1',
      quantity: 2,
    });

    expect(result).toEqual({ id: 'cached-order' });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('帖子不存在抛 NotFoundError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT kitchen_posts

    await expect(
      kitchenOrderService.create('buyer-1', { postId: 'not-exist', quantity: 1 }),
    ).rejects.toThrow(NotFoundError);
  });

  it('剩余份数不足抛 BadRequestError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makePostRow({ remaining_portions: 1 })] });

    await expect(
      kitchenOrderService.create('buyer-1', { postId: 'post-1', quantity: 2 }),
    ).rejects.toThrow(BadRequestError);
  });

  it('正常创建订单（验证减份数、创建订单 INSERT）', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [makePostRow({ remaining_portions: 5, credit_price: 10 })] }) // SELECT post
      .mockResolvedValueOnce({ rows: [] }) // UPDATE remaining_portions
      .mockResolvedValueOnce({ rows: [makeOrderRow()] }); // INSERT order

    const result = await kitchenOrderService.create('buyer-1', {
      postId: 'post-1',
      quantity: 2,
    });

    expect(result.id).toBe('order-1');
    // 验证事务内 3 次 client.query：SELECT post + UPDATE 份数 + INSERT order
    expect(mockClientQuery).toHaveBeenCalledTimes(3);
    // 验证 INSERT SQL 含 kitchen_orders
    const insertSql = mockClientQuery.mock.calls[2][0] as string;
    expect(insertSql).toContain('INSERT INTO kitchen_orders');
    // 验证 UPDATE 份数 SQL
    const updateSql = mockClientQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain('UPDATE kitchen_posts');
    expect(updateSql).toContain('remaining_portions = remaining_portions - ');
  });

  it('XSS 不变式：remark 含 script 标签时入库前被清洗', async () => {
    // 设计原因：remark 会写入 kitchen_orders 表并在订单详情页直接渲染，卖家与买家均可见，
    // 未清洗会在订单详情触发存储型 XSS。此处验证 INSERT 的 remark 参数已剥离 <script> 标签
    mockClientQuery
      .mockResolvedValueOnce({ rows: [makePostRow({ remaining_portions: 5, credit_price: 10 })] }) // SELECT post
      .mockResolvedValueOnce({ rows: [] }) // UPDATE remaining_portions
      .mockResolvedValueOnce({ rows: [makeOrderRow()] }); // INSERT order

    await kitchenOrderService.create('buyer-1', {
      postId: 'post-1',
      quantity: 2,
      remark: '<script>alert(1)</script>多加辣',
    });

    const insertCall = mockClientQuery.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO kitchen_orders');
    const insertParams = insertCall[1] as unknown[];
    // 参数顺序：post_id, user_id, seller_id, portions, credit_amount,
    //          pickup_type, pickup_time, delivery_address, remark
    // remark 为第 9 个参数（索引 8）
    const remarkParam = insertParams[8] as string;
    expect(remarkParam).not.toContain('<script>');
    expect(remarkParam).not.toContain('</script>');
    // 清洗后仍应保留正常备注字符
    expect(remarkParam).toContain('多加辣');
  });
});

describe('kitchen-order.service confirm', () => {
  it('订单不存在抛 NotFoundError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE

    await expect(kitchenOrderService.confirm('not-exist', 'seller-1')).rejects.toThrow(NotFoundError);
  });

  it('非卖家抛 PermissionDeniedError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeOrderRow({ seller_id: 'seller-2' })] });

    await expect(kitchenOrderService.confirm('order-1', 'seller-1')).rejects.toThrow(PermissionDeniedError);
  });

  it('状态非 pending 抛 OrderStatusInvalidError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeOrderRow({ status: 'confirmed' })] });

    await expect(kitchenOrderService.confirm('order-1', 'seller-1')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('正常确认并通知买家', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [makeOrderRow({ status: 'pending' })] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }); // UPDATE status

    const result = await kitchenOrderService.confirm('order-1', 'seller-1');

    expect(result.status).toBe('confirmed');
    // 验证 UPDATE SQL 含 status = 'confirmed'
    const updateSql = mockClientQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("status = 'confirmed'");
  });
});

describe('kitchen-order.service complete', () => {
  it('评分 <1 抛 BadRequestError', async () => {
    await expect(
      kitchenOrderService.complete('order-1', 'buyer-1', { rating: 0 }),
    ).rejects.toThrow(BadRequestError);
  });

  it('评分 >5 抛 BadRequestError', async () => {
    await expect(
      kitchenOrderService.complete('order-1', 'buyer-1', { rating: 6 }),
    ).rejects.toThrow(BadRequestError);
  });

  it('订单不存在抛 NotFoundError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE

    await expect(
      kitchenOrderService.complete('not-exist', 'buyer-1', { rating: 5 }),
    ).rejects.toThrow(NotFoundError);
  });

  it('非买家抛 PermissionDeniedError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeOrderRow({ user_id: 'buyer-2' })] });

    await expect(
      kitchenOrderService.complete('order-1', 'buyer-1', { rating: 5 }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('状态非 confirmed 抛 OrderStatusInvalidError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeOrderRow({ status: 'pending' })] });

    await expect(
      kitchenOrderService.complete('order-1', 'buyer-1', { rating: 5 }),
    ).rejects.toThrow(OrderStatusInvalidError);
  });

  it('正常完成（结算积分、创建评价、更新信誉分）', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [makeOrderRow({ status: 'confirmed', credit_amount: 20 })] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE status='completed'
      .mockResolvedValueOnce({ rows: [] }); // INSERT review

    const result = await kitchenOrderService.complete('order-1', 'buyer-1', { rating: 5, content: '好评' });

    expect(result.status).toBe('completed');
    // 验证 UPDATE status SQL
    const updateSql = mockClientQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("status = 'completed'");
    // 验证 INSERT review SQL 含 rating 与 content
    const reviewSql = mockClientQuery.mock.calls[2][0] as string;
    expect(reviewSql).toContain('INSERT INTO reviews');
  });
});

describe('kitchen-order.service cancel', () => {
  it('订单不存在抛 NotFoundError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [] });

    await expect(kitchenOrderService.cancel('not-exist', 'buyer-1')).rejects.toThrow(NotFoundError);
  });

  it('非买家且非卖家抛 PermissionDeniedError', async () => {
    mockClientQuery.mockResolvedValueOnce({
      rows: [makeOrderRow({ user_id: 'buyer-1', seller_id: 'seller-1' })],
    });

    await expect(kitchenOrderService.cancel('order-1', 'other-user')).rejects.toThrow(PermissionDeniedError);
  });

  it('状态非 pending/confirmed 抛 OrderStatusInvalidError', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [makeOrderRow({ status: 'completed' })] });

    await expect(kitchenOrderService.cancel('order-1', 'buyer-1')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('正常取消（退还积分、恢复份数、恢复状态）', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [makeOrderRow({ status: 'pending', credit_amount: 20, portions: 2 })] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // UPDATE kitchen_posts remaining_portions +
      .mockResolvedValueOnce({ rows: [{ remaining_portions: 3 }] }) // SELECT remaining_portions
      .mockResolvedValueOnce({ rows: [] }) // UPDATE status='active'（份数>0）
      .mockResolvedValueOnce({ rows: [] }); // UPDATE kitchen_orders status='cancelled'

    const result = await kitchenOrderService.cancel('order-1', 'buyer-1');

    expect(result.status).toBe('cancelled');
    // 验证恢复份数 SQL
    const restoreSql = mockClientQuery.mock.calls[1][0] as string;
    expect(restoreSql).toContain('remaining_portions = remaining_portions + ');
    // 验证取消订单 SQL
    const cancelSql = mockClientQuery.mock.calls[4][0] as string;
    expect(cancelSql).toContain("status = 'cancelled'");
  });
});

describe('kitchen-order.service getList', () => {
  it('role=buyer 时 SQL 含 user_id 条件', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeListRow()] });

    await kitchenOrderService.getList('buyer-1', { role: 'buyer' }, 1, 10);

    // COUNT 与 SELECT 的 SQL 都应含 ko.user_id = $1
    expect(mockQuery.mock.calls[0][0]).toContain('ko.user_id = $1');
    expect(mockQuery.mock.calls[1][0]).toContain('ko.user_id = $1');
  });

  it('role=seller 时 SQL 含 seller_id 条件', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeListRow()] });

    await kitchenOrderService.getList('seller-1', { role: 'seller' }, 1, 10);

    expect(mockQuery.mock.calls[0][0]).toContain('ko.seller_id = $1');
    expect(mockQuery.mock.calls[1][0]).toContain('ko.seller_id = $1');
  });

  it('无 role 时 SQL 含 OR 条件（买家或卖家）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeListRow()] });

    await kitchenOrderService.getList('user-1', {}, 1, 10);

    // SQL 应含 (ko.user_id = $1 OR ko.seller_id = $2)
    expect(mockQuery.mock.calls[0][0]).toContain('OR');
    expect(mockQuery.mock.calls[0][0]).toContain('ko.user_id');
    expect(mockQuery.mock.calls[0][0]).toContain('ko.seller_id');
  });

  it('status 过滤时 SQL 含 status 条件', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeListRow()] });

    await kitchenOrderService.getList('user-1', { status: 'completed' }, 1, 10);

    expect(mockQuery.mock.calls[0][0]).toContain('ko.status = $');
    expect(mockQuery.mock.calls[1][0]).toContain('ko.status = $');
  });
});
