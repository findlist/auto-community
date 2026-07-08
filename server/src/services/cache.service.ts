import { getCache, setCache, deleteCache } from '../config/redis';
import { logger } from '../utils/logger';

// 缓存 TTL：5 分钟（300 秒）
const CACHE_TTL = 300;

// 缓存 key 前缀
const CACHE_KEYS = {
  USER: 'user',
  SKILL_POST: 'skill_post',
  KITCHEN_POST: 'kitchen_post',
  TIME_SERVICE: 'time_service',
} as const;

/**
 * 通用缓存获取函数（支持缓存穿透保护）
 * 查询失败时不缓存空值，避免缓存穿透
 */
async function getOrSetCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number = CACHE_TTL,
): Promise<T> {
  // 尝试从缓存获取
  const cached = await getCache<T>(key);
  if (cached !== null) {
    logger.debug({ key }, '缓存命中');
    return cached;
  }

  // 缓存未命中，从数据源获取
  logger.debug({ key }, '缓存未命中，从数据源获取');
  const data = await fetchFn();

  // 仅缓存有效数据，不缓存 null/undefined（防止缓存穿透）
  if (data !== null && data !== undefined) {
    await setCache(key, data, ttl);
  }

  return data;
}

/**
 * 用户公开信息缓存
 */
export const userCache = {
  // 生成缓存 key
  getKey(userId: string): string {
    return `${CACHE_KEYS.USER}:${userId}`;
  },

  // 获取用户缓存
  async get<T>(userId: string, fetchFn: () => Promise<T>): Promise<T> {
    const key = this.getKey(userId);
    return getOrSetCache(key, fetchFn);
  },

  // 清除用户缓存
  async invalidate(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await deleteCache(key);
    logger.debug({ key }, '用户缓存已清除');
  },
};

/**
 * 技能帖子缓存
 */
export const skillPostCache = {
  // 生成缓存 key
  getKey(postId: string): string {
    return `${CACHE_KEYS.SKILL_POST}:${postId}`;
  },

  // 获取帖子缓存
  async get<T>(postId: string, fetchFn: () => Promise<T>): Promise<T> {
    const key = this.getKey(postId);
    return getOrSetCache(key, fetchFn);
  },

  // 清除帖子缓存
  async invalidate(postId: string): Promise<void> {
    const key = this.getKey(postId);
    await deleteCache(key);
    logger.debug({ key }, '技能帖子缓存已清除');
  },
};

/**
 * 美食帖子缓存
 */
export const kitchenPostCache = {
  // 生成缓存 key
  getKey(postId: string): string {
    return `${CACHE_KEYS.KITCHEN_POST}:${postId}`;
  },

  // 获取帖子缓存
  async get<T>(postId: string, fetchFn: () => Promise<T>): Promise<T> {
    const key = this.getKey(postId);
    return getOrSetCache(key, fetchFn);
  },

  // 清除帖子缓存
  async invalidate(postId: string): Promise<void> {
    const key = this.getKey(postId);
    await deleteCache(key);
    logger.debug({ key }, '美食帖子缓存已清除');
  },
};

/**
 * 时间银行服务缓存
 */
export const timeServiceCache = {
  // 生成缓存 key
  getKey(serviceId: string): string {
    return `${CACHE_KEYS.TIME_SERVICE}:${serviceId}`;
  },

  // 获取服务缓存
  async get<T>(serviceId: string, fetchFn: () => Promise<T>): Promise<T> {
    const key = this.getKey(serviceId);
    return getOrSetCache(key, fetchFn);
  },

  // 清除服务缓存
  async invalidate(serviceId: string): Promise<void> {
    const key = this.getKey(serviceId);
    await deleteCache(key);
    logger.debug({ key }, '时间银行服务缓存已清除');
  },
};