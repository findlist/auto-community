/**
 * 限流中间件单元测试
 *
 * 测试目标：
 * - 内存降级模式：Redis 不可用时，限流器使用内存 Map 正常工作
 * - Redis 模式：Redis 可用时，使用 incr/expire 进行计数与窗口管理
 *
 * 测试策略：mock redis 模块，避免依赖真实 Redis 实例。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret-for-rate-limiter-test';
process.env.DB_PASSWORD = 'test-db-password';

// mock redis 模块：使用 vi.hoisted 确保 mock 对象在 vi.mock 工厂执行前已初始化
const { mockRedisClient } = vi.hoisted(() => ({
  mockRedisClient: {
    incr: vi.fn(),
    expire: vi.fn(),
    // isOpen 默认 false，测试内存降级；Redis 模式测试中改为 true
    isOpen: false,
  },
}));
vi.mock('../../config/redis', () => ({
  redisClient: mockRedisClient,
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

import { createRedisRateLimiter } from '../rateLimiter';

// 构造 Express 请求/响应/next 的辅助函数
function createMockReqRes(ip = '127.0.0.1'): {
  req: Request;
  res: Response;
  next: NextFunction;
} {
  const req = { ip, user: undefined } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

beforeEach(() => {
  // 重置 mock 调用记录与实现，避免测试间相互污染
  vi.resetAllMocks();
  // 默认测试内存降级模式
  mockRedisClient.isOpen = false;
});

afterEach(() => {
  // 确保每个测试结束后恢复真实定时器
  vi.useRealTimers();
});

describe('createRedisRateLimiter - 内存降级模式（Redis 不可用）', () => {
  it('正常请求应通过（调用 next 无错误）', async () => {
    const limiter = createRedisRateLimiter({
      windowMs: 1000,
      max: 3,
      keyPrefix: 'mem-pass',
    });
    const { req, res, next } = createMockReqRes();

    await limiter(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('超限请求应返回 429 状态码', async () => {
    const limiter = createRedisRateLimiter({
      windowMs: 1000,
      max: 2,
      keyPrefix: 'mem-over',
    });

    // 前两次请求应通过
    for (let i = 0; i < 2; i++) {
      const { req, res, next } = createMockReqRes();
      await limiter(req, res, next);
      expect(next).toHaveBeenCalledWith();
    }

    // 第三次请求应被拒绝，返回 429
    const { req, res, next } = createMockReqRes();
    await limiter(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'RATE_LIMIT_EXCEEDED',
        message: expect.any(String),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('窗口重置后计数器应归零，请求重新通过', async () => {
    vi.useFakeTimers();

    const limiter = createRedisRateLimiter({
      windowMs: 1000,
      max: 2,
      keyPrefix: 'mem-reset',
    });

    // 消耗完配额
    for (let i = 0; i < 2; i++) {
      const { req, res, next } = createMockReqRes();
      await limiter(req, res, next);
    }

    // 第三次请求应被拒绝
    const beforeReset = createMockReqRes();
    await limiter(beforeReset.req, beforeReset.res, beforeReset.next);
    expect(beforeReset.res.status).toHaveBeenCalledWith(429);

    // 推进时间超过窗口（1500ms > 1000ms），窗口应已重置
    vi.advanceTimersByTime(1500);

    // 窗口重置后请求应通过
    const afterReset = createMockReqRes();
    await limiter(afterReset.req, afterReset.res, afterReset.next);

    expect(afterReset.next).toHaveBeenCalledWith();
    expect(afterReset.res.status).not.toHaveBeenCalled();
  });
});

describe('createRedisRateLimiter - Redis 模式', () => {
  beforeEach(() => {
    mockRedisClient.isOpen = true;
  });

  it('首次请求应调用 incr 并设置 expire（TTL = windowMs / 1000）', async () => {
    mockRedisClient.incr.mockResolvedValueOnce(1);
    mockRedisClient.expire.mockResolvedValueOnce(1);

    const limiter = createRedisRateLimiter({
      windowMs: 60000,
      max: 5,
      keyPrefix: 'redis-first',
    });
    const { req, res, next } = createMockReqRes('10.0.0.1');

    await limiter(req, res, next);

    // 应使用 incr 计数，key 格式为 rate_limit:{keyPrefix}:{ip}
    expect(mockRedisClient.incr).toHaveBeenCalledWith('rate_limit:redis-first:10.0.0.1');
    // 首次请求应设置 expire，TTL 为 60 秒
    expect(mockRedisClient.expire).toHaveBeenCalledWith('rate_limit:redis-first:10.0.0.1', 60);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('后续请求不应重复设置 expire（避免重置窗口）', async () => {
    // 模拟第二次请求：incr 返回 2
    mockRedisClient.incr.mockResolvedValueOnce(2);

    const limiter = createRedisRateLimiter({
      windowMs: 60000,
      max: 5,
      keyPrefix: 'redis-subsequent',
    });
    const { req, res, next } = createMockReqRes('10.0.0.2');

    await limiter(req, res, next);

    expect(mockRedisClient.incr).toHaveBeenCalled();
    // current !== 1，不应调用 expire
    expect(mockRedisClient.expire).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('超限请求应返回 429 且不设置 expire', async () => {
    // incr 返回 6，超过 max=5
    mockRedisClient.incr.mockResolvedValueOnce(6);

    const limiter = createRedisRateLimiter({
      windowMs: 60000,
      max: 5,
      keyPrefix: 'redis-over',
    });
    const { req, res, next } = createMockReqRes('10.0.0.3');

    await limiter(req, res, next);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
    );
    // current=6 !== 1，不应调用 expire
    expect(mockRedisClient.expire).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('Redis 异常时应降级到内存限流', async () => {
    // incr 抛出异常，模拟 Redis 命令执行失败
    mockRedisClient.incr.mockRejectedValueOnce(new Error('Redis connection lost'));

    const limiter = createRedisRateLimiter({
      windowMs: 1000,
      max: 5,
      keyPrefix: 'redis-fallback',
    });
    const { req, res, next } = createMockReqRes('10.0.0.4');

    await limiter(req, res, next);

    // 降级后首次请求应通过
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });
});
