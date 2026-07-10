/**
 * reputation.service 单元测试
 *
 * 测试目标：
 * - updateReputationScore 双调用模式：事务内（PoolClient）与事务外（string）
 * - typeof 类型守卫区分两种调用路径，验证 SQL 与参数透传正确性
 * - 事务内调用复用传入的 client，保证信誉分更新与业务操作在同一事务提交/回滚
 * - 事务外调用使用连接池 query，适用于无事务上下文的异步刷新场景
 *
 * 测试策略：mock database 的 query（事务外路径），构造模拟 PoolClient 对象（事务内路径），
 *           验证两条调用路径分别走对应的 query 方法，SQL 语句与参数正确透传。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：reputation.service 事务外路径使用 query
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

import type { PoolClient } from 'pg';
import { reputationService } from '../reputation.service';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('reputation.service updateReputationScore 事务外调用（string）', () => {
  it('使用连接池 query 执行 UPDATE，参数为 [userId]', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await reputationService.updateReputationScore('user-1');

    // 验证走的是顶层 query（连接池），而非 client.query
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0];
    // SQL 含 UPDATE users SET reputation_score 子查询
    expect(call[0]).toContain('UPDATE users SET reputation_score');
    expect(call[0]).toContain('COALESCE(AVG(rating), 5.0)');
    expect(call[1]).toEqual(['user-1']);
  });

  it('返回 void（无返回值）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reputationService.updateReputationScore('user-2');

    expect(result).toBeUndefined();
  });
});

describe('reputation.service updateReputationScore 事务内调用（PoolClient）', () => {
  it('复用传入的 client.query，不触发顶层 query', async () => {
    // 构造模拟 PoolClient 对象（只需 query 方法符合 PoolClient 接口子集）
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    };

    await reputationService.updateReputationScore(mockClient as unknown as PoolClient, 'user-1');

    // 验证走的是 client.query（事务内），顶层 query 不被调用
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('SQL 与参数透传到 client.query', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    };

    await reputationService.updateReputationScore(mockClient as unknown as PoolClient, 'user-2');

    const call = mockClient.query.mock.calls[0];
    expect(call[0]).toContain('UPDATE users SET reputation_score');
    // 事务内路径 userId 通过第2参数传入
    expect(call[1]).toEqual(['user-2']);
  });

  it('返回 void（无返回值）', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValueOnce({ rows: [] }),
    };

    const result = await reputationService.updateReputationScore(mockClient as unknown as PoolClient, 'user-3');

    expect(result).toBeUndefined();
  });
});

describe('reputation.service updateReputationScore SQL 语义', () => {
  it('SQL 基于 recently 50 条评价计算平均分', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await reputationService.updateReputationScore('user-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    // 验证 SQL 含 LIMIT 50（最近50条评价）与 ORDER BY created_at DESC
    expect(sql).toContain('LIMIT 50');
    expect(sql).toContain('ORDER BY created_at DESC');
  });

  it('SQL 含 COALESCE 默认 5.0（无评价时）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await reputationService.updateReputationScore('user-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('COALESCE(AVG(rating), 5.0)');
  });
});
