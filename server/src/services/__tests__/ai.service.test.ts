/**
 * ai.service 单元测试
 *
 * 测试目标：
 * - 智能匹配降级路径：帖子不存在 / 无候选 / control 变体类别匹配 / treatment 变体 LLM 失败降级
 * - 需求分类降级：LLM 失败时关键词匹配
 * - 安全风控：正常用户 / 高频下单异常（规则评分降级）
 * - cosineSimilarity 纯函数
 *
 * 测试策略：mock database query / ab-test.service / logger，
 *           AI_API_KEY 在测试环境为空，callLLM/generateEmbedding 自动返回 null 触发降级。
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';
// AI_API_KEY 不设置，触发所有 LLM/Embedding 调用降级

// mock database 模块：query 由测试按 SQL 内容控制返回值
vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: {},
}));

// mock ab-test.service：assignVariant/recordEvent 由测试控制变体
vi.mock('../ab-test.service', () => ({
  assignVariant: vi.fn(),
  recordEvent: vi.fn().mockResolvedValue(undefined),
}));

// mock logger，避免测试输出噪音
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { aiService, matchSkill, matchTimeService, classifyContent, detectAbnormalBehavior, cosineSimilarity } from '../ai.service';
import { query } from '../../config/database';
import { assignVariant } from '../ab-test.service';

const mockedQuery = vi.mocked(query);
const mockedAssignVariant = vi.mocked(assignVariant);

/**
 * 按 SQL 关键词路由 query 返回值
 * 设计原因：ai.service 多处调用 query 但 SQL 不同，用 includes 区分比按调用顺序更稳健
 */
