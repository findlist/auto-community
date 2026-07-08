// 幂等性控制工具
// 基于 Redis 实现，支持多实例部署下的幂等状态共享
// 用于防止资产变更类接口被重复提交
// 改造说明：原内存 Map 实现无法在多实例间共享幂等状态，改为 Redis 后所有实例共用一份缓存

import { redisClient } from '../config/redis';

// 幂等时间窗口：5 秒（与原内存实现保持一致）
const IDEMPOTENCY_TTL_SECONDS = 5;

// 幂等缓存 Redis key 前缀，便于命名空间隔离
const IDEMPOTENCY_KEY_PREFIX = 'idempotency:';

// 构造统一的缓存键：`${userId}:${resourceType}:${resourceId}`
function buildKey(userId: string, resourceType: string, resourceId: string): string {
  return `${IDEMPOTENCY_KEY_PREFIX}${userId}:${resourceType}:${resourceId}`;
}

/**
 * 检查幂等：若键存在则返回缓存结果
 * @param key 幂等缓存键
 * @returns hit 表示是否命中，data 为缓存的结果数据
 *
 * Redis 中 key 存在即视为命中；TTL 过期后 Redis 自动删除，返回未命中
 */
// data?: unknown：幂等缓存存储任意业务结果（订单/响应/流水），工具层无法预知具体类型，
// 用 unknown 替代 any 强制消费方在使用 cached.data 时做类型断言，比 any 更安全
async function checkIdempotency(key: string): Promise<{ hit: boolean; data?: unknown }> {
  const value = await redisClient.get(key);
  if (value === null) {
    return { hit: false };
  }
  return { hit: true, data: JSON.parse(value) };
}

/**
 * 写入幂等缓存结果
 * @param key 幂等缓存键
 * @param data 缓存的结果数据
 * @param ttlSeconds TTL 秒数，默认 5 秒
 *
 * 使用 setEx 写入并设置 TTL，过期后 Redis 自动清理，无需手动维护
 * data: unknown：接受任意业务结果序列化为 JSON 存储，工具层不关心具体类型
 */
async function setIdempotencyResult(
  key: string,
  data: unknown,
  ttlSeconds: number = IDEMPOTENCY_TTL_SECONDS,
): Promise<void> {
  await redisClient.setEx(key, ttlSeconds, JSON.stringify(data));
}

export const idempotency = {
  buildKey,
  checkIdempotency,
  setIdempotencyResult,
};
