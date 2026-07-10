/**
 * admin.service 数据导出单元测试
 *
 * 测试目标：覆盖 getExportData 方法，验证各导出类型的 SQL 拼装、参数绑定、
 *           订单字段统一逻辑、无效类型校验
 * 测试策略：mock database 模块，断言 SQL 文本与参数数组
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import ExcelJS from 'exceljs';

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
// getExportData 第一参数为 ExportType 联合类型（未导出），通过 Parameters 提取
type ExportTypeParam = Parameters<typeof adminService.getExportData>[0];

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('admin.service - 数据导出 getExportData', () => {
  it('无效类型抛 BadRequestError', async () => {
    await expect(
      adminService.getExportData('invalid' as unknown as ExportTypeParam, {}),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('users 导出：查询未删除用户，返回用户列定义', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', phone: '13800000000', nickname: '张三', role: 'user', status: 'active', reputation_score: 4.5, credit_balance: 100, created_at: new Date('2026-01-01') }],
    } as unknown as DbResult);

    const result = await adminService.getExportData('users', {});

    // SQL 应过滤已删除用户，并按注册时间倒序
    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(result.columns[0]).toEqual({ field: 'id', header: '用户ID' });
    expect(result.columns.map(c => c.field)).toContain('phone');
    expect(result.rows).toHaveLength(1);
  });

  it('users 导出：支持 status 筛选，参数正确绑定', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await adminService.getExportData('users', { status: 'banned' });

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('status = $1');
    expect(params).toEqual(['banned']);
  });

  it('orders 导出：默认 orderType=skill，SQL 查询 skill_orders 表', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'o1', buyer_id: 'u1', seller_id: 'u2', credit_amount: 50, status: 'completed', created_at: new Date() }],
    } as unknown as DbResult);

    const result = await adminService.getExportData('orders', {});

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('FROM skill_orders');
    // 统一字段：amount 应从 credit_amount 映射
    expect(result.rows[0].amount).toBe(50);
    expect(result.rows[0].buyer_id).toBe('u1');
    expect(result.rows[0].seller_id).toBe('u2');
  });

  it('orders 导出：orderType=kitchen 查询 kitchen_orders 表，买家字段为 user_id', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'o2', user_id: 'u3', seller_id: 'u4', credit_amount: 30, status: 'pending', created_at: new Date() }],
    } as unknown as DbResult);

    const result = await adminService.getExportData('orders', { orderType: 'kitchen' });

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('FROM kitchen_orders');
    // user_id 统一映射为 buyer_id
    expect(result.rows[0].buyer_id).toBe('u3');
    expect(result.rows[0].seller_id).toBe('u4');
    expect(result.rows[0].amount).toBe(30);
  });

  it('orders 导出：orderType=time_bank 查询 time_orders 表，金额字段为 duration_minutes', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'o3', requester_id: 'u5', provider_id: 'u6', duration_minutes: 60, status: 'in_progress', created_at: new Date() }],
    } as unknown as DbResult);

    const result = await adminService.getExportData('orders', { orderType: 'time_bank' });

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('FROM time_orders');
    expect(result.rows[0].buyer_id).toBe('u5');
    expect(result.rows[0].seller_id).toBe('u6');
    expect(result.rows[0].amount).toBe(60);
  });

  it('orders 导出：支持 status + 时间范围筛选，参数顺序正确', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await adminService.getExportData('orders', {
      orderType: 'skill',
      status: 'completed',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('status = $1');
    expect(sql).toContain('created_at >= $2');
    expect(sql).toContain('created_at <= $3');
    expect(params).toEqual(['completed', '2026-01-01', '2026-12-31']);
  });

  it('reports 导出：SQL 联表查询举报人与处理人昵称', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'r1', reporter_id: 'u1', target_type: 'skill', target_id: 'p1',
        reason: '违规内容', status: 'pending', handler_id: null, handle_note: null,
        created_at: new Date(), handled_at: null,
        reporter_nickname: '张三', handler_nickname: null,
      }],
    } as unknown as DbResult);

    const result = await adminService.getExportData('reports', {});

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('LEFT JOIN users reporter');
    expect(sql).toContain('LEFT JOIN users handler');
    expect(result.columns.map(c => c.field)).toContain('reporter_nickname');
    // 测试 mock 返回联合类型，需类型断言访问动态字段
    expect((result.rows[0] as Record<string, unknown>).reporter_nickname).toBe('张三');
  });

  it('audit-logs 导出：支持时间范围筛选，查询 audit_logs 表', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await adminService.getExportData('audit-logs', {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });

    const [sql, params] = mockedQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM audit_logs');
    expect(sql).toContain('created_at >= $1');
    expect(sql).toContain('created_at <= $2');
    expect(params).toEqual(['2026-01-01', '2026-12-31']);
  });

  it('所有导出类型 SQL 均包含 LIMIT 保护，避免全表扫描', async () => {
    mockedQuery.mockResolvedValue({ rows: [] } as unknown as DbResult);

    for (const type of ['users', 'orders', 'reports', 'audit-logs'] as const) {
      await adminService.getExportData(type, type === 'orders' ? { orderType: 'skill' } : {});
    }

    for (const call of mockedQuery.mock.calls) {
      const sql = call[0] as string;
      expect(sql).toMatch(/LIMIT \d+/);
    }
  });

  it('空结果集时返回空 rows 与完整 columns', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await adminService.getExportData('users', {});

    expect(result.rows).toEqual([]);
    expect(result.columns.length).toBeGreaterThan(0);
  });
});

/**
 * 用 exceljs 从 Node Buffer 加载 Workbook
 * 设计原因：@types/node 22+ 后 Buffer 变为泛型 Buffer<ArrayBufferLike>，
 * 其 [Symbol.toStringTag] 为 'Uint8Array' 与 exceljs load 期望的 'ArrayBuffer' 不兼容；
 * 运行时 exceljs 接受任意 Buffer/Uint8Array/ArrayBuffer，仅类型层不兼容，故用类型断言绕过
 */
