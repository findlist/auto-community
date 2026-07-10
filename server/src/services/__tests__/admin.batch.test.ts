/**
 * admin.service 批量操作单元测试
 *
 * 测试目标：覆盖 batchBanUsers / batchUnbanUsers / batchUpdateContentStatus 三个方法，
 *           验证参数校验、管理员与自身跳过逻辑、去重、SQL 拼装、成功/失败明细返回
 * 测试策略：mock database 模块，断言 SQL 文本与参数数组，不依赖真实数据库
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: {},
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../cache.service', () => ({
  userCache: { get: vi.fn(), invalidate: vi.fn() },
  kitchenPostCache: { get: vi.fn(), invalidate: vi.fn() },
}));

import { adminService } from '../admin.service';
import { query } from '../../config/database';
import { BadRequestError } from '../../utils/errors';

const mockedQuery = vi.mocked(query);

// 局部类型别名：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需 rows
// 用 as unknown as DbResult 替代显式 any 断言以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;
// 内容类型联合，与 admin.service 内部 ContentType 对齐，用于非法字面量测试入参
type ContentType = 'skill' | 'kitchen' | 'time_bank' | 'emergency';

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('admin.service - 批量封禁 batchBanUsers', () => {
  it('空数组抛 BadRequestError', async () => {
    await expect(adminService.batchBanUsers([], 'operator-1')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('超过 50 条抛 BadRequestError', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `user-${i}`);
    await expect(adminService.batchBanUsers(ids, 'operator-1')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('去重后只处理唯一 ID', async () => {
    // 第一次 query：SELECT 现有用户角色，返回两个普通用户
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 'user-a', role: 'user' },
        { id: 'user-b', role: 'user' },
      ],
    } as unknown as DbResult);
    // 第二次 query：UPDATE 返回成功
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-a' }, { id: 'user-b' }],
    } as unknown as DbResult);

    const result = await adminService.batchBanUsers(['user-a', 'user-a', 'user-b'], 'operator-1');

    // 传入 SELECT 的参数应为去重后的数组（id = ANY($1) 绑定数组参数）
    expect(mockedQuery.mock.calls[0][1]).toEqual([['user-a', 'user-b']]);
    expect(result.successfulIds).toEqual(['user-a', 'user-b']);
  });

  it('跳过管理员角色，放入 skippedAdminIds', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 'user-a', role: 'user' },
        { id: 'admin-x', role: 'admin' },
      ],
    } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'user-a' }] } as unknown as DbResult);

    const result = await adminService.batchBanUsers(['user-a', 'admin-x'], 'operator-1');

    expect(result.skippedAdminIds).toEqual(['admin-x']);
    expect(result.successfulIds).toEqual(['user-a']);
  });

  it('跳过操作者自身，放入 skippedSelfId', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'operator-1', role: 'admin' }],
    } as unknown as DbResult);
    // 全部跳过时不应触发第二次 UPDATE
    const result = await adminService.batchBanUsers(['operator-1'], 'operator-1');

    expect(result.skippedSelfId).toEqual(['operator-1']);
    expect(result.successfulIds).toEqual([]);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('全部需跳过时不调用 UPDATE', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 'admin-x', role: 'admin' },
        { id: 'admin-y', role: 'admin' },
      ],
    } as unknown as DbResult);

    const result = await adminService.batchBanUsers(['admin-x', 'admin-y'], 'operator-1');

    expect(result.successfulIds).toEqual([]);
    expect(result.skippedAdminIds).toEqual(['admin-x', 'admin-y']);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('目标中已封禁用户计入 failedIds', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { id: 'user-a', role: 'user' },
        { id: 'user-b', role: 'user' },
      ],
    } as unknown as DbResult);
    // UPDATE 只返回 1 个（user-b 已封禁，WHERE status != 'banned' 命中失败）
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'user-a' }] } as unknown as DbResult);

    const result = await adminService.batchBanUsers(['user-a', 'user-b'], 'operator-1');

    expect(result.successfulIds).toEqual(['user-a']);
    expect(result.failedIds).toEqual(['user-b']);
  });

  it('SQL 使用 WHERE id = ANY($1) 且 status != banned', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'user-a', role: 'user' }] } as unknown as DbResult);
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'user-a' }] } as unknown as DbResult);

    await adminService.batchBanUsers(['user-a'], 'operator-1');

    const updateSql = mockedQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain("status = 'banned'");
    expect(updateSql).toContain('WHERE id = ANY($1)');
    expect(updateSql).toContain("status != 'banned'");
  });
});

describe('admin.service - 批量解封 batchUnbanUsers', () => {
  it('空数组抛 BadRequestError', async () => {
    await expect(adminService.batchUnbanUsers([])).rejects.toBeInstanceOf(BadRequestError);
  });

  it('超过 50 条抛 BadRequestError', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `user-${i}`);
    await expect(adminService.batchUnbanUsers(ids)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('正常解封返回成功与失败明细', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'user-a' }, { id: 'user-c' }],
    } as unknown as DbResult);

    const result = await adminService.batchUnbanUsers(['user-a', 'user-b', 'user-c']);

    expect(result.successfulIds).toEqual(['user-a', 'user-c']);
    expect(result.failedIds).toEqual(['user-b']);
  });

  it('SQL 仅解封 status=banned 的用户', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'user-a' }] } as unknown as DbResult);

    await adminService.batchUnbanUsers(['user-a']);

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("status = 'banned'");
    expect(mockedQuery.mock.calls[0][1]).toEqual([['user-a']]);
  });
});

describe('admin.service - 批量内容状态更新 batchUpdateContentStatus', () => {
  it('无效内容类型抛 BadRequestError', async () => {
    await expect(
      adminService.batchUpdateContentStatus('invalid' as unknown as ContentType, ['id-1'], 'active'),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('空 ID 列表抛 BadRequestError', async () => {
    await expect(
      adminService.batchUpdateContentStatus('skill', [], 'active'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('超过 50 条抛 BadRequestError', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `post-${i}`);
    await expect(
      adminService.batchUpdateContentStatus('skill', ids, 'active'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('正常更新返回成功与失败明细', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'post-1' }, { id: 'post-3' }],
    } as unknown as DbResult);

    const result = await adminService.batchUpdateContentStatus('skill', ['post-1', 'post-2', 'post-3'], 'inactive');

    expect(result.successfulIds).toEqual(['post-1', 'post-3']);
    expect(result.failedIds).toEqual(['post-2']);
  });

  it('SQL 使用对应表名（skill → skill_posts）', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'post-1' }] } as unknown as DbResult);

    await adminService.batchUpdateContentStatus('skill', ['post-1'], 'active');

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE skill_posts');
    expect(sql).toContain('WHERE id = ANY($2)');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['active', ['post-1']]);
  });

  it('kitchen 类型使用 kitchen_posts 表', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'kp-1' }] } as unknown as DbResult);

    await adminService.batchUpdateContentStatus('kitchen', ['kp-1'], 'active');

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE kitchen_posts');
  });

  it('time_bank 类型使用 time_services 表', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'ts-1' }] } as unknown as DbResult);

    await adminService.batchUpdateContentStatus('time_bank', ['ts-1'], 'inactive');

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE time_services');
  });

  it('emergency 类型使用 emergency_requests 表', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'er-1' }] } as unknown as DbResult);

    await adminService.batchUpdateContentStatus('emergency', ['er-1'], 'inactive');

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('UPDATE emergency_requests');
  });

  it('去重后只处理唯一 ID', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 'post-1' }] } as unknown as DbResult);

    const result = await adminService.batchUpdateContentStatus('skill', ['post-1', 'post-1'], 'active');

    expect(mockedQuery.mock.calls[0][1]).toEqual(['active', ['post-1']]);
    expect(result.successfulIds).toEqual(['post-1']);
  });
});
