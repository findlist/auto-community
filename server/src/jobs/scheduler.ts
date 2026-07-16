import cron, { ScheduledTask } from 'node-cron';
import { query, transaction } from '../config/database';
import { groupOrderService } from '../services/group-order.service';
import { creditService } from '../services/credit.service';
import { backupService } from '../services/backup.service';
import { dataDeletionService } from '../services/data-deletion.service';
import { recordAllMetrics } from '../services/metrics-calculation.service';
import { logger } from '../utils/logger';

// 时间收益每日上限（分钟），与 time-bank.service.ts 保持一致
const DAILY_EARN_LIMIT = 480;

// 调度器句柄：暴露 stop 方法，便于优雅关闭时停止所有定时任务
export interface SchedulerHandle {
  stop(): void;
}

// 技能订单超时处理：pending 状态超过 7 天的订单自动取消并退款
// accepted 状态的超时处理改为发送提醒（见 handleSkillOrderAcceptReminder），避免误自动完成
// 优化：批量查询后单事务批量更新，避免循环中每次启动独立事务
// 导出处理函数便于单元测试直接调用，不改变 initScheduler 的调度行为
export async function handleSkillOrderTimeout(): Promise<void> {
  // 批量查询 pending 超时订单
  const pendingResult = await query<{ id: string; buyer_id: string; credit_amount: number }>(
    `SELECT id, buyer_id, credit_amount FROM skill_orders
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '7 days'`,
  );

  if (pendingResult.rows.length === 0) return;

  // 单事务批量处理：更新订单状态 + 解冻积分
  try {
    await transaction(async (client) => {
      const orderIds = pendingResult.rows.map((o) => o.id);

      // 批量更新订单状态为 cancelled，带 status='pending' 过滤避免竞态
      // SELECT 在事务外执行，期间订单可能已被接单，未过滤会误取消已接单订单
      const cancelledResult = await client.query<{ id: string }>(
        `UPDATE skill_orders
         SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
         WHERE id = ANY($1) AND status = 'pending'
         RETURNING id`,
        [orderIds],
      );
      const cancelledIds = new Set(cancelledResult.rows.map((r) => r.id));

      // 批量解冻积分退还买家（仅处理实际被取消的订单）
      for (const order of pendingResult.rows) {
        if (!cancelledIds.has(order.id)) continue;
        if (order.credit_amount > 0) {
          // 解冻买家积分
          await client.query(
            `UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2`,
            [order.credit_amount, order.buyer_id],
          );
          // 更新冻结记录为 unfreeze
          await client.query(
            `UPDATE credit_transactions
             SET type = 'unfreeze', updated_at = NOW()
             WHERE reference_id = $1 AND reference_type = 'skill_order' AND type = 'freeze'`,
            [order.id],
          );
        }
      }
    });

    for (const order of pendingResult.rows) {
      logger.info({ orderId: order.id }, '[定时任务] 技能订单超时已自动取消');
    }
  } catch (error) {
    logger.error({ err: error, count: pendingResult.rows.length }, '[定时任务] 技能订单批量自动取消失败');
  }
}

// 技能订单 accepted 7 天提醒：触发"完成确认"流程，提醒买家确认完成
// 不直接完成，避免误操作（如服务未实际完成）
export async function handleSkillOrderAcceptReminder(): Promise<void> {
  const result = await query<{ id: string; buyer_id: string; seller_id: string }>(
    `SELECT id, buyer_id, seller_id FROM skill_orders
     WHERE status = 'accepted' AND updated_at < NOW() - INTERVAL '7 days'`,
  );
  for (const order of result.rows) {
    // 仅记录提醒日志，实际通知可通过消息系统发送
    logger.info(
      { orderId: order.id, buyerId: order.buyer_id, sellerId: order.seller_id },
      '[定时任务] 技能订单已 accepted 7 天，提醒买家确认完成',
    );
  }
  if (result.rows.length > 0) {
    logger.info({ count: result.rows.length }, '[定时任务] 技能订单 accepted 7 天提醒完成');
  }
}

// 技能订单 in_progress 超时处理：超过 30 天的订单标记为需处理
// 不自动完成，避免误操作
export async function handleSkillOrderInProgressTimeout(): Promise<void> {
  const result = await query<{ id: string; buyer_id: string; seller_id: string }>(
    `SELECT id, buyer_id, seller_id FROM skill_orders
     WHERE status = 'in_progress' AND updated_at < NOW() - INTERVAL '30 days'`,
  );
  for (const order of result.rows) {
    logger.warn(
      { orderId: order.id, buyerId: order.buyer_id, sellerId: order.seller_id },
      '[定时任务] 技能订单 in_progress 超过 30 天未更新，需处理',
    );
  }
  if (result.rows.length > 0) {
    logger.info({ count: result.rows.length }, '[定时任务] 技能订单 in_progress 超时检查完成');
  }
}

