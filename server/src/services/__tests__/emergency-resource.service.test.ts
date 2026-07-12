/**
 * emergency-resource.service 单元测试
 *
 * 测试目标：
 * - getResources：type 过滤分支、分页 offset 计算、Promise.all 并行查询、list/total 映射
 * - getResourceById：资源存在/不存在、toResourceResponse 的 created_at Date→ISO 转换
 * - create：无有效字段拦截、location {lat,lng}→point 字面量转换、字段白名单过滤、空字符串跳过
 * - update：无有效字段拦截、资源不存在拦截、动态 SET 子句、location 更新、updated_at=NOW() 透传
 * - remove：软删除成功、资源不存在拦截
 *
 * 测试策略：mock database 的 query，模拟 Promise.all 顺序、INSERT/UPDATE/DELETE RETURNING 场景，
 *           验证 service 层的校验逻辑、SQL 动态构建、point 字面量转换、响应映射正确性。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：emergency-resource.service 使用 query
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

import { emergencyResourceService } from '../emergency-resource.service';
import { NotFoundError, BadRequestError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('emergency-resource.service getResources', () => {
  it('无 type 过滤时 SQL 不含 type = $N', async () => {
    // Promise.all 第1项：list；第2项：count
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await emergencyResourceService.getResources({ page: 1, pageSize: 10 });

    const listCall = mockQuery.mock.calls[0];
    expect(listCall[0]).not.toContain('type = $');
    // 参数为 [...values, pageSize, offset]，无 type 时 values 为空
    expect(listCall[1]).toEqual([10, 0]);
  });

  it('有 type 过滤时 SQL 含 type = $1 且 type 作为第1参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await emergencyResourceService.getResources({ type: 'shelter', page: 1, pageSize: 10 });

    const listCall = mockQuery.mock.calls[0];
    expect(listCall[0]).toContain('type = $1');
    // 参数为 [type, pageSize, offset]
    expect(listCall[1]).toEqual(['shelter', 10, 0]);
  });

  it('page=2, pageSize=10 时 offset=10 透传', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 15 }] });

    await emergencyResourceService.getResources({ page: 2, pageSize: 10 });

    // 第1参数为 pageSize，第2参数为 offset
    expect(mockQuery.mock.calls[0][1]).toEqual([10, 10]);
  });

  it('返回 list 映射与 total', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-1',
        community_id: 'c1',
        type: 'shelter',
        name: '避难所A',
        description: '社区避难所',
        location: null,
        address: '某路1号',
        contact_phone: '110',
        status: 'active',
        last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const result = await emergencyResourceService.getResources({ page: 1, pageSize: 10 });

    expect(result.list).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.list[0].id).toBe('res-1');
    expect(result.list[0].name).toBe('避难所A');
    // created_at Date→ISO 转换
    expect(result.list[0].createdAt).toBe('2026-07-08T10:00:00.000Z');
  });
});

describe('emergency-resource.service getResourceById', () => {
  it('资源存在时返回映射结果', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-1',
        community_id: null,
        type: 'hospital',
        name: '社区医院',
        description: '急诊',
        location: null,
        address: '某路2号',
        contact_phone: '120',
        status: 'active',
        last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    const result = await emergencyResourceService.getResourceById('res-1');

    expect(result.id).toBe('res-1');
    expect(result.type).toBe('hospital');
  });

  it('资源不存在时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      emergencyResourceService.getResourceById('not-exist'),
    ).rejects.toThrow(NotFoundError);
  });

  it('created_at 为 string 时透传不转换', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-2',
        community_id: null,
        type: 'shelter',
        name: '避难所',
        description: '',
        location: null,
        address: '某路',
        contact_phone: null,
        status: 'active',
        last_check: null,
        created_at: '2026-07-08T10:00:00Z',
        updated_at: '2026-07-08T10:00:00Z',
      }],
    });

    const result = await emergencyResourceService.getResourceById('res-2');

    // string 类型透传（instanceof Date 为 false）
    expect(result.createdAt).toBe('2026-07-08T10:00:00Z');
  });
});

describe('emergency-resource.service create', () => {
  it('未提供有效字段时抛 BadRequestError', async () => {
    await expect(
      emergencyResourceService.create({}),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('正常创建（无 location），INSERT 参数透传', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-1',
        community_id: 'c1',
        type: 'shelter',
        name: '避难所',
        description: '描述',
        location: null,
        address: '某路',
        contact_phone: '110',
        status: 'active',
        last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    const result = await emergencyResourceService.create({
      communityId: 'c1',
      type: 'shelter',
      name: '避难所',
      description: '描述',
      address: '某路',
      contactPhone: '110',
      status: 'active',
    });

    expect(result.id).toBe('res-1');
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('INSERT INTO emergency_resources');
    // 最后一个参数为 location（null）
    expect(call[1][call[1].length - 1]).toBeNull();
  });

  it('有 location 时转换为 point 字面量 (lng,lat)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-2', community_id: null, type: 'shelter', name: '避难所',
        description: '', location: null, address: '', contact_phone: null,
        status: 'active', last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    await emergencyResourceService.create({
      name: '避难所',
      location: { lng: 116.404, lat: 39.915 },
    });

    const call = mockQuery.mock.calls[0];
    // location 参数为 point 字面量字符串
    expect(call[1][call[1].length - 1]).toBe('(116.404,39.915)');
  });

  it('字段白名单过滤：非法字段不写入 INSERT', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-3', community_id: null, type: 'shelter', name: '避难所',
        description: '', location: null, address: '', contact_phone: null,
        status: 'active', last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    await emergencyResourceService.create({
      name: '避难所',
      // 非法字段，不在白名单内
      hackField: 'malicious',
    } as unknown as Parameters<typeof emergencyResourceService.create>[0]);

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    // hackField 不应出现在 INSERT 列中
    expect(sql).not.toContain('hack_field');
    expect(sql).not.toContain('hackField');
  });

  it('空字符串字段被跳过', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-4', community_id: null, type: 'shelter', name: '避难所',
        description: '', location: null, address: '', contact_phone: null,
        status: 'active', last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    await emergencyResourceService.create({
      name: '避难所',
      description: '',  // 空字符串应被跳过
      address: '某路',
    });

    const call = mockQuery.mock.calls[0];
    const sql = call[0] as string;
    // description 不应出现在 INSERT 列中（仅检查 INSERT INTO (...) 子句，RETURNING 列常量包含 description 不影响）
    const insertColumns = sql.match(/INSERT INTO emergency_resources \(([^)]*)\)/)?.[1] || '';
    expect(insertColumns).not.toContain('description');
  });
});

describe('emergency-resource.service update', () => {
  it('未提供有效字段且无 location 时抛 BadRequestError', async () => {
    await expect(
      emergencyResourceService.update('res-1', {}),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('资源不存在时抛 NotFoundError', async () => {
    // existResult 查询返回空
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      emergencyResourceService.update('not-exist', { name: '新名称' }),
    ).rejects.toThrow(NotFoundError);
    // 仅触发存在性校验 query，不应触发 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('正常更新（含 location），SET 子句含 location 与 updated_at=NOW()', async () => {
    // 第1次：存在性校验；第2次：UPDATE RETURNING
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'res-1' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-1', community_id: null, type: 'shelter', name: '新名称',
        description: '', location: null, address: '', contact_phone: null,
        status: 'active', last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T11:00:00Z'),
      }],
    });

    const result = await emergencyResourceService.update('res-1', {
      name: '新名称',
      location: { lng: 116.404, lat: 39.915 },
    });

    expect(result.name).toBe('新名称');
    const updateCall = mockQuery.mock.calls[1];
    const sql = updateCall[0] as string;
    expect(sql).toContain('location = $');
    expect(sql).toContain('::point');
    expect(sql).toContain('updated_at = NOW()');
    // location 参数为 point 字面量
    expect(updateCall[1]).toContain('(116.404,39.915)');
  });

  it('仅更新 location（无其他字段）时通过校验', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'res-1' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'res-1', community_id: null, type: 'shelter', name: '避难所',
        description: '', location: null, address: '', contact_phone: null,
        status: 'active', last_check: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
        updated_at: new Date('2026-07-08T11:00:00Z'),
      }],
    });

    const result = await emergencyResourceService.update('res-1', {
      location: { lng: 116.0, lat: 40.0 },
    });

    expect(result.id).toBe('res-1');
    // 仅触发存在性校验 + UPDATE 两次 query
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('emergency-resource.service remove', () => {
  it('软删除成功（设置 deleted_at）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'res-1' }] });

    await emergencyResourceService.remove('res-1');

    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('UPDATE emergency_resources SET deleted_at = NOW()');
    expect(call[0]).toContain('deleted_at IS NULL');
    expect(call[1]).toEqual(['res-1']);
  });

  it('资源不存在或已删除时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      emergencyResourceService.remove('not-exist'),
    ).rejects.toThrow(NotFoundError);
  });
});
