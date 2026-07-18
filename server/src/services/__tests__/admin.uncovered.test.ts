/**
 * admin.service 未覆盖函数单元测试
 *
 * 测试目标：覆盖 forceCancelOrder（含3子函数）、数据统计（getDashboard/
 *   getRegistrationTrend/getOrderTrend/getReputationDistribution/getModuleActivity/
 *   getSystemMetrics）、举报处理（createReport/getReports/handleReport）、
 *   实名认证审核（getVerificationRequests/reviewVerificationRequest）共 13 个函数
 * 测试策略：mock database 的 query/transaction + cache.service 的 userCache +
 *   logger，事务内用 mockClient.query 按 SQL 调用顺序返回数据
 * 设计原因：这 13 个函数是 admin.service 覆盖率从 65.98% 提升的关键缺口，
 *   集中在一个文件便于维护，避免修改现有 5 个测试文件的 mock 上下文
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// vi.hoisted 提前创建 mock 引用，避免 vi.mock 工厂内 TDZ 问题
const {
  mockQuery, mockTransaction, mockClient,
  mockUserCacheInvalidate,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockClient: { query: vi.fn() },
  mockUserCacheInvalidate: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
  pool: {},
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../cache.service', () => ({
  userCache: { get: vi.fn(), invalidate: mockUserCacheInvalidate },
  kitchenPostCache: { get: vi.fn(), invalidate: vi.fn() },
}));

import { adminService } from '../admin.service';
import { BadRequestError, NotFoundError } from '../../utils/errors';

beforeEach(() => {
  vi.clearAllMocks();
  // 默认事务实现：将 mockClient 传给回调，模拟真实事务行为
  mockTransaction.mockImplementation(async (cb: (c: typeof mockClient) => Promise<unknown>) => cb(mockClient));
});

// ===================== forceCancelOrder =====================
describe('admin.service - forceCancelOrder 强制取消订单', () => {
  it('无效订单类型抛 BadRequestError', async () => {
    await expect(
      adminService.forceCancelOrder('invalid' as never, 'o-1', '原因', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  // ---------- skill ----------
  it('skill 订单不存在抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] } as never);
    await expect(
      adminService.forceCancelOrder('skill', 'o-x', '原因', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('skill 订单已取消抛 BadRequestError', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'o-1', status: 'cancelled', credit_amount: 50, buyer_id: 'u1', seller_id: 'u2' }],
    } as never);
    await expect(
      adminService.forceCancelOrder('skill', 'o-1', '原因', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('skill pending 状态正常取消（退款买家，不扣回卖家）', async () => {
    // 1.SELECT order 2.UPDATE order 3.UPDATE buyer+credit 4.INSERT refund
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'pending', credit_amount: 50, buyer_id: 'u1', seller_id: 'u2' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await adminService.forceCancelOrder('skill', 'o-1', '违规', 'admin-1');

    expect(result).toEqual({ id: 'o-1', status: 'cancelled', reason: '违规', adminId: 'admin-1' });
    // pending 状态：退款买家（4 次 client.query），不扣回卖家
    expect(mockClient.query).toHaveBeenCalledTimes(4);
  });

  it('skill accepted 状态取消（退款买家 + 扣回卖家）', async () => {
    // 1.SELECT 2.UPDATE order 3.UPDATE buyer+ 4.INSERT refund 5.UPDATE seller- 6.INSERT spend
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'accepted', credit_amount: 50, buyer_id: 'u1', seller_id: 'u2' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.forceCancelOrder('skill', 'o-1', '违规', 'admin-1');

    // accepted：退款买家 + 扣回卖家，共 6 次 client.query
    expect(mockClient.query).toHaveBeenCalledTimes(6);
  });

  it('skill completed 状态取消（不退款）', async () => {
    // completed 状态 needRefund=false，只有 1.SELECT 2.UPDATE order
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'completed', credit_amount: 50, buyer_id: 'u1', seller_id: 'u2' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.forceCancelOrder('skill', 'o-1', '原因', 'admin-1');

    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  // ---------- kitchen ----------
  it('kitchen 订单不存在抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] } as never);
    await expect(
      adminService.forceCancelOrder('kitchen', 'o-x', '原因', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('kitchen 订单已取消抛 BadRequestError', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 'o-1', status: 'cancelled', credit_amount: 30, user_id: 'u1', seller_id: 'u2', portions: 2, post_id: 'p1' }],
    } as never);
    await expect(
      adminService.forceCancelOrder('kitchen', 'o-1', '原因', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('kitchen pending 状态取消（退款买家 + 恢复份数，不扣回卖家）', async () => {
    // 1.SELECT 2.UPDATE order 3.UPDATE buyer+ 4.INSERT refund 5.UPDATE portions 6.UPDATE status
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'pending', credit_amount: 30, user_id: 'u1', seller_id: 'u2', portions: 2, post_id: 'p1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await adminService.forceCancelOrder('kitchen', 'o-1', '违规', 'admin-1');

    expect(result.status).toBe('cancelled');
    // pending：退款买家（4次）+ 恢复份数（2次）= 6 次
    expect(mockClient.query).toHaveBeenCalledTimes(6);
  });

  it('kitchen confirmed 状态取消（退款买家 + 扣回卖家 + 恢复份数）', async () => {
    // 1.SELECT 2.UPDATE order 3.UPDATE buyer+ 4.INSERT refund 5.UPDATE seller- 6.INSERT spend 7.UPDATE portions 8.UPDATE status
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'confirmed', credit_amount: 30, user_id: 'u1', seller_id: 'u2', portions: 2, post_id: 'p1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.forceCancelOrder('kitchen', 'o-1', '违规', 'admin-1');

    // confirmed：退款买家（4次）+ 扣回卖家（2次）+ 恢复份数（2次）= 8 次
    expect(mockClient.query).toHaveBeenCalledTimes(8);
  });

  it('kitchen completed 状态取消（不退款，但仍恢复份数）', async () => {
    // completed: needRefund=false，1.SELECT 2.UPDATE order 3.UPDATE portions 4.UPDATE status
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'completed', credit_amount: 30, user_id: 'u1', seller_id: 'u2', portions: 2, post_id: 'p1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.forceCancelOrder('kitchen', 'o-1', '原因', 'admin-1');

    // completed：不退款，但份数恢复仍执行，共 4 次
    expect(mockClient.query).toHaveBeenCalledTimes(4);
  });

  it('kitchen credit_amount=0 时不退款（needRefund=false）', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'pending', credit_amount: 0, user_id: 'u1', seller_id: 'u2', portions: 1, post_id: 'p1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.forceCancelOrder('kitchen', 'o-1', '原因', 'admin-1');

    // credit_amount=0：needRefund=false，1.SELECT 2.UPDATE order 3.UPDATE portions 4.UPDATE status
    expect(mockClient.query).toHaveBeenCalledTimes(4);
  });

  // ---------- time_bank ----------
  it('time_bank 订单不存在抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] } as never);
    await expect(
      adminService.forceCancelOrder('time_bank', 'o-x', '原因', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('time_bank 订单已取消抛 BadRequestError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'cancelled' }] } as never);
    await expect(
      adminService.forceCancelOrder('time_bank', 'o-1', '原因', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('time_bank 正常取消（无需退款）', async () => {
    // time_bank 完成时才结算，取消无需退还：1.SELECT 2.UPDATE order
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'in_progress' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await adminService.forceCancelOrder('time_bank', 'o-1', '原因', 'admin-1');

    expect(result).toEqual({ id: 'o-1', status: 'cancelled', reason: '原因', adminId: 'admin-1' });
    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });
});

// ===================== 数据统计 =====================
describe('admin.service - getDashboard 平台概览', () => {
  it('返回 7 个统计数字，count 字符串转 number', async () => {
    // Promise.all 按 7 个 query 数组顺序消费
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '100' }] } as never)   // totalUsers
      .mockResolvedValueOnce({ rows: [{ count: '5' }] } as never)      // todayNewUsers
      .mockResolvedValueOnce({ rows: [{ count: '20' }] } as never)     // skillOrders
      .mockResolvedValueOnce({ rows: [{ count: '10' }] } as never)     // kitchenOrders
      .mockResolvedValueOnce({ rows: [{ count: '8' }] } as never)      // timeBankOrders
      .mockResolvedValueOnce({ rows: [{ count: '3' }] } as never)      // emergencyRequests
      .mockResolvedValueOnce({ rows: [{ count: '2' }] } as never);     // pendingReports

    const result = await adminService.getDashboard();

    expect(result).toEqual({
      totalUsers: 100,
      todayNewUsers: 5,
      skillOrders: 20,
      kitchenOrders: 10,
      timeBankOrders: 8,
      emergencyRequests: 3,
      pendingReports: 2,
    });
  });
});

describe('admin.service - getRegistrationTrend 注册趋势', () => {
  it('返回日期序列，count 字符串转 number', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { date: '2026-07-01', count: '3' },
        { date: '2026-07-02', count: '0' },
      ],
    } as never);

    const result = await adminService.getRegistrationTrend(7);

    expect(result).toEqual([
      { date: '2026-07-01', count: 3 },
      { date: '2026-07-02', count: 0 },
    ]);
    // SQL 应含 generate_series 与 days-1 间隔
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('generate_series');
    expect(mockQuery.mock.calls[0][1]).toEqual(['6 days']);
  });
});

describe('admin.service - getOrderTrend 订单趋势', () => {
  it('返回日期序列，COALESCE 兜底 count 为 0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ date: '2026-07-01', count: '0' }],
    } as never);

    const result = await adminService.getOrderTrend(7);

    expect(result).toEqual([{ date: '2026-07-01', count: 0 }]);
    // SQL 应含 UNION ALL 三张订单表
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('skill_orders');
    expect(sql).toContain('kitchen_orders');
    expect(sql).toContain('time_orders');
  });
});

describe('admin.service - getReputationDistribution 信誉分分布', () => {
  it('返回分段统计，count 字符串转 number', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { label: '优秀 (4.5+)', count: '10' },
        { label: '良好 (4.0-4.5)', count: '20' },
      ],
    } as never);

    const result = await adminService.getReputationDistribution();

    expect(result).toEqual([
      { label: '优秀 (4.5+)', count: 10 },
      { label: '良好 (4.0-4.5)', count: 20 },
    ]);
    // SQL 应含 CASE WHEN 信誉分分段
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('CASE');
    expect(sql).toContain('reputation_score');
  });
});

describe('admin.service - getModuleActivity 模块活跃度', () => {
  it('返回 4 个模块，emergency orders 固定为 0', async () => {
    // Promise.all 7 个 count 查询：skillPosts/skillOrders/kitchenPosts/kitchenOrders/timeServices/timeOrders/emergencyRequests
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '10' }] } as never)  // skillPosts
      .mockResolvedValueOnce({ rows: [{ count: '5' }] } as never)   // skillOrders
      .mockResolvedValueOnce({ rows: [{ count: '8' }] } as never)   // kitchenPosts
      .mockResolvedValueOnce({ rows: [{ count: '4' }] } as never)   // kitchenOrders
      .mockResolvedValueOnce({ rows: [{ count: '6' }] } as never)   // timeServices
      .mockResolvedValueOnce({ rows: [{ count: '3' }] } as never)   // timeOrders
      .mockResolvedValueOnce({ rows: [{ count: '2' }] } as never);  // emergencyRequests

    const result = await adminService.getModuleActivity();

    expect(result).toEqual([
      { name: '技能交换', posts: 10, orders: 5 },
      { name: '共享厨房', posts: 8, orders: 4 },
      { name: '时间银行', posts: 6, orders: 3 },
      { name: '应急邻里', posts: 2, orders: 0 },  // emergency 无订单概念，固定 0
    ]);
  });

  it('SQL 含 30 天间隔过滤', async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: '0' }] } as never);

    await adminService.getModuleActivity();

    // 所有 7 个 query SQL 均应含 30 天间隔
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).toContain("INTERVAL '30 days'");
    }
  });
});

describe('admin.service - getSystemMetrics 系统指标', () => {
  it('返回 4 个指标，totalMutualAids 用 || 兜底为 0', async () => {
    // Promise.all 4 个查询：pendingReports/todayActiveUsers/totalMutualAids/monthNewUsers
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '3' }] } as never)   // pendingReports
      .mockResolvedValueOnce({ rows: [{ count: '15' }] } as never)   // todayActiveUsers
      .mockResolvedValueOnce({ rows: [{ sum: '42' }] } as never)     // totalMutualAids
      .mockResolvedValueOnce({ rows: [{ count: '8' }] } as never);   // monthNewUsers

    const result = await adminService.getSystemMetrics();

    expect(result).toEqual({
      pendingReports: 3,
      todayActiveUsers: 15,
      totalMutualAids: 42,
      monthNewUsers: 8,
    });
  });

  it('sum 为 null 时 totalMutualAids 兜底为 0', async () => {
    // 无完成订单时 SUM(cnt) 为 null，用 || '0' 兜底
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [{ sum: null }] } as never)
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never);

    const result = await adminService.getSystemMetrics();

    expect(result.totalMutualAids).toBe(0);
  });
});

// ===================== 举报处理 =====================
describe('admin.service - createReport 创建举报', () => {
  it('正常创建，字段映射驼峰', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r-1', reporter_id: 'u-1', target_type: 'skill', target_id: 'p-1',
        reason: '违规内容', status: 'pending', created_at: new Date('2026-07-08'),
      }],
    } as never);

    const result = await adminService.createReport('u-1', 'skill', 'p-1', '违规内容');

    expect(result).toEqual({
      id: 'r-1',
      reporterId: 'u-1',
      targetType: 'skill',
      targetId: 'p-1',
      reason: '违规内容',
      status: 'pending',
      createdAt: new Date('2026-07-08'),
    });
    // SQL 应含 INSERT INTO reports
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO reports');
    // 参数顺序：reporterId, targetType, targetId, reason
    expect(mockQuery.mock.calls[0][1]).toEqual(['u-1', 'skill', 'p-1', '违规内容']);
  });
});

describe('admin.service - getReports 举报列表', () => {
  it('正常分页，字段映射驼峰，JOIN reporter/handler', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)  // count
      .mockResolvedValueOnce({
        rows: [{
          id: 'r-1', reporter_id: 'u-1', target_type: 'skill', target_id: 'p-1',
          reason: '违规', status: 'pending', handler_id: null, handle_note: null,
          created_at: new Date(), handled_at: null,
          reporter_nickname: '张三', handler_nickname: null,
        }],
      } as never);

    const result = await adminService.getReports(1, 20);

    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      id: 'r-1',
      reporterId: 'u-1',
      reporterNickname: '张三',
      targetType: 'skill',
      status: 'pending',
      handlerId: null,
      handlerNickname: null,
    });
    // list SQL 应含 LEFT JOIN reporter/handler
    const listSql = mockQuery.mock.calls[1][0] as string;
    expect(listSql).toContain('LEFT JOIN users reporter');
    expect(listSql).toContain('LEFT JOIN users handler');
  });

  it('status 过滤时 SQL 含 status = $1', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.getReports(1, 20, 'pending');

    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain('status = $1');
    expect(mockQuery.mock.calls[0][1]).toEqual(['pending']);
  });

  it('空结果返回空 list', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await adminService.getReports(1, 20);

    expect(result.list).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('admin.service - handleReport 处理举报', () => {
  it('无效状态抛 BadRequestError', async () => {
    await expect(
      adminService.handleReport('r-1', 'admin-1', 'pending' as never, '备注'),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('举报不存在抛 NotFoundError', async () => {
    // UPDATE 返回空（status != pending 未命中），第二次 SELECT 也返回空
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)  // UPDATE RETURNING
      .mockResolvedValueOnce({ rows: [] } as never); // SELECT exist

    await expect(
      adminService.handleReport('r-x', 'admin-1', 'resolved', '已处理'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('举报已处理抛 BadRequestError（重复处理）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)  // UPDATE RETURNING 空
      .mockResolvedValueOnce({ rows: [{ id: 'r-1', status: 'resolved' }] } as never); // SELECT exist

    await expect(
      adminService.handleReport('r-1', 'admin-1', 'resolved', '备注'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('正常处理 resolved，字段映射驼峰', async () => {
    const handledAt = new Date();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r-1', status: 'resolved', handler_id: 'admin-1',
        handle_note: '已处理', handled_at: handledAt,
      }],
    } as never);

    const result = await adminService.handleReport('r-1', 'admin-1', 'resolved', '已处理');

    expect(result).toEqual({
      id: 'r-1',
      status: 'resolved',
      handlerId: 'admin-1',
      handleNote: '已处理',
      handledAt,
    });
    // SQL 应含 WHERE status = 'pending' 防止重复处理
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'pending'");
  });

  it('正常处理 rejected', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r-1', status: 'rejected', handler_id: 'admin-1', handle_note: '无效举报', handled_at: new Date() }],
    } as never);

    const result = await adminService.handleReport('r-1', 'admin-1', 'rejected', '无效举报');

    expect(result.status).toBe('rejected');
    expect(result.handleNote).toBe('无效举报');
  });
});

// ===================== 实名认证审核 =====================
describe('admin.service - getVerificationRequests 认证申请列表', () => {
  it('正常分页，字段映射驼峰，JOIN users/reviewer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 'v-1', user_id: 'u-1', real_name: '张三', status: 'pending',
          reject_reason: null, created_at: new Date(), reviewed_at: null, reviewed_by: null,
          user_nickname: '昵称', user_phone: '13800000000', reviewer_nickname: null,
        }],
      } as never);

    const result = await adminService.getVerificationRequests(1, 20);

    expect(result.total).toBe(1);
    expect(result.list[0]).toMatchObject({
      id: 'v-1',
      userId: 'u-1',
      userNickname: '昵称',
      userPhone: '13800000000',
      realName: '张三',
      status: 'pending',
      rejectReason: null,
      reviewedAt: null,
      reviewedBy: null,
      reviewerNickname: null,
    });
    // list SQL 应含 LEFT JOIN users u 与 reviewer
    const listSql = mockQuery.mock.calls[1][0] as string;
    expect(listSql).toContain('LEFT JOIN users u');
    expect(listSql).toContain('LEFT JOIN users reviewer');
  });

  it('status 过滤时 SQL 含 status = $1', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.getVerificationRequests(1, 20, 'pending');

    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain('status = $1');
    expect(mockQuery.mock.calls[0][1]).toEqual(['pending']);
  });

  it('reject_reason 非空时透传', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as never)
      .mockResolvedValueOnce({
        rows: [{
          id: 'v-1', user_id: 'u-1', real_name: '李四', status: 'rejected',
          reject_reason: '证件不清晰', created_at: new Date(), reviewed_at: new Date(), reviewed_by: 'admin-1',
          user_nickname: '李四昵称', user_phone: '13900000000', reviewer_nickname: '管理员',
        }],
      } as never);

    const result = await adminService.getVerificationRequests(1, 20);

    expect(result.list[0].rejectReason).toBe('证件不清晰');
    expect(result.list[0].reviewerNickname).toBe('管理员');
  });
});

describe('admin.service - reviewVerificationRequest 审核认证申请', () => {
  it('申请不存在抛 NotFoundError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never);

    await expect(
      adminService.reviewVerificationRequest('v-x', 'admin-1', 'approve'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('申请已审核抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'v-1', status: 'approved', user_id: 'u-1' }],
    } as never);

    await expect(
      adminService.reviewVerificationRequest('v-1', 'admin-1', 'approve'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('reject 时未提供原因抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'v-1', status: 'pending', user_id: 'u-1' }],
    } as never);

    await expect(
      adminService.reviewVerificationRequest('v-1', 'admin-1', 'reject'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('approve 正常通过，事务内更新申请+用户，清缓存', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'v-1', status: 'pending', user_id: 'u-1' }],
    } as never);
    // 事务内 2 次 client.query
    mockClient.query
      .mockResolvedValueOnce({ rows: [] } as never)  // UPDATE verification_requests
      .mockResolvedValueOnce({ rows: [] } as never); // UPDATE users verify_status

    const result = await adminService.reviewVerificationRequest('v-1', 'admin-1', 'approve');

    expect(result.status).toBe('approved');
    expect(result.reviewedBy).toBe('admin-1');
    // 验证事务内 2 次 UPDATE
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    // 验证清缓存
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith('u-1');
  });

  it('reject 正常通过（含原因）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'v-1', status: 'pending', user_id: 'u-1' }],
    } as never);
    mockClient.query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await adminService.reviewVerificationRequest('v-1', 'admin-1', 'reject', '证件不清晰');

    expect(result.status).toBe('rejected');
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith('u-1');
  });

  it('approve 时 rejectReason 为 undefined，SQL 参数绑定为 null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'v-1', status: 'pending', user_id: 'u-1' }],
    } as never);
    mockClient.query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.reviewVerificationRequest('v-1', 'admin-1', 'approve');

    // 事务内第一次 UPDATE 参数：[newStatus, reviewerId, rejectReason||null, requestId]
    const params = mockClient.query.mock.calls[0][1] as unknown[];
    expect(params).toEqual(['approved', 'admin-1', null, 'v-1']);
  });
});

// ===================== XSS 不变式测试 =====================
// 设计原因：handleReport/reviewVerificationRequest/forceCancelOrder 三处入口已补 sanitizeXss，
// 需补不变式测试验证 XSS payload 在入库前被剥离，避免依赖 xss 库具体输出格式
describe('admin.service - XSS 不变式（handleReport/reviewVerificationRequest/forceCancelOrder）', () => {
  it('handleReport 含 <script> 的 handleNote 入库前被剥离', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r-1', status: 'resolved', handler_id: 'admin-1', handle_note: 'cleaned', handled_at: new Date() }],
    } as never);

    await adminService.handleReport('r-1', 'admin-1', 'resolved', '正常备注<script>alert(1)</script>');

    // UPDATE 参数第 3 位为 handleNote，应剥离 <script> 标签
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[2]).not.toContain('<script>');
    expect(params[2]).not.toContain('</script>');
    // 正常文本应保留
    expect(params[2]).toContain('正常备注');
  });

  it('reviewVerificationRequest reject 含 <script> 的 rejectReason 入库前被剥离', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'v-1', status: 'pending', user_id: 'u-1' }],
    } as never);
    mockClient.query
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.reviewVerificationRequest('v-1', 'admin-1', 'reject', '证件不清晰<script>alert(1)</script>');

    // 事务内第一次 UPDATE 参数第 3 位为 rejectReason，应剥离 <script> 标签
    const params = mockClient.query.mock.calls[0][1] as unknown[];
    expect(params[2]).not.toContain('<script>');
    expect(params[2]).not.toContain('</script>');
    expect(params[2]).toContain('证件不清晰');
  });

  it('forceCancelOrder skill 含 <script> 的 reason 拼接 description 前被剥离', async () => {
    // skill pending：1.SELECT 2.UPDATE order 3.UPDATE buyer 4.INSERT refund（reason 拼入 description）
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ id: 'o-1', status: 'pending', credit_amount: 50, buyer_id: 'u1', seller_id: 'u2' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await adminService.forceCancelOrder('skill', 'o-1', '违规<script>alert(1)</script>', 'admin-1');

    // 第 4 次 client.query 是 INSERT credit_transactions，description 参数（第 4 位）含 reason
    const insertParams = mockClient.query.mock.calls[3][1] as unknown[];
    const description = insertParams[3] as string;
    expect(description).not.toContain('<script>');
    expect(description).not.toContain('</script>');
    expect(description).toContain('违规');
    expect(description).toContain('管理员强制取消');
  });
});
