/**
 * review.service 单元测试
 *
 * 测试目标：
 * - createReview：评分边界校验、重复评价拦截、正常创建（含/不含 content）、INSERT 参数透传
 * - calculateReputation：有评价时计算平均分、无评价时 COALESCE 默认 5.0、UPDATE users 触发
 * - getReviewsByUser：分页查询、空结果、totalPages 计算、offset 透传、toReview 映射
 * - toReview 间接验证：rating string→number 转换、reviewer_nickname 存在/缺失时 reviewer 对象构建
 *
 * 测试策略：mock database 的 query，分别模拟 count 查询、INSERT RETURNING、SELECT JOIN、UPDATE 等场景，
 *           验证 service 层的校验逻辑、SQL 参数透传、响应映射正确性。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：review.service 使用 query 与 transaction
// mock transaction 默认执行 callback 并传入 mock client，client.query 复用 mockQuery 便于统一断言
const { mockQuery, mockTransaction } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
  pool: {},
}));

import { reviewService } from '../review.service';
import { BadRequestError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  // transaction 默认执行 callback，传入的 client.query 复用 mockQuery 统一断言
  mockTransaction.mockImplementation(async (cb: (client: { query: typeof mockQuery }) => Promise<unknown>) => cb({ query: mockQuery }));
});

describe('review.service createReview', () => {
  it('rating < 1 时抛 BadRequestError 且不触发 query', async () => {
    await expect(
      reviewService.createReview('r1', 'r2', 'o1', 'skill', 0),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rating > 5 时抛 BadRequestError 且不触发 query', async () => {
    await expect(
      reviewService.createReview('r1', 'r2', 'o1', 'skill', 6),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('已评价过此订单时抛 BadRequestError', async () => {
    // 模拟 count 查询返回已存在记录
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await expect(
      reviewService.createReview('r1', 'r2', 'o1', 'skill', 5, '好评'),
    ).rejects.toThrow('已评价过此订单');
    // 仅触发查重 query，不应触发 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('无 content 时正常创建，INSERT 参数 content 透传为 null', async () => {
    // 事务内 3 次 query：查重 count=0 → INSERT RETURNING * → 信誉分 UPDATE
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const insertedRow = {
      id: 'rev-1',
      reviewer_id: 'r1',
      reviewed_id: 'r2',
      order_id: 'o1',
      order_type: 'skill',
      rating: '5',
      content: null,
      created_at: new Date('2026-07-08T10:00:00Z'),
      updated_at: new Date('2026-07-08T10:00:00Z'),
    };
    mockQuery.mockResolvedValueOnce({ rows: [insertedRow] });
    // 第3次：reputationService.updateReputationScore 的 UPDATE，返回空 rows 即可（函数不使用返回值）
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reviewService.createReview('r1', 'r2', 'o1', 'skill', 5);

    // 验证 INSERT 第6个参数为 null（content || null）
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1][5]).toBeNull();
    // 验证返回值映射：rating string→number 转换
    expect(result.rating).toBe(5);
    expect(result.id).toBe('rev-1');
    expect(result.reviewer).toBeUndefined();
  });

  it('有 content 时正常创建，返回值含 content', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rev-2',
        reviewer_id: 'r1',
        reviewed_id: 'r2',
        order_id: 'o1',
        order_type: 'kitchen',
        rating: '4.5',
        content: '服务不错',
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });
    // 第3次：信誉分 UPDATE 返回空 rows
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reviewService.createReview('r1', 'r2', 'o1', 'kitchen', 4.5, '服务不错');

    // 验证 rating string→number 转换（parseFloat）
    expect(result.rating).toBe(4.5);
    expect(result.content).toBe('服务不错');
    expect(result.orderType).toBe('kitchen');
  });

  it('createReview 包裹 transaction 且事务内调用 reputationService.updateReputationScore 保证评价与信誉分原子性', async () => {
    // 不变式：查重 + INSERT + 信誉分 UPDATE 必须在同一事务内，任一步失败回滚
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{
      id: 'rev-3',
      reviewer_id: 'r1',
      reviewed_id: 'r2',
      order_id: 'o1',
      order_type: 'skill',
      rating: '5',
      content: null,
      created_at: new Date('2026-07-08T10:00:00Z'),
      updated_at: new Date('2026-07-08T10:00:00Z'),
    }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await reviewService.createReview('r1', 'r2', 'o1', 'skill', 5);

    // 验证 transaction 被调用一次（包裹 查重 + INSERT + 信誉分 UPDATE）
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 验证事务内 3 次 client.query（mockTransaction 默认 client.query 复用 mockQuery）
    expect(mockQuery).toHaveBeenCalledTimes(3);
    // 第3次 query 为信誉分 UPDATE：SQL 含 UPDATE users SET reputation_score
    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE users SET reputation_score');
    // 参数为 [reviewedId]（updateReputationScore(client, userId) 透传 reviewedId）
    expect(updateCall[1]).toEqual(['r2']);
  });
});

describe('review.service calculateReputation', () => {
  it('有评价时原子计算平均分并 UPDATE users（单条 SQL 消除 lost update）', async () => {
    // 单条 UPDATE + 子查询 + RETURNING reputation_score，事务内仅 1 次 client.query
    mockQuery.mockResolvedValueOnce({ rows: [{ reputation_score: '4.5' }] });

    const result = await reviewService.calculateReputation('user-1');

    expect(result).toBe(4.5);
    // 验证 transaction 被调用
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 验证事务内仅 1 次 query（原实现为 2 次：SELECT AVG + UPDATE）
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('UPDATE users SET reputation_score');
    expect(sql).toContain('SELECT COALESCE(AVG(rating), 5.0)');
    // 参数仅 userId（原实现为 [avgRating, userId]）
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('无评价时 COALESCE 默认 5.0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ reputation_score: '5.0' }] });

    const result = await reviewService.calculateReputation('user-2');

    expect(result).toBe(5.0);
  });
});

describe('review.service getReviewsByUser', () => {
  it('正常分页查询，返回映射后的 list 与分页信息', async () => {
    // Promise.all 第1项：list 查询；第2项：count 查询
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rev-1',
        reviewer_id: 'r1',
        reviewed_id: 'user-1',
        order_id: 'o1',
        order_type: 'skill',
        rating: '5',
        content: '好评',
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
        reviewer_nickname: '张三',
        reviewer_avatar: '/uploads/a.png',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await reviewService.getReviewsByUser('user-1', 1, 10);

    expect(result.list).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(1);
    // 验证 reviewer 对象构建（reviewer_nickname 存在时）
    expect(result.list[0].reviewer).toEqual({
      id: 'r1',
      nickname: '张三',
      avatar: '/uploads/a.png',
    });
  });

  it('空结果时返回空 list 与 total=0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await reviewService.getReviewsByUser('user-1', 1, 10);

    expect(result.list).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('totalPages 向上取整（total=25, pageSize=10 → 3）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });

    const result = await reviewService.getReviewsByUser('user-1', 1, 10);

    expect(result.totalPages).toBe(3);
  });

  it('page=2, pageSize=10 时 offset=10 透传到查询参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '15' }] });

    await reviewService.getReviewsByUser('user-1', 2, 10);

    // list 查询是第1次调用，参数为 [userId, pageSize, offset]
    const listCall = mockQuery.mock.calls[0];
    expect(listCall[1]).toEqual(['user-1', 10, 10]);
  });

  it('reviewer_nickname 为 null 时 reviewer 为 undefined', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rev-1',
        reviewer_id: 'r1',
        reviewed_id: 'user-1',
        order_id: 'o1',
        order_type: 'skill',
        rating: '4',
        content: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
        reviewer_nickname: null,
        reviewer_avatar: null,
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await reviewService.getReviewsByUser('user-1', 1, 10);

    expect(result.list[0].reviewer).toBeUndefined();
  });
});

describe('review.service getReviewsByOrderType', () => {
  it('不传 userId 时 SQL 仅含 order_type 必备条件，count 参数为 [orderType]', async () => {
    // Promise.all 第1项：list 查询；第2项：count 查询
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await reviewService.getReviewsByOrderType('kitchen', { page: 1, pageSize: 10 });

    expect(result.total).toBe(0);
    expect(result.list).toEqual([]);

    // list 查询是第1次调用：参数为 [orderType, pageSize, offset]
    const listCall = mockQuery.mock.calls[0];
    expect(listCall[1]).toEqual(['kitchen', 10, 0]);
    // list SQL WHERE 仅含 r.order_type = $1 条件，不含 reviewed_id = 过滤
    // 注意：SELECT 列名含 r.reviewed_id 是正常的，只验证 WHERE 子句无 reviewed_id = 条件
    expect(listCall[0]).toContain('r.order_type = $1');
    expect(listCall[0]).not.toContain('reviewed_id = ');

    // count 查询是第2次调用：参数仅 [orderType]（无前缀的 whereClause）
    const countCall = mockQuery.mock.calls[1];
    expect(countCall[1]).toEqual(['kitchen']);
    expect(countCall[0]).toContain('order_type = $1');
    expect(countCall[0]).not.toContain('r.order_type');
  });

  it('传 userId 时 SQL 含 order_type + reviewed_id，参数对应增长', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'rev-1',
        reviewer_id: 'r1',
        reviewed_id: 'user-1',
        order_id: 'o1',
        order_type: 'kitchen',
        rating: '5',
        content: '好评',
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
        reviewer_nickname: '李四',
        reviewer_avatar: '/uploads/b.png',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await reviewService.getReviewsByOrderType('kitchen', {
      userId: 'user-1',
      page: 1,
      pageSize: 10,
    });

    expect(result.list).toHaveLength(1);
    expect(result.total).toBe(1);

    // list 查询参数：[orderType, userId, pageSize, offset]
    const listCall = mockQuery.mock.calls[0];
    expect(listCall[1]).toEqual(['kitchen', 'user-1', 10, 0]);
    // list SQL WHERE 含 r.order_type = $1 和 r.reviewed_id = $2
    expect(listCall[0]).toContain('r.order_type = $1');
    expect(listCall[0]).toContain('r.reviewed_id = $2');

    // count 查询参数：[orderType, userId]
    const countCall = mockQuery.mock.calls[1];
    expect(countCall[1]).toEqual(['kitchen', 'user-1']);
  });

  it('默认 page=1, pageSize=10（不传 options 时使用默认值）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await reviewService.getReviewsByOrderType('skill');

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);

    // list 查询参数：[orderType, pageSize, offset]
    const listCall = mockQuery.mock.calls[0];
    expect(listCall[1]).toEqual(['skill', 10, 0]);
  });
});
