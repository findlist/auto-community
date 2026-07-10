/**
 * group-order.service 单元测试
 *
 * 测试目标：
 * - cancel 取消拼单退款（发起人取消，所有参与者退款）
 * - exit 参与者退出退款（open/full 状态全额退款）
 * - exit 发起人不能退出（应使用 cancel）
 * - exit 状态校验（ongoing/completed 禁止退出）
 * - exit full→open 状态回退
 *
 * 测试策略：mock database / credit.service 避免依赖真实数据库。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块
const mockClient = {
  query: vi.fn(),
};

vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn((cb: (client: typeof mockClient) => Promise<any>) => cb(mockClient)),
  pool: {},
}));

// mock credit.service
vi.mock('../credit.service', () => ({
  creditService: {
    freezeCredits: vi.fn().mockResolvedValue({ balance: 50 }),
    unfreezeCredits: vi.fn().mockResolvedValue({ balance: 100 }),
    settleCredits: vi.fn().mockResolvedValue({ sellerBalance: 100 }),
    earnCredits: vi.fn().mockResolvedValue({ balance: 100 }),
    checkBalance: vi.fn(),
    getCreditBalance: vi.fn(),
  },
}));

// mock notification.service：通知为副作用，测试中统一返回 resolved，不执行真实落库逻辑
vi.mock('../notification.service', () => ({
  notificationService: {
    notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
    createNotification: vi.fn().mockResolvedValue(undefined),
    notifyFamilyBindingChange: vi.fn().mockResolvedValue(undefined),
    notifyTimeBankTransaction: vi.fn().mockResolvedValue(undefined),
  },
}));

import { groupOrderService } from '../group-order.service';
import { creditService } from '../credit.service';
import { BadRequestError, NotFoundError, ForbiddenError } from '../../utils/errors';
import { query } from '../../config/database';

const mockedCreditService = vi.mocked(creditService);
// 顶层 query mock 引用：create/getList/getById/checkExpired 使用顶层 query（非 transaction 内 client.query）
// 局部类型别名：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需 rows
// 用 as unknown as DbResult 替代裸 any 断言以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;
const mockedQuery = vi.mocked(query);

// 辅助函数：创建 mock 拼单数据
function mockGroupOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'group-order-1',
    initiator_id: 'initiator-1',
    title: '测试拼单',
    status: 'open',
    current_amount: 150,
    target_amount: 300,
    current_participants: 3,
    min_participants: 2,
    max_participants: 5,
    deadline: new Date(Date.now() + 86400000).toISOString(), // 明天
    ...overrides,
  };
}

// 辅助函数：创建 mock 参与者数据
function mockParticipant(overrides: Record<string, any> = {}) {
  return {
    id: 'participation-1',
    group_order_id: 'group-order-1',
    user_id: 'participant-a',
    amount: 100,
    status: 'paid',
    ...overrides,
  };
}

// 辅助函数：设置取消场景的 mock 调用链
function setupCancelMock(orderOverrides: Record<string, any> = {}) {
  const order = mockGroupOrder(orderOverrides);
  const participants = [
    mockParticipant({ user_id: 'participant-a', amount: 100 }),
    mockParticipant({ id: 'participation-2', user_id: 'participant-b', amount: 50 }),
    mockParticipant({ id: 'participation-3', user_id: 'initiator-1', amount: 0 }),
  ];

  // 按顺序 mock query 和 client.query 调用

  // transaction 内部使用 client.query
  mockClient.query.mockReset();

  // 第一次调用：SELECT ... FOR UPDATE (锁拼单)
  // 第二次调用：SELECT participants FOR UPDATE
  // 第三次调用：UPDATE participants SET status = 'refunded' (participant-a)
  // 第四次调用：UPDATE participants SET status = 'refunded' (participant-b)
  // 第五次调用：UPDATE participants SET status = 'refunded' (initiator-1)
  // 第六次调用：UPDATE group_orders SET status = 'cancelled'

  mockClient.query
    .mockResolvedValueOnce({ rows: [order] })                  // 1. lock order
    .mockResolvedValueOnce({ rows: participants })             // 2. select paid participants
    .mockResolvedValueOnce({ rows: [] })                        // 3. update participant-a status
    .mockResolvedValueOnce({ rows: [] })                        // 4. update participant-b status
    .mockResolvedValueOnce({ rows: [] })                        // 5. update initiator status
    .mockResolvedValueOnce({ rows: [] });                       // 6. update group_order status

  return { order, participants };
}

// 辅助函数：设置 exit 场景的 mock 调用链
function setupExitMock(orderOverrides: Record<string, any> = {}, participantOverrides: Record<string, any> = {}) {
  const order = mockGroupOrder(orderOverrides);
  const participant = mockParticipant(participantOverrides);

  mockClient.query.mockReset();
  mockClient.query
    .mockResolvedValueOnce({ rows: [order] })                  // 1. lock order
    .mockResolvedValueOnce({ rows: [participant] })            // 2. select participant
    .mockResolvedValueOnce({ rows: [] })                        // 3. update participant status
    .mockResolvedValueOnce({ rows: [] });                       // 4. update group_order status

  return { order, participant };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockClient.query.mockReset();
});

// ==================== exit 测试 ====================

describe('group-order.service - exit 参与者退出退款', () => {
  it('open 状态参与者退出应全额退款', async () => {
    setupExitMock({ status: 'open', current_participants: 3 });

    await groupOrderService.exit('group-order-1', 'participant-a');

    // 验证调用了 unfreezeCredits 退款
    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledWith(
      mockClient,
      'participant-a',
      100,
      '拼单退出退还',
      'group-order-1',
      'group_order',
    );
  });

  it('full 状态参与者退出应全额退款', async () => {
    setupExitMock({ status: 'full', current_participants: 5 });

    await groupOrderService.exit('group-order-1', 'participant-a');

    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalled();
  });

  it('full 状态退出后人数不足 max 应回退为 open', async () => {
    const order = mockGroupOrder({ status: 'full', max_participants: 5, current_participants: 5 });
    const participant = mockParticipant();

    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [participant] })
      .mockResolvedValueOnce({ rows: [] })  // update participant
      .mockResolvedValueOnce({ rows: [] });  // update group_order

    await groupOrderService.exit('group-order-1', 'participant-a');

    // 验证更新拼单时状态回退为 open
    const updateCall = mockClient.query.mock.calls[3];
    expect(updateCall[0]).toContain('SET current_amount');
    // 参数数组 [newAmount, newParticipants, newStatus, groupOrderId]，索引2为 status
    const params = updateCall[1] as unknown[];
    expect(params[2]).toBe('open');  // 4 < 5，应回退为 open
  });

  it('full 状态退出后人数仍满足 max 不应回退', async () => {
    const order = mockGroupOrder({ status: 'full', max_participants: 5, current_participants: 6 });
    const participant = mockParticipant();

    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [participant] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await groupOrderService.exit('group-order-1', 'participant-a');

    const updateCall = mockClient.query.mock.calls[3];
    const params = updateCall[1] as unknown[];
    expect(params[2]).toBe('full');  // 5 >= 5，保持 full
  });

  it('发起人不能退出，应抛出 BadRequestError', async () => {
    setupExitMock({ status: 'open', initiator_id: 'initiator-1' });

    await expect(
      groupOrderService.exit('group-order-1', 'initiator-1'),
    ).rejects.toThrow(BadRequestError);
  });

  it('已退款参与者再次退出应抛出 BadRequestError', async () => {
    setupExitMock({ status: 'open' }, { status: 'refunded' });

    await expect(
      groupOrderService.exit('group-order-1', 'participant-a'),
    ).rejects.toThrow('已退款');
  });

  it('completed 状态不允许退出', async () => {
    setupExitMock({ status: 'completed' });

    await expect(
      groupOrderService.exit('group-order-1', 'participant-a'),
    ).rejects.toThrow('当前拼单状态不允许退出');
  });

  it('completed 状态不允许退出', async () => {
    setupExitMock({ status: 'completed' });

    await expect(
      groupOrderService.exit('group-order-1', 'participant-a'),
    ).rejects.toThrow('当前拼单状态不允许退出');
  });

  it('cancelled 状态不允许退出', async () => {
    setupExitMock({ status: 'cancelled' });

    await expect(
      groupOrderService.exit('group-order-1', 'participant-a'),
    ).rejects.toThrow('当前拼单状态不允许退出');
  });

  it('ongoing 状态应部分退款：90% 退还参与者，10% 补偿发起人', async () => {
    // amount=100，预期退还 90 给参与者，10 给发起人
    setupExitMock({ status: 'ongoing', initiator_id: 'initiator-1' }, { amount: 100 });

    await groupOrderService.exit('group-order-1', 'participant-a');

    // 验证调用 unfreezeCredits 退还 90 给参与者
    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledWith(
      mockClient,
      'participant-a',
      90,
      '拼单退出部分退还',
      'group-order-1',
      'group_order',
    );
    // 验证调用 earnCredits 补偿 10 给发起人
    expect(mockedCreditService.earnCredits).toHaveBeenCalledWith(
      mockClient,
      'initiator-1',
      10,
      '拼单退出成本补偿',
      'group-order-1',
      'group_order',
    );
  });

  it('ongoing 状态退款后拼单状态保持 ongoing 不回退', async () => {
    const order = mockGroupOrder({ status: 'ongoing', max_participants: 5, current_participants: 4 });
    const participant = mockParticipant({ amount: 100 });

    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [participant] })
      .mockResolvedValueOnce({ rows: [] })  // update participant
      .mockResolvedValueOnce({ rows: [] });  // update group_order

    await groupOrderService.exit('group-order-1', 'participant-a');

    // ongoing 状态退出后不应回退为 open
    const updateCall = mockClient.query.mock.calls[3];
    const params = updateCall[1] as unknown[];
    expect(params[2]).toBe('ongoing');
  });

  it('ongoing 状态 amount=0 不调用退款', async () => {
    setupExitMock({ status: 'ongoing' }, { amount: 0 });

    await groupOrderService.exit('group-order-1', 'participant-a');

    expect(mockedCreditService.unfreezeCredits).not.toHaveBeenCalled();
    expect(mockedCreditService.earnCredits).not.toHaveBeenCalled();
  });

  it('ongoing 状态部分退款金额向下取整保证总额守恒', async () => {
    // amount=15，90% = 13.5 → floor 为 13，feeAmount = 15 - 13 = 2
    setupExitMock({ status: 'ongoing', initiator_id: 'initiator-1' }, { amount: 15 });

    await groupOrderService.exit('group-order-1', 'participant-a');

    const refundCall = mockedCreditService.unfreezeCredits.mock.calls[0];
    const earnCall = mockedCreditService.earnCredits.mock.calls[0];
    expect(refundCall[2]).toBe(13);  // 退还 13
    expect(earnCall[2]).toBe(2);     // 补偿 2
    expect(refundCall[2] + earnCall[2]).toBe(15);  // 总额守恒
  });

  it('not_found 拼单应抛出 NotFoundError', async () => {
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // 拼单不存在

    await expect(
      groupOrderService.exit('nonexistent', 'participant-a'),
    ).rejects.toThrow(NotFoundError);
  });

  it('未参与拼单的用户退出应抛出 BadRequestError', async () => {
    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [mockGroupOrder()] })   // lock order
      .mockResolvedValueOnce({ rows: [] });                    // participant not found

    await expect(
      groupOrderService.exit('group-order-1', 'non-participant'),
    ).rejects.toThrow('未参与此拼单');
  });

  it('amount=0 参与者退出不调用退款', async () => {
    setupExitMock({ status: 'open' }, { amount: 0 });

    await groupOrderService.exit('group-order-1', 'participant-a');

    // 不应该调用 unfreezeCredits
    expect(mockedCreditService.unfreezeCredits).not.toHaveBeenCalled();
  });
});

// ==================== cancel 测试 ====================

describe('group-order.service - cancel 取消拼单退款', () => {
  it('发起人取消拼单，所有参与者应退款', async () => {
    setupCancelMock();

    await groupOrderService.cancel('group-order-1', 'initiator-1', '测试取消');

    // participant-a (amount=100) 和 participant-b (amount=50) 应退款
    expect(mockedCreditService.unfreezeCredits).toHaveBeenCalledTimes(2);
    // initiator (amount=0) 不退款
    const refundUserIds = mockedCreditService.unfreezeCredits.mock.calls.map(call => call[1]);
    expect(refundUserIds).toContain('participant-a');
    expect(refundUserIds).toContain('participant-b');
    expect(refundUserIds).not.toContain('initiator-1');
  });

  it('非发起人取消应抛出 ForbiddenError', async () => {
    setupCancelMock();

    await expect(
      groupOrderService.cancel('group-order-1', 'participant-a'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('cancelled 状态无法再次取消', async () => {
    setupCancelMock({ status: 'cancelled' });

    await expect(
      groupOrderService.cancel('group-order-1', 'initiator-1'),
    ).rejects.toThrow('拼单已取消');
  });

  it('completed 状态无法取消', async () => {
    setupCancelMock({ status: 'completed' });

    await expect(
      groupOrderService.cancel('group-order-1', 'initiator-1'),
    ).rejects.toThrow('无法取消');
  });
});

// ==================== complete 测试 ====================

describe('group-order.service - complete 完成拼单', () => {
  it('达到最低人数可完成拼单', async () => {
    const order = mockGroupOrder({ status: 'full', current_participants: 3, min_participants: 2 });
    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [order] })     // lock order
      .mockResolvedValueOnce({ rows: [] })            // update status
      .mockResolvedValueOnce({ rows: [] });           // 查询仍参与的参与者（通知用，新增）

    await groupOrderService.complete('group-order-1', 'initiator-1');

    expect(mockedCreditService.earnCredits).toHaveBeenCalledWith(
      mockClient,
      'initiator-1',
      order.current_amount,
      '拼单结算收入',
      'group-order-1',
      'group_order',
    );
  });

  it('非发起人不能完成', async () => {
    const order = mockGroupOrder({ status: 'full' });
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValueOnce({ rows: [order] });

    await expect(
      groupOrderService.complete('group-order-1', 'participant-a'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('未达到最低人数不能完成', async () => {
    const order = mockGroupOrder({ status: 'open', current_participants: 1, min_participants: 3 });
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValueOnce({ rows: [order] });

    await expect(
      groupOrderService.complete('group-order-1', 'initiator-1'),
    ).rejects.toThrow('未达到最低参与人数');
  });
});

// ==================== toGroupOrderResponse 测试 ====================

describe('group-order.service - toGroupOrderResponse 序列化', () => {
  it('完整字段序列化：含 initiator 和 participants', () => {
    const row = {
      id: 'order-1', initiator_id: 'user-1', title: '测试', description: '描述',
      target_amount: 100, current_amount: 50, min_participants: 2, max_participants: 5,
      current_participants: 3, address: '地址', deadline: new Date('2026-01-01'),
      status: 'open', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
    };
    const initiator = { id: 'user-1', nickname: '张三', avatar: 'avatar.png' };
    const participants = [{ id: 'user-2', nickname: '李四', avatar: null, amount: 50, status: 'paid' }];

    const result = groupOrderService.toGroupOrderResponse(row, initiator, participants);

    expect(result.id).toBe('order-1');
    expect(result.initiatorId).toBe('user-1');
    expect(result.initiator).toEqual(initiator);
    expect(result.title).toBe('测试');
    expect(result.description).toBe('描述');
    expect(result.targetAmount).toBe(100);
    expect(result.currentAmount).toBe(50);
    expect(result.participants).toEqual(participants);
    expect(result.status).toBe('open');
  });

  it('initiator/participants 为 undefined 时正常序列化', () => {
    const row = {
      id: 'order-1', initiator_id: 'user-1', title: '测试', description: null,
      target_amount: 100, current_amount: 0, min_participants: 2, max_participants: 5,
      current_participants: 1, address: '地址', deadline: new Date('2026-01-01'),
      status: 'open', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
    };

    const result = groupOrderService.toGroupOrderResponse(row);

    expect(result.initiator).toBeUndefined();
    expect(result.participants).toBeUndefined();
    expect(result.description).toBeNull();
  });
});

// ==================== create 测试 ====================

describe('group-order.service - create 创建拼单', () => {
  it('正常创建：含 description，执行 3 次 query 并返回序列化结果', async () => {
    const mockRow = {
      id: 'order-1', initiator_id: 'user-1', title: '测试拼单', description: '描述',
      target_amount: 300, current_amount: 0, min_participants: 2, max_participants: 5,
      current_participants: 0, address: '地址', deadline: new Date('2026-01-01'),
      status: 'open', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
    };
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await groupOrderService.create('user-1', {
      title: '测试拼单', description: '描述', targetAmount: 300,
      minParticipants: 2, maxParticipants: 5, address: '地址', deadline: '2026-01-01',
    });

    expect(result.id).toBe('order-1');
    expect(result.initiatorId).toBe('user-1');
    expect(mockedQuery).toHaveBeenCalledTimes(3);
  });

  it('无 description 时插入 null（data.description || null 透传）', async () => {
    const mockRow = {
      id: 'order-1', initiator_id: 'user-1', title: '测试拼单', description: null,
      target_amount: 300, current_amount: 0, min_participants: 2, max_participants: 5,
      current_participants: 0, address: '地址', deadline: new Date('2026-01-01'),
      status: 'open', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
    };
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await groupOrderService.create('user-1', {
      title: '测试拼单', targetAmount: 300,
      minParticipants: 2, maxParticipants: 5, address: '地址', deadline: '2026-01-01',
    });

    // 验证第一次 query（INSERT RETURNING）的参数中 description 为 null
    const insertCall = mockedQuery.mock.calls[0];
    const params = insertCall[1] as unknown[];
    expect(params[2]).toBeNull();
  });
});

// ==================== join 测试 ====================

describe('group-order.service - join 参与拼单', () => {
  it('拼单不存在抛 NotFoundError', async () => {
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    await expect(
      groupOrderService.join('nonexistent', 'user-1', 50),
    ).rejects.toThrow(NotFoundError);
  });

  it('状态非 open 抛 BadRequestError（拼单已关闭）', async () => {
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValueOnce({ rows: [mockGroupOrder({ status: 'full' })] });

    await expect(
      groupOrderService.join('group-order-1', 'user-1', 50),
    ).rejects.toThrow('拼单已关闭');
  });

  it('截止时间过期抛 BadRequestError（拼单已截止）', async () => {
    mockClient.query.mockReset();
    const expiredDeadline = new Date(Date.now() - 86400000).toISOString();
    mockClient.query.mockResolvedValueOnce({ rows: [mockGroupOrder({ deadline: expiredDeadline })] });

    await expect(
      groupOrderService.join('group-order-1', 'user-1', 50),
    ).rejects.toThrow('拼单已截止');
  });

  it('人数已满抛 BadRequestError（拼单已满）', async () => {
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValueOnce({
      rows: [mockGroupOrder({ current_participants: 5, max_participants: 5 })],
    });

    await expect(
      groupOrderService.join('group-order-1', 'user-1', 50),
    ).rejects.toThrow('拼单已满');
  });

  it('已参与拼单抛 BadRequestError', async () => {
    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [mockGroupOrder()] })
      .mockResolvedValueOnce({ rows: [{ id: 'p-1' }] });

    await expect(
      groupOrderService.join('group-order-1', 'participant-a', 50),
    ).rejects.toThrow('已参与此拼单');
  });

  it('正常参与 + 满员时状态变 full + 通知发起人 + freezeCredits 调用', async () => {
    const order = mockGroupOrder({ current_participants: 4, max_participants: 5 });
    mockClient.query.mockReset();
    mockClient.query
      .mockResolvedValueOnce({ rows: [order] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await groupOrderService.join('group-order-1', 'user-2', 50);

    expect(result.status).toBe('full');
    expect(result.currentParticipants).toBe(5);
    expect(result.currentAmount).toBe(200);
    expect(mockedCreditService.freezeCredits).toHaveBeenCalledWith(
      mockClient, 'user-2', 50, '参与拼单', 'group-order-1', 'group_order',
    );
  });
});

// ==================== getList 测试 ====================

describe('group-order.service - getList 获取列表', () => {
  it('无 status 过滤 + 分页参数透传', async () => {
    const mockRow = {
      id: 'order-1', initiator_id: 'user-1', title: '测试', description: null,
      target_amount: 300, current_amount: 150, min_participants: 2, max_participants: 5,
      current_participants: 3, address: '地址', deadline: new Date('2026-01-01'),
      status: 'open', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
      initiator_uid: 'user-1', initiator_nickname: '张三', initiator_avatar: null,
    };
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow] } as unknown as DbResult);

    const result = await groupOrderService.getList({}, 1, 20);

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].id).toBe('order-1');
    expect(result.list[0].initiator).toEqual({ id: 'user-1', nickname: '张三', avatar: null });
  });

  it('有 status 过滤：SQL 参数含 status 值', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await groupOrderService.getList({ status: 'open' }, 2, 10);

    expect(result.total).toBe(0);
    expect(result.list).toEqual([]);
    // 验证 count query 参数含 'open'
    const countCall = mockedQuery.mock.calls[0];
    const params = countCall[1] as unknown[];
    expect(params).toContain('open');
  });
});

// ==================== getById 测试 ====================

describe('group-order.service - getById 获取详情', () => {
  it('正常返回含 participants', async () => {
    const mockRow = {
      id: 'order-1', initiator_id: 'user-1', title: '测试', description: null,
      target_amount: 300, current_amount: 150, min_participants: 2, max_participants: 5,
      current_participants: 3, address: '地址', deadline: new Date('2026-01-01'),
      status: 'open', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'),
      initiator_uid: 'user-1', initiator_nickname: '张三', initiator_avatar: 'avatar.png',
    };
    const mockParticipantRow = {
      user_id: 'user-2', group_order_id: 'order-1', amount: 50, status: 'paid',
      created_at: new Date('2026-01-01'), nickname: '李四', avatar: null,
    };
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [mockParticipantRow] } as unknown as DbResult);

    const result = await groupOrderService.getById('order-1');

    expect(result.id).toBe('order-1');
    expect(result.initiator).toEqual({ id: 'user-1', nickname: '张三', avatar: 'avatar.png' });
    expect(result.participants).toHaveLength(1);
    expect(result.participants![0]).toEqual({
      id: 'user-2', nickname: '李四', avatar: null, amount: 50, status: 'paid',
    });
  });

  it('拼单不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await expect(
      groupOrderService.getById('nonexistent'),
    ).rejects.toThrow(NotFoundError);
  });
});

// ==================== checkExpired 测试 ====================

describe('group-order.service - checkExpired 检查过期', () => {
  it('无过期拼单返回 0', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const count = await groupOrderService.checkExpired();

    expect(count).toBe(0);
  });

  it('有过期拼单 + cancel 失败时不阻塞，返回已处理数 0', async () => {
    // checkExpired 查询返回 1 个过期拼单
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'expired-1', initiator_id: 'initiator-1' }],
    } as unknown as DbResult);
    // cancel 内部 lock order 返回空（拼单不存在），抛 NotFoundError，被 checkExpired catch 捕获
    mockClient.query.mockReset();
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const count = await groupOrderService.checkExpired();

    // cancel 失败，processedCount 为 0
    expect(count).toBe(0);
  });
});

export {};