async function loadWorkbookFromBuffer(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

/**
 * Excel 导出 buildExcelBuffer 单测
 * 测试目标：验证 xlsx 二进制生成正确性，包括 ZIP 签名、表头/数据行写入、
 *           Date 自动格式化、空数据兜底、多余字段忽略
 * 测试策略：用 exceljs 读回生成的 Buffer 断言内容，避免只校验签名导致内容错误漏检
 */
describe('admin.service - Excel 导出 buildExcelBuffer', () => {
  it('生成合法 xlsx Buffer（ZIP 签名为 PK）', async () => {
    const columns = [{ field: 'id', header: '用户ID' }, { field: 'name', header: '昵称' }];
    const rows = [{ id: 'u1', name: '张三' }];

    const buffer = await adminService.buildExcelBuffer(columns, rows, '用户');

    // xlsx 本质为 ZIP 压缩包，首两字节固定为 'PK'(0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('表头与数据行正确写入，可被 exceljs 读回', async () => {
    const columns = [{ field: 'id', header: '用户ID' }, { field: 'phone', header: '手机号' }];
    const rows = [
      { id: 'u1', phone: '13800000000' },
      { id: 'u2', phone: '13900000000' },
    ];

    const buffer = await adminService.buildExcelBuffer(columns, rows, '用户');

    // 用 exceljs 读回验证，确保生成内容真实可解析
    const wb = await loadWorkbookFromBuffer(buffer);
    const sheet = wb.getWorksheet('用户');
    expect(sheet).toBeDefined();
    expect(sheet!.getRow(1).getCell(1).value).toBe('用户ID');
    expect(sheet!.getRow(1).getCell(2).value).toBe('手机号');
    expect(sheet!.getRow(2).getCell(1).value).toBe('u1');
    expect(sheet!.getRow(2).getCell(2).value).toBe('13800000000');
    expect(sheet!.getRow(3).getCell(1).value).toBe('u2');
    // 表头 + 2 行数据
    expect(sheet!.rowCount).toBe(3);
  });

  it('Date 类型字段自动格式化为字符串，避免 Excel 显示为序列号', async () => {
    const columns = [{ field: 'created_at', header: '注册时间' }];
    const date = new Date('2026-07-06T08:46:22.000Z');
    const rows = [{ created_at: date }];

    const buffer = await adminService.buildExcelBuffer(columns, rows, '用户');

    const wb = await loadWorkbookFromBuffer(buffer);
    const sheet = wb.getWorksheet('用户');
    const cellValue = sheet!.getRow(2).getCell(1).value;
    // 应为字符串而非 Date 对象，否则 Excel 会渲染为数字序列号
    expect(typeof cellValue).toBe('string');
    expect(cellValue).toContain('2026-07-06');
  });

  it('空数据行仍能生成合法 xlsx（仅含表头）', async () => {
    const columns = [{ field: 'id', header: '用户ID' }];

    const buffer = await adminService.buildExcelBuffer(columns, [], '空表');

    const wb = await loadWorkbookFromBuffer(buffer);
    const sheet = wb.getWorksheet('空表');
    expect(sheet!.getRow(1).getCell(1).value).toBe('用户ID');
    expect(sheet!.rowCount).toBe(1);
  });

  it('行数据含多余字段时不影响列定义（按 columns 映射）', async () => {
    const columns = [{ field: 'id', header: '用户ID' }];
    const rows = [{ id: 'u1', extra: '不应出现' }];

    const buffer = await adminService.buildExcelBuffer(columns, rows, '用户');

    const wb = await loadWorkbookFromBuffer(buffer);
    const sheet = wb.getWorksheet('用户');
    // 仅一列，多余字段被忽略
    expect(sheet!.columnCount).toBe(1);
    expect(sheet!.getRow(2).getCell(1).value).toBe('u1');
  });
});
