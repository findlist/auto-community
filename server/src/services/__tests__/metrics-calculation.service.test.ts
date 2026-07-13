/**
 * metrics-calculation.service 单元测试
 *
 * 测试目标：
 * - calculateEmergencyResponseTime：正常计算平均响应秒数 / query 抛错降级
 * - calculateMatchSuccessRate：正常计算 orders/total*100 / total=0 降级 / query 抛错降级
 * - calculateOrderCompletionRate：正常计算 completed/total*100 / query 抛错降级
 * - calculateUserSatisfactionScore：正常计算平均评分 / query 抛错降级
 * - calculateAIRecommendationAccuracy：正常计算 clicks/total*100 / query 抛错降级
 * - recordAllMetrics：5 个指标全部成功 / 部分计算失败跳过 / recordMetric 抛错不阻塞其他指标
 *
 * 测试策略：
 * - mock database 的 query、logger
 * - mock metrics-collector.service 的 recordMetric 与 METRIC_NAMES，避免引入 redis 依赖
 * - 每个计算函数都有 try/catch 降级路径，验证抛错时返回 {value:0, tags:{error:true}}
 * - 验证 parseInt/parseFloat 的 string→number 转换与 || 兜底逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database：query 为可控 mock
const { mockQuery, mockRecordMetric } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockRecordMetric: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
}));

// mock logger：避免依赖日志输出环境
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// mock metrics-collector.service：隔离 recordMetric 便于断言调用次数与参数，
// 同时避免引入 config/redis（redis 客户端在 import 时即创建实例，单元测试环境无 Redis 服务）
vi.mock('../metrics-collector.service', () => ({
  recordMetric: mockRecordMetric,
  // 保持与生产代码一致的 METRIC_NAMES 常量，确保映射表测试真实
  METRIC_NAMES: {
    EMERGENCY_RESPONSE_TIME: 'emergency_response_time',
    MATCH_SUCCESS_RATE: 'match_success_rate',
    ORDER_COMPLETION_RATE: 'order_completion_rate',
    USER_SATISFACTION_SCORE: 'user_satisfaction_score',
    AI_RECOMMENDATION_ACCURACY: 'ai_recommendation_accuracy',
  },
}));

import {
  calculateEmergencyResponseTime,
  calculateMatchSuccessRate,
  calculateOrderCompletionRate,
  calculateUserSatisfactionScore,
  calculateAIRecommendationAccuracy,
  recordAllMetrics,
} from '../metrics-calculation.service';

describe('metrics-calculation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateEmergencyResponseTime', () => {
    it('正常计算：返回平均响应秒数 + tags', async () => {
      // 设计原因：EXTRACT(EPOCH) 返回秒数，parseFloat 转换 DB 的 numeric/string 结果
      mockQuery.mockResolvedValueOnce({ rows: [{ avg_seconds: '125.50' }] });

      const result = await calculateEmergencyResponseTime();

      expect(result.value).toBe(125.5);
      expect(result.tags).toEqual({ period: '30d', unit: 'seconds' });
    });

    it('avg_seconds 为 0 时 || 0 兜底返回 0', async () => {
      // 设计原因：parseFloat('0') = 0，0 || 0 = 0，验证无数据场景
      mockQuery.mockResolvedValueOnce({ rows: [{ avg_seconds: '0' }] });

      const result = await calculateEmergencyResponseTime();

      expect(result.value).toBe(0);
    });

    it('query 抛错时降级返回 {value:0, tags:{error:true}}', async () => {
      // 设计原因：指标计算失败不应影响主流程，降级返回错误标记
      mockQuery.mockRejectedValueOnce(new Error('DB 连接失败'));

      const result = await calculateEmergencyResponseTime();

      expect(result).toEqual({ value: 0, tags: { error: true } });
    });
  });

  describe('calculateMatchSuccessRate', () => {
    it('正常计算：orders/total*100 百分比', async () => {
      // 设计原因：匹配成功率 = 下单数 / 总曝光数 * 100
      mockQuery.mockResolvedValueOnce({
        rows: [{ clicks: '80', orders: '20', total: '100' }],
      });

      const result = await calculateMatchSuccessRate();

      expect(result.value).toBe(20);
      expect(result.tags).toEqual({ period: '30d', unit: 'percent', clicks: 80, orders: 20, total: 100 });
    });

    it('total 为 0 时 parseInt 兜底为 1，value 计算为 0', async () => {
      // 设计原因：parseInt('0') || 1 = 1（0 为 falsy），避免除以 0，value = 0/1*100 = 0
      mockQuery.mockResolvedValueOnce({
        rows: [{ clicks: '0', orders: '0', total: '0' }],
      });

      const result = await calculateMatchSuccessRate();

      expect(result.value).toBe(0);
      expect(result.tags).toEqual({ period: '30d', unit: 'percent', clicks: 0, orders: 0, total: 1 });
    });

    it('query 抛错时降级返回 {value:0, tags:{error:true}}', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB 连接失败'));

      const result = await calculateMatchSuccessRate();

      expect(result).toEqual({ value: 0, tags: { error: true } });
    });
  });

  describe('calculateOrderCompletionRate', () => {
    it('正常计算：completed/total*100 百分比', async () => {
      // 设计原因：订单完成率 = 已完成数 / 总订单数 * 100
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: '50', completed: '40' }],
      });

      const result = await calculateOrderCompletionRate();

      expect(result.value).toBe(80);
      expect(result.tags).toEqual({ period: '30d', unit: 'percent', completed: 40, total: 50 });
    });

    it('query 抛错时降级返回 {value:0, tags:{error:true}}', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB 连接失败'));

      const result = await calculateOrderCompletionRate();

      expect(result).toEqual({ value: 0, tags: { error: true } });
    });
  });

  describe('calculateUserSatisfactionScore', () => {
    it('正常计算：返回平均评分 + totalReviews', async () => {
      // 设计原因：满意度 = reviews 表平均评分，tags 携带 totalReviews 便于前端展示
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg_rating: '4.50', total_reviews: '120' }],
      });

      const result = await calculateUserSatisfactionScore();

      expect(result.value).toBe(4.5);
      expect(result.tags).toEqual({ period: '30d', unit: 'score', totalReviews: 120 });
    });

    it('avg_rating 为 0 时 || 0 兜底返回 0', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg_rating: '0', total_reviews: '0' }],
      });

      const result = await calculateUserSatisfactionScore();

      expect(result.value).toBe(0);
      expect(result.tags).toEqual({ period: '30d', unit: 'score', totalReviews: 0 });
    });

    it('query 抛错时降级返回 {value:0, tags:{error:true}}', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB 连接失败'));

      const result = await calculateUserSatisfactionScore();

      expect(result).toEqual({ value: 0, tags: { error: true } });
    });
  });

  describe('calculateAIRecommendationAccuracy', () => {
    it('正常计算：treatment 组 clicks/total*100', async () => {
      // 设计原因：AI 推荐准确率 = treatment 组点击数 / treatment 组总数 * 100
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: '200', clicks: '60' }],
      });

      const result = await calculateAIRecommendationAccuracy();

      expect(result.value).toBe(30);
      expect(result.tags).toEqual({ period: '30d', unit: 'percent', clicks: 60, total: 200 });
    });

    it('total 为 0 时兜底为 1，value 为 0', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ total: '0', clicks: '0' }],
      });

      const result = await calculateAIRecommendationAccuracy();

      expect(result.value).toBe(0);
      expect(result.tags).toEqual({ period: '30d', unit: 'percent', clicks: 0, total: 1 });
    });

    it('query 抛错时降级返回 {value:0, tags:{error:true}}', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB 连接失败'));

      const result = await calculateAIRecommendationAccuracy();

      expect(result).toEqual({ value: 0, tags: { error: true } });
    });
  });

  // ===================== recordAllMetrics 编排函数 =====================
  describe('recordAllMetrics', () => {
    it('5 个指标全部计算成功时全部落库，recorded=5 / failed=0', async () => {
      // 设计原因：每个 calculate 函数内部 mockResolvedValueOnce 一次，串行执行按序消费
      mockQuery
        // calculateEmergencyResponseTime
        .mockResolvedValueOnce({ rows: [{ avg_seconds: '120' }] })
        // calculateMatchSuccessRate
        .mockResolvedValueOnce({ rows: [{ clicks: '80', orders: '20', total: '100' }] })
        // calculateOrderCompletionRate
        .mockResolvedValueOnce({ rows: [{ total: '50', completed: '40' }] })
        // calculateUserSatisfactionScore
        .mockResolvedValueOnce({ rows: [{ avg_rating: '4.5', total_reviews: '120' }] })
        // calculateAIRecommendationAccuracy
        .mockResolvedValueOnce({ rows: [{ total: '200', clicks: '60' }] });
      mockRecordMetric.mockResolvedValue(undefined);

      const result = await recordAllMetrics();

      expect(result.recorded).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.failedNames).toEqual([]);
      // 验证 recordMetric 被调用 5 次，每次对应正确的指标名
      expect(mockRecordMetric).toHaveBeenCalledTimes(5);
      const calledNames = mockRecordMetric.mock.calls.map((c) => c[0]);
      expect(calledNames).toEqual([
        'emergency_response_time',
        'match_success_rate',
        'order_completion_rate',
        'user_satisfaction_score',
        'ai_recommendation_accuracy',
      ]);
    });

    it('部分 calculate 返回 error 标记时跳过落库，failed 记录指标名', async () => {
      // 设计原因：第 1 个指标计算失败（query 抛错 → 降级返回 tags.error=true），
      // 第 2-5 个指标正常，验证失败的指标不写入 metrics 表
      mockQuery
        // calculateEmergencyResponseTime - 抛错降级
        .mockRejectedValueOnce(new Error('DB 连接失败'))
        // calculateMatchSuccessRate
        .mockResolvedValueOnce({ rows: [{ clicks: '80', orders: '20', total: '100' }] })
        // calculateOrderCompletionRate
        .mockResolvedValueOnce({ rows: [{ total: '50', completed: '40' }] })
        // calculateUserSatisfactionScore
        .mockResolvedValueOnce({ rows: [{ avg_rating: '4.5', total_reviews: '120' }] })
        // calculateAIRecommendationAccuracy
        .mockResolvedValueOnce({ rows: [{ total: '200', clicks: '60' }] });
      mockRecordMetric.mockResolvedValue(undefined);

      const result = await recordAllMetrics();

      expect(result.recorded).toBe(4);
      expect(result.failed).toBe(1);
      expect(result.failedNames).toEqual(['emergency_response_time']);
      // 失败的指标不调用 recordMetric
      expect(mockRecordMetric).toHaveBeenCalledTimes(4);
      const calledNames = mockRecordMetric.mock.calls.map((c) => c[0]);
      expect(calledNames).not.toContain('emergency_response_time');
    });

    it('recordMetric 抛错时不阻塞后续指标采集', async () => {
      // 设计原因：recordMetric 内部已有 try/catch 不会抛错，此处防御性测试验证外层 catch 兜底
      mockQuery
        .mockResolvedValueOnce({ rows: [{ avg_seconds: '120' }] })
        .mockResolvedValueOnce({ rows: [{ clicks: '80', orders: '20', total: '100' }] })
        .mockResolvedValueOnce({ rows: [{ total: '50', completed: '40' }] })
        .mockResolvedValueOnce({ rows: [{ avg_rating: '4.5', total_reviews: '120' }] })
        .mockResolvedValueOnce({ rows: [{ total: '200', clicks: '60' }] });
      // 第 2 个指标的 recordMetric 抛错，验证不阻塞后续 3 个
      mockRecordMetric
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Redis 不可用'))
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const result = await recordAllMetrics();

      expect(result.recorded).toBe(4);
      expect(result.failed).toBe(1);
      expect(result.failedNames).toEqual(['match_success_rate']);
      // 所有 5 个指标的 calculate 都被调用（串行不中断）
      expect(mockQuery).toHaveBeenCalledTimes(5);
    });
  });
});
