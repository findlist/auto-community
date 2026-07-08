import { Request, Response, NextFunction } from 'express';
import { redisClient } from '../config/redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { BusinessErrorCode } from '../utils/errorCodes';

// 内存限流降级存储：Redis 不可用时使用，保证单实例仍可用
// 结构：key -> { count, resetAt }
interface MemoryEntry {
  count: number;
  resetAt: number;
}
const memoryStore = new Map<string, MemoryEntry>();

// 限流器配置
interface RateLimiterOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

// 默认标识符生成：优先用户 ID，其次 IP
function defaultKeyGenerator(req: Request): string {
  return req.user?.id || req.ip || 'unknown';
}

// 内存限流：Redis 不可用时的降级逻辑
// 返回 true 表示放行，false 表示已超限
function memoryRateLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const entry = memoryStore.get(key);
  // 无记录或窗口已过期：重置计数
  if (!entry || entry.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

// 发送 429 限流响应，格式与 errorHandler 保持一致
function sendRateLimitResponse(res: Response, message: string): void {
  res.status(429).json({
    code: BusinessErrorCode.RATE_LIMIT_EXCEEDED,
    message,
  });
}

/**
 * 创建基于 Redis 的限流中间件
 *
 * 实现要点：
 * - 使用 redisClient.incr 计数，key 不存在时自动创建并返回 1
 * - 首次请求（incr 返回 1）时设置 expire，TTL = windowMs / 1000 秒
 * - 后续请求不重复设置 expire，避免重置窗口
 * - Redis 不可用时降级为内存限流，保证服务可用
 *
 * key 格式：rate_limit:{keyPrefix}:{ip_or_userId}
 */
export function createRedisRateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    max,
    keyPrefix,
    message = '请求过于频繁，请稍后再试',
    keyGenerator = defaultKeyGenerator,
  } = options;
  const ttlSeconds = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = keyGenerator(req);
    const redisKey = `rate_limit:${keyPrefix}:${identifier}`;

    // Redis 未连接：降级到内存限流
    if (!redisClient.isOpen) {
      if (!memoryRateLimit(redisKey, windowMs, max)) {
        sendRateLimitResponse(res, message);
        return;
      }
      next();
      return;
    }

    try {
      const current = await redisClient.incr(redisKey);
      // 首次请求设置 TTL，后续不重置窗口
      if (current === 1) {
        await redisClient.expire(redisKey, ttlSeconds);
      }

      if (current > max) {
        sendRateLimitResponse(res, message);
        return;
      }
      next();
    } catch (error) {
      // Redis 异常：降级到内存限流，保证服务可用
      logger.warn({ err: error, key: redisKey }, 'Redis 限流异常，降级到内存限流');
      if (!memoryRateLimit(redisKey, windowMs, max)) {
        sendRateLimitResponse(res, message);
        return;
      }
      next();
    }
  };
}

// API 全局限流
export const apiLimiter = createRedisRateLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  keyPrefix: 'api',
  message: '请求过于频繁，请稍后再试',
});

// 认证接口限流（更严格）
export const authLimiter = createRedisRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 10,
  keyPrefix: 'auth',
  message: '登录尝试过多，请15分钟后再试',
  keyGenerator: (req) => req.ip || 'unknown',
});

// 发布内容限流
export const createPostLimiter = createRedisRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 小时
  max: 20,
  keyPrefix: 'create_post',
  message: '发布过于频繁，请稍后再试',
});

// 订单操作限流
export const orderLimiter = createRedisRateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 30,
  keyPrefix: 'order',
  message: '操作过于频繁，请稍后再试',
});

// 聊天消息限流
export const chatLimiter = createRedisRateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 60,
  keyPrefix: 'chat',
  message: '消息发送过于频繁，请稍后再试',
});

// 短信验证码限流
export const smsLimiter = createRedisRateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 1,
  keyPrefix: 'sms',
  message: '短信发送过于频繁，请稍后再试',
  keyGenerator: (req) => req.body?.phone || req.ip || 'unknown',
});

// 搜索限流
export const searchLimiter = createRedisRateLimiter({
  windowMs: 60 * 1000, // 1 分钟
  max: 60,
  keyPrefix: 'search',
  message: '搜索过于频繁，请稍后再试',
});