function mockQueryBySql(resolvers: Array<{ match: string; rows: unknown[] }>) {
  mockedQuery.mockImplementation(async (sql: string) => {
    for (const r of resolvers) {
      if (sql.includes(r.match)) {
        return { rows: r.rows } as never;
      }
    }
    return { rows: [] } as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认变体为 control（仅类别匹配，不依赖 embedding/LLM）
  mockedAssignVariant.mockResolvedValue({ variant: 'control', userId: 'user-1' } as never);
});

describe('ai.service - cosineSimilarity', () => {
  it('相同向量相似度为 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('正交向量相似度为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('长度不一致返回 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('空向量返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('ai.service - classifyContent 降级', () => {
  it('LLM 失败时按关键词降级分类（家政 + high 紧急度）', async () => {
    // AI_API_KEY 为空，callLLM 直接返回 null，触发关键词降级
    const result = await classifyContent('老人发烧需要陪诊去医院');
    expect(result.category).toBe('医疗');
    expect(result.urgency).toBe('critical');
  });

  it('无匹配关键词时降级为其他/low', async () => {
    const result = await classifyContent('随便一段无关文本');
    expect(result.category).toBe('其他');
    expect(result.urgency).toBe('low');
  });

  it('维修类关键词匹配', async () => {
    const result = await classifyContent('家里水管漏水需要维修');
    // 漏水命中 high，维修命中维修类
    expect(result.category).toBe('维修');
    expect(result.urgency).toBe('high');
  });
});

describe('ai.service - matchSkill 降级路径', () => {
  it('帖子不存在时返回空数组', async () => {
    // fetchSkillPost SQL 同行含 'WHERE id = $1 AND deleted_at'，独特匹配
    mockQueryBySql([{ match: 'WHERE id = $1 AND deleted_at', rows: [] }]);
    const result = await matchSkill('post-not-exist');
    expect(result).toEqual([]);
  });

  it('帖子存在但无候选时返回空数组', async () => {
    mockQueryBySql([
      { match: 'WHERE id = $1 AND deleted_at', rows: [{ id: 'post-1', user_id: 'user-1', type: 'offer', category: '维修', title: '修水管', description: '漏水', location: null }] },
      { match: 'FROM skill_posts sp', rows: [] },
    ]);
    const result = await matchSkill('post-1');
    expect(result).toEqual([]);
  });

  it('control 变体按类别匹配降级排序', async () => {
    mockedAssignVariant.mockResolvedValue({ variant: 'control', userId: 'user-1' } as never);
    mockQueryBySql([
      {
        match: 'WHERE id = $1 AND deleted_at',
        rows: [{ id: 'post-1', user_id: 'user-1', type: 'offer', category: '维修', title: '修水管', description: '漏水', location: null }],
      },
      {
        match: 'FROM skill_posts sp',
        rows: [
          { id: 'cand-1', user_id: 'user-2', title: '我会修水管', description: '经验丰富', category: '维修', location: null, nickname: '张三', reputation_score: 8.5 },
          { id: 'cand-2', user_id: 'user-3', title: '我教数学', description: '经验丰富', category: '教育', location: null, nickname: '李四', reputation_score: 9.0 },
        ],
      },
    ]);
    const result = await matchSkill('post-1', 'user-1');
    // 类别匹配的候选应排前（matchScore 更高）
    expect(result.length).toBe(2);
    expect(result[0].userId).toBe('user-2');
    expect(result[0].matchScore).toBeGreaterThan(result[1].matchScore);
    // nickname 兜底空字符串（LEFT JOIN 命中时取实际值）
    expect(result[0].nickname).toBe('张三');
  });

  it('treatment 变体在 AI_API_KEY 为空时降级到类别匹配', async () => {
    // treatment 走完整 AI 路径，但 AI_API_KEY 为空导致 embedding/LLM 全部返回 null
    mockedAssignVariant.mockResolvedValue({ variant: 'treatment', userId: 'user-1' } as never);
    mockQueryBySql([
      {
        match: 'WHERE id = $1 AND deleted_at',
        rows: [{ id: 'post-1', user_id: 'user-1', type: 'offer', category: '维修', title: '修水管', description: '漏水', location: null }],
      },
      {
        match: 'FROM skill_posts sp',
        rows: [
          { id: 'cand-1', user_id: 'user-2', title: '我会修水管', description: '经验丰富', category: '维修', location: null, nickname: '张三', reputation_score: 8.5 },
        ],
      },
      // searchByEmbedding 内部 generateEmbedding 返回 null 后会短路返回空数组，不会再调 query
    ]);
    const result = await matchSkill('post-1', 'user-1');
    expect(result.length).toBe(1);
    expect(result[0].userId).toBe('user-2');
    // 类别匹配降级分应为 0.6
    expect(result[0].matchScore).toBeGreaterThan(0);
  });

  it('nickname 为 null 时兜底为空字符串', async () => {
    mockedAssignVariant.mockResolvedValue({ variant: 'control', userId: 'user-1' } as never);
    mockQueryBySql([
      {
        match: 'WHERE id = $1 AND deleted_at',
        rows: [{ id: 'post-1', user_id: 'user-1', type: 'offer', category: '维修', title: '修水管', description: '漏水', location: null }],
      },
      {
        match: 'FROM skill_posts sp',
        // nickname 为 null 模拟 LEFT JOIN 未命中场景
        rows: [
          { id: 'cand-1', user_id: 'user-2', title: '我会修水管', description: '经验', category: '维修', location: null, nickname: null, reputation_score: 8.5 },
        ],
      },
    ]);
    const result = await matchSkill('post-1', 'user-1');
    expect(result[0].nickname).toBe('');
  });
});

describe('ai.service - matchTimeService 降级路径', () => {
  it('服务不存在时返回空数组', async () => {
    mockQueryBySql([{ match: 'WHERE id = $1 AND deleted_at', rows: [] }]);
    const result = await matchTimeService('svc-not-exist');
    expect(result).toEqual([]);
  });

  it('服务存在但无候选时返回空数组', async () => {
    mockQueryBySql([
      { match: 'WHERE id = $1 AND deleted_at', rows: [{ id: 'svc-1', user_id: 'user-1', type: 'provide', category: '家政', title: '保洁', description: '日常保洁', location: null }] },
      { match: 'FROM time_services ts', rows: [] },
    ]);
    const result = await matchTimeService('svc-1');
    expect(result).toEqual([]);
  });

  it('control 变体按类别匹配降级', async () => {
    mockedAssignVariant.mockResolvedValue({ variant: 'control', userId: 'user-1' } as never);
    mockQueryBySql([
      {
        match: 'WHERE id = $1 AND deleted_at',
        rows: [{ id: 'svc-1', user_id: 'user-1', type: 'provide', category: '家政', title: '保洁', description: '日常保洁', location: null }],
      },
      {
        match: 'FROM time_services ts',
        rows: [
          { id: 'cand-1', user_id: 'user-2', title: '需要保洁服务', description: '周末', category: '家政', location: null, nickname: '王五', reputation_score: 7.0 },
        ],
      },
    ]);
    const result = await matchTimeService('svc-1', 'user-1');
    expect(result.length).toBe(1);
    expect(result[0].userId).toBe('user-2');
  });
});

describe('ai.service - detectAbnormalBehavior 规则降级', () => {
  it('正常用户不触发风控', async () => {
    // 订单数 2、earn 50、IP 1 均低于阈值
    mockQueryBySql([
      { match: 'FROM skill_orders', rows: [{ cnt: 1 }] },
      { match: 'FROM time_orders', rows: [{ cnt: 1 }] },
      { match: 'FROM time_transactions', rows: [{ total: 50 }] },
      { match: 'FROM audit_logs', rows: [{ cnt: 1 }] },
    ]);
    const result = await detectAbnormalBehavior('user-1');
    expect(result.isAbnormal).toBe(false);
    expect(result.score).toBeLessThan(60);
    expect(result.reason).toBe('正常');
  });

  it('高频下单触发风控规则（LLM 失败降级为规则评分）', async () => {
    // 订单数 15 > 阈值 10，触发 40 分规则；LLM 失败不会额外加分
    mockQueryBySql([
      { match: 'FROM skill_orders', rows: [{ cnt: 10 }] },
      { match: 'FROM time_orders', rows: [{ cnt: 5 }] },
      { match: 'FROM time_transactions', rows: [{ total: 50 }] },
      { match: 'FROM audit_logs', rows: [{ cnt: 1 }] },
    ]);
    const result = await detectAbnormalBehavior('user-1');
    expect(result.isAbnormal).toBe(false);
    expect(result.score).toBe(40);
    expect(result.reason).toContain('24小时内下单 15 单');
  });

  it('多指标同时触发风控', async () => {
    // 订单 15（40分）+ earn 300（30分）+ IP 5（30分）= 100 分
    mockQueryBySql([
      { match: 'FROM skill_orders', rows: [{ cnt: 10 }] },
      { match: 'FROM time_orders', rows: [{ cnt: 5 }] },
      { match: 'FROM time_transactions', rows: [{ total: 300 }] },
      { match: 'FROM audit_logs', rows: [{ cnt: 5 }] },
    ]);
    const result = await detectAbnormalBehavior('user-1');
    expect(result.isAbnormal).toBe(true);
    expect(result.score).toBe(100);
    expect(result.reason).toContain('24小时内下单 15 单');
    expect(result.reason).toContain('疑似刷分');
    expect(result.reason).toContain('疑似异常');
  });
});

describe('ai.service - aiService 导出对象', () => {
  it('aiService 导出所有核心方法', () => {
    expect(typeof aiService.matchSkill).toBe('function');
    expect(typeof aiService.matchTimeService).toBe('function');
    expect(typeof aiService.classifyContent).toBe('function');
    expect(typeof aiService.detectAbnormalBehavior).toBe('function');
    expect(typeof aiService.callLLM).toBe('function');
    expect(typeof aiService.cosineSimilarity).toBe('function');
  });
});

// ===================== callLLM / generateEmbedding 降级 =====================
describe('ai.service - callLLM 降级', () => {
  it('AI_API_KEY 为空时返回 null', async () => {
    // 测试环境未设置 AI_API_KEY，callLLM 应直接返回 null
    const result = await aiService.callLLM('测试 prompt');
    expect(result).toBeNull();
  });

  it('自定义 timeoutMs 传入时仍返回 null（API_KEY 为空短路）', async () => {
    const result = await aiService.callLLM('测试', { timeoutMs: 5000, temperature: 0.5 });
    expect(result).toBeNull();
  });
});

describe('ai.service - generateEmbedding 降级', () => {
  it('AI_API_KEY 为空时返回 null', async () => {
    const result = await aiService.generateEmbedding('测试文本');
    expect(result).toBeNull();
  });
});

// ===================== storeEmbedding =====================
describe('ai.service - storeEmbedding', () => {
  it('content_hash 相同时跳过 embedding 生成与 INSERT', async () => {
    // 模拟已有相同 hash 的记录：storeEmbedding 查到相同 hash 后直接返回
    mockQueryBySql([
      { match: 'FROM post_embeddings WHERE post_id', rows: [{ content_hash: '待匹配的 hash' }] },
    ]);
    // 由于 contentHash 由 crypto.createHash('md5').update(text).digest('hex') 计算，
    // 测试文本 'test' 的 md5 为 098f6bcd4621d373cade4e832627b4f6
    // 设置返回相同 hash 触发跳过
    mockedQuery.mockImplementation(async () => ({
      rows: [{ content_hash: '098f6bcd4621d373cade4e832627b4f6' }],
    }) as never);

    await aiService.storeEmbedding('post-1', 'skill', 'test');

    // hash 相同应只调用 1 次 query（SELECT），不触发 generateEmbedding/INSERT
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('content_hash 不同但 generateEmbedding 返回 null 时跳过 INSERT', async () => {
    // 返回不同 hash，触发 generateEmbedding 调用（API_KEY 为空返回 null），跳过 INSERT
    mockedQuery.mockResolvedValue({ rows: [{ content_hash: 'different-hash' }] } as never);

    await aiService.storeEmbedding('post-1', 'skill', 'test');

    // 应只调用 1 次 query（SELECT hash），generateEmbedding 返回 null 后不再 INSERT
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  it('query 抛错时 catch 吞错不向上抛出', async () => {
    mockedQuery.mockRejectedValue(new Error('DB 连接失败') as never);

    // storeEmbedding 内部 catch 吞错，不应向上抛出
    await expect(aiService.storeEmbedding('post-1', 'skill', 'test')).resolves.toBeUndefined();
  });
});

// ===================== searchByEmbedding =====================
describe('ai.service - searchByEmbedding', () => {
  it('AI_API_KEY 为空时返回空数组（generateEmbedding 返回 null 短路）', async () => {
    const result = await aiService.searchByEmbedding('测试', 'skill', 10);
    expect(result).toEqual([]);
    // generateEmbedding 返回 null 后不应查数据库
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});

// ===================== findNearbyResponders =====================
describe('ai.service - findNearbyResponders', () => {
  it('正常返回附近响应者（含距离转换与 point 解析）', async () => {
    mockQueryBySql([
      {
        match: 'FROM emergency_resources',
        rows: [{
          id: 'res-1', type: 'shelter', name: '社区避难所', address: '某路1号',
          location: '(116.4,39.9)', distance_degrees: '0.001',
        }],
      },
    ]);

    const result = await aiService.findNearbyResponders(39.9, 116.4, 500);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('res-1');
    // distance_degrees 0.001 × 111000 ≈ 111 米
    expect(result[0].distance).toBe(111);
    // location 字符串 "(lng,lat)" 应解析为 {lng, lat}
    expect(result[0].location).toEqual({ lng: 116.4, lat: 39.9 });
  });

  it('无附近响应者时返回空数组', async () => {
    mockQueryBySql([{ match: 'FROM emergency_resources', rows: [] }]);

    const result = await aiService.findNearbyResponders(39.9, 116.4, 300);
    expect(result).toEqual([]);
  });

  it('location 为 null 时 parsePoint 返回 null', async () => {
    mockQueryBySql([
      {
        match: 'FROM emergency_resources',
        rows: [{
          id: 'res-1', type: 'shelter', name: '避难所', address: '某路',
          location: null, distance_degrees: '0.002',
        }],
      },
    ]);

    const result = await aiService.findNearbyResponders(39.9, 116.4, 500);
    expect(result[0].location).toBeNull();
  });

  // parsePoint 分支覆盖：pg 驱动返回 {x, y} 对象形态，需正确映射为 {lng, lat}
  it('location 为 pg {x, y} 对象时解析为 {lng, lat}', async () => {
    mockQueryBySql([
      {
        match: 'FROM emergency_resources',
        rows: [{
          id: 'res-1', type: 'shelter', name: '避难所', address: '某路',
          location: { x: 116.4, y: 39.9 }, distance_degrees: '0.001',
        }],
      },
    ]);

    const result = await aiService.findNearbyResponders(39.9, 116.4, 500);
    expect(result[0].location).toEqual({ lng: 116.4, lat: 39.9 });
  });

  // parsePoint 分支覆盖：location 已是 GeoPoint 结构，应原样返回
  it('location 为 {lng, lat} 对象时直接返回', async () => {
    mockQueryBySql([
      {
        match: 'FROM emergency_resources',
        rows: [{
          id: 'res-1', type: 'shelter', name: '避难所', address: '某路',
          location: { lng: 116.4, lat: 39.9 }, distance_degrees: '0.001',
        }],
      },
    ]);

    const result = await aiService.findNearbyResponders(39.9, 116.4, 500);
    expect(result[0].location).toEqual({ lng: 116.4, lat: 39.9 });
  });

  // parsePoint 分支覆盖：字符串格式不匹配正则时返回 null
  it('location 为非法字符串格式时 parsePoint 返回 null', async () => {
    mockQueryBySql([
      {
        match: 'FROM emergency_resources',
        rows: [{
          id: 'res-1', type: 'shelter', name: '避难所', address: '某路',
          location: 'invalid-format', distance_degrees: '0.001',
        }],
      },
    ]);

    const result = await aiService.findNearbyResponders(39.9, 116.4, 500);
    expect(result[0].location).toBeNull();
  });

  // parsePoint 分支覆盖：location 为对象但缺少 x/y 与 lng/lat 字段时返回 null
  it('location 为不匹配对象结构时 parsePoint 返回 null', async () => {
    mockQueryBySql([
      {
        match: 'FROM emergency_resources',
        rows: [{
          id: 'res-1', type: 'shelter', name: '避难所', address: '某路',
          location: { foo: 1, bar: 2 }, distance_degrees: '0.001',
        }],
      },
    ]);

    const result = await aiService.findNearbyResponders(39.9, 116.4, 500);
    expect(result[0].location).toBeNull();
  });
});

// ===================== LLM 真实路径（mock fetch + 动态重载） =====================
// 设计原因：AI_API_KEY 在测试环境为空导致所有 LLM 调用短路返回 null，
// 大量代码路径（callLLM fetch/generateEmbedding fetch/parseJsonFromLLM/evaluateRiskByLLM 等）无法覆盖。
// 通过 vi.resetModules + vi.stubEnv + dynamic import 重新加载 ai.service 模块，
// 使 AI_API_KEY 在新模块实例中为 'test-key'，配合 mock global.fetch 触发真实路径。
describe('ai.service - LLM 真实路径', () => {
  let aiServiceWithKey: typeof aiService;
  let originalFetch: typeof global.fetch;

  beforeAll(async () => {
    originalFetch = global.fetch;
    vi.resetModules();
    // stubEnv 会让 process.env.AI_API_KEY 在新模块加载时读取到 'test-key'
    vi.stubEnv('AI_API_KEY', 'test-key');
    aiServiceWithKey = (await import('../ai.service')).aiService;
  });

  afterAll(() => {
    // 恢复 fetch 与 env，避免污染后续测试
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- callLLM 真实路径 ----
  it('callLLM 成功返回 content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'test-content' } }] }),
    } as never);

    const result = await aiServiceWithKey.callLLM('test prompt');
    expect(result).toBe('test-content');
    // 验证 fetch 调用参数：URL 含 /chat/completions、Authorization 头携带 Bearer Key
    const mockFetch = vi.mocked(global.fetch);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-key',
    });
  });

  it('callLLM 自定义 options 透传到请求体', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as never);

    await aiServiceWithKey.callLLM('test', { model: 'gpt-4', temperature: 0.7, maxTokens: 1000, timeoutMs: 5000 });
    const mockFetch = vi.mocked(global.fetch);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4');
    expect(body.temperature).toBe(0.7);
    expect(body.max_tokens).toBe(1000);
  });

  it('callLLM HTTP 错误时返回 null 并记录错误', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    } as never);

    const result = await aiServiceWithKey.callLLM('test');
    expect(result).toBeNull();
  });

  it('callLLM fetch 抛错时进入 catch 返回 null', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await aiServiceWithKey.callLLM('test');
    expect(result).toBeNull();
  });

  it('callLLM 响应 content 为空时返回 null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    } as never);

    const result = await aiServiceWithKey.callLLM('test');
    expect(result).toBeNull();
  });

  it('callLLM 响应 choices 为空数组时返回 null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    } as never);

    const result = await aiServiceWithKey.callLLM('test');
    expect(result).toBeNull();
  });

  // ---- generateEmbedding 真实路径 ----
  it('generateEmbedding 成功返回向量', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    } as never);

    const result = await aiServiceWithKey.generateEmbedding('test');
    expect(result).toEqual([0.1, 0.2, 0.3]);
    // 验证 fetch 调用 URL 含 /embeddings
    const mockFetch = vi.mocked(global.fetch);
    expect(String(mockFetch.mock.calls[0][0])).toContain('/embeddings');
  });

  it('generateEmbedding HTTP 错误时返回 null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as never);

    const result = await aiServiceWithKey.generateEmbedding('test');
    expect(result).toBeNull();
  });

  it('generateEmbedding fetch 抛错时返回 null', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await aiServiceWithKey.generateEmbedding('test');
    expect(result).toBeNull();
  });

  it('generateEmbedding 响应 embedding 不是数组时返回 null', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: 'not-array' }] }),
    } as never);

    const result = await aiServiceWithKey.generateEmbedding('test');
    expect(result).toBeNull();
  });

  // ---- classifyContent LLM 成功路径 ----
  it('classifyContent LLM 返回合法 JSON 时使用 LLM 分类结果', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"category":"医疗","urgency":"high"}' } }] }),
    } as never);

    const result = await aiServiceWithKey.classifyContent('老人发烧');
    expect(result.category).toBe('医疗');
    expect(result.urgency).toBe('high');
  });

  it('classifyContent LLM 返回带 markdown 代码块的 JSON 时正确解析', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n{"category":"维修","urgency":"medium"}\n```' } }] }),
    } as never);

    const result = await aiServiceWithKey.classifyContent('需要修理水管');
    expect(result.category).toBe('维修');
    expect(result.urgency).toBe('medium');
  });

  it('classifyContent LLM 返回非法 urgency 时降级为关键词匹配', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"category":"医疗","urgency":"invalid"}' } }] }),
    } as never);

    const result = await aiServiceWithKey.classifyContent('老人发烧需要陪诊');
    // urgency 不在合法枚举内，降级为关键词匹配，发烧命中 critical
    expect(result.urgency).toBe('critical');
  });

  it('classifyContent LLM 返回字段类型不符时降级为关键词匹配', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"category":123,"urgency":"high"}' } }] }),
    } as never);

    const result = await aiServiceWithKey.classifyContent('老人发烧');
    // category 非 string，降级为关键词匹配
    expect(result.urgency).toBe('critical');
  });

  it('classifyContent LLM 返回非 JSON 时降级为关键词匹配', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not a json' } }] }),
    } as never);

    const result = await aiServiceWithKey.classifyContent('老人发烧');
    // JSON 解析抛错进入 catch，降级为关键词匹配
    expect(result.urgency).toBe('critical');
  });

  // ---- cosineSimilarity 边界（denominator=0 分支） ----
  it('cosineSimilarity 零向量时 denominator=0 返回 0', () => {
    // 零向量：normA 与 normB 均为 0，denominator 为 0
    expect(aiServiceWithKey.cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  // ---- storeEmbedding 路径（content_hash 不同 + embedding 成功） ----
  it('storeEmbedding content_hash 不同且 embedding 成功时执行 INSERT', async () => {
    // mock query 第一次返回不同 hash（触发 generateEmbedding 调用），
    // 第二次返回 INSERT 结果（任意，storeEmbedding 不消费）
    mockedQuery.mockImplementation(async () => ({
      rows: [{ content_hash: 'different-hash' }],
    }) as never);

    // mock fetch 返回合法 embedding 向量
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    } as never);

    await aiServiceWithKey.storeEmbedding('post-1', 'skill', 'test');

    // 应调用 2 次 query：SELECT hash + INSERT
    expect(mockedQuery).toHaveBeenCalledTimes(2);
  });

  it('storeEmbedding embedding 返回 null 时跳过 INSERT', async () => {
    mockedQuery.mockResolvedValue({ rows: [{ content_hash: 'different-hash' }] } as never);
    // HTTP 错误使 generateEmbedding 返回 null
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as never);

    await aiServiceWithKey.storeEmbedding('post-1', 'skill', 'test');

    // 只调用 1 次 query（SELECT hash），generateEmbedding 返回 null 后跳过 INSERT
    expect(mockedQuery).toHaveBeenCalledTimes(1);
  });

  // ---- searchByEmbedding 真实路径 ----
  it('searchByEmbedding embedding 生成成功后查询数据库并返回排序结果', async () => {
    // mock fetch 返回 query embedding
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1.0, 0.0] }] }),
    } as never);

    // mock query 返回两条记录，其中一条为字符串形态、一条为数组形态，覆盖两种解析分支
    mockedQuery.mockResolvedValue({
      rows: [
        { post_id: 'post-a', embedding: '[1.0, 0.0]' }, // 字符串形态
        { post_id: 'post-b', embedding: [0.0, 1.0] },   // 数组形态（与 query 正交，相似度 0 被过滤）
      ],
    } as never);

    const result = await aiServiceWithKey.searchByEmbedding('test', 'skill', 10);
    // post-a 与 query 完全相同，相似度 1.0 应被保留；post-b 正交相似度 0 被过滤
    expect(result).toHaveLength(1);
    expect(result[0].postId).toBe('post-a');
    expect(result[0].similarity).toBeCloseTo(1, 5);
  });

  it('searchByEmbedding query 抛错时返回空数组', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1.0, 0.0] }] }),
    } as never);

    mockedQuery.mockRejectedValue(new Error('DB error') as never);

    const result = await aiServiceWithKey.searchByEmbedding('test', 'skill', 10);
    expect(result).toEqual([]);
  });

  // ---- computeMatchScores LLM 路径（通过 matchSkill treatment 变体触发） ----
  it('matchSkill treatment 变体 LLM 返回匹配度时使用 LLM 分数排序', async () => {
    // 重新加载 ab-test.service 也需要 mock，这里通过 doMock 在 isolateModules 内处理
    // 简化：直接调用 aiServiceWithKey，因 vi.mock 是文件级 hoisted，重新加载时仍生效
    mockedAssignVariant.mockResolvedValue({ variant: 'treatment', userId: 'user-1' } as never);

    // mock query：fetchSkillPost + fetchSkillCandidates + searchByEmbedding 的 SELECT
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('WHERE id = $1 AND deleted_at')) {
        return { rows: [{ id: 'post-1', user_id: 'user-1', type: 'offer', category: '维修', title: '修水管', description: '漏水', location: null }] } as never;
      }
      if (sql.includes('FROM skill_posts sp')) {
        return { rows: [
          { id: 'cand-1', user_id: 'user-2', title: '修水管', description: '经验', category: '维修', location: null, nickname: '张三', reputation_score: 5.0 },
        ] } as never;
      }
      // searchByEmbedding 内部 SELECT（embedding 为空数组，使 embeddingScoreMap 为空触发 computeMatchScores）
      if (sql.includes('FROM post_embeddings')) {
        return { rows: [] } as never;
      }
      return { rows: [] } as never;
    });

    // mock fetch：第一次为 generateEmbedding（searchByEmbedding 调用）返回 null 触发 computeMatchScores，
    // 第二次为 callLLM（computeMatchScores 调用）返回 JSON 数组
    let fetchCallCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        // generateEmbedding HTTP 错误返回 null，searchByEmbedding 返回空数组
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({}),
        } as never);
      }
      // callLLM 返回匹配度 JSON
      return Promise.resolve({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '[{"id":"cand-1","score":0.85}]' } }] }),
      } as never);
    });

    const result = await aiServiceWithKey.matchSkill('post-1', 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe('user-2');
    // LLM 分数 0.85 应影响 matchScore 计算
    expect(result[0].matchScore).toBeGreaterThan(0);
  });

  // ---- detectAbnormalBehavior 触发 evaluateRiskByLLM 路径 ----
  it('detectAbnormalBehavior 触发风控规则时调用 LLM 评估风险', async () => {
    // 订单数 15 > 阈值 10，触发 evaluateRiskByLLM
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM skill_orders')) return { rows: [{ cnt: 10 }] } as never;
      if (sql.includes('FROM time_orders')) return { rows: [{ cnt: 5 }] } as never;
      if (sql.includes('FROM time_transactions')) return { rows: [{ total: 50 }] } as never;
      if (sql.includes('FROM audit_logs')) return { rows: [{ cnt: 1 }] } as never;
      return { rows: [] } as never;
    });

    // mock fetch 为 callLLM 返回风控评分 JSON
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"score":80,"reason":"LLM 判定异常"}' } }] }),
    } as never);

    const result = await aiServiceWithKey.detectAbnormalBehavior('user-1');
    // 规则评分 40，LLM 评分 80，取最大值 80
    expect(result.score).toBe(80);
    expect(result.isAbnormal).toBe(true);
    expect(result.reason).toContain('LLM 判定异常');
  });

  it('detectAbnormalBehavior LLM 返回字段类型不符时仅用规则评分', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM skill_orders')) return { rows: [{ cnt: 10 }] } as never;
      if (sql.includes('FROM time_orders')) return { rows: [{ cnt: 5 }] } as never;
      if (sql.includes('FROM time_transactions')) return { rows: [{ total: 50 }] } as never;
      if (sql.includes('FROM audit_logs')) return { rows: [{ cnt: 1 }] } as never;
      return { rows: [] } as never;
    });

    // LLM 返回 score 非数字，evaluateRiskByLLM 返回 null
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"score":"not-number","reason":"test"}' } }] }),
    } as never);

    const result = await aiServiceWithKey.detectAbnormalBehavior('user-1');
    // 规则评分 40，LLM 失败不加分
    expect(result.score).toBe(40);
  });

  it('detectAbnormalBehavior LLM 返回非 JSON 时仅用规则评分', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM skill_orders')) return { rows: [{ cnt: 10 }] } as never;
      if (sql.includes('FROM time_orders')) return { rows: [{ cnt: 5 }] } as never;
      if (sql.includes('FROM time_transactions')) return { rows: [{ total: 50 }] } as never;
      if (sql.includes('FROM audit_logs')) return { rows: [{ cnt: 1 }] } as never;
      return { rows: [] } as never;
    });

    // LLM 返回非 JSON，parseJsonFromLLM 抛错进入 catch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    } as never);

    const result = await aiServiceWithKey.detectAbnormalBehavior('user-1');
    expect(result.score).toBe(40);
  });
});

// ===================== processPostPipeline =====================
describe('ai.service - processPostPipeline', () => {
  it('正常执行三步骤：分类降级 + 风控正常 + 匹配空数组', async () => {
    // classifyContent 降级为关键词匹配（无需 mock）
    // detectAbnormalBehavior 查询 4 个表均返回低风险
    // searchByEmbedding 因 API_KEY 为空返回空数组
    mockQueryBySql([
      { match: 'FROM skill_orders', rows: [{ cnt: 1 }] },
      { match: 'FROM time_orders', rows: [{ cnt: 1 }] },
      { match: 'FROM time_transactions', rows: [{ total: 50 }] },
      { match: 'FROM audit_logs', rows: [{ cnt: 1 }] },
    ]);

    const result = await aiService.processPostPipeline('家里水管漏水需要维修', 'user-1', 'skill');

    // 分类降级为关键词匹配：维修 + high
    expect(result.classification.category).toBe('维修');
    expect(result.classification.urgency).toBe('high');
    // 风控正常
    expect(result.riskAssessment.isAbnormal).toBe(false);
    // 匹配为空数组（API_KEY 为空）
    expect(result.preMatches).toEqual([]);
  });

  it('detectAbnormalBehavior 查询失败时降级为默认值', async () => {
    // 所有 query 抛错，触发各步骤 catch 降级
    mockedQuery.mockRejectedValue(new Error('DB 错误') as never);

    const result = await aiService.processPostPipeline('随便文本', 'user-1');

    // 分类降级为关键词匹配（不依赖 DB）
    expect(result.classification.category).toBe('其他');
    // 风控降级为默认值
    expect(result.riskAssessment.score).toBe(0);
    expect(result.riskAssessment.isAbnormal).toBe(false);
    // 匹配降级为空数组
    expect(result.preMatches).toEqual([]);
  });
});

// ===================== matchSkill 带 location 距离计算 =====================
describe('ai.service - matchSkill 距离计算', () => {
  it('候选含 location 时距离影响排序（control 变体）', async () => {
    mockedAssignVariant.mockResolvedValue({ variant: 'control', userId: 'user-1' } as never);
    mockQueryBySql([
      {
        match: 'WHERE id = $1 AND deleted_at',
        rows: [{ id: 'post-1', user_id: 'user-1', type: 'offer', category: '维修', title: '修水管', description: '漏水', location: '(116.4,39.9)' }],
      },
      {
        match: 'FROM skill_posts sp',
        rows: [
          // 近的候选（同位置，距离 0）
          { id: 'cand-near', user_id: 'user-2', title: '修水管', description: '近', category: '维修', location: '(116.4,39.9)', nickname: '近', reputation_score: 5.0 },
          // 远的候选（不同位置，距离 > 0）
          { id: 'cand-far', user_id: 'user-3', title: '修水管', description: '远', category: '维修', location: '(121.5,31.2)', nickname: '远', reputation_score: 5.0 },
        ],
      },
    ]);

    const result = await matchSkill('post-1', 'user-1');

    expect(result).toHaveLength(2);
    // 近的候选距离应为 0
    expect(result[0].distance).toBe(0);
    // 远的候选距离应远大于 0（北京到上海约 1067km）
    expect(result[1].distance).toBeGreaterThan(100000);
    // 近的候选 matchScore 应更高（距离分更高）
    expect(result[0].matchScore).toBeGreaterThan(result[1].matchScore);
  });
});
