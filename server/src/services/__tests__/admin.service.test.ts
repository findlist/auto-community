/**
 * admin.service 单元测试
 *
 * 测试目标：覆盖用户管理（getUsers/banUser/unbanUser/updateUserRole）、
 *           内容审核（getContent/updateContentStatus/getContentDetail/updateContent）、
 *           首页图片（getHomepageImage/setHomepageImage）等核心方法
 * 测试策略：mock database 模块，验证 SQL 拼装、字段白名单、驼峰转下划线映射、XSS 清洗调用等。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 使用 importOriginal 保留 isSqlParam 等纯函数的真实实现，
// 仅 mock query/transaction/pool 这些会触发真实 DB 连接的部分
// 设计原因：isSqlParam 是无副作用的类型守卫，复用真实实现可让测试覆盖到运行时类型校验逻辑
vi.mock('../../config/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/database')>();
  return {
    ...actual,
    query: vi.fn(),
    transaction: vi.fn(),
    pool: {},
  };
});

// mock logger，避免测试输出干扰
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// mock cache.service，避免 userCache 调用真实 Redis
vi.mock('../cache.service', () => ({
  userCache: { get: vi.fn(), invalidate: vi.fn() },
  kitchenPostCache: { get: vi.fn(), invalidate: vi.fn() },
}));

import { adminService } from '../admin.service';
import { query } from '../../config/database';
import { NotFoundError, BadRequestError } from '../../utils/errors';

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('admin.service - 用户管理', () => {
  it('getUsers 支持按 search 搜索', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'u1', phone: '13800000000', nickname: '张三', role: 'user', status: 'active', created_at: new Date(), reputation_score: 80, credit_balance: 100 }],
      } as any);

    const result = await adminService.getUsers(1, 20, '张三');

    expect(result.total).toBe(1);
    expect(result.list[0].nickname).toBe('张三');
    // SQL 应包含 phone / nickname 两个 LIKE 条件
    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('phone LIKE');
    expect(countSql).toContain('nickname LIKE');
  });

  it('banUser 更新用户状态为 banned', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', status: 'banned' }],
    } as any);

    const result = await adminService.banUser('u1');

    expect(result.status).toBe('banned');
    expect(mockedQuery.mock.calls[0][0]).toContain("SET status = 'banned'");
  });

  it('banUser 用户不存在时抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    await expect(adminService.banUser('u-x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('unbanUser 更新用户状态为 active', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', status: 'active' }],
    } as any);

    const result = await adminService.unbanUser('u1');
    expect(result.status).toBe('active');
  });

  it('updateUserRole 更新用户角色', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', role: 'admin' }],
    } as any);

    const result = await adminService.updateUserRole('u1', 'admin');
    expect(result.role).toBe('admin');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['admin', 'u1']);
  });
});

describe('admin.service - 内容审核', () => {
  it('getContent 按类型查询内容列表', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '技能帖', status: 'active', created_at: new Date(), user_id: 'u1', credit_price: 50 }],
      } as any);

    const result = await adminService.getContent('skill', undefined, 1, 20);

    expect(result.total).toBe(1);
    expect(result.list[0].title).toBe('技能帖');
    // skill 类型别名应为 creditsRequired
    expect(result.list[0].creditsRequired).toBe(50);
  });

  it('getContent kitchen 类型使用 price 别名', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{ id: 'k1', title: '美食帖', status: 'active', created_at: new Date(), user_id: 'u1', credit_price: 30 }],
      } as any);

    const result = await adminService.getContent('kitchen', undefined, 1, 20);
    expect(result.list[0].price).toBe(30);
  });

  it('updateContentStatus 状态更新成功', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ id: 's1', status: 'rejected' }],
    } as any);

    const result = await adminService.updateContentStatus('skill', 's1', 'rejected');
    expect(result.status).toBe('rejected');
  });

  it('updateContentStatus 内容不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    await expect(adminService.updateContentStatus('skill', 's-x', 'rejected')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('admin.service - getContentDetail', () => {
  it('按 skill 类型查询内容详情', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 's1',
        title: '技能帖',
        description: '描述',
        credit_price: 50,
        images: ['https://example.com/1.png'],
        tags: ['编程'],
        address: '北京',
        status: 'active',
        created_at: new Date(),
      }],
    } as any);

    const result = await adminService.getContentDetail('skill', 's1');

    expect(result.title).toBe('技能帖');
    expect(result.creditPrice).toBe(50);
    expect(result.images).toHaveLength(1);
    expect(result.tags).toEqual(['编程']);
  });

  it('内容不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    await expect(adminService.getContentDetail('skill', 's-x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('admin.service - updateContent', () => {
  it('驼峰字段名应映射为下划线列名（creditPrice → credit_price）', async () => {
    // 第一次校验存在性，第二次实际 UPDATE，第三次返回详情
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] } as any) // SELECT id
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '新标题', description: '', credit_price: 80, images: [], tags: [], address: null, status: 'active', created_at: new Date() }],
      } as any);

    // data 参数不再需要 as any：对象字面量天然可赋给 Record<string, unknown>
    await adminService.updateContent('skill', 's1', {
      title: '新标题',
      creditPrice: 80,
    }, 'admin-1');

    // UPDATE 调用应包含 title 和 credit_price 字段
    const updateSql = mockedQuery.mock.calls[1][0];
    expect(updateSql).toContain('title = $1');
    expect(updateSql).toContain('credit_price = $2');
    // 参数顺序：[title, creditPrice, id]
    expect(mockedQuery.mock.calls[1][1]).toEqual(['新标题', 80, 's1']);
  });

  it('字段不在白名单时被忽略', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] } as any) // SELECT id
      // 字段不在白名单 → 没有有效字段 → 走 getById 分支，返回 getContentDetail
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '原标题', description: '', credit_price: 50, images: [], tags: [], address: null, status: 'active', created_at: new Date() }],
      } as any);

    // 传入白名单外字段（如 user_id 不在 skill.editableFields 中）
    const result = await adminService.updateContent('skill', 's1', {
      user_id: '不该被更新的字段',
    }, 'admin-1');

    // 应直接走 getContentDetail 分支，不触发 UPDATE
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(result.title).toBe('原标题');
  });

  it('内容不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    await expect(
      adminService.updateContent('skill', 's-x', { title: '新标题' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('字段类型不合法（如函数）时抛 BadRequestError', async () => {
    // 内容存在，但字段值类型非法（function 不是 SqlParam 联合成员）
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }] } as any);

    // title 字段为函数，type guard 应拒绝；as unknown as string 仅测试入参类型断言
    await expect(
      adminService.updateContent('skill', 's1', { title: (() => {}) as unknown as string }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('NaN 数值类型不合法时抛 BadRequestError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ id: 's1' }] } as any);

    // credit_price 字段为 NaN，type guard 应拒绝（避免 pg 序列化异常）
    await expect(
      adminService.updateContent('skill', 's1', { creditPrice: NaN }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('字符串数组类型字段可正常写入（images/tags）', async () => {
    // 覆盖 string[] 类型的 type guard 通过路径，确保数组字段不被误拒
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] } as any) // SELECT id
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE
      .mockResolvedValueOnce({
        rows: [{ id: 's1', title: '标题', description: '', credit_price: 50, images: ['a.png', 'b.png'], tags: ['编程'], address: null, status: 'active', created_at: new Date() }],
      } as any);

    await adminService.updateContent('skill', 's1', {
      images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
      tags: ['编程', '设计'],
    }, 'admin-1');

    // UPDATE 参数应包含字符串数组
    const updateParams = mockedQuery.mock.calls[1][1] as unknown[];
    expect(updateParams[0]).toEqual(['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']);
    expect(updateParams[1]).toEqual(['编程', '设计']);
  });
});

describe('admin.service - 首页展示图片', () => {
  it('getHomepageImage 返回已配置的图片 URL', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ value: 'https://cdn.example.com/hero.png' }],
    } as any);

    const url = await adminService.getHomepageImage();
    expect(url).toBe('https://cdn.example.com/hero.png');
    // SQL 应使用 site_settings 表与 homepage_hero_image 键
    expect(mockedQuery.mock.calls[0][0]).toContain('site_settings');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['homepage_hero_image']);
  });

  it('getHomepageImage 未配置时返回 null', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
    const url = await adminService.getHomepageImage();
    expect(url).toBeNull();
  });

  it('setHomepageImage 使用 UPSERT 写入', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    const result = await adminService.setHomepageImage('https://cdn.example.com/hero.png', 'admin-1');

    expect(result.url).toBe('https://cdn.example.com/hero.png');
    expect(result.updatedBy).toBe('admin-1');
    // SQL 应包含 ON CONFLICT (key) DO UPDATE
    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toContain('ON CONFLICT (key) DO UPDATE');
  });

  it('setHomepageImage URL 为空时抛 BadRequestError', async () => {
    await expect(adminService.setHomepageImage('', 'admin-1')).rejects.toBeInstanceOf(BadRequestError);
    await expect(adminService.setHomepageImage(null as any, 'admin-1')).rejects.toBeInstanceOf(BadRequestError);
  });
});
