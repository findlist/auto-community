import { logger } from './logger';

/**
 * 安全执行通知类异步操作：吞掉异常不阻塞主流程，同时记录 warn 日志便于监控
 *
 * 设计原因：项目内多处通知调用（站内信推送、外部通道分发等）曾使用
 * `.catch(() => {})` 静默吞错，导致通知发送失败时无任何日志可观测，运维无法
 * 感知通道异常。统一收口为 safeNotify，保留 fire-and-forget 特性的同时记录
 * warn 级别日志，便于告警系统采集。
 *
 * @param promise 通知类异步操作的 Promise
 * @param context 日志上下文（如 { userId, type }），便于排查
 */
export function safeNotify<T>(promise: Promise<T>, context?: Record<string, unknown>): void {
  promise.catch((err) => {
    logger.warn({ err, ...context }, '通知/异步操作失败（已吞错不阻塞主流程）');
  });
}
