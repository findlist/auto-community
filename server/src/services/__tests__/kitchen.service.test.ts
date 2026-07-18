/**
 * kitchen.service 单元测试
 *
 * 测试目标：覆盖 create / getList / getById / update / remove
 * 测试策略：mock database 与 cache.service，验证 SQL 拼装、字段映射、权限校验、缓存失效等。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: {},
}));

vi.mock('../cache.service', () => ({
  // kitchenPostCache.get 直接调用 fetchFn，便于测试 DB 查询逻辑
  kitchenPostCache: {
    get: vi.fn((_id: string, fetchFn: () => Promise<unknown>) => fetchFn()),
    invalidate: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock sanitize，避免实际 xss 库依赖
vi.mock('../../utils/sanitize', () => ({
  sanitizeObject: vi.fn(<T extends Record<string, unknown>>(data: T): T => data),
  sanitizeXss: vi.fn((v: unknown) => v),
  validateImageUrls: vi.fn(),
}));

import { kitchenService, toKitchenPostResponse } from '../kitchen.service';
import { query } from '../../config/database';
import { kitchenPostCache } from '../cache.service';
import { NotFoundError, PermissionDeniedError } from '../../utils/errors';

const mockedQuery = vi.mocked(query);
const mockedCache = vi.mocked(kitchenPostCache);

// 局部类型别名：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需 rows
// 用 as unknown as DbResult 替代显式 any 断言以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;

// 构造一条 kitchen_posts 行（含 join 出来的 user 字段）
// 设计原因：pickup_time/created_at/updated_at 用 Date 对象，反映 pg TIMESTAMP 列的实际解析行为，
// 与 KitchenPostRow 类型定义对齐，避免 toKitchenPostResponse 入参类型不匹配
function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    user_id: 'u1',
    type: 'offer',
    title: '红烧肉',
    description: '家常红烧肉',
    category: '荤菜',
    credit_price: 20,
    portions: 5,
    remaining_portions: 3,
    pickup_time: new Date('2026-01-01T18:00:00Z'),
    pickup_address: '北京朝阳',
    pickup_type: 'self_pickup',
    images: ['https://cdn.example.com/1.png'],
    allergens: ['花生'],
    health_cert: true,
    status: 'active',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    // join 字段
    nickname: '张三',
    avatar: 'https://cdn.example.com/a.png',
    reputation_score: 80,
    ...overrides,
  };
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedCache.get.mockReset();
  mockedCache.get.mockImplementation((_id, fetchFn) => fetchFn());
  mockedCache.invalidate.mockClear();
});

describe('kitchen.service - toKitchenPostResponse', () => {
  it('将数据库 snake_case 转为前端 camelCase', () => {
    const row = mockRow();
    const result = toKitchenPostResponse(row, {
      id: row.user_id,
      nickname: row.nickname,
      avatar: row.avatar,
      reputation_score: row.reputation_score,
    });

    expect(result.userId).toBe('u1');
    expect(result.price).toBe(20);
    expect(result.quantity).toBe(5);
    expect(result.remaining).toBe(3);
    expect(result.pickupLocation).toBe('北京朝阳');
    expect(result.pickupType).toBe('self_pickup');
    expect(result.healthCert).toBe(true);
    expect(result.user?.nickname).toBe('张三');
    expect(result.user?.reputationScore).toBe(80);
  });

  it('images 为空时返回空数组', () => {
    const result = toKitchenPostResponse({ ...mockRow(), images: null });
    expect(result.images).toEqual([]);
  });
});

describe('kitchen.service - create', () => {
  it('创建美食分享并返回响应对象', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult);

    const result = await kitchenService.create('u1', {
      type: 'offer',
      title: '红烧肉',
      description: '家常红烧肉',
      category: '荤菜',
      price: 20,
      quantity: 5,
      images: ['https://cdn.example.com/1.png'],
    });

    expect(result.title).toBe('红烧肉');
    expect(result.price).toBe(20);
    // INSERT 时 remaining_portions 应等于 portions（参数中 $7, $7 重复使用）
    const insertSql = mockedQuery.mock.calls[0][0];
    expect(insertSql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7, $7');
  });
});

describe('kitchen.service - getList', () => {
  it('按 type/category/keyword 多条件查询', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult);

    const result = await kitchenService.getList({
      type: 'offer',
      category: '荤菜',
      keyword: '红烧',
    }, 1, 20);

    expect(result.total).toBe(1);
    expect(result.list).toHaveLength(1);
    // COUNT SQL 应包含三个条件
    const countSql = mockedQuery.mock.calls[0][0];
    expect(countSql).toContain('kp.type = $1');
    expect(countSql).toContain('kp.category = $2');
    expect(countSql).toContain('kp.title ILIKE $3');
    expect(countSql).toContain('kp.description ILIKE $4');
  });

  it('无条件时返回全部', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const result = await kitchenService.getList({}, 1, 20);
    expect(result.total).toBe(0);
    expect(result.list).toEqual([]);
  });
});

describe('kitchen.service - getById', () => {
  it('命中数据库后返回详情', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult);

    const result = await kitchenService.getById('k1');

    expect(result.id).toBe('k1');
    expect(result.user?.nickname).toBe('张三');
    expect(mockedCache.get).toHaveBeenCalledWith('k1', expect.any(Function));
  });

  it('帖子不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(kitchenService.getById('k-x')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('kitchen.service - update', () => {
  it('非作者更新抛 PermissionDeniedError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u-author' }] } as unknown as DbResult);

    await expect(
      kitchenService.update('k1', 'u-other', { title: '篡改' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('帖子不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(kitchenService.update('k-x', 'u1', { title: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('作者更新字段后清除缓存', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] } as unknown as DbResult) // SELECT 权限校验
      .mockResolvedValueOnce({ rows: [mockRow({ title: '新标题' })] } as unknown as DbResult); // UPDATE RETURNING

    const result = await kitchenService.update('k1', 'u1', { title: '新标题' });

    expect(result.title).toBe('新标题');
    // 更新后应清除缓存
    expect(mockedCache.invalidate).toHaveBeenCalledWith('k1');
  });

  it('无字段更新时走 getById 分支', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] } as unknown as DbResult) // SELECT 权限校验
      .mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult); // getById 内部 SELECT

    const result = await kitchenService.update('k1', 'u1', {});

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('k1');
  });

  // 覆盖所有字段独立更新分支：description/category/price/quantity/pickupTime/pickupLocation/pickupType/images/allergens/status
  // 设计原因：单字段更新测试仅覆盖 title 分支，其余 10 个字段的 if 分支未被命中，
  // 一次性传入全部字段可覆盖所有字段映射分支，验证 SQL SET 子句拼装正确性
  it('更新全部字段时 SQL 包含所有 SET 子句', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] } as unknown as DbResult) // SELECT 权限校验
      .mockResolvedValueOnce({ rows: [mockRow({ title: '新标题' })] } as unknown as DbResult); // UPDATE RETURNING

    await kitchenService.update('k1', 'u1', {
      title: '新标题',
      description: '新描述',
      category: '素菜',
      price: 30,
      quantity: 8,
      pickupTime: '2026-02-01',
      pickupLocation: '上海浦东',
      pickupType: 'delivery',
      images: ['https://cdn.example.com/2.png'],
      allergens: ['海鲜'],
      status: 'closed',
    });

    // 验证 UPDATE SQL 包含所有字段的 SET 子句
    const updateSql = mockedQuery.mock.calls[1][0] as string;
    expect(updateSql).toContain('title = $1');
    expect(updateSql).toContain('description = $2');
    expect(updateSql).toContain('category = $3');
    expect(updateSql).toContain('credit_price = $4');
    expect(updateSql).toContain('portions = $5');
    expect(updateSql).toContain('pickup_time = $6');
    expect(updateSql).toContain('pickup_address = $7');
    expect(updateSql).toContain('pickup_type = $8');
    expect(updateSql).toContain('images = $9');
    expect(updateSql).toContain('allergens = $10');
    expect(updateSql).toContain('status = $11');
    expect(updateSql).toContain('updated_at = NOW()');
    // 验证图片 URL 校验被调用（images 字段存在时触发）
    const { validateImageUrls } = await import('../../utils/sanitize');
    expect(vi.mocked(validateImageUrls)).toHaveBeenCalledWith(['https://cdn.example.com/2.png']);
    // 更新后清缓存
    expect(mockedCache.invalidate).toHaveBeenCalledWith('k1');
  });

  it('仅更新 images 字段时触发 validateImageUrls', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult);

    await kitchenService.update('k1', 'u1', { images: ['https://cdn.example.com/x.png'] });

    const { validateImageUrls } = await import('../../utils/sanitize');
    expect(vi.mocked(validateImageUrls)).toHaveBeenCalledWith(['https://cdn.example.com/x.png']);
  });
});

describe('kitchen.service - toKitchenPostResponse 边界', () => {
  it('user 为 undefined 时不输出 user 字段', () => {
    const row = mockRow();
    const result = toKitchenPostResponse(row);
    // 未传 user 参数时 result.user 应为 undefined
    expect(result.user).toBeUndefined();
  });

  it('allergens 为 null 时返回空数组', () => {
    const result = toKitchenPostResponse({ ...mockRow(), allergens: null });
    expect(result.allergens).toEqual([]);
  });

  it('health_cert 为 null 时返回 false', () => {
    const result = toKitchenPostResponse({ ...mockRow(), health_cert: null });
    expect(result.healthCert).toBe(false);
  });
});

describe('kitchen.service - create 默认值分支', () => {
  // 覆盖 create 中各字段 || 默认值分支：price || 0、pickupTime || null、pickupLocation || null、
  // pickupType || 'self_pickup'、images || []、allergens || []、healthCert || false
  it('未传可选字段时使用默认值', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult);

    await kitchenService.create('u1', {
      type: 'offer',
      title: '简餐',
      category: '简餐',
      quantity: 1,
    });

    // 验证 INSERT 参数：price=0、pickupType='self_pickup'、images=[]、allergens=[]、healthCert=false
    const insertParams = mockedQuery.mock.calls[0][1] as unknown[];
    // 参数顺序：userId, type, title, description, category, price, quantity, pickupTime, pickupLocation, pickupType, images, allergens, healthCert
    expect(insertParams[5]).toBe(0);              // price || 0
    expect(insertParams[7]).toBeNull();            // pickupTime || null
    expect(insertParams[8]).toBeNull();            // pickupLocation || null
    expect(insertParams[9]).toBe('self_pickup');   // pickupType || 'self_pickup'
    expect(insertParams[10]).toEqual([]);          // images || []
    expect(insertParams[11]).toEqual([]);          // allergens || []
    expect(insertParams[12]).toBe(false);          // healthCert || false
  });
});

describe('kitchen.service - remove', () => {
  it('作者软删除帖子并清除缓存', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] } as unknown as DbResult) // SELECT 权限校验
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // UPDATE 软删除

    const result = await kitchenService.remove('k1', 'u1');

    expect(result.success).toBe(true);
    // 软删除 SQL 应设置 deleted_at 与 status='closed'
    const updateSql = mockedQuery.mock.calls[1][0];
    expect(updateSql).toContain('deleted_at = NOW()');
    expect(updateSql).toContain("status = $1");
    expect(mockedQuery.mock.calls[1][1]).toEqual(['closed', 'k1']);
    expect(mockedCache.invalidate).toHaveBeenCalledWith('k1');
  });

  it('非作者删除抛 PermissionDeniedError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u-author' }] } as unknown as DbResult);
    await expect(kitchenService.remove('k1', 'u-other')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('帖子不存在抛 NotFoundError', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(kitchenService.remove('k-x', 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// XSS 不变式：create 与 update 入口的 sanitizeObject 字段列表必须包含 pickupLocation
// 设计原因：pickupLocation 落库后写入 kitchen_posts.pickup_address，跨用户在详情/列表渲染，
// 未清洗会触发存储型 XSS。此测试锁定字段列表，避免后续重构不慎移除 pickupLocation
describe('kitchen.service - pickupLocation XSS 不变式', () => {
  it('create 入口 sanitizeObject 字段列表包含 pickupLocation', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult);

    await kitchenService.create('u1', {
      type: 'offer',
      title: '红烧肉',
      category: '荤菜',
      quantity: 5,
      pickupLocation: '北京市朝阳区某街道',
    });

    const { sanitizeObject } = await import('../../utils/sanitize');
    // 第二个参数为字段列表，应包含 pickupLocation/title/description 三项
    const fieldsArg = vi.mocked(sanitizeObject).mock.calls[0][1] as string[];
    expect(fieldsArg).toContain('pickupLocation');
    expect(fieldsArg).toContain('title');
    expect(fieldsArg).toContain('description');
  });

  it('update 入口 sanitizeObject 字段列表包含 pickupLocation', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] } as unknown as DbResult)
      .mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult);

    await kitchenService.update('k1', 'u1', { pickupLocation: '北京市海淀区某街道' });

    const { sanitizeObject } = await import('../../utils/sanitize');
    const fieldsArg = vi.mocked(sanitizeObject).mock.calls[0][1] as string[];
    expect(fieldsArg).toContain('pickupLocation');
  });
});