// 厨房订单超时处理：
// 1. pending 状态超过 30 分钟的订单自动取消、退款并恢复库存
// 2. confirmed 状态超过 24 小时的订单自动完成并结算积分
// 优化：批量查询后单事务批量更新，避免循环中每次启动独立事务
export async function handleKitchenOrderTimeout(): Promise<void> {
  // 1. 批量处理 pending 超时订单：自动取消、退款并恢复库存
  const pendingResult = await query<{
    id: string;
    user_id: string;
    post_id: string;
    portions: number;
    credit_amount: number;
  }>(
    `SELECT id, user_id, post_id, portions, credit_amount FROM kitchen_orders
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 minutes'`,
  );

  if (pendingResult.rows.length > 0) {
    try {
      await transaction(async (client) => {
        const orderIds = pendingResult.rows.map((o) => o.id);

        // 批量更新订单状态为 cancelled，带 status='pending' 过滤避免竞态
        // SELECT 在事务外执行，期间订单可能已被确认，未过滤会误取消已确认订单
        const cancelledResult = await client.query<{ id: string }>(
          `UPDATE kitchen_orders
           SET status = 'cancelled', updated_at = NOW()
           WHERE id = ANY($1) AND status = 'pending'
           RETURNING id`,
          [orderIds],
        );
        const cancelledIds = new Set(cancelledResult.rows.map((r) => r.id));

        // 批量恢复库存（仅处理实际被取消的订单）
        for (const order of pendingResult.rows) {
          if (!cancelledIds.has(order.id)) continue;
          await client.query(
            `UPDATE kitchen_posts
             SET remaining_portions = remaining_portions + $1
             WHERE id = $2`,
            [order.portions, order.post_id],
          );
        }

        // 批量解冻积分退还买家（仅处理实际被取消的订单）
        for (const order of pendingResult.rows) {
          if (!cancelledIds.has(order.id)) continue;
          if (order.credit_amount > 0) {
            await client.query(
              `UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2`,
              [order.credit_amount, order.user_id],
            );
            await client.query(
              `UPDATE credit_transactions
               SET type = 'unfreeze', updated_at = NOW()
               WHERE reference_id = $1 AND reference_type = 'kitchen_order' AND type = 'freeze'`,
              [order.id],
            );
          }
        }
      });

      for (const order of pendingResult.rows) {
        logger.info({ orderId: order.id }, '[定时任务] 厨房订单超时已自动取消');
      }
    } catch (error) {
      logger.error({ err: error, count: pendingResult.rows.length }, '[定时任务] 厨房订单批量自动取消失败');
    }
  }

  // 2. 批量处理 confirmed 超时订单：自动完成并结算积分（无评价）
  const confirmedResult = await query<{
    id: string;
    user_id: string;
    seller_id: string;
    credit_amount: number;
  }>(
    `SELECT id, user_id, seller_id, credit_amount FROM kitchen_orders
     WHERE status = 'confirmed' AND updated_at < NOW() - INTERVAL '24 hours'`,
  );

  if (confirmedResult.rows.length > 0) {
    try {
      await transaction(async (client) => {
        const orderIds = confirmedResult.rows.map((o) => o.id);

        // 批量锁定订单，过滤状态已变更的记录
        const lockedResult = await client.query(
          `SELECT id FROM kitchen_orders WHERE id = ANY($1) AND status = 'confirmed' FOR UPDATE`,
          [orderIds],
        );
        const validOrderIds = lockedResult.rows.map((r: { id: string }) => r.id);

        if (validOrderIds.length === 0) return;

        // 批量更新订单状态为 completed
        await client.query(
          `UPDATE kitchen_orders
           SET status = 'completed', completed_at = NOW(), updated_at = NOW()
           WHERE id = ANY($1)`,
          [validOrderIds],
        );

        // 批量结算积分给卖家
        for (const order of confirmedResult.rows) {
          if (validOrderIds.includes(order.id) && order.credit_amount > 0) {
            await creditService.settleCredits(
              client,
              order.user_id,
              order.seller_id,
              order.credit_amount,
              order.id,
              'kitchen_order',
            );
          }
        }
      });

      for (const order of confirmedResult.rows) {
        logger.info({ orderId: order.id }, '[定时任务] 厨房订单 confirmed 超时已自动完成');
      }
    } catch (error) {
      logger.error({ err: error, count: confirmedResult.rows.length }, '[定时任务] 厨房订单批量自动完成失败');
    }
  }
}

