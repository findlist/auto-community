/**
 * audit.service 单元测试
 *
 * 测试目标：覆盖 writeAuditLog / getAuditLogs
 * 测试策略：mock database 的 pool.query（writeAuditLog 用）与 query（getAuditLogs 用），
 *           验证审计日志写入容错、查询条件动态拼装与分页响应。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：pool.query 用于 writeAuditLog，query 用于 getAuditLogs
vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: { query: vi.fn() },
}));

// mock logger，避免测试输出干扰
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

import { auditService } from '../audit.service';
import { query, pool } from '../../config/database';

const mockedQuery = vi.mocked(query);
const mockedPoolQuery = vi.mocked(pool.query);

beforeEach(() => {
  mockedQuery.mockReset();
  mockedPoolQuery.mockReset();
});

describe('audit.service - writeAuditLog', () => {
  it('成功写入审计日志', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [] } as any);

    await auditService.writeAuditLog({
      userId: 'user-1',
      action: 'LOGIN',
      status: 'success',
    });

    expect(mockedPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedPoolQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_logs');
    // 参数：userId, action, resourceType, resourceId, ip, userAgent, requestBody, status, errorMessage
    expect(params[0]).toBe('user-1');
    expect(params[1]).toBe('LOGIN');
    expect(params[7]).toBe('success');
  });

  it('未登录场景 userId 为 null', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [] } as any);

    await auditService.writeAuditLog({
      action: 'LOGIN_FAILED',
      status: 'failed',
      errorMessage: '密码错误',
    });

    const params = mockedPoolQuery.mock.calls[0][1];
    expect(params[0]).toBeNull();
    expect(params[8]).toBe('密码错误');
  });

  it('写入失败不抛错，仅记录日志（不影响主流程）', async () => {
    mockedPoolQuery.mockRejectedValueOnce(new Error('DB connection lost'));

    // 不应抛出
    await expect(
      auditService.writeAuditLog({ action: 'TEST', status: 'success' }),
    ).resolves.toBeUndefined();
  });
});

describe('audit.service - getAuditLogs', () => {
  it('无条件时查询全部并返回分页结构', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] } as any) // COUNT
      .mockResolvedValueOnce({
        rows: [
          { id: 1, user_id: 'u1', nickname: '张三', action: 'LOGIN', status: 'success', created_at: new Date('2026-01-01') },
          { id: 2, user_id: 'u2', nickname: '李四', action: 'LOGOUT', status: 'success', created_at: new Date('2026-01-02') },
        ],
      } as any);

    const result = await auditService.getAuditLogs({}, 1, 20);

    expect(result.total).toBe(2);
    expect(result.list).toHaveLength(2);
    expect(result.list[0].nickname).toBe('张三');
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.hasNext).toBe(false);
  });

  it('按 userId/action/status 多条件筛选', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 'u1', action: 'LOGIN', status: 'success', created_at: new Date() }] } as any);

    await auditService.getAuditLogs({
      userId: 'u1',
      action: 'LOGIN',
      status: 'success',
    });

    // COUNT 调用应包含三个条件
    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('a.user_id = $1');
    expect(countSql).toContain('a.action = $2');
    expect(countSql).toContain('a.status = $3');
    // 参数应按序传入
    expect(mockedQuery.mock.calls[0][1]).toEqual(['u1', 'LOGIN', 'success']);
  });

  it('按时间范围筛选：startDate/endDate 均传入', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await auditService.getAuditLogs({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('a.created_at >= $1');
    expect(countSql).toContain('a.created_at <= $2');
  });

  it('第二页分页参数：offset = (page-1) * pageSize', async () => {
    // total=50, pageSize=20, page=2 → totalPages=3, hasNext=true
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '50' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await auditService.getAuditLogs({}, 2, 20);

    // list 查询参数最后两个应为 [pageSize, offset]
    const listCallParams = mockedQuery.mock.calls[1]![1] as any[];
    const offset = listCallParams[listCallParams.length - 1];
    expect(offset).toBe(20); // (2-1) * 20
    expect(result.hasNext).toBe(true); // 50 条 / 20 每页 → 3 页，page=2 < 3
  });

  it('末页 hasNext 应为 false', async () => {
    // total=30, pageSize=20, page=2 → totalPages=2, hasNext=false
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '30' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const result = await auditService.getAuditLogs({}, 2, 20);
    expect(result.hasNext).toBe(false);
  });

  it('关联 users 表获取昵称：LEFT JOIN', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 'u1', nickname: '张三', action: 'LOGIN', status: 'success', created_at: new Date() }] } as any);

    await auditService.getAuditLogs({ userId: 'u1' });

    const listSql = mockedQuery.mock.calls[1][0];
    expect(listSql).toContain('LEFT JOIN users u ON a.user_id = u.id');
  });
});
