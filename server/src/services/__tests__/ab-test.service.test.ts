/**
 * ab-test.service 单元测试
 *
 * 测试目标：
 * - getTestConfig：缓存命中/未命中、DB 查不到抛 NotFoundError
 * - getAllTestConfigs：缓存命中/未命中、返回数组
 * - assignVariant：测试未激活抛错、正常分配变体、哈希一致性
 * - recordEvent：INSERT 参数透传、metadata 为 undefined 时落 null
 * - getTestResults：变体统计计算、转化率计算、totalParticipants 转换
 * - calculateConversionRate：有/无 impressions 的转化率计算、精度验证
 *
 * 测试策略：
 * - mock database 的 query、redis 的 getCache/setCache、logger
 * - crypto 用真实实现，hashAssign 作为纯函数通过 assignVariant 间接验证
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

// mock redis：getCache 默认返回 null（缓存未命中），setCache 直接返回
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

import { abTestService } from '../ab-test.service';
import { NotFoundError, BadRequestError } from '../../utils/errors';

// 构造完整的 TestConfig 测试数据，供多个测试复用
function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    test_name: 'homepage_test',
    description: '首页 A/B 测试',
    variants: { control: 50, treatment: 50 },
    status: 'active',
    start_date: '2026-01-01',
    end_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetCache.mockReset();
  mockSetCache.mockReset();
  // 默认缓存未命中
  mockGetCache.mockResolvedValue(null);
  mockSetCache.mockResolvedValue(undefined);
});

describe('ab-test.service getTestConfig', () => {
  it('缓存命中直接返回（不查 DB）', async () => {
    const cachedConfig = makeConfig();
    mockGetCache.mockResolvedValueOnce(cachedConfig);

    const result = await abTestService.getTestConfig('homepage_test');

    expect(result).toEqual(cachedConfig);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('缓存未命中查 DB，存在则返回并写缓存', async () => {
    const dbConfig = makeConfig();
    mockQuery.mockResolvedValueOnce({ rows: [dbConfig] });

    const result = await abTestService.getTestConfig('homepage_test');

    expect(result).toEqual(dbConfig);
    // 验证写缓存被调用
    expect(mockSetCache).toHaveBeenCalledTimes(1);
    // 验证 SQL 含 test_name 参数
    expect(mockQuery.mock.calls[0][1]).toContain('homepage_test');
  });

  it('缓存未命中查 DB，不存在抛 NotFoundError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(abTestService.getTestConfig('not-exist')).rejects.toThrow(NotFoundError);
    // 查不到不应写缓存
    expect(mockSetCache).not.toHaveBeenCalled();
  });
});

describe('ab-test.service getAllTestConfigs', () => {
  it('缓存命中直接返回数组', async () => {
    const cachedConfigs = [makeConfig(), makeConfig({ id: 2, test_name: 'second_test' })];
    mockGetCache.mockResolvedValueOnce(cachedConfigs);

    const result = await abTestService.getAllTestConfigs();

    expect(result).toEqual(cachedConfigs);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('缓存未命中查 DB 返回数组并写缓存', async () => {
    const dbConfigs = [makeConfig()];
    mockQuery.mockResolvedValueOnce({ rows: dbConfigs });

    const result = await abTestService.getAllTestConfigs();

    expect(result).toEqual(dbConfigs);
    expect(mockSetCache).toHaveBeenCalledTimes(1);
    // 验证 SQL 含 ORDER BY created_at DESC
    expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY created_at DESC');
  });

  it('SQL 含 LIMIT 100 防御性约束，避免配置异常膨胀拖垮后台渲染', async () => {
    // 设计原因：AB 测试配置正常 < 20，超限通常意味着脏数据，
    // 提前截断避免单次查询返回过多行拖垮后台渲染
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await abTestService.getAllTestConfigs();

    expect(mockQuery.mock.calls[0][0]).toContain('LIMIT 100');
  });
});

describe('ab-test.service assignVariant', () => {
  it('测试未激活抛 BadRequestError', async () => {
    // getTestConfig 缓存命中，返回 inactive 配置
    mockGetCache.mockResolvedValueOnce(makeConfig({ status: 'inactive' }));

    await expect(abTestService.assignVariant('homepage_test', 'user-1')).rejects.toThrow(BadRequestError);
  });

  it('测试激活时正常分配变体（验证返回 variant 和 testName）', async () => {
    mockGetCache.mockResolvedValueOnce(makeConfig({ status: 'active' }));

    const result = await abTestService.assignVariant('homepage_test', 'user-1');

    expect(result.testName).toBe('homepage_test');
    // variant 应为配置中的某个变体（control 或 treatment）
    expect(['control', 'treatment']).toContain(result.variant);
  });

  it('相同 userId+testName 分配结果一致（哈希一致性）', async () => {
    mockGetCache.mockResolvedValue(makeConfig({ status: 'active' }));

    const result1 = await abTestService.assignVariant('homepage_test', 'user-1');
    const result2 = await abTestService.assignVariant('homepage_test', 'user-1');

    // 相同输入应产出相同变体（MD5 哈希确定性）
    expect(result1.variant).toBe(result2.variant);
  });
});

describe('ab-test.service recordEvent', () => {
  it('正常记录事件（验证 INSERT 参数透传）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await abTestService.recordEvent('homepage_test', 'user-1', 'control', 'impression');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[0]).toContain('INSERT INTO ab_test_results');
    // 参数顺序：testName, userId, variant, eventType, metadata
    expect(callArgs[1][0]).toBe('homepage_test');
    expect(callArgs[1][1]).toBe('user-1');
    expect(callArgs[1][2]).toBe('control');
    expect(callArgs[1][3]).toBe('impression');
    // 无 metadata 时第5参数为 null
    expect(callArgs[1][4]).toBeNull();
  });

  it('metadata 存在时转为 JSON string', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await abTestService.recordEvent('homepage_test', 'user-1', 'control', 'conversion', { source: 'button' });

    const callArgs = mockQuery.mock.calls[0];
    // metadata 应被 JSON.stringify
    expect(callArgs[1][4]).toBe(JSON.stringify({ source: 'button' }));
  });

  it('非法 eventType 抛 BadRequestError，避免脏数据污染下游聚合', async () => {
    // 白名单防御：任意字符串会写入 ab_test_results，
    // 下游 GROUP BY event_type 会产生未预期分组，影响 A/B 测试结果可信度
    await expect(
      abTestService.recordEvent('homepage_test', 'user-1', 'control', 'malicious_event'),
    ).rejects.toThrow(BadRequestError);
    // 抛错时不应触发 DB 写入
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('ab-test.service getTestResults', () => {
  it('正常计算变体统计与转化率', async () => {
    // getTestConfig 缓存命中
    mockGetCache.mockResolvedValueOnce(makeConfig({ variants: { control: 50, treatment: 50 } }));
    // 参与者总数查询
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '180' }] }) // COUNT DISTINCT
      .mockResolvedValueOnce({
        rows: [
          { variant: 'control', event_type: 'impression', cnt: '100' },
          { variant: 'control', event_type: 'conversion', cnt: '10' },
          { variant: 'treatment', event_type: 'impression', cnt: '80' },
          { variant: 'treatment', event_type: 'conversion', cnt: '8' },
        ],
      });

    const result = await abTestService.getTestResults('homepage_test');

    expect(result.testName).toBe('homepage_test');
    expect(result.totalParticipants).toBe(180);
    // control: 10/100 * 100 = 10%
    const control = result.variants.find((v) => v.variant === 'control');
    expect(control?.eventCounts['impression']).toBe(100);
    expect(control?.eventCounts['conversion']).toBe(10);
    expect(control?.conversionRate).toBe(10);
    // treatment: 8/80 * 100 = 10%
    const treatment = result.variants.find((v) => v.variant === 'treatment');
    expect(treatment?.conversionRate).toBe(10);
  });

  it('无事件数据时转化率为 0', async () => {
    mockGetCache.mockResolvedValueOnce(makeConfig());
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] }); // 无事件统计

    const result = await abTestService.getTestResults('homepage_test');

    expect(result.totalParticipants).toBe(0);
    // 所有变体转化率应为 0
    for (const v of result.variants) {
      expect(v.conversionRate).toBe(0);
      expect(v.totalEvents).toBe(0);
    }
  });

  it('totalParticipants 为 null 时转换为 0', async () => {
    mockGetCache.mockResolvedValueOnce(makeConfig());
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // total 查询无结果
      .mockResolvedValueOnce({ rows: [] });

    const result = await abTestService.getTestResults('homepage_test');

    // participantsResult.rows[0]?.total || 0 → 0
    expect(result.totalParticipants).toBe(0);
  });

  it('聚合 SQL 含 90 天时间窗，避免长跑测试累积事件全表扫描', async () => {
    // 防御性断言：长跑 A/B 测试累积事件后，COUNT DISTINCT user_id 与 GROUP BY 会全表扫描
    // 加 90 天时间窗覆盖近一季度数据，满足 dashboard 场景
    mockGetCache.mockResolvedValueOnce(makeConfig());
    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] });

    await abTestService.getTestResults('homepage_test');

    const participantsSql = mockQuery.mock.calls[0][0] as string;
    const statsSql = mockQuery.mock.calls[1][0] as string;
    expect(participantsSql).toContain("created_at >= NOW() - INTERVAL '90 days'");
    expect(statsSql).toContain("created_at >= NOW() - INTERVAL '90 days'");
  });
});

describe('ab-test.service calculateConversionRate', () => {
  it('有 impressions 和 conversions 时计算转化率', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ impressions: '200', conversions: '15' }],
    });

    const rate = await abTestService.calculateConversionRate('homepage_test', 'control');

    // 15/200 * 100 = 7.5%
    expect(rate).toBe(7.5);
  });

  it('无 impressions 时转化率为 0', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ impressions: '0', conversions: '0' }],
    });

    const rate = await abTestService.calculateConversionRate('homepage_test', 'control');

    expect(rate).toBe(0);
  });

  it('验证精度保留两位小数（Math.round * 10000 / 100）', async () => {
    // 1/3 * 100 = 33.333...%，Math.round(33.333... * 10000) / 100 = 33.33
    mockQuery.mockResolvedValueOnce({
      rows: [{ impressions: '3', conversions: '1' }],
    });

    const rate = await abTestService.calculateConversionRate('homepage_test', 'control');

    expect(rate).toBe(33.33);
  });
});