// 时间银行订单超时处理：pending 状态超过 48 小时的订单自动取消
// 优化：批量更新，避免循环中每次单独执行 UPDATE
export async function handleTimeOrderTimeout(): Promise<void> {
  const result = await query<{ id: string }>(
    `UPDATE time_orders
     SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '48 hours'
     RETURNING id`,
  );

  if (result.rows.length > 0) {
    logger.info({ count: result.rows.length }, '[定时任务] 时间银行订单超时已自动取消');
  }
}

// 时间银行订单超时检查：accepted/in_progress 状态超过 7 天的订单标记为需处理
// 不自动完成，避免误操作（如服务未实际完成）
export async function handleTimeBankOrderTimeout(): Promise<void> {
  const result = await query<{ id: string; status: string; provider_id: string; requester_id: string }>(
    `SELECT id, status, provider_id, requester_id FROM time_orders
     WHERE status IN ('accepted', 'in_progress')
       AND updated_at < NOW() - INTERVAL '7 days'`,
  );
  for (const order of result.rows) {
    logger.warn(
      { orderId: order.id, status: order.status, providerId: order.provider_id, requesterId: order.requester_id },
      '[定时任务] 时间银行订单超过 7 天未更新，需处理',
    );
  }
  if (result.rows.length > 0) {
    logger.info({ count: result.rows.length }, '[定时任务] 时间银行订单超时检查完成');
  }
}

// 应急响应超时处理：
// 1. accepted 状态且已超过 timeout_at 的响应自动置为 timeout
// 2. responding 状态且无 accepted 响应的求助（未超时）回退为 open，允许新的响应者接单
//    求助本身已超时的情况由 handleEmergencyRequestTimeout 处理，避免重复
export async function handleEmergencyTimeout(): Promise<void> {
  // 1. 将超时的 accepted 响应置为 timeout
  const timeoutResponseResult = await query<{ id: string }>(
    `UPDATE emergency_responses
     SET status = 'timeout', updated_at = NOW()
     WHERE status = 'accepted' AND timeout_at < NOW()
     RETURNING id`,
  );
  if (timeoutResponseResult.rows.length > 0) {
    logger.info({ count: timeoutResponseResult.rows.length }, '[定时任务] 应急响应超时处理完成');
  }

  // 2. responding 状态且无 accepted 响应的求助（未超时）回退为 open
  //    避免求助卡在 responding 状态无法被新响应者接单
  const rollbackResult = await query<{ id: string }>(
    `UPDATE emergency_requests er
     SET status = 'open', updated_at = NOW()
     WHERE er.deleted_at IS NULL
       AND er.status = 'responding'
       AND er.timeout_at >= NOW()
       AND NOT EXISTS (
         SELECT 1 FROM emergency_responses resp
         WHERE resp.request_id = er.id AND resp.status = 'accepted'
       )
     RETURNING er.id`,
  );
  if (rollbackResult.rows.length > 0) {
    logger.info({ count: rollbackResult.rows.length }, '[定时任务] 应急求助状态回退完成');
  }
}

// 应急求助超时处理：将 status IN ('open','responding') AND timeout_at < NOW()
// 且无 accepted 响应的求助置为 expired
export async function handleEmergencyRequestTimeout(): Promise<void> {
  const result = await query<{ id: string }>(
    `UPDATE emergency_requests er
     SET status = 'expired', updated_at = NOW()
     WHERE er.deleted_at IS NULL
       AND er.status IN ('open', 'responding')
       AND er.timeout_at < NOW()
       AND NOT EXISTS (
         SELECT 1 FROM emergency_responses resp
         WHERE resp.request_id = er.id
           AND resp.status = 'accepted'
       )
     RETURNING er.id`,
  );
  if (result.rows.length > 0) {
    logger.info({ count: result.rows.length }, '[定时任务] 应急求助超时处理完成');
  }
}

// 拼单过期处理：截止时间已过且未达最低参与人数的拼单自动取消并退款
export async function handleGroupOrderTimeout(): Promise<void> {
  const processedCount = await groupOrderService.checkExpired();
  if (processedCount > 0) {
    logger.info({ count: processedCount }, '[定时任务] 拼单过期处理完成');
  }
}

