import { createClient, RedisClientType } from 'redis';
import { env } from './env';
import { logger } from '../utils/logger';

// 创建Redis客户端
// database: 共享 Redis 实例时区分项目（社区默认 DB 0）
export const redisClient: RedisClientType = createClient({
  socket: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error('Redis 重连次数超限');
      return Math.min(retries * 300, 5000);
    },
  },
  password: env.REDIS_PASSWORD || undefined,
  database: env.REDIS_DB ? Number(env.REDIS_DB) : 0,
});

// 连接事件监听
redisClient.on('connect', () => {
  logger.debug('Redis客户端连接中');
});

redisClient.on('ready', () => {
  logger.info('Redis客户端就绪');
});

redisClient.on('error', (err) => {
  logger.error({ err }, 'Redis客户端错误');
});

redisClient.on('end', () => {
  logger.debug('Redis客户端连接关闭');
});

// 连接Redis
export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
    logger.info('Redis连接成功');
  } catch (error) {
    logger.warn({ err: error }, 'Redis连接失败，将使用内存降级模式');
  }
}

// 断开Redis连接
export async function disconnectRedis(): Promise<void> {
  try {
    await redisClient.quit();
    logger.info('Redis连接已关闭');
  } catch (error) {
    logger.error({ err: error }, 'Redis关闭错误');
  }
}

// 缓存辅助函数
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const value = await redisClient.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.error({ err: error, key }, 'Redis获取缓存错误');
    return null;
  }
}

// value: unknown — 缓存层存储任意可序列化值，用 unknown 替代 any 强制消费方在读取时通过 getCache<T> 泛型断言类型
export async function setCache(key: string, value: unknown, ttl?: number): Promise<void> {
  try {
    const stringValue = JSON.stringify(value);
    if (ttl) {
      await redisClient.setEx(key, ttl, stringValue);
    } else {
      await redisClient.set(key, stringValue);
    }
  } catch (error) {
    logger.error({ err: error, key }, 'Redis设置缓存错误');
  }
}

export async function deleteCache(key: string): Promise<void> {
  try {
    await redisClient.del(key);
  } catch (error) {
    logger.error({ err: error, key }, 'Redis删除缓存错误');
  }
}

export async function clearCachePattern(pattern: string): Promise<void> {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (error) {
    logger.error({ err: error, pattern }, 'Redis清除缓存错误');
  }
}
