/**
 * metrics-calculation.service 单元测试
 *
 * 测试目标：
 * - calculateEmergencyResponseTime：正常计算平均响应秒数 / query 抛错降级
 * - calculateMatchSuccessRate：正常计算 orders/total*100 / total=0 降级 / query 抛错降级
 * - calculateOrderCompletionRate：正常计算 completed/total*100 / query 抛错降级
 * - calculateUserSatisfactionScore：正常计算平均评分 / query 抛错降级
 * - calculateAIRecommendationAccuracy：正常计算 clicks/total*100 / query 抛错降级
 *
 * 测试策略：
 * - mock database 的 query、logger
 * - 每个计算函数都有 try/catch 降级路径，验证抛错时返回 {value:0, tags:{error:true}}
 * - 验证 parseInt/parseFloat 的 string→number 转换与 || 兜底逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database：query 为可控 mock
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
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

import {
  calculateEmergencyResponseTime,
  calculateMatchSuccessRate,
  calculateOrderCompletionRate,
  calculateUserSatisfactionScore,
  calculateAIRecommendationAccuracy,
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
});