// 应急资源定期巡检：更新可用资源的 last_check 时间戳，标记资源已通过巡检
// 同时将超过 30 天未巡检的资源标记为 needs_check，提示管理员复核
export async function handleEmergencyResourceCheck(): Promise<void> {
  // 1. 更新所有未删除、可用状态资源的 last_check 为当前时间
  const checkedResult = await query<{ id: string }>(
    `UPDATE emergency_resources
     SET last_check = NOW(), updated_at = NOW()
     WHERE deleted_at IS NULL AND status = 'available'
     RETURNING id`,
  );
  if (checkedResult.rows.length > 0) {
    logger.info({ count: checkedResult.rows.length }, '[定时任务] 应急资源巡检完成');
  }

  // 2. 将超过 30 天未巡检的非可用资源标记为 needs_check，提示管理员复核
  //    仅处理状态不为 available 的资源，避免与上一步冲突
  const staleResult = await query<{ id: string }>(
    `UPDATE emergency_resources
     SET status = 'needs_check', updated_at = NOW()
     WHERE deleted_at IS NULL
       AND status NOT IN ('available', 'needs_check', 'unavailable')
       AND (last_check IS NULL OR last_check < NOW() - INTERVAL '30 days')
     RETURNING id`,
  );
  if (staleResult.rows.length > 0) {
    logger.warn({ count: staleResult.rows.length }, '[定时任务] 发现应急资源超过 30 天未巡检，已标记为 needs_check');
  }
}

// 用户自动解封：ban_until 已到期的限时封禁用户自动恢复为 active 状态
// 配合虚假举报审核的 ban_7d / ban_30d 处罚逻辑
export async function handleAutoUnban(): Promise<void> {
  const result = await query<{ id: string }>(
    `UPDATE users
     SET status = 'active', ban_until = NULL, updated_at = NOW()
     WHERE status = 'banned' AND ban_until IS NOT NULL AND ban_until < NOW()
     RETURNING id`,
  );
  if (result.rows.length > 0) {
    logger.info({ count: result.rows.length }, '[定时任务] 自动解封封禁到期的用户');
  }
}

// 积分对账：核对 users.credit_balance 与 credit_transactions 流水累计是否一致
// 仅读不写，发现不一致时记录 error 日志，不自动修复 balance（避免误改）
// 注意：credit_transactions.amount 字段已带符号（earn/unfreeze/refund 为正，spend/freeze 为负），
// 因此直接 SUM(amount) 即为流水计算余额；audit.service.ts 未实现，暂用 logger.error 记录异常
// 导出便于单元测试验证对账逻辑
export async function reconcileCreditBalance(): Promise<number> {
  const result = await query<{ id: string; credit_balance: number; computed_balance: number }>(
    `SELECT u.id, u.credit_balance,
            COALESCE(SUM(ct.amount), 0) AS computed_balance
     FROM users u
     LEFT JOIN credit_transactions ct ON ct.user_id = u.id
     GROUP BY u.id, u.credit_balance
     HAVING u.credit_balance != COALESCE(SUM(ct.amount), 0)`,
  );

  // 逐条记录不一致详情，便于后续排查
  for (const row of result.rows) {
    const diff = Number(row.credit_balance) - Number(row.computed_balance);
    logger.error(
      { userId: row.id, creditBalance: row.credit_balance, computedBalance: row.computed_balance, diff },
      '[定时任务] 积分对账异常',
    );
  }

  if (result.rows.length > 0) {
    logger.error({ count: result.rows.length }, '[定时任务] 积分对账完成，发现用户余额不一致');
  }

  return result.rows.length;
}

// 指标采集：调用 metrics-calculation.service 计算 5 个核心指标并写入 metrics 表
// 设计原因：原 metrics-calculation.service 的计算函数从未被生产代码调用，导致 metrics 表为空、
// /metrics/dashboard 端点返回空数组。此任务作为"计算 → 落库"的桥梁，每小时触发一次。
// 导出便于单元测试直接调用，不改变 initScheduler 的调度行为
export async function handleMetricsCollection(): Promise<void> {
  const result = await recordAllMetrics();
  if (result.failed > 0) {
    logger.warn(
      { recorded: result.recorded, failed: result.failed, failedNames: result.failedNames },
      '[定时任务] 指标采集部分失败',
    );
  } else {
    logger.info({ recorded: result.recorded }, '[定时任务] 指标采集完成');
  }
}

