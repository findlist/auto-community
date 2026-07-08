import { query } from '../config/database';
import { logger } from '../utils/logger';

// 指标计算结果类型
export interface MetricResult {
  value: number;
  // tags 与 metrics-collector.service.ts 的 DashboardMetric.tags 保持一致，用 unknown 替代 any
  tags: Record<string, unknown>;
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

export const metricsCalculationService = {
  calculateEmergencyResponseTime,
  calculateMatchSuccessRate,
  calculateOrderCompletionRate,
  calculateUserSatisfactionScore,
  calculateAIRecommendationAccuracy,
};
