// JWT 令牌黑名单工具
// 基于 Redis 实现，支持多实例部署下的黑名单共享
// 用户登出后将未过期的 JWT 写入 Redis，并在认证中间件中校验

import { redisClient } from '../config/redis';
import { logger } from './logger';

// 黑名单 key 前缀，便于在 Redis 中区分命名空间
const BLACKLIST_KEY_PREFIX = 'blacklist:token:';

// 构造黑名单存储用的 Redis key
function buildKey(token: string): string {
  return `${BLACKLIST_KEY_PREFIX}${token}`;
}

export const tokenBlacklist = {
  /**
   * 添加 token 到黑名单
   * @param token JWT 原始字符串
   * @param exp JWT 过期时间戳（秒）
   *
   * 使用 setEx 写入并设置 TTL，Token 过期后 Redis 自动清理，无需手动维护
   */
  async addToBlacklist(token: string, exp: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ttl = exp - now;
    if (ttl <= 0) return;
    try {
      await redisClient.setEx(buildKey(token), ttl, '1');
    } catch (err) {
      // Redis 不可用时静默降级，不影响主流程（登出仍可成功）
      // 记录 warn 便于安全审计：降级后该 token 不会被拉黑，仅依赖 JWT 过期
      logger.warn({ err, ttl }, '[tokenBlacklist] Redis 不可用，addToBlacklist 降级跳过');
    }
  },

  async isBlacklisted(token: string): Promise<boolean> {
    try {
      const value = await redisClient.get(buildKey(token));
      return value !== null;
    } catch (err) {
      // Redis 不可用时放行，依赖 JWT 自身过期机制
      // 记录 warn 便于安全审计：降级后已拉黑的 token 仍可使用，存在安全隐患
      logger.warn({ err }, '[tokenBlacklist] Redis 不可用，isBlacklisted 降级放行');
      return false;
    }
  },
};