// 技能帖子过期处理：将 status='active' AND expires_at < NOW() 的帖子置为 expired
export async function handleSkillPostExpiry(): Promise<void> {
  const result = await query<{ id: string }>(
    `UPDATE skill_posts
     SET status = 'expired', updated_at = NOW()
     WHERE deleted_at IS NULL AND status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()
     RETURNING id`,
  );
  if (result.rows.length > 0) {
    logger.info({ count: result.rows.length }, '[定时任务] 技能帖子过期处理完成');
  }
}

// 延迟发放时间收益：每日凌晨发放 pending 状态的时间收益（type 为 earn 或 bonus）
// 发放时仍需检查当日收益上限，超限部分保持 pending
export async function handleDeferredTimeEarn(): Promise<number> {
  return transaction(async (client) => {
    // 查询所有 pending 状态的收益流水，按创建时间升序处理（先创建先发放）
    const pendingResult = await client.query(
      `SELECT id, to_user_id, amount, type, service_id, from_user_id, remark FROM time_transactions
       WHERE status = 'pending' AND type IN ('earn', 'bonus')
       ORDER BY created_at ASC`,
    );

    let processedCount = 0;
    for (const tx of pendingResult.rows as Array<{
      id: string;
      to_user_id: string;
      amount: number;
      type: string;
      service_id: string;
      from_user_id: string;
      remark: string;
    }>) {
      // 查询 provider 当日已发放收益（type 为 earn 或 bonus 且 status 为 completed）
      const dailyEarnedResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM time_transactions
         WHERE to_user_id = $1 AND type IN ('earn', 'bonus') AND status = 'completed'
         AND created_at >= CURRENT_DATE`,
        [tx.to_user_id],
      );
      const dailyEarned = parseInt(dailyEarnedResult.rows[0].total, 10);
      const remaining = Math.max(0, DAILY_EARN_LIMIT - dailyEarned);

      // 当日已达上限，保持 pending
      if (remaining <= 0) {
        continue;
      }

      // 发放金额：min(tx.amount, remaining)，超限部分保持 pending
      const grantAmount = Math.min(tx.amount, remaining);

      if (grantAmount >= tx.amount) {
        // 全额发放：更新 status 为 completed
        await client.query(
          `UPDATE time_transactions
           SET status = 'completed', completed_at = NOW()
           WHERE id = $1`,
          [tx.id],
        );
      } else {
        // 部分发放：更新原流水金额为 grantAmount 并置为 completed
        // 插入剩余部分为新的 pending 流水，保留原 remark 便于追溯
        await client.query(
          `UPDATE time_transactions
           SET status = 'completed', completed_at = NOW(), amount = $1
           WHERE id = $2`,
          [grantAmount, tx.id],
        );
        await client.query(
          `INSERT INTO time_transactions (service_id, from_user_id, to_user_id, amount, type, status, remark)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
          [tx.service_id, tx.from_user_id, tx.to_user_id, tx.amount - grantAmount, tx.type, tx.remark],
        );
      }

      // 增加 provider 的 time_balance 和 time_accounts.balance / total_earned
      await client.query(
        'UPDATE users SET time_balance = time_balance + $1 WHERE id = $2',
        [grantAmount, tx.to_user_id],
      );
      await client.query(
        `UPDATE time_accounts
         SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW()
         WHERE user_id = $2`,
        [grantAmount, tx.to_user_id],
      );

      processedCount++;
    }

    return processedCount;
  });
}

