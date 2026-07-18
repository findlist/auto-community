import crypto from 'crypto';
import { query } from '../config/database';
import { getCache, setCache } from '../config/redis';
import { NotFoundError, BadRequestError } from '../utils/errors';
import { logger } from '../utils/logger';

const CACHE_TTL = 300;
const CACHE_PREFIX = 'ab_test:';

// eventType 白名单：INSERT 前校验避免脏数据污染 getTestResults 聚合
// 设计原因：参数化 SQL 已无注入风险，但任意字符串会写入 ab_test_results，
// 下游聚合 GROUP BY event_type 会产生未预期分组，影响 A/B 测试结果可信度
const ALLOWED_EVENT_TYPES = ['impression', 'click', 'conversion', 'order', 'dismiss'] as const;

// 结果聚合时间窗：90 天覆盖长跑测试，避免历史事件累积导致 COUNT DISTINCT 全表扫描
const RESULT_LOOKBACK_INTERVAL = "INTERVAL '90 days'";

interface TestConfig {
  id: number;
  test_name: string;
  description: string;
  variants: Record<string, number>;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

interface VariantStats {
  variant: string;
  eventCounts: Record<string, number>;
  totalEvents: number;
  conversionRate: number;
}

interface TestResults {
  testName: string;
  variants: VariantStats[];
  totalParticipants: number;
}

export async function getTestConfig(testName: string): Promise<TestConfig> {
  const cacheKey = `${CACHE_PREFIX}config:${testName}`;
  const cached = await getCache<TestConfig>(cacheKey);
  if (cached) return cached;

  const result = await query(
    `SELECT id, test_name, description, variants, status, start_date, end_date, created_at, updated_at
     FROM ab_test_configs WHERE test_name = $1`,
    [testName],
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('A/B 测试配置');
  }

  const config = result.rows[0] as TestConfig;
  await setCache(cacheKey, config, CACHE_TTL);
  return config;
}

export async function getAllTestConfigs(): Promise<TestConfig[]> {
  const cacheKey = `${CACHE_PREFIX}configs:all`;
  const cached = await getCache<TestConfig[]>(cacheKey);
  if (cached) return cached;

  const result = await query(
    `SELECT id, test_name, description, variants, status, start_date, end_date, created_at, updated_at
     FROM ab_test_configs ORDER BY created_at DESC LIMIT 100`,
  );

  const configs = result.rows as TestConfig[];
  await setCache(cacheKey, configs, CACHE_TTL);
  return configs;
}

export async function assignVariant(testName: string, userId: string): Promise<{ variant: string; testName: string }> {
  const config = await getTestConfig(testName);

  if (config.status !== 'active') {
    throw new BadRequestError('该测试当前未激活');
  }

  const variant = hashAssign(userId, testName, config.variants);
  return { variant, testName };
}

export async function recordEvent(
  testName: string,
  userId: string,
  variant: string,
  eventType: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // eventType 白名单校验：避免任意字符串污染下游聚合
  if (!ALLOWED_EVENT_TYPES.includes(eventType as (typeof ALLOWED_EVENT_TYPES)[number])) {
    throw new BadRequestError(`不支持的 eventType：${eventType}`);
  }

  await query(
    `INSERT INTO ab_test_results (test_name, user_id, variant, event_type, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [testName, userId, variant, eventType, metadata ? JSON.stringify(metadata) : null],
  );

  logger.debug({ testName, userId, variant, eventType }, '[AB Test] 事件已记录');
}

export async function getTestResults(testName: string): Promise<TestResults> {
  const config = await getTestConfig(testName);

  // 加 90 天时间窗：避免长跑测试累积事件导致 COUNT DISTINCT 全表扫描
  const participantsResult = await query(
    `SELECT COUNT(DISTINCT user_id) AS total FROM ab_test_results
     WHERE test_name = $1 AND created_at >= NOW() - ${RESULT_LOOKBACK_INTERVAL}`,
    [testName],
  );

  const statsResult = await query(
    `SELECT variant, event_type, COUNT(*) AS cnt
     FROM ab_test_results
     WHERE test_name = $1 AND created_at >= NOW() - ${RESULT_LOOKBACK_INTERVAL}
     GROUP BY variant, event_type
     ORDER BY variant, event_type`,
    [testName],
  );

  const variantMap = new Map<string, Record<string, number>>();

  for (const row of statsResult.rows) {
    const v = row.variant as string;
    if (!variantMap.has(v)) variantMap.set(v, {});
    variantMap.get(v)![row.event_type as string] = Number(row.cnt);
  }

  const variants: VariantStats[] = Object.keys(config.variants).map((variant) => {
    const eventCounts = variantMap.get(variant) || {};
    const totalEvents = Object.values(eventCounts).reduce((sum, cnt) => sum + cnt, 0);
    const impressions = eventCounts['impression'] || 0;
    const conversions = eventCounts['conversion'] || 0;
    const conversionRate = impressions > 0 ? Math.round((conversions / impressions) * 10000) / 100 : 0;

    return { variant, eventCounts, totalEvents, conversionRate };
  });

  return {
    testName,
    variants,
    totalParticipants: Number(participantsResult.rows[0]?.total || 0),
  };
}

export async function calculateConversionRate(testName: string, variant: string): Promise<number> {
  // 加 90 天时间窗：与 getTestResults 保持一致，避免历史事件累积全表扫描
  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'impression') AS impressions,
       COUNT(*) FILTER (WHERE event_type = 'conversion') AS conversions
     FROM ab_test_results
     WHERE test_name = $1 AND variant = $2 AND created_at >= NOW() - ${RESULT_LOOKBACK_INTERVAL}`,
    [testName, variant],
  );

  const row = result.rows[0];
  const impressions = Number(row?.impressions || 0);
  const conversions = Number(row?.conversions || 0);

  return impressions > 0 ? Math.round((conversions / impressions) * 10000) / 100 : 0;
}

function hashAssign(userId: string, testName: string, variants: Record<string, number>): string {
  const hash = crypto.createHash('md5').update(`${userId}:${testName}`).digest('hex');
  const hashNum = parseInt(hash.substring(0, 8), 16);
  const bucket = hashNum % 100;

  let cumulative = 0;
  for (const [variantName, weight] of Object.entries(variants)) {
    cumulative += weight;
    if (bucket < cumulative) return variantName;
  }

  return Object.keys(variants)[0];
}

export const abTestService = {
  getTestConfig,
  getAllTestConfigs,
  assignVariant,
  recordEvent,
  getTestResults,
  calculateConversionRate,
};
