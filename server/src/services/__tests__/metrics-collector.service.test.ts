/**
 * metrics-collector.service 单元测试
 *
 * 测试目标：
 * - recordMetric：INSERT 参数透传、tags JSON.stringify、query 抛错时 catch 吞错
 * - getMetricSummary：动态 WHERE 条件构建（无日期/startDate/endDate）、parseFloat+parseInt 转换
 * - getMetricTrend：动态 WHERE + granularity 映射（day/week/month）
 * - getDashboardMetrics：缓存命中/未命中、setCache 写入
 * - getLatestMetrics（通过 getDashboardMetrics 间接测试）：tags null 兜底、recorded_at 字段映射
 *
 * 测试策略：
 * - mock database 的 query、redis 的 getCache/setCache、logger
 * - 按 query 调用顺序用 mockResolvedValueOnce 模拟不同场景的返回
 * - 通过 SQL 字符串断言验证动态 WHERE 条件构建逻辑
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
  // SqlParam 为类型，运行时无需提供实现
  SqlParam: {},
}));

// mock redis：getCache 默认返回 null（缓存未命中），setCache 直接 resolve
const { mockGetCache, mockSetCache } = vi.hoisted(() => ({
  mockGetCache: vi.fn(),
  mockSetCache: vi.fn(),
}));

vi.mock('../../config/redis', () => ({
  getCache: mockGetCache,
  setCache: mockSetCache,
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

import { recordMetric, getMetricSummary, getMetricTrend, getDashboardMetrics, METRIC_NAMES } from '../metrics-collector.service';

describe('metrics-collector.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCache.mockResolvedValue(null);
    mockSetCache.mockResolvedValue(undefined);
  });

  describe('recordMetric', () => {
    it('正常写入：INSERT 参数透传，tags 经 JSON.stringify 序列化', async () => {
      // 设计原因：tags 是 Record 类型，PostgreSQL JSONB 列需字符串化写入
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordMetric('response_time', 123.45, { endpoint: '/api/users', method: 'GET' });

      expect(mockQuery).toHaveBeenCalledWith(
        'INSERT INTO metrics (name, value, tags) VALUES ($1, $2, $3)',
        ['response_time', 123.45, JSON.stringify({ endpoint: '/api/users', method: 'GET' })]
      );
    });

    it('tags 为空对象时仍调用 JSON.stringify（写入 "{}"）', async () => {
      // 设计原因：默认参数为 {}，验证默认值经序列化后为 "{}" 字符串
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await recordMetric('response_time', 50);

      expect(mockQuery).toHaveBeenCalledWith(
        'INSERT INTO metrics (name, value, tags) VALUES ($1, $2, $3)',
        ['response_time', 50, '{}']
      );
    });

    it('query 抛错时 catch 吞错，不向上抛出', async () => {
      // 设计原因：指标记录为辅助流程，失败不应影响主业务，必须吞错
      mockQuery.mockRejectedValueOnce(new Error('DB 连接失败'));

      // 不应抛出
      await expect(recordMetric('response_time', 50)).resolves.toBeUndefined();
    });
  });

  describe('getMetricSummary', () => {
    it('无日期范围时 SQL 仅含 name 条件，params 仅 [name]', async () => {
      // 设计原因：动态 WHERE 构建，无日期时不应产生额外的占位符
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg: '123.45', min: '10', max: '200', count: '5' }],
      });

      const result = await getMetricSummary('response_time');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('WHERE name = $1');
      expect(sql).not.toContain('recorded_at');
      expect(params).toEqual(['response_time']);
      // string → number 转换
      expect(result).toEqual({ name: 'response_time', avg: 123.45, min: 10, max: 200, count: 5 });
    });

    it('有 startDate 时 SQL 含 recorded_at >= $2，params 含 startDate', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg: '50', min: '10', max: '100', count: '3' }],
      });

      await getMetricSummary('response_time', '2026-01-01');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('recorded_at >= $2');
      expect(params).toEqual(['response_time', '2026-01-01']);
    });

    it('有 startDate 和 endDate 时 SQL 含两个日期条件，paramIndex 递增', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg: '50', min: '10', max: '100', count: '3' }],
      });

      await getMetricSummary('response_time', '2026-01-01', '2026-01-31');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('recorded_at >= $2');
      expect(sql).toContain('recorded_at <= $3');
      expect(params).toEqual(['response_time', '2026-01-01', '2026-01-31']);
    });

    it('仅有 endDate 时 paramIndex 从 $2 开始', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ avg: '0', min: '0', max: '0', count: '0' }],
      });

      await getMetricSummary('response_time', undefined, '2026-01-31');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).not.toContain('recorded_at >= $2');
      expect(sql).toContain('recorded_at <= $2');
      expect(params).toEqual(['response_time', '2026-01-31']);
    });
  });

  describe('getMetricTrend', () => {
    it('默认 granularity=day 时 SQL 含 DATE_TRUNC(\'day\')', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ date: '2026-01-01', value: '100' }, { date: '2026-01-02', value: '200' }],
      });

      const result = await getMetricTrend('response_time');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("DATE_TRUNC('day'");
      expect(result).toEqual([{ date: '2026-01-01', value: 100 }, { date: '2026-01-02', value: 200 }]);
    });

    it('granularity=week 时 SQL 含 DATE_TRUNC(\'week\')', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getMetricTrend('response_time', undefined, undefined, 'week');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("DATE_TRUNC('week'");
    });

    it('granularity=month 时 SQL 含 DATE_TRUNC(\'month\')', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getMetricTrend('response_time', undefined, undefined, 'month');

      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("DATE_TRUNC('month'");
    });

    it('非法 granularity 回退为 day，避免 DATE_TRUNC(\'undefined\') 触发 500', async () => {
      // 防御性校验：route 层 as 断言可能放过非法值，service 层必须兜底
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getMetricTrend('response_time', undefined, undefined, 'hour');

      const [sql] = mockQuery.mock.calls[0];
      // 非法值 'hour' 应被回退为 'day'，SQL 不应出现 'undefined' 或 'hour'
      expect(sql).toContain("DATE_TRUNC('day'");
      expect(sql).not.toContain('undefined');
      expect(sql).not.toContain("'hour'");
    });

    it('有日期范围时 WHERE 条件正确拼接', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getMetricTrend('response_time', '2026-01-01', '2026-01-31', 'day');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('recorded_at >= $2');
      expect(sql).toContain('recorded_at <= $3');
      expect(params).toEqual(['response_time', '2026-01-01', '2026-01-31']);
    });
  });

  describe('getDashboardMetrics', () => {
    it('缓存命中时直接返回缓存值，不查 DB', async () => {
      // 设计原因：仪表盘数据访问频繁，缓存命中必须跳过 DB 查询
      const cached = [{ name: 'response_time', value: 100, tags: {}, recordedAt: '2026-01-01' }];
      mockGetCache.mockResolvedValueOnce(cached);

      const result = await getDashboardMetrics();

      expect(result).toEqual(cached);
      expect(mockQuery).not.toHaveBeenCalled();
      // 缓存命中不应回写
      expect(mockSetCache).not.toHaveBeenCalled();
    });

    it('缓存未命中时查 DB 并写入缓存（TTL=60）', async () => {
      const dbRows = [{
        name: 'response_time',
        value: '123.45',
        tags: { endpoint: '/api' },
        recorded_at: '2026-01-01T00:00:00Z',
      }];
      mockQuery.mockResolvedValueOnce({ rows: dbRows });

      const result = await getDashboardMetrics();

      // value string→number 转换、recorded_at→recordedAt 映射
      expect(result).toEqual([{
        name: 'response_time',
        value: 123.45,
        tags: { endpoint: '/api' },
        recordedAt: '2026-01-01T00:00:00Z',
      }]);
      // 写入缓存，TTL 为 60 秒
      expect(mockSetCache).toHaveBeenCalledWith('metrics:dashboard', result, 60);
    });

    it('DB 返回 tags 为 null 时兜底为空对象 {}', async () => {
      // 设计原因：DB 的 JSONB 列可能为 null，前端期望 tags 始终为对象
      mockQuery.mockResolvedValueOnce({
        rows: [{ name: 'response_time', value: '50', tags: null, recorded_at: '2026-01-01' }],
      });

      const result = await getDashboardMetrics();

      expect(result[0].tags).toEqual({});
    });

    it('缓存键为 metrics:dashboard', async () => {
      // 设计原因：缓存键名是隔离基础，变更会导致缓存失效
      mockGetCache.mockResolvedValueOnce(null);
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await getDashboardMetrics();

      expect(mockGetCache).toHaveBeenCalledWith('metrics:dashboard');
    });
  });

  describe('METRIC_NAMES 常量', () => {
    it('应包含 5 个核心指标名称', () => {
      // 设计原因：指标名称常量是 getLatestMetrics 查询的基础，变更需测试锁定
      expect(Object.keys(METRIC_NAMES)).toHaveLength(5);
      expect(METRIC_NAMES.EMERGENCY_RESPONSE_TIME).toBe('emergency_response_time');
      expect(METRIC_NAMES.MATCH_SUCCESS_RATE).toBe('match_success_rate');
      expect(METRIC_NAMES.ORDER_COMPLETION_RATE).toBe('order_completion_rate');
      expect(METRIC_NAMES.USER_SATISFACTION_SCORE).toBe('user_satisfaction_score');
      expect(METRIC_NAMES.AI_RECOMMENDATION_ACCURACY).toBe('ai_recommendation_accuracy');
    });
  });
});
