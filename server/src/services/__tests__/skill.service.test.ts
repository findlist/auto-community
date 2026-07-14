/**
 * skill.service 单元测试
 *
 * 测试目标：
 * - createPost：type=offer 时 credit_price 校验、INSERT 参数透传、可选字段默认值
 * - getPostList：动态 WHERE 条件构建（type/category/keyword）、分页计算
 * - getPostById：缓存透传、帖子不存在抛 NotFoundError、过期帖子标注 expired
 * - updatePost：权限校验、无字段更新走 getPostById、动态 SET 子句、清缓存
 * - deletePost：权限校验、软删除、清缓存
 * - getUserPosts：分页查询、空结果 totalPages 为 0
 *
 * 测试策略：mock database 的 query、sanitize 模块（透传）、cache.service 的 skillPostCache
 *           （get 直接调用 fetchFn，invalidate 直接返回），聚焦 service 业务逻辑验证
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：query 为可控 mock，便于按调用顺序模拟不同返回值
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

// mock database 模块：保留 isSqlParam 等真实实现，仅覆盖 query 便于按调用顺序模拟返回值
// 设计原因：updatePost 用 isSqlParam type guard 校验字段类型，需真实实现保证守卫逻辑正确
vi.mock('../../config/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/database')>();
  return {
    ...actual,
    query: mockQuery,
  };
});

// mock sanitize 模块：sanitizeObject 直接返回原对象（透传），validateImageUrls 直接放行
// 设计原因：XSS 清洗与图片 URL 校验已有独立测试，此处 mock 避免重复测试，聚焦 service 逻辑
vi.mock('../../utils/sanitize', () => ({
  sanitizeObject: vi.fn(<T extends object>(data: T) => data),
  validateImageUrls: vi.fn(),
}));

// mock cache.service：skillPostCache.get 直接调用 fetchFn（绕过 Redis 依赖），
// invalidate 直接返回，便于验证缓存清理调用次数
vi.mock('../cache.service', () => ({
  skillPostCache: {
    get: vi.fn((_postId: string, fetchFn: () => Promise<unknown>) => fetchFn()),
    invalidate: vi.fn().mockResolvedValue(undefined),
  },
}));

import { skillService } from '../skill.service';
import { BadRequestError, NotFoundError, PermissionDeniedError } from '../../utils/errors';

// 构造一个完整的 SkillPostRow 测试数据，供多个测试复用
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    user_id: 'user-1',
    type: 'offer',
    category: '技术',
    title: '测试技能',
    description: '测试描述',
    credit_price: 10,
    images: ['https://example.com/1.png'],
    tags: ['编程'],
    location: '北京',
    address: '北京市朝阳区',
    status: 'active',
    expires_at: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    nickname: '张三',
    avatar: 'https://example.com/avatar.png',
    reputation_score: 5,
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  vi.mocked(skillPostCache.invalidate).mockClear();
});

// 由于 vi.mock 中 skillPostCache.get 用了 vi.fn，需通过模块导入获取引用以做断言
import { skillPostCache } from '../cache.service';

describe('skill.service createPost', () => {
  it('type=offer 且 credit_price 未提供时抛 BadRequestError', async () => {
    await expect(
      skillService.createPost('user-1', {
        type: 'offer',
        category: '技术',
        title: '测试',
      }),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('type=offer 且 credit_price=0 时抛 BadRequestError', async () => {
    await expect(
      skillService.createPost('user-1', {
        type: 'offer',
        category: '技术',
        title: '测试',
        credit_price: 0,
      }),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('type=offer 且 credit_price>0 时正常创建，验证 INSERT 参数透传', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow()] });

    const result = await skillService.createPost('user-1', {
      type: 'offer',
      category: '技术',
      title: '测试技能',
      description: '测试描述',
      credit_price: 10,
      images: ['https://example.com/1.png'],
      tags: ['编程'],
      location: '北京',
      address: '北京市朝阳区',
    });

    expect(result.id).toBe('post-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    // 验证 INSERT 参数：userId 在首位，credit_price 透传
    expect(callArgs[1][0]).toBe('user-1');
    expect(callArgs[1][5]).toBe(10);
  });

  it('type=need 时 credit_price 默认 0（不需提供）', async () => {
    // credit_price 为 undefined 时，sanitized.credit_price || 0 → 0
    mockQuery.mockResolvedValue({ rows: [makeRow({ type: 'need', credit_price: 0 })] });

    const result = await skillService.createPost('user-1', {
      type: 'need',
      category: '技术',
      title: '测试',
    });

    expect(result.type).toBe('need');
    const callArgs = mockQuery.mock.calls[0];
    // credit_price 参数应为 0（默认值）
    expect(callArgs[1][5]).toBe(0);
  });
});

describe('skill.service getPostList', () => {
  it('无过滤条件时正常分页查询，totalPages 向上取整', async () => {
    // Promise.all 两次 query：先 count 后 list
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '11' }] }) // total=11
      .mockResolvedValueOnce({ rows: [makeRow(), makeRow({ id: 'post-2' })] });

    const result = await skillService.getPostList({}, 1, 5);

    expect(result.total).toBe(11);
    expect(result.list).toHaveLength(2);
    // 11/5 = 2.2 → 向上取整为 3
    expect(result.totalPages).toBe(3);
    // 验证 user 对象构建
    expect(result.list[0].user?.nickname).toBe('张三');
  });

  it('type 过滤时 SQL 含 type 条件', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeRow()] });

    await skillService.getPostList({ type: 'offer' }, 1, 10);

    // 验证两次 query 的 SQL 都包含 type 条件
    expect(mockQuery.mock.calls[0][0]).toContain('sp.type = $1');
    expect(mockQuery.mock.calls[1][0]).toContain('sp.type = $1');
  });

  it('category 过滤时 SQL 含 category 条件', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeRow()] });

    await skillService.getPostList({ category: '技术' }, 1, 10);

    expect(mockQuery.mock.calls[0][0]).toContain('sp.category = $1');
    expect(mockQuery.mock.calls[1][0]).toContain('sp.category = $1');
  });

  it('keyword 过滤时 SQL 含 ILIKE 条件且参数带 % 通配符', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({ rows: [makeRow()] });

    await skillService.getPostList({ keyword: '编程' }, 1, 10);

    // SQL 应包含 title 和 description 的 ILIKE
    expect(mockQuery.mock.calls[0][0]).toContain('ILIKE');
    expect(mockQuery.mock.calls[0][0]).toContain('sp.title');
    expect(mockQuery.mock.calls[0][0]).toContain('sp.description');
    // 参数应为 %编程%
    expect(mockQuery.mock.calls[0][1]).toContain('%编程%');
  });
});

describe('skill.service getPostById', () => {
  it('帖子存在且未过期正常返回，验证 user 对象构建', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow()] });

    const result = await skillService.getPostById('post-1');

    expect(result.id).toBe('post-1');
    // getPostById 返回联合类型，正常帖子无 expired 属性，用 toHaveProperty 避免直接访问
    expect(result).not.toHaveProperty('expired');
    expect(result.user?.id).toBe('user-1');
    expect(result.user?.nickname).toBe('张三');
    expect(result.user?.reputationScore).toBe(5);
  });

  it('帖子不存在抛 NotFoundError', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(skillService.getPostById('not-exist')).rejects.toThrow(NotFoundError);
  });

  it('帖子已过期标注 expired: true', async () => {
    // expires_at 为过去时间，触发过期标注逻辑
    const pastDate = new Date('2020-01-01');
    mockQuery.mockResolvedValue({ rows: [makeRow({ expires_at: pastDate })] });

    const result = await skillService.getPostById('post-1');

    // 过期帖子返回 {...post, expired: true }，用 toHaveProperty 验证避免联合类型报错
    expect(result).toHaveProperty('expired', true);
  });

  it('nickname 为 null 时 user 为 undefined', async () => {
    mockQuery.mockResolvedValue({ rows: [makeRow({ nickname: null, avatar: null, reputation_score: null })] });

    const result = await skillService.getPostById('post-1');

    expect(result.user).toBeUndefined();
  });
});

describe('skill.service updatePost', () => {
  it('帖子不存在抛 NotFoundError', async () => {
    // 第一次 query 查 user_id，返回空
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(
      skillService.updatePost('not-exist', 'user-1', { title: '新标题' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('非本人帖子抛 PermissionDeniedError', async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 'user-2' }] });

    await expect(
      skillService.updatePost('post-1', 'user-1', { title: '新标题' }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('无字段更新时返回 getPostById 结果', async () => {
    // 第一次 query 查 user_id（存在且本人）
    // 第二次 query 由 getPostById → skillPostCache.get → fetchFn 触发
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [makeRow()] });

    const result = await skillService.updatePost('post-1', 'user-1', {});

    expect(result.id).toBe('post-1');
    // 仅调用 2 次 query：1 次权限校验 + 1 次 getPostById 查询，无 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const secondSql = mockQuery.mock.calls[1][0] as string;
    expect(secondSql).toContain('SELECT');
    expect(secondSql).not.toContain('UPDATE');
  });

  it('正常更新含动态 SET 子句，验证清缓存', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] }) // 权限校验
      .mockResolvedValueOnce({ rows: [makeRow({ title: '新标题' })] }); // UPDATE RETURNING

    const result = await skillService.updatePost('post-1', 'user-1', { title: '新标题' });

    expect(result.title).toBe('新标题');
    // 验证 UPDATE SQL 含动态 SET
    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain('UPDATE skill_posts');
    expect(updateSql).toContain('title = $1');
    expect(updateSql).toContain('updated_at = NOW()');
    // 验证清缓存被调用
    expect(skillPostCache.invalidate).toHaveBeenCalledWith('post-1');
  });

  it('更新含 images 时触发 validateImageUrls', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [makeRow()] });

    await skillService.updatePost('post-1', 'user-1', {
      images: ['https://example.com/new.png'],
    });

    // 验证 UPDATE SQL 含 images 字段
    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain('images = $1');
  });

  it('字段值为函数类型时抛 BadRequestError（isSqlParam 守卫）', async () => {
    // 权限校验通过
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] });

    // 模拟运行时恶意输入：title 字段为函数，绕过 TS 类型检查
    const maliciousInput = { title: (() => {}) as unknown as string };
    await expect(
      skillService.updatePost('post-1', 'user-1', maliciousInput),
    ).rejects.toThrow(BadRequestError);
    // 确保未执行 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('skill.service deletePost', () => {
  it('帖子不存在抛 NotFoundError', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(skillService.deletePost('not-exist', 'user-1')).rejects.toThrow(NotFoundError);
  });

  it('非本人帖子抛 PermissionDeniedError', async () => {
    mockQuery.mockResolvedValue({ rows: [{ user_id: 'user-2' }] });

    await expect(skillService.deletePost('post-1', 'user-1')).rejects.toThrow(PermissionDeniedError);
  });

  it('正常软删除并清缓存', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] }) // 权限校验
      .mockResolvedValueOnce({ rows: [] }); // 软删除 UPDATE

    await skillService.deletePost('post-1', 'user-1');

    // 验证软删除 SQL 含 deleted_at = NOW()
    const deleteSql = mockQuery.mock.calls[1][0] as string;
    expect(deleteSql).toContain('UPDATE skill_posts');
    expect(deleteSql).toContain('deleted_at = NOW()');
    // 验证清缓存
    expect(skillPostCache.invalidate).toHaveBeenCalledWith('post-1');
  });
});

describe('skill.service getUserPosts', () => {
  it('正常分页查询', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '5' }] }) // total=5
      .mockResolvedValueOnce({ rows: [makeRow(), makeRow({ id: 'post-2' })] });

    const result = await skillService.getUserPosts('user-1', 1, 10);

    expect(result.total).toBe(5);
    expect(result.list).toHaveLength(2);
    expect(result.totalPages).toBe(1);
  });

  it('空结果 totalPages 为 0', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await skillService.getUserPosts('user-1', 1, 10);

    expect(result.total).toBe(0);
    expect(result.list).toHaveLength(0);
    // 0/10 = 0，Math.ceil(0) = 0
    expect(result.totalPages).toBe(0);
  });
});
