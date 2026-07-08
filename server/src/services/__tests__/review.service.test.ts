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

// mock database 模块：review.service 仅使用 query
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

import { reviewService } from '../review.service';
import { BadRequestError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
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
    // 第1次：查重 count=0；第2次：INSERT RETURNING *
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

    const result = await reviewService.createReview('r1', 'r2', 'o1', 'kitchen', 4.5, '服务不错');

    // 验证 rating string→number 转换（parseFloat）
    expect(result.rating).toBe(4.5);
    expect(result.content).toBe('服务不错');
    expect(result.orderType).toBe('kitchen');
  });
});

describe('review.service calculateReputation', () => {
  it('有评价时计算平均分并 UPDATE users', async () => {
    // 第1次：查询 avg_rating；第2次：UPDATE users
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_rating: '4.5' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reviewService.calculateReputation('user-1');

    expect(result).toBe(4.5);
    // 验证 UPDATE users 被调用
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[0]).toContain('UPDATE users SET reputation_score');
    expect(updateCall[1]).toEqual([4.5, 'user-1']);
  });

  it('无评价时 COALESCE 默认 5.0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ avg_rating: '5.0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

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
