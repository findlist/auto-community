import { query, SqlParam } from '../config/database';
import { getCache, setCache } from '../config/redis';
import { logger } from '../utils/logger';

// 核心指标名称常量
export const METRIC_NAMES = {
  EMERGENCY_RESPONSE_TIME: 'emergency_response_time',
  MATCH_SUCCESS_RATE: 'match_success_rate',
  ORDER_COMPLETION_RATE: 'order_completion_rate',
  USER_SATISFACTION_SCORE: 'user_satisfaction_score',
  AI_RECOMMENDATION_ACCURACY: 'ai_recommendation_accuracy',
} as const;

export type MetricName = typeof METRIC_NAMES[keyof typeof METRIC_NAMES];

// 指标汇总数据类型
export interface MetricSummary {
  name: string;
  avg: number;
  min: number;
  max: number;
  count: number;
}

// 指标趋势数据类型
export interface MetricTrendItem {
  date: string;
  value: number;
}

// 仪表盘指标数据类型
export interface DashboardMetric {
  name: string;
  value: number;
  // tags 来自 DB 的 JSONB 字段，结构由写入方决定，工具层无法预知具体形状
  // 用 unknown 替代 any 强制消费方在使用时做类型断言，比 any 更安全
  tags: Record<string, unknown>;
  recordedAt: string;
}

// Redis 缓存键前缀
const DASHBOARD_CACHE_KEY = 'metrics:dashboard';
const DASHBOARD_CACHE_TTL = 60;

// 异步写入指标数据，不阻塞主业务流程
// tags: unknown 与 DashboardMetric.tags 保持一致，写入前由 JSON.stringify 序列化
export async function recordMetric(
  name: string,
  value: number,
  tags: Record<string, unknown> = {}
): Promise<void> {
  try {
    await query(
      'INSERT INTO metrics (name, value, tags) VALUES ($1, $2, $3)',
      [name, value, JSON.stringify(tags)]
    );
    logger.debug({ name, value, tags }, '指标数据已记录');
  } catch (error) {
    logger.error({ err: error, name, value, tags }, '记录指标数据失败');
  }
}

// 默认时间窗 90 天：未传 startDate 时强制约束，避免 metrics 表全量扫描
// 设计原因：调用方未传日期时全表 AVG/COUNT 聚合在指标累积后会拖垮 DB，90 天覆盖近一季度数据满足 dashboard 场景
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_LOOKBACK_MS = DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

// 获取指标汇总数据（avg, min, max, count）
export async function getMetricSummary(
  name: string,
  startDate?: string,
  endDate?: string
): Promise<MetricSummary> {
  const conditions: string[] = ['name = $1'];
  // params 仅承载 string 类型入参（name/startDate/endDate），用 SqlParam 收紧以对齐 query 函数签名
  const params: SqlParam[] = [name];
  let paramIndex = 2;

  // 未传 startDate 时回退到 90 天前：避免 metrics 表全表扫描聚合
  const effectiveStart = startDate ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
  conditions.push(`recorded_at >= $${paramIndex++}`);
  params.push(effectiveStart);

  if (endDate) {
    conditions.push(`recorded_at <= $${paramIndex++}`);
    params.push(endDate);
  }

  const whereClause = conditions.join(' AND ');

  const { rows } = await query(
    `SELECT
       COALESCE(AVG(value), 0) as avg,
       COALESCE(MIN(value), 0) as min,
       COALESCE(MAX(value), 0) as max,
       COUNT(*) as count
     FROM metrics
     WHERE ${whereClause}`,
    params
  );

  const row = rows[0];
  return {
    name,
    avg: parseFloat(row.avg),
    min: parseFloat(row.min),
    max: parseFloat(row.max),
    count: parseInt(row.count, 10),
  };
}

// 获取指标趋势数据（时间序列）
export async function getMetricTrend(
  name: string,
  startDate?: string,
  endDate?: string,
  // 放宽为 string 接受 route 层透传的未断言值，内部通过 ALLOWED_GRANULARITIES 校验兜底
  granularity: string = 'day'
): Promise<MetricTrendItem[]> {
  const conditions: string[] = ['name = $1'];
  // params 仅承载 string 类型入参（name/startDate/endDate），用 SqlParam 收紧以对齐 query 函数签名
  const params: SqlParam[] = [name];
  let paramIndex = 2;

  // 未传 startDate 时回退到 90 天前：与 getMetricSummary 保持一致，避免趋势查询全表扫描
  const effectiveStart = startDate ?? new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
  conditions.push(`recorded_at >= $${paramIndex++}`);
  params.push(effectiveStart);

  if (endDate) {
    conditions.push(`recorded_at <= $${paramIndex++}`);
    params.push(endDate);
  }

  const whereClause = conditions.join(' AND ');

  // 防御性校验：route 层用 as 断言绕过了 TS 类型检查，非法 granularity 值
  // 会导致 dateTruncMap 查找不到返回 undefined，进而生成 DATE_TRUNC('undefined', ...) 触发 500。
  // 此处做 defense-in-depth：未映射值统一回退为 'day'，保证 SQL 始终合法
  const ALLOWED_GRANULARITIES = ['day', 'week', 'month'] as const;
  const safeGranularity = ALLOWED_GRANULARITIES.includes(granularity as (typeof ALLOWED_GRANULARITIES)[number])
    ? granularity
    : 'day';
  const truncUnit = safeGranularity;

  const { rows } = await query(
    `SELECT
       TO_CHAR(DATE_TRUNC('${truncUnit}', recorded_at), 'YYYY-MM-DD') as date,
       AVG(value) as value
     FROM metrics
     WHERE ${whereClause}
     GROUP BY DATE_TRUNC('${truncUnit}', recorded_at)
     ORDER BY DATE_TRUNC('${truncUnit}', recorded_at)`,
    params
  );

  return rows.map((row) => ({
    date: row.date,
    value: parseFloat(row.value),
  }));
}

// 获取所有核心指标的最新值
async function getLatestMetrics(): Promise<DashboardMetric[]> {
  const metricNames = Object.values(METRIC_NAMES);

  const { rows } = await query(
    `SELECT DISTINCT ON (name)
       name,
       value,
       tags,
       recorded_at
     FROM metrics
     WHERE name = ANY($1)
     ORDER BY name, recorded_at DESC`,
    [metricNames]
  );

  return rows.map((row) => ({
    name: row.name,
    value: parseFloat(row.value),
    tags: row.tags || {},
    recordedAt: row.recorded_at,
  }));
}

// 获取仪表盘指标数据（带 Redis 缓存）
export async function getDashboardMetrics(): Promise<DashboardMetric[]> {
  const cached = await getCache<DashboardMetric[]>(DASHBOARD_CACHE_KEY);
  if (cached) {
    return cached;
  }

  const metrics = await getLatestMetrics();

  await setCache(DASHBOARD_CACHE_KEY, metrics, DASHBOARD_CACHE_TTL);

  return metrics;
}

export const metricsCollectorService = {
  recordMetric,
  getMetricSummary,
  getMetricTrend,
  getDashboardMetrics,
};
