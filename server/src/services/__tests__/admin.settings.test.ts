/**
 * admin.service 系统配置管理单元测试
 *
 * 测试目标：覆盖 listSettings / getSetting / setSetting / deleteSetting 四个方法，
 *           验证 SQL 拼装、参数绑定、字段映射、受保护键拒绝、键名格式与值长度校验
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
import { BadRequestError, NotFoundError } from '../../utils/errors';

const mockedQuery = vi.mocked(query);

// 局部类型别名：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需 rows/rowCount
// 用 as unknown as DbResult 替代显式 any 断言以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('admin.service - 系统配置 listSettings', () => {
  it('查询全部配置并按 key 字典序返回，字段映射为驼峰（含 valueType）', async () => {
    // 模拟数据库返回原始 snake_case 字段，含 value_type 列
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          key: 'daily_earn_limit',
          value: '120',
          value_type: 'int',
          description: '每日时间币收益上限',
          updated_by: 'admin-1',
          updated_at: new Date('2026-07-03'),
        },
      ],
    } as unknown as DbResult);

    const result = await adminService.listSettings();

    // SQL 应按 key 字典序排序，并显式查询 value_type 字段
    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY key ASC');
    expect(sql).toContain('value_type');
    // 字段应映射为驼峰命名，value_type → valueType，供前端直接消费
    expect(result).toEqual([
      {
        key: 'daily_earn_limit',
        value: '120',
        valueType: 'int',
        description: '每日时间币收益上限',
        updatedBy: 'admin-1',
        updatedAt: new Date('2026-07-03'),
      },
    ]);
  });

  it('空结果集返回空数组', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    const result = await adminService.listSettings();
    expect(result).toEqual([]);
  });
});

describe('admin.service - 系统配置 getSetting', () => {
  it('配置存在时返回详情（含 valueType），参数绑定 key', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          key: 'skill_publish_reward',
          value: '5',
          value_type: 'int',
          description: '技能发布奖励积分',
          updated_by: 'admin-2',
          updated_at: new Date('2026-07-02'),
        },
      ],
    } as unknown as DbResult);

    const result = await adminService.getSetting('skill_publish_reward');

    // SQL 应使用参数化查询绑定 key，防止注入
    expect(mockedQuery.mock.calls[0][1]).toEqual(['skill_publish_reward']);
    expect(result.key).toBe('skill_publish_reward');
    expect(result.valueType).toBe('int');
    expect(result.updatedBy).toBe('admin-2');
  });

  it('配置不存在时抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(adminService.getSetting('nonexistent_key')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('admin.service - 系统配置 setSetting', () => {
  it('键名格式合法时执行 upsert，不传 valueType 时绑定 null 保留原类型', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    // 不传 valueType：resolvedValueType 绑定 null，让 COALESCE 保留原类型（编辑场景）
    // 新增场景由 INSERT VALUES 的 COALESCE($3, 'string') 兜底默认类型
    await adminService.setSetting('order_auto_expire_hours', '24', '订单自动过期小时数', 'admin-1');

    const sql = mockedQuery.mock.calls[0][0] as string;
    // 应使用 ON CONFLICT 实现 upsert
    expect(sql).toContain('ON CONFLICT (key) DO UPDATE');
    // INSERT VALUES 中 value_type 用 COALESCE($3, 'string') 兜底默认类型（新增场景）
    expect(sql).toContain('COALESCE($3, \'string\')');
    // UPDATE SET 中 value_type 用 COALESCE($3, site_settings.value_type) 保留原值（编辑场景）
    expect(sql).toContain('COALESCE($3, site_settings.value_type)');
    expect(sql).toContain('COALESCE($4, site_settings.description)');
    // 参数顺序：key, value, resolvedValueType(null 缺省), description, adminId
    expect(mockedQuery.mock.calls[0][1]).toEqual(['order_auto_expire_hours', '24', null, '订单自动过期小时数', 'admin-1']);
  });

  it('description 传 undefined 时绑定 null，valueType 缺省也绑定 null', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await adminService.setSetting('daily_earn_limit', '150', undefined, 'admin-1');

    // service 内部 description ?? null 会把 undefined 转为 null，让 SQL 的 COALESCE 保留原 description
    // valueType 缺省也绑定 null，让 COALESCE 保留原 value_type
    // 参数顺序：key, value, null(valueType), null(description), adminId
    expect(mockedQuery.mock.calls[0][1]).toEqual(['daily_earn_limit', '150', null, null, 'admin-1']);
  });

  it('显式传入合法 valueType（int）时写入对应类型', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await adminService.setSetting('order_auto_expire_hours', '24', '订单自动过期小时数', 'admin-1', 'int');

    // valueType='int' 透传到参数数组第三位
    expect(mockedQuery.mock.calls[0][1]).toEqual(['order_auto_expire_hours', '24', 'int', '订单自动过期小时数', 'admin-1']);
  });

  it('显式传入合法 valueType（float）时写入对应类型', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    await adminService.setSetting('exchange_rate', '0.85', '时间币兑换汇率', 'admin-1', 'float');

    expect(mockedQuery.mock.calls[0][1]).toEqual(['exchange_rate', '0.85', 'float', '时间币兑换汇率', 'admin-1']);
  });

  it('非法 valueType 抛 BadRequestError，不触发数据库写入', async () => {
    await expect(
      adminService.setSetting('valid_key', 'value', undefined, 'admin-1', 'boolean'),
    ).rejects.toBeInstanceOf(BadRequestError);
    // 校验失败应短路在白名单检查，不触发 SQL
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('setSetting 返回值含 valueType 字段', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await adminService.setSetting('exchange_rate', '0.85', '汇率', 'admin-1', 'float');

    expect(result.valueType).toBe('float');
  });

  it('不传 valueType 时返回值 valueType 兜底为 string（与 DB 实际值一致）', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    // 缺省场景：resolvedValueType 为 null，返回值用 DEFAULT_VALUE_TYPE 兜底
    const result = await adminService.setSetting('new_config', 'value', '描述', 'admin-1');

    expect(result.valueType).toBe('string');
  });

  it('键名以数字开头抛 BadRequestError', async () => {
    await expect(
      adminService.setSetting('1invalid', 'value', undefined, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('键名含大写字母抛 BadRequestError', async () => {
    await expect(
      adminService.setSetting('InvalidKey', 'value', undefined, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('键名含连字符抛 BadRequestError', async () => {
    await expect(
      adminService.setSetting('invalid-key', 'value', undefined, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('键名超 64 字符抛 BadRequestError', async () => {
    const longKey = 'a'.repeat(65);
    await expect(
      adminService.setSetting(longKey, 'value', undefined, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('配置值超 2000 字符抛 BadRequestError', async () => {
    const longValue = 'x'.repeat(2001);
    await expect(
      adminService.setSetting('valid_key', longValue, undefined, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe('admin.service - 系统配置 deleteSetting', () => {
  it('受保护键 homepage_hero_image 拒绝删除', async () => {
    await expect(
      adminService.deleteSetting('homepage_hero_image'),
    ).rejects.toBeInstanceOf(BadRequestError);
    // 受保护键校验在数据库调用前，不应触发 SQL
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('配置不存在时抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 0 } as unknown as DbResult);
    await expect(adminService.deleteSetting('nonexistent')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('正常删除返回 { key }，SQL 绑定 key 参数', async () => {
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 } as unknown as DbResult);

    const result = await adminService.deleteSetting('custom_config');

    const sql = mockedQuery.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE FROM site_settings WHERE key = $1');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['custom_config']);
    expect(result).toEqual({ key: 'custom_config' });
  });
});
