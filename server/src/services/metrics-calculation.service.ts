import { query } from '../config/database';
import { logger } from '../utils/logger';
import { recordMetric, METRIC_NAMES } from './metrics-collector.service';

// 指标计算结果类型
export interface MetricResult {
  value: number;
  // tags 与 metrics-collector.service.ts 的 DashboardMetric.tags 保持一致，用 unknown 替代 any
  tags: Record<string, unknown>;
}

// 指标采集结果：用于调度层日志汇总，便于运维快速定位失败项
export interface MetricsCollectionResult {
  recorded: number;
  failed: number;
  failedNames: string[];
}

// 计算应急响应时间：从发布到首次响应的平均时间（秒）
export async function calculateEmergencyResponseTime(): Promise<MetricResult> {
  try {
    const { rows } = await query(
      `SELECT
         COALESCE(AVG(EXTRACT(EPOCH FROM (er.created_at - eq.created_at))), 0) as avg_seconds
       FROM emergency_requests eq
       INNER JOIN emergency_responses er ON eq.id = er.request_id
       WHERE eq.deleted_at IS NULL
         AND eq.created_at >= NOW() - INTERVAL '30 days'`
    );

    return {
      value: parseFloat(rows[0].avg_seconds) || 0,
      tags: { period: '30d', unit: 'seconds' },
    };
  } catch (error) {
    logger.error({ err: error }, '计算应急响应时间失败');
    return { value: 0, tags: { error: true } };
  }
}

// 计算匹配成功率：AI 推荐后用户点击/下单的比例
export async function calculateMatchSuccessRate(): Promise<MetricResult> {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(CASE WHEN event_type = 'click' THEN 1 END) as clicks,
         COUNT(CASE WHEN event_type = 'order' THEN 1 END) as orders,
         COUNT(*) as total
       FROM ab_test_results
       WHERE created_at >= NOW() - INTERVAL '30 days'`
    );

    const row = rows[0];
    const total = parseInt(row.total, 10) || 1;
    const clicks = parseInt(row.clicks, 10) || 0;
    const orders = parseInt(row.orders, 10) || 0;

    return {
      value: total > 0 ? (orders / total) * 100 : 0,
      tags: { period: '30d', unit: 'percent', clicks, orders, total },
    };
  } catch (error) {
    logger.error({ err: error }, '计算匹配成功率失败');
    return { value: 0, tags: { error: true } };
  }
}

// 计算订单完成率：已完成/总订单比例
export async function calculateOrderCompletionRate(): Promise<MetricResult> {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed
       FROM (
         SELECT status FROM skill_orders WHERE created_at >= NOW() - INTERVAL '30 days'
         UNION ALL
         SELECT status FROM kitchen_orders WHERE created_at >= NOW() - INTERVAL '30 days'
         UNION ALL
         SELECT status FROM time_orders WHERE created_at >= NOW() - INTERVAL '30 days'
       ) all_orders`
    );

    const row = rows[0];
    const total = parseInt(row.total, 10) || 1;
    const completed = parseInt(row.completed, 10) || 0;

    return {
      value: total > 0 ? (completed / total) * 100 : 0,
      tags: { period: '30d', unit: 'percent', completed, total },
    };
  } catch (error) {
    logger.error({ err: error }, '计算订单完成率失败');
    return { value: 0, tags: { error: true } };
  }
}

// 计算用户满意度：reviews 表平均评分
export async function calculateUserSatisfactionScore(): Promise<MetricResult> {
  try {
    const { rows } = await query(
      `SELECT
         COALESCE(AVG(rating), 0) as avg_rating,
         COUNT(*) as total_reviews
       FROM reviews
       WHERE created_at >= NOW() - INTERVAL '30 days'`
    );

    const row = rows[0];
    return {
      value: parseFloat(row.avg_rating) || 0,
      tags: { period: '30d', unit: 'score', totalReviews: parseInt(row.total_reviews, 10) },
    };
  } catch (error) {
    logger.error({ err: error }, '计算用户满意度失败');
    return { value: 0, tags: { error: true } };
  }
}

