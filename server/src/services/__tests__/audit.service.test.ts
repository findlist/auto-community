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
// 包含 warn：sanitize.ts 引入 env 模块，env 校验失败会调用 logger.warn
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { auditService } from '../audit.service';
import { query, pool } from '../../config/database';

// 局部类型别名：query / pool.query 均返回 Promise<QueryResult<QueryResultRow>>，
// 测试 mock 只需 rows；用 as unknown as DbResult 替代显式 any 断言以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;

const mockedQuery = vi.mocked(query);
// pool.query 存在回调重载（返回 void），vi.mocked 选中该重载会导致 mockResolvedValueOnce 期望 void
// 复用 mockedQuery 的类型（MockedFunction<typeof query>），使 mock 链路类型与运行时一致
const mockedPoolQuery = pool.query as unknown as typeof mockedQuery;

beforeEach(() => {
  mockedQuery.mockReset();
  mockedPoolQuery.mockReset();
});

describe('audit.service - writeAuditLog', () => {
  it('成功写入审计日志', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await auditService.writeAuditLog({
      userId: 'user-1',
      action: 'LOGIN',
      status: 'success',
    });

    expect(mockedPoolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockedPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO audit_logs');
    // 参数：userId, action, resourceType, resourceId, ip, userAgent, requestBody, status, errorMessage
    expect(params[0]).toBe('user-1');
    expect(params[1]).toBe('LOGIN');
    expect(params[7]).toBe('success');
  });

  it('未登录场景 userId 为 null', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await auditService.writeAuditLog({
      action: 'LOGIN_FAILED',
      status: 'failed',
      errorMessage: '密码错误',
    });

    const params = mockedPoolQuery.mock.calls[0][1] as unknown[];
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

  // XSS 不变式：所有字符串字段（action/resourceType/userAgent/errorMessage）含 XSS 片段时被清洗后入库
  // 设计原因：userAgent 来自请求头完全用户可控，errorMessage 可能含异常 message 含用户输入片段，
  // 管理员后台审计日志页会渲染这些字段，未清洗会触发存储型 XSS
  it('userAgent/errorMessage/action/resourceType 含 XSS 片段时被清洗后入库', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await auditService.writeAuditLog({
      userId: 'u1',
      action: '<script>alert(1)</script>LOGIN',
      resourceType: '<script>alert(2)</script>user',
      userAgent: '<script>alert(3)</script>Mozilla/5.0',
      errorMessage: '<script>alert(4)</script>密码错误',
      status: 'failed',
    });

    const params = mockedPoolQuery.mock.calls[0][1] as unknown[];
    // INSERT 参数顺序：userId, action, resourceType, resourceId, ip, userAgent, requestBody, status, errorMessage
    expect(params[1]).not.toContain('<script>'); // action
    expect(params[2]).not.toContain('<script>'); // resourceType
    expect(params[5]).not.toContain('<script>'); // userAgent
    expect(params[8]).not.toContain('<script>'); // errorMessage
    // 正常字符应保留（如 LOGIN、user、Mozilla/5.0、密码错误）
    expect(params[1]).toContain('LOGIN');
    expect(params[2]).toContain('user');
    expect(params[5]).toContain('Mozilla/5.0');
    expect(params[8]).toContain('密码错误');
  });

  it('requestBody 嵌套字符串含 XSS 片段时被清洗后入库', async () => {
    mockedPoolQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await auditService.writeAuditLog({
      action: 'CREATE_REPORT',
      status: 'success',
      requestBody: {
        reason: '<script>alert(1)</script>举报理由',
        nested: { field: '<script>alert(2)</script>nested' },
      },
    });

    const params = mockedPoolQuery.mock.calls[0][1] as unknown[];
    // requestBody 在 JSON.stringify 后整体清洗，应同时剥离两层嵌套的 <script>
    const requestBodyStr = params[6] as string;
    expect(requestBodyStr).not.toContain('<script>');
    // JSON 结构应保留（含 reason 字段名与正常字符）
    expect(requestBodyStr).toContain('reason');
    expect(requestBodyStr).toContain('举报理由');
    expect(requestBodyStr).toContain('nested');
  });
});

describe('audit.service - getAuditLogs', () => {
  it('无条件时查询全部并返回分页结构', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] } as unknown as DbResult) // COUNT
      .mockResolvedValueOnce({
        rows: [
          { id: 1, user_id: 'u1', nickname: '张三', action: 'LOGIN', status: 'success', created_at: new Date('2026-01-01') },
          { id: 2, user_id: 'u2', nickname: '李四', action: 'LOGOUT', status: 'success', created_at: new Date('2026-01-02') },
        ],
      } as unknown as DbResult);

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
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 'u1', action: 'LOGIN', status: 'success', created_at: new Date() }] } as unknown as DbResult);

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
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await auditService.getAuditLogs({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });

    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('a.created_at >= $1');
    expect(countSql).toContain('a.created_at <= $2');
  });

  // 默认 90 天时间窗：startDate 缺失时强制附加 INTERVAL '90 days' 条件，
  // 避免 audit_logs 全表扫描。endDate 不附加默认值（NOW 兜底无意义且会增加 planner 负担）。
  it('startDate 缺失时默认附加 90 天时间窗（避免全表扫描）', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await auditService.getAuditLogs({});

    const countSql = mockedQuery.mock.calls[0][0] as string;
    expect(countSql).toContain("a.created_at >= NOW() - INTERVAL '90 days'");
    // list 查询 SQL 也应包含默认时间窗
    const listSql = mockedQuery.mock.calls[1][0] as string;
    expect(listSql).toContain("a.created_at >= NOW() - INTERVAL '90 days'");
    // INTERVAL 用 SQL 字面量，参数列表应仍为空（COUNT 调用无 $N 参数）
    expect(mockedQuery.mock.calls[0][1]).toEqual([]);
  });

  it('startDate 传入时不附加默认时间窗（尊重用户显式输入）', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await auditService.getAuditLogs({ startDate: '2025-01-01' });

    const countSql = mockedQuery.mock.calls[0][0] as string;
    expect(countSql).not.toContain("INTERVAL '90 days'");
    expect(countSql).toContain('a.created_at >= $1');
  });

  it('第二页分页参数：offset = (page-1) * pageSize', async () => {
    // total=50, pageSize=20, page=2 → totalPages=3, hasNext=true
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '50' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await auditService.getAuditLogs({}, 2, 20);

    // list 查询参数最后两个应为 [pageSize, offset]
    const listCallParams = mockedQuery.mock.calls[1]![1] as unknown[];
    const offset = listCallParams[listCallParams.length - 1];
    expect(offset).toBe(20); // (2-1) * 20
    expect(result.hasNext).toBe(true); // 50 条 / 20 每页 → 3 页，page=2 < 3
  });

  it('末页 hasNext 应为 false', async () => {
    // total=30, pageSize=20, page=2 → totalPages=2, hasNext=false
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '30' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await auditService.getAuditLogs({}, 2, 20);
    expect(result.hasNext).toBe(false);
  });

  it('关联 users 表获取昵称：LEFT JOIN', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 'u1', nickname: '张三', action: 'LOGIN', status: 'success', created_at: new Date() }] } as unknown as DbResult);

    await auditService.getAuditLogs({ userId: 'u1' });

    const listSql = mockedQuery.mock.calls[1][0];
    expect(listSql).toContain('LEFT JOIN users u ON a.user_id = u.id');
  });
});
