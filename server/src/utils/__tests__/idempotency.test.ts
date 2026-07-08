/**
 * 幂等性控制单元测试（Task 11 Redis 化）
 *
 * 测试目标：覆盖 idempotency 模块的 buildKey / checkIdempotency / setIdempotencyResult
 * 测试策略：mock redis 模块，避免依赖真实 Redis 实例。
 *
 * 改造说明：原文件使用 Node.js 内置 assert 模块 + 真实 Redis 连接，
 *           现统一为 vitest 风格并使用 mock，便于 CI 环境下无外部依赖运行。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret-for-idempotency-test';
process.env.DB_PASSWORD = 'test-db-password';

// mock redis 模块：使用 vi.hoisted 确保 mock 对象在 vi.mock 工厂执行前已初始化
// vi.mock 调用会被提升到文件顶部，普通变量无法在工厂函数中引用
const { mockRedisClient } = vi.hoisted(() => ({
  mockRedisClient: {
    get: vi.fn(),
    setEx: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));
vi.mock('../../config/redis', () => ({
  redisClient: mockRedisClient,
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

import { idempotency } from '../idempotency';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('idempotency - buildKey', () => {
  it('应按 `${prefix}${userId}:${resourceType}:${resourceId}` 格式构造 key', () => {
    const key = idempotency.buildKey('user-1', 'skill_order', 'post-1');
    // 前缀为 idempotency:
    expect(key).toBe('idempotency:user-1:skill_order:post-1');
  });

  it('不同参数组合应生成不同 key', () => {
    const key1 = idempotency.buildKey('user-1', 'skill_order', 'post-1');
    const key2 = idempotency.buildKey('user-1', 'skill_order', 'post-2');
    const key3 = idempotency.buildKey('user-2', 'skill_order', 'post-1');

    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key2).not.toBe(key3);
  });
});

describe('idempotency - checkIdempotency', () => {
  it('Redis 中存在 key 时应返回 hit=true 与反序列化后的数据', async () => {
    const cached = { orderId: 'order-123', amount: 100 };
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await idempotency.checkIdempotency('idempotency:user-1:skill_order:post-1');

    expect(mockRedisClient.get).toHaveBeenCalledWith('idempotency:user-1:skill_order:post-1');
    expect(result.hit).toBe(true);
    expect(result.data).toEqual(cached);
  });

  it('Redis 中不存在 key 时应返回 hit=false 且 data 为 undefined', async () => {
    mockRedisClient.get.mockResolvedValueOnce(null);

    const result = await idempotency.checkIdempotency('idempotency:user-1:skill_order:post-missing');

    expect(result.hit).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it('应支持缓存复杂对象（嵌套结构）', async () => {
    const cached = { order: { id: 'order-1', items: [{ sku: 'a', qty: 2 }] }, meta: { ts: 123 } };
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(cached));

    const result = await idempotency.checkIdempotency('idempotency:user-1:skill_order:post-1');

    expect(result.data).toEqual(cached);
  });
});

describe('idempotency - setIdempotencyResult', () => {
  it('应调用 redisClient.setEx 写入 JSON 字符串并设置默认 TTL=5 秒', async () => {
    const data = { orderId: 'order-123' };
    await idempotency.setIdempotencyResult('idempotency:user-1:skill_order:post-1', data);

    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      'idempotency:user-1:skill_order:post-1',
      5,
      JSON.stringify(data),
    );
  });

  it('应支持自定义 TTL', async () => {
    const data = { orderId: 'order-456' };
    await idempotency.setIdempotencyResult('idempotency:user-1:skill_order:post-2', data, 10);

    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      'idempotency:user-1:skill_order:post-2',
      10,
      JSON.stringify(data),
    );
  });

  it('写入后立即查询应命中（mock 模拟读写一致性）', async () => {
    const data = { orderId: 'order-789', amount: 50 };
    // 模拟 setEx 后 get 返回相同数据
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(data));

    await idempotency.setIdempotencyResult('idempotency:user-1:skill_order:post-3', data);
    const result = await idempotency.checkIdempotency('idempotency:user-1:skill_order:post-3');

    expect(result.hit).toBe(true);
    expect(result.data).toEqual(data);
  });
});

describe('idempotency - 端到端流程（mock）', () => {
  it('首次请求未命中 → 执行业务 → 写入缓存 → 第二次请求命中返回缓存结果', async () => {
    const key = idempotency.buildKey('user-1', 'skill_order', 'post-1');
    const businessResult = { id: 'order-1', postId: 'post-1', buyerId: 'user-1' };

    // 第一次查询：未命中
    mockRedisClient.get.mockResolvedValueOnce(null);
    const firstCheck = await idempotency.checkIdempotency(key);
    expect(firstCheck.hit).toBe(false);

    // 业务执行后写入缓存
    await idempotency.setIdempotencyResult(key, businessResult);
    expect(mockRedisClient.setEx).toHaveBeenCalledTimes(1);

    // 第二次查询：命中（mock 返回缓存数据）
    mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(businessResult));
    const secondCheck = await idempotency.checkIdempotency(key);
    expect(secondCheck.hit).toBe(true);
    expect(secondCheck.data).toEqual(businessResult);
  });
});