// 计算 AI 推荐准确率：ab_test_results 中 treatment 组的点击率
export async function calculateAIRecommendationAccuracy(): Promise<MetricResult> {
  try {
    const { rows } = await query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN event_type = 'click' THEN 1 END) as clicks
       FROM ab_test_results
       WHERE variant = 'treatment'
         AND created_at >= NOW() - INTERVAL '30 days'`
    );

    const row = rows[0];
    const total = parseInt(row.total, 10) || 1;
    const clicks = parseInt(row.clicks, 10) || 0;

    return {
      value: total > 0 ? (clicks / total) * 100 : 0,
      tags: { period: '30d', unit: 'percent', clicks, total },
    };
  } catch (error) {
    logger.error({ err: error }, '计算 AI 推荐准确率失败');
    return { value: 0, tags: { error: true } };
  }
}

/**
 * 指标采集映射表：将 5 个计算函数与 metrics 表的指标名称一一对应。
 * 设计原因：集中维护映射关系，避免在 recordAllMetrics 中重复 if/else 或 switch，
 * 新增指标只需在此处追加一项，符合开闭原则。
 */
const METRIC_CALCULATORS: Array<{ name: string; calculate: () => Promise<MetricResult> }> = [
  { name: METRIC_NAMES.EMERGENCY_RESPONSE_TIME, calculate: calculateEmergencyResponseTime },
  { name: METRIC_NAMES.MATCH_SUCCESS_RATE, calculate: calculateMatchSuccessRate },
  { name: METRIC_NAMES.ORDER_COMPLETION_RATE, calculate: calculateOrderCompletionRate },
  { name: METRIC_NAMES.USER_SATISFACTION_SCORE, calculate: calculateUserSatisfactionScore },
  { name: METRIC_NAMES.AI_RECOMMENDATION_ACCURACY, calculate: calculateAIRecommendationAccuracy },
];

/**
 * 一次性采集所有核心指标并写入 metrics 表，供 dashboard 端点读取。
 *
 * 设计原因：
 * - 原本 metrics-calculation.service 的 5 个计算函数从未被生产代码调用，
 *   导致 metrics 表永远为空，/metrics/dashboard 端点永远返回空数组。
 * - 此函数作为"计算 → 落库"的桥梁，由 scheduler 定时触发。
 * - 单个指标失败不阻塞其他指标：calculate 函数自身已有 try/catch 降级返回 {value:0,tags:{error:true}}，
 *   此处仍对 recordMetric 做 try/catch，避免 redis/DB 抖动导致整批采集中断。
 * - 串行而非并行：5 个指标各自查不同业务表，并行会瞬时建立 5 个 DB 连接，
 *   在低配服务器上可能触发连接池压力；串行总耗时约 5×单查询时间，可接受。
 */
export async function recordAllMetrics(): Promise<MetricsCollectionResult> {
  let recorded = 0;
  let failed = 0;
  const failedNames: string[] = [];

  for (const { name, calculate } of METRIC_CALCULATORS) {
    try {
      const result = await calculate();
      // 跳过计算失败的指标（tags 含 error 标记），避免把无效的 0 值写入 metrics 表污染趋势数据
      if (result.tags.error) {
        failed++;
        failedNames.push(name);
        continue;
      }
      await recordMetric(name, result.value, result.tags);
      recorded++;
    } catch (error) {
      // recordMetric 内部已有 try/catch，此处兜底防御未预期异常
      failed++;
      failedNames.push(name);
      logger.error({ err: error, metricName: name }, '采集指标落库失败');
    }
  }

  logger.info(
    { recorded, failed, failedNames: failedNames.length > 0 ? failedNames : undefined },
    '指标采集完成',
  );

  return { recorded, failed, failedNames };
}
