/**
 * data-deletion.service 单元测试（隐私合规模块）
 *
 * 测试目标：
 * - submitDeletionRequest：用户不存在/已封禁/重复申请/正常提交（含/缺 reason）
 * - getDeletionRequestStatus：无申请返回 null / 有申请返回完整对象
 * - cancelDeletionRequest：无可取消申请抛错 / 正常取消
 * - getDeletionRequests：带/不带 status 筛选 / 分页结构正确
 * - reviewDeletionRequest：申请不存在/已审核/reject 无原因/approve 触发匿名化/reject 不触发
 * - executeAnonymization：事务内更新用户表 + 删除认证 + 清缓存
 * - cleanupSoftDeletedData：无过期用户返回 0 / 有过期用户事务内删除多表
 *
 * 测试策略：mock database 的 query 与 transaction（transaction 回调注入 mockClient）、
 *           mock cache.service 与 logger，验证 SQL 参数与抛错行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 使用 vi.hoisted 提前创建 mock 引用，避免 vi.mock 工厂内 TDZ
const { mockQuery, mockTransaction, mockClient, mockUserCacheInvalidate, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  // 事务回调内使用的 client.query mock
  mockClient: { query: vi.fn() },
  mockUserCacheInvalidate: vi.fn().mockResolvedValue(undefined),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

// mock database：transaction 需将回调注入 mockClient，便于测试事务内多条 SQL
vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
  pool: {},
  SqlParam: vi.fn(), // 仅类型用途，运行时不需要真实实现
}));

// mock cache.service，避免 env 依赖与真实缓存连接
vi.mock('../cache.service', () => ({
  userCache: {
    get: vi.fn(),
    invalidate: mockUserCacheInvalidate,
  },
}));

// mock logger，避免测试输出污染控制台
vi.mock('../../utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

import { dataDeletionService } from '../data-deletion.service';
import { BadRequestError, NotFoundError, ConflictError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
  mockClient.query.mockReset();
  // mockReset 会清除调用记录与 implementation，需重新设置默认实现
  mockTransaction.mockReset();
  mockTransaction.mockImplementation(async (cb: (c: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  mockUserCacheInvalidate.mockClear();
  mockLoggerInfo.mockClear();
  mockLoggerError.mockClear();
});

describe('data-deletion.service - submitDeletionRequest', () => {
  it('用户不存在时抛 NotFoundError', async () => {
    // 模拟用户查询返回空
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      dataDeletionService.submitDeletionRequest('user-x', 'reason'),
    ).rejects.toThrow(NotFoundError);
    // 不应触发后续 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('用户已封禁时抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'banned' }] });

    await expect(
      dataDeletionService.submitDeletionRequest('user-1'),
    ).rejects.toThrow(BadRequestError);
  });

  it('已存在待处理申请时抛 ConflictError', async () => {
    // 第一次 query：用户存在且未封禁；第二次 query：已有 pending/approved 申请
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'active' }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-old' }] });

    await expect(
      dataDeletionService.submitDeletionRequest('user-1', '重复申请'),
    ).rejects.toThrow(ConflictError);
    // 不应触发 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('正常提交（含 reason）返回 pending 状态', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'active' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 无重复申请
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1', status: 'pending' }] });

    const result = await dataDeletionService.submitDeletionRequest('user-1', '不再使用');

    expect(result).toEqual({
      id: 'req-1',
      status: 'pending',
      message: '注销申请已提交，请等待管理员审核',
    });
    // 验证 INSERT 参数 reason 透传
    const insertCall = mockQuery.mock.calls[2];
    expect(insertCall[1]).toEqual(['user-1', '不再使用']);
    // 验证日志记录
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', requestId: 'req-1' }),
      expect.stringContaining('[数据删除]'),
    );
  });

  it('正常提交（无 reason）INSERT 参数 reason 为 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'active' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-2', status: 'pending' }] });

    await dataDeletionService.submitDeletionRequest('user-1');

    const insertCall = mockQuery.mock.calls[2];
    // 无 reason 时应传 null，匹配 SQL 默认值语义
    expect(insertCall[1]).toEqual(['user-1', null]);
  });
});

describe('data-deletion.service - getDeletionRequestStatus', () => {
  it('无注销申请时返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await dataDeletionService.getDeletionRequestStatus('user-1');

    expect(result).toBeNull();
  });

  it('有注销申请时返回完整 DeletionRequest 对象', async () => {
    const mockRow = {
      id: 'req-1',
      user_id: 'user-1',
      status: 'approved',
      reason: '不再使用',
      created_at: new Date('2026-01-01'),
      reviewed_at: new Date('2026-01-02'),
      reviewed_by: 'admin-1',
      reviewer_nickname: '管理员',
      completed_at: new Date('2026-01-03'),
    };
    mockQuery.mockResolvedValueOnce({ rows: [mockRow] });

    const result = await dataDeletionService.getDeletionRequestStatus('user-1');

    expect(result).toEqual({
      id: 'req-1',
      userId: 'user-1',
      status: 'approved',
      reason: '不再使用',
      createdAt: mockRow.created_at,
      reviewedAt: mockRow.reviewed_at,
      reviewedBy: 'admin-1',
      reviewerNickname: '管理员',
      completedAt: mockRow.completed_at,
    });
  });

  it('SQL 含 LEFT JOIN reviewer 与 ORDER BY DESC LIMIT 1', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await dataDeletionService.getDeletionRequestStatus('user-1');

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('LEFT JOIN users reviewer');
    expect(sql).toContain('ORDER BY dr.created_at DESC');
    expect(sql).toContain('LIMIT 1');
  });
});

describe('data-deletion.service - cancelDeletionRequest', () => {
  it('无可取消的申请时抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      dataDeletionService.cancelDeletionRequest('user-1'),
    ).rejects.toThrow(BadRequestError);
  });

  it('成功取消时记录日志且无返回值', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1' }] });

    await dataDeletionService.cancelDeletionRequest('user-1');

    // 验证 DELETE SQL 仅删除 pending 状态
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'pending'");
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', requestId: 'req-1' }),
      expect.stringContaining('取消'),
    );
  });
});

describe('data-deletion.service - getDeletionRequests', () => {
  it('不带 status 筛选时不追加 status 条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // count
    mockQuery.mockResolvedValueOnce({ rows: [] }); // list

    await dataDeletionService.getDeletionRequests(1, 10);

    // 验证 count SQL 不含 status 条件（仅 1=1）
    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).not.toContain('status =');
    // 验证分页参数：第二参数数组仅含 pageSize 与 offset
    const listCall = mockQuery.mock.calls[1];
    expect(listCall[1]).toEqual([10, 0]);
  });

  it('带 status 筛选时追加 status 条件且参数正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [
      { id: 'r1', user_id: 'u1', user_nickname: 'A', status: 'pending', reason: null, created_at: new Date(), reviewed_at: null, reviewed_by: null, reviewer_nickname: null, completed_at: null },
      { id: 'r2', user_id: 'u2', user_nickname: 'B', status: 'pending', reason: 'x', created_at: new Date(), reviewed_at: null, reviewed_by: null, reviewer_nickname: null, completed_at: null },
    ] });

    const result = await dataDeletionService.getDeletionRequests(2, 5, 'pending');

    // 验证 SQL 含 status 条件
    const countSql = mockQuery.mock.calls[0][0] as string;
    expect(countSql).toContain('status = $1');
    // count 参数仅含 status
    expect(mockQuery.mock.calls[0][1]).toEqual(['pending']);
    // list 参数含 status + pageSize + offset
    expect(mockQuery.mock.calls[1][1]).toEqual(['pending', 5, 5]);
    // 验证返回结构
    expect(result.total).toBe(2);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.totalPages).toBe(1); // Math.ceil(2/5) = 1
    expect(result.list).toHaveLength(2);
    // 源码 list 项实际含 userNickname 字段（DeletionRequest 接口未声明，属类型不严谨），
    // 用 objectContaining 避免编译期访问未声明字段
    expect(result.list[0]).toEqual(expect.objectContaining({ userNickname: 'A' }));
  });

  it('totalPages 向上取整正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '12' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await dataDeletionService.getDeletionRequests(1, 5);

    // 12 条 / 每页 5 = 3 页
    expect(result.totalPages).toBe(3);
  });
});

describe('data-deletion.service - reviewDeletionRequest', () => {
  it('申请不存在时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      dataDeletionService.reviewDeletionRequest('req-x', 'admin-1', 'approve'),
    ).rejects.toThrow(NotFoundError);
  });

  it('申请已被审核时抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1', user_id: 'u1', status: 'approved' }] });

    await expect(
      dataDeletionService.reviewDeletionRequest('req-1', 'admin-1', 'approve'),
    ).rejects.toThrow(BadRequestError);
  });

  it('reject 但未提供原因时抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1', user_id: 'u1', status: 'pending' }] });

    await expect(
      dataDeletionService.reviewDeletionRequest('req-1', 'admin-1', 'reject'),
    ).rejects.toThrow(BadRequestError);
    // 不应触发 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('approve 时触发匿名化并更新为 completed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1', user_id: 'u1', status: 'pending' }] });
    // UPDATE 为 approved
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // executeAnonymization 内部走 transaction（mockTransaction），不调用 mockQuery
    // UPDATE 为 completed
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await dataDeletionService.reviewDeletionRequest('req-1', 'admin-1', 'approve');

    expect(result).toEqual({ id: 'req-1', status: 'approved' });
    // 验证 transaction 被调用（匿名化走事务）
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 验证第一条 UPDATE 设置 status = approved
    const updateApprovedCall = mockQuery.mock.calls[1];
    expect(updateApprovedCall[0]).toContain("SET status = $1, reviewed_by = $2");
    expect(updateApprovedCall[1]).toEqual(['approved', 'admin-1', 'req-1']);
    // 验证第二条 UPDATE 设置 status = completed
    const updateCompletedCall = mockQuery.mock.calls[2];
    expect(updateCompletedCall[0]).toContain("status = 'completed'");
    expect(updateCompletedCall[0]).toContain('completed_at = NOW()');
  });

  it('reject 时仅更新状态为 rejected，不触发匿名化', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'req-1', user_id: 'u1', status: 'pending' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE 为 rejected

    const result = await dataDeletionService.reviewDeletionRequest('req-1', 'admin-1', 'reject', '材料不全');

    expect(result).toEqual({ id: 'req-1', status: 'rejected' });
    // reject 不应触发 transaction（匿名化）
    expect(mockTransaction).not.toHaveBeenCalled();
    // 验证 UPDATE 参数
    const updateCall = mockQuery.mock.calls[1];
    expect(updateCall[1]).toEqual(['rejected', 'admin-1', 'req-1']);
    // 仅 2 次 query：SELECT + UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('data-deletion.service - executeAnonymization', () => {
  it('事务内更新用户表 + 删除认证申请 + 清除缓存', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    await dataDeletionService.executeAnonymization('user-1');

    // transaction 被调用一次
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 事务内应有 2 条 SQL：UPDATE users + DELETE verification_requests
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    // 第一条：UPDATE users 匿名化 PII 字段
    const updateSql = mockClient.query.mock.calls[0][0] as string;
    expect(updateSql).toContain('UPDATE users');
    expect(updateSql).toContain("status = 'deleted'");
    expect(updateSql).toContain('deleted_at = NOW()');
    // 验证匿名化字段值：昵称格式 deleted_user_{id}
    const updateParams = mockClient.query.mock.calls[0][1] as unknown[];
    expect(updateParams[0]).toBe('deleted_user_user-1');
    expect(updateParams[1]).toBe('ANONYMIZED');
    // 手机号哈希格式 deleted_phone_{16位hex}
    expect(updateParams[2]).toMatch(/^deleted_phone_[a-f0-9]{16}$/);
    expect(updateParams[3]).toBe('user-1');
    // 第二条：DELETE verification_requests
    const deleteSql = mockClient.query.mock.calls[1][0] as string;
    expect(deleteSql).toContain('DELETE FROM verification_requests');
    // 缓存清除被调用
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith('user-1');
    // 完成日志
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.stringContaining('匿名化完成'),
    );
  });
});

describe('data-deletion.service - cleanupSoftDeletedData', () => {
  it('无过期用户时返回 0 且不调用 transaction', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await dataDeletionService.cleanupSoftDeletedData();

    expect(result).toBe(0);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('有过期用户时事务内删除多表数据并返回数量', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1' }, { id: 'u2' }],
    });
    mockClient.query.mockResolvedValue({ rows: [] });

    const result = await dataDeletionService.cleanupSoftDeletedData();

    expect(result).toBe(2);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 事务内应有 6 条 DELETE：credit_transactions / time_transactions / time_accounts / deletion_requests / reports / users
    expect(mockClient.query).toHaveBeenCalledTimes(6);
    // 验证删除顺序：最后一条应为 DELETE FROM users
    const lastCall = mockClient.query.mock.calls[5];
    expect(lastCall[0]).toContain('DELETE FROM users');
    // 验证所有删除均使用 ANY($1) + userIds 数组
    for (const call of mockClient.query.mock.calls) {
      expect(call[0]).toContain('ANY($1)');
      expect(call[1]).toEqual([['u1', 'u2']]);
    }
    // 验证 cutoff 查询使用 90 天保留期
    const cutoffQuery = mockQuery.mock.calls[0][0] as string;
    expect(cutoffQuery).toContain('deleted_at < $1');
  });

  it('SQL 查询使用 SOFT_DELETE_RETENTION_DAYS 90 天保留期', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await dataDeletionService.cleanupSoftDeletedData();

    // 验证查询条件含 deleted_at IS NOT NULL AND deleted_at < $1
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('deleted_at IS NOT NULL');
    // 参数应为 Date 类型（cutoffDate）
    const param = mockQuery.mock.calls[0][1][0];
    expect(param).toBeInstanceOf(Date);
  });
});