// 初始化定时任务调度器
// 每个处理函数独立 try/catch，单个任务失败不影响其他任务
// 返回句柄对象，便于优雅关闭时调用 stop 停止所有定时任务
export function initScheduler(): SchedulerHandle {
  // 收集所有定时任务实例，便于优雅关闭时统一停止
  const tasks: ScheduledTask[] = [];

  // 每 5 分钟执行一次所有超时处理函数
  tasks.push(cron.schedule('*/5 * * * *', async () => {
    logger.info('[定时任务] 开始执行超时订单处理');

    try {
      await handleSkillOrderTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 技能订单超时处理异常');
    }

    try {
      await handleKitchenOrderTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 厨房订单超时处理异常');
    }

    try {
      await handleTimeOrderTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 时间银行订单超时处理异常');
    }

    try {
      await handleEmergencyTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 应急响应超时处理异常');
    }

    try {
      await handleEmergencyRequestTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 应急求助超时处理异常');
    }

    try {
      await handleGroupOrderTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 拼单过期处理异常');
    }

    try {
      await handleEmergencyResourceCheck();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 应急资源巡检异常');
    }

    try {
      await handleAutoUnban();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 用户自动解封异常');
    }

    try {
      await handleSkillOrderAcceptReminder();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 技能订单 accepted 提醒异常');
    }

    try {
      await handleSkillOrderInProgressTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 技能订单 in_progress 超时检查异常');
    }

    try {
      await handleTimeBankOrderTimeout();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 时间银行订单超时检查异常');
    }

    logger.info('[定时任务] 超时订单处理完成');
  }));

  // 每小时执行一次技能帖子过期处理
  tasks.push(cron.schedule('0 * * * *', async () => {
    logger.info('[定时任务] 开始执行技能帖子过期处理');
    try {
      await handleSkillPostExpiry();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 技能帖子过期处理异常');
    }
    logger.info('[定时任务] 技能帖子过期处理结束');
  }));

  // 每日凌晨 0:01 发放 pending 状态的时间收益
  tasks.push(cron.schedule('1 0 * * *', async () => {
    logger.info('[定时任务] 开始执行延迟时间收益发放');
    try {
      const processedCount = await handleDeferredTimeEarn();
      if (processedCount > 0) {
        logger.info({ count: processedCount }, '[定时任务] 延迟时间收益发放完成');
      } else {
        logger.info('[定时任务] 延迟时间收益发放完成，无 pending 流水需处理');
      }
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 延迟时间收益发放异常');
    }
    logger.info('[定时任务] 延迟时间收益发放结束');
  }));

  // 每日凌晨 3 点执行积分对账，独立 try/catch 隔离失败
  tasks.push(cron.schedule('0 3 * * *', async () => {
    logger.info('[定时任务] 开始执行积分对账');
    try {
      const anomalyCount = await reconcileCreditBalance();
      if (anomalyCount === 0) {
        logger.info('[定时任务] 积分对账完成，所有用户余额一致');
      }
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 积分对账异常');
    }
    logger.info('[定时任务] 积分对账结束');
  }));

  // 每日凌晨 2 点执行数据库备份
  tasks.push(cron.schedule('0 2 * * *', async () => {
    logger.info('[定时任务] 开始执行数据库备份');
    try {
      const result = await backupService.performBackup();
      if (result.success) {
        logger.info({
          fileName: result.fileName,
          fileSize: result.fileSize,
          durationMs: result.duration,
        }, '[定时任务] 数据库备份完成');
      } else {
        logger.error({ error: result.error }, '[定时任务] 数据库备份失败');
      }
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 数据库备份异常');
    }
    logger.info('[定时任务] 数据库备份结束');
  }));

  // 每日凌晨 4 点清理超过 90 天的软删除数据
  tasks.push(cron.schedule('0 4 * * *', async () => {
    logger.info('[定时任务] 开始执行软删除数据清理');
    try {
      const cleanedCount = await dataDeletionService.cleanupSoftDeletedData();
      if (cleanedCount > 0) {
        logger.info({ count: cleanedCount }, '[定时任务] 软删除数据清理完成');
      } else {
        logger.info('[定时任务] 软删除数据清理完成，无过期数据');
      }
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 软删除数据清理异常');
    }
    logger.info('[定时任务] 软删除数据清理结束');
  }));

  // 每小时第 5 分钟采集核心业务指标写入 metrics 表
  // 设计原因：错峰避开整点的帖子过期处理与备份任务；1 小时粒度足以反映业务趋势，避免高频写入污染 metrics 表
  tasks.push(cron.schedule('5 * * * *', async () => {
    try {
      await handleMetricsCollection();
    } catch (error) {
      logger.error({ err: error }, '[定时任务] 指标采集异常');
    }
  }));

  logger.info('[定时任务] 调度器已启动：每 5 分钟超时订单处理 / 每小时帖子过期 / 每小时第 5 分钟指标采集 / 每日 0:01 收益发放 / 每日 2:00 数据库备份 / 每日 3:00 积分对账 / 每日 4:00 软删除数据清理');

  // 返回调度器句柄：stop 方法遍历停止所有定时任务，单个失败不影响其他任务
  return {
    stop(): void {
      for (const task of tasks) {
        try {
          task.stop();
        } catch (error) {
          logger.error({ err: error }, '[定时任务] 停止任务失败');
        }
      }
      logger.info('[定时任务] 调度器已停止');
    },
  };
}
