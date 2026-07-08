import { query } from '../config/database';
import type { PoolClient } from 'pg';

/**
 * 更新用户信誉分
 * 基于最近50条评价的平均分计算，无评价时默认 5.0
 *
 * 设计原因：用函数重载明确两种调用契约，让编译期即可校验调用方传参正确性
 *   1. 事务内: updateReputationScore(client, userId) — 复用传入的 client，
 *      保证信誉分更新与业务操作在同一事务内提交/回滚，避免数据不一致
 *   2. 事务外: updateReputationScore(userId) — 使用连接池查询，
 *      适用于无事务上下文的场景（如异步通知触发后的信誉分刷新）
 */
async function updateReputationScore(client: PoolClient, userId: string): Promise<void>;
async function updateReputationScore(userId: string): Promise<void>;
async function updateReputationScore(
  clientOrUserId: PoolClient | string,
  userId?: string,
): Promise<void> {
  const sql = `UPDATE users SET reputation_score = (
    SELECT COALESCE(AVG(rating), 5.0) FROM (
      SELECT rating FROM reviews WHERE reviewed_id = $1 ORDER BY created_at DESC LIMIT 50
    ) recent
  ) WHERE id = $1`;

  // typeof 类型守卫区分两种调用：
  //   - string 分支：事务外调用，clientOrUserId 即为 userId
  //   - 非 string 分支：事务内调用，clientOrUserId 为 PoolClient，userId 必然存在（由重载签名1保证）
  if (typeof clientOrUserId === 'string') {
    await query(sql, [clientOrUserId]);
  } else {
    await clientOrUserId.query(sql, [userId as string]);
  }
}

export const reputationService = {
  updateReputationScore,
};
