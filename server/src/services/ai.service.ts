/**
 * AI 能力服务
 *
 * 封装大模型 API 调用，提供智能匹配、需求分类、安全风控等能力。
 * 所有 AI 调用失败时均降级处理，不阻塞主流程。
 *
 * 安全：不会在 prompt 中携带明文手机号等 PII，调用方需确保已脱敏（Task 5 已实现）。
 * 密钥从环境变量读取，绝不硬编码。
 */
import crypto from 'crypto';
import { QueryResultRow } from 'pg';
import { query } from '../config/database';
import { logger } from '../utils/logger';
import { assignVariant, recordEvent } from './ab-test.service';

// ==================== 配置 ====================

// 从环境变量读取 AI 服务配置
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_API_BASE = process.env.AI_API_BASE || 'https://api.openai.com/v1';
const AI_MODEL = process.env.AI_MODEL || 'gpt-3.5-turbo';
const AI_EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || AI_MODEL;
const AI_TIMEOUT_MS = 10000;

// 度与米的近似换算：1 度 ≈ 111km（纬度方向）
const METERS_PER_DEGREE = 111000;

// ==================== 类型定义 ====================

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/**
 * 地理点：lng 经度，lat 纬度
 * 设计原因：项目多处使用 { lng, lat } 结构，统一类型避免散落字面量
 */
interface GeoPoint {
  lng: number;
  lat: number;
}

/**
 * OpenAI Chat Completions 响应最小化类型
 * 设计原因：仅声明项目实际消费的字段，避免引入完整 SDK 类型
 */
interface LLMChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * OpenAI Embeddings 响应最小化类型
 */
interface LLMEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

/**
 * LLM 解析后通用的 JSON 项结构（匹配度/分类/风控评分共用）
 * 设计原因：解析后字段动态，统一使用 unknown 值，调用方按需收窄
 */
type LLMJsonResult = Record<string, unknown>;

/**
 * 候选项通用行类型
 * 同时覆盖 skill_posts 与 time_services 的 SELECT 结果，所有字段均为可选取值
 * 设计原因：rankCandidates 同时承接两类候选，使用统一行类型避免重复定义
 */
interface CandidateRow extends QueryResultRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  location: string | GeoPoint | null;
  nickname?: string;
  reputation_score: string | number;
}

/**
 * post_embeddings 行类型
 */
interface EmbeddingRow extends QueryResultRow {
  post_id: string;
  embedding: number[] | string;
}

/**
 * emergency_resources 行类型（findNearbyResponders 的 SELECT 结果）
 */
interface EmergencyResourceRow extends QueryResultRow {
  id: string;
  type: string;
  name: string;
  address: string;
  location: string | GeoPoint | null;
  distance_degrees: string | number;
}

/**
 * skill_posts / time_services 行类型（fetchSkillPost/fetchTimeService 的 SELECT 结果）
 */
interface PostRow extends QueryResultRow {
  id: string;
  user_id: string;
  type: string;
  category: string;
  title: string;
  description: string;
  location: string | GeoPoint | null;
}

/**
 * 提取错误消息：兼容 Error/对象/原始值三类异常
 * 设计原因：catch (err: unknown) 后无法直接访问 err.message，统一收窄入口
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

interface ContentClassification {
  category: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

interface AbnormalBehaviorResult {
  isAbnormal: boolean;
  reason: string;
  score: number;
}

interface MatchCandidate {
  userId: string;
  nickname: string;
  reputationScore: number;
  matchScore: number;
  distance: number | null;
  post?: {
    id: string;
    title: string;
    category: string;
  };
}

interface NearbyResponder {
  id: string;
  type: string;
  name: string;
  address: string;
  location: { lng: number; lat: number } | null;
  distance: number;
}

// ==================== 通用 LLM 调用 ====================

/**
 * 通用大模型调用函数
 * 兼容 OpenAI Chat Completions 协议（OpenAI/通义千问/智谱等）
 *
 * 降级策略：未配置密钥或 API 失败时返回 null，由调用方降级处理
 */
export async function callLLM(prompt: string, options: LLMOptions = {}): Promise<string | null> {
  // 未配置 API 密钥时直接返回 null，触发降级
  if (!AI_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || AI_TIMEOUT_MS);

  try {
    const url = `${AI_API_BASE.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: options.model || AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 500,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error({ status: response.status }, '[AI] LLM 调用失败');
      return null;
    }

    const data = await response.json() as LLMChatResponse;
    const content = data?.choices?.[0]?.message?.content;
    return content || null;
  } catch (err) {
    // 异常对象类型不确定，统一通过 extractErrorMessage 提取消息
    logger.error({ err: extractErrorMessage(err) }, '[AI] LLM 调用异常');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ==================== 智能匹配 ====================

/**
 * 技能帖子智能匹配
 * 基于语义相似度 + 距离 + 信誉分排序推荐用户
 *
 * 降级策略：LLM 失败时用简单规则匹配（类别相同）
 */
export async function matchSkill(postId: string, userId?: string): Promise<MatchCandidate[]> {
  const post = await fetchSkillPost(postId);
  if (!post) return [];

  const oppositeType = post.type === 'offer' ? 'request' : 'offer';
  const candidates = await fetchSkillCandidates(oppositeType, post.user_id);
  if (candidates.length === 0) return [];

  return rankCandidates(
    `${post.title} ${post.description}`,
    post.category,
    post.location,
    candidates,
    'skill',
    userId,
  );
}

/**
 * 时间银行服务智能匹配
 * 逻辑同 matchSkill，针对 time_services 表
 */
export async function matchTimeService(serviceId: string, userId?: string): Promise<MatchCandidate[]> {
  const service = await fetchTimeService(serviceId);
  if (!service) return [];

  const oppositeType = service.type === 'provide' ? 'request' : 'provide';
  const candidates = await fetchTimeServiceCandidates(oppositeType, service.user_id);
  if (candidates.length === 0) return [];

  return rankCandidates(
    `${service.title} ${service.description}`,
    service.category,
    service.location,
    candidates,
    'time_service',
    userId,
  );
}

async function fetchSkillPost(postId: string): Promise<PostRow | null> {
  const result = await query(
    `SELECT id, user_id, type, category, title, description, location
     FROM skill_posts
     WHERE id = $1 AND deleted_at IS NULL`,
    [postId],
  );
  return (result.rows[0] as PostRow) || null;
}

async function fetchSkillCandidates(oppositeType: string, excludeUserId: string): Promise<CandidateRow[]> {
  const result = await query(
    `SELECT sp.id, sp.user_id, sp.title, sp.description, sp.category, sp.location,
            u.nickname, u.reputation_score
     FROM skill_posts sp
     LEFT JOIN users u ON sp.user_id = u.id
     WHERE sp.deleted_at IS NULL
       AND sp.status = 'active'
       AND sp.type = $1
       AND sp.user_id != $2
       AND (sp.expires_at IS NULL OR sp.expires_at > NOW())
     ORDER BY sp.created_at DESC
     LIMIT 20`,
    [oppositeType, excludeUserId],
  );
  return result.rows as CandidateRow[];
}

async function fetchTimeService(serviceId: string): Promise<PostRow | null> {
  const result = await query(
    `SELECT id, user_id, type, category, title, description, location
     FROM time_services
     WHERE id = $1 AND deleted_at IS NULL`,
    [serviceId],
  );
  return (result.rows[0] as PostRow) || null;
}

async function fetchTimeServiceCandidates(oppositeType: string, excludeUserId: string): Promise<CandidateRow[]> {
  const result = await query(
    `SELECT ts.id, ts.user_id, ts.title, ts.description, ts.category, ts.location,
            u.nickname, u.reputation_score
     FROM time_services ts
     LEFT JOIN users u ON ts.user_id = u.id
     WHERE ts.deleted_at IS NULL
       AND ts.status = 'active'
       AND ts.type = $1
       AND ts.user_id != $2
     ORDER BY ts.created_at DESC
     LIMIT 20`,
    [oppositeType, excludeUserId],
  );
  return result.rows as CandidateRow[];
}

/**
 * 综合排序候选：LLM 语义匹配度 + 信誉分 + 距离
 */
async function rankCandidates(
  targetText: string,
  targetCategory: string,
  targetLocation: string | GeoPoint | null,
  candidates: CandidateRow[],
  postType: string = 'skill',
  userId?: string,
): Promise<MatchCandidate[]> {
  // A/B 测试：根据用户变体选择匹配算法
  let variant = 'treatment';
  const testName = 'ai_recommendation_vs_keyword';

  if (userId) {
    try {
      const result = await assignVariant(testName, userId);
      variant = result.variant;
      // 记录曝光事件
      await recordEvent(testName, userId, variant, 'impression', {
        postType,
        candidateCount: candidates.length,
      });
    } catch (err) {
      // 变体分配失败时降级使用完整 AI 匹配
      logger.debug({ err, userId }, '[AI] A/B 测试变体分配失败，使用默认算法');
    }
  }

  // control 变体：仅使用类别匹配，不调用 embedding/LLM
  if (variant === 'control') {
    return candidates.map((c) => {
      const matchScore = c.category === targetCategory ? 0.6 : 0.3;
      const reputation = parseFloat(String(c.reputation_score)) || 5.0;
      const distance = computeDistance(targetLocation, c.location);
      const distanceScore = distance !== null ? Math.max(0, 1 - distance / 10000) : 0.5;
      const totalScore = matchScore * 0.5 + (reputation / 5) * 0.3 + distanceScore * 0.2;
      return {
        userId: c.user_id,
        // nickname 在 LEFT JOIN 未命中时为 null，统一兜底空字符串
        nickname: c.nickname || '',
        reputationScore: reputation,
        matchScore: Math.round(totalScore * 100) / 100,
        distance,
        post: { id: c.id, title: c.title, category: c.category },
      };
    }).sort((a, b) => b.matchScore - a.matchScore).slice(0, 10);
  }

  // treatment 变体：使用完整的 AI 匹配逻辑
  const embeddingResults = await searchByEmbedding(targetText, postType, 20);
  const embeddingScoreMap = new Map(embeddingResults.map(r => [r.postId, r.similarity]));

  let matchScores: Map<string, number>;
  if (embeddingScoreMap.size > 0) {
    matchScores = embeddingScoreMap;
  } else {
    matchScores = await computeMatchScores(
      targetText,
      candidates.map((c) => ({ id: c.id, text: `${c.title} ${c.description}` })),
    );
  }

  const ranked = candidates.map((c) => {
    const matchScore = matchScores.get(c.id) ?? (c.category === targetCategory ? 0.6 : 0.3);
    const reputation = parseFloat(String(c.reputation_score)) || 5.0;
    const distance = computeDistance(targetLocation, c.location);
    const distanceScore = distance !== null ? Math.max(0, 1 - distance / 10000) : 0.5;
    const totalScore = matchScore * 0.5 + (reputation / 5) * 0.3 + distanceScore * 0.2;
    return {
      userId: c.user_id,
      // nickname 在 LEFT JOIN 未命中时为 null，统一兜底空字符串
      nickname: c.nickname || '',
      reputationScore: reputation,
      matchScore: Math.round(totalScore * 100) / 100,
      distance,
      post: { id: c.id, title: c.title, category: c.category },
    };
  });

  return ranked.sort((a, b) => b.matchScore - a.matchScore).slice(0, 10);
}

/**
 * 调用 LLM 批量计算匹配度
 * 降级：LLM 失败时返回空 Map，调用方使用类别匹配
 */
async function computeMatchScores(
  targetText: string,
  candidates: Array<{ id: string; text: string }>,
): Promise<Map<string, number>> {
  const scoreMap = new Map<string, number>();
  if (candidates.length === 0) return scoreMap;

  const candidateList = candidates
    .map((c, i) => `${i + 1}. [ID:${c.id}] ${c.text}`)
    .join('\n');
  const prompt = `你是一个匹配助手。请根据目标需求，为每个候选计算匹配度（0-1 之间的小数，保留两位）。
只返回 JSON 数组，格式：[{"id":"候选ID","score":0.85}]，不要其他内容。

目标需求：${targetText}

候选列表：
${candidateList}`;

  const result = await callLLM(prompt, { maxTokens: 800, temperature: 0.2 });
  if (!result) return scoreMap;

  try {
    const parsed = parseJsonFromLLM(result);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        // 解析项为 LLMJsonResult，需显式收窄 id/score 类型
        const candidate = item as LLMJsonResult;
        const id = candidate.id;
        const score = candidate.score;
        if (typeof id === 'string' && typeof score === 'number') {
          scoreMap.set(id, Math.max(0, Math.min(1, score)));
        }
      }
    }
  } catch (err) {
    logger.error({ err }, '[AI] 匹配度解析失败，降级为类别匹配');
  }
  return scoreMap;
}

// ==================== Embedding 向量匹配 ====================

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!AI_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const url = `${AI_API_BASE.replace(/\/$/, '')}/embeddings`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_EMBEDDING_MODEL,
        input: text,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error({ status: response.status }, '[AI] Embedding 调用失败');
      return null;
    }

    const data = await response.json() as LLMEmbeddingResponse;
    const embedding = data?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (err) {
    logger.error({ err: extractErrorMessage(err) }, '[AI] Embedding 调用异常');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA.length || !vecB.length || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export async function storeEmbedding(postId: string, postType: string, text: string): Promise<void> {
  try {
    const contentHash = crypto.createHash('md5').update(text).digest('hex');

    const existing = await query(
      `SELECT content_hash FROM post_embeddings WHERE post_id = $1 AND post_type = $2`,
      [postId, postType],
    );

    if (existing.rows[0]?.content_hash === contentHash) {
      return;
    }

    const embedding = await generateEmbedding(text);
    if (!embedding) {
      return;
    }

    await query(
      `INSERT INTO post_embeddings (post_id, post_type, content_hash, embedding, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (post_id, post_type)
       DO UPDATE SET content_hash = $3, embedding = $4, updated_at = NOW()`,
      [postId, postType, contentHash, JSON.stringify(embedding)],
    );
  } catch (err) {
    logger.error({ err: extractErrorMessage(err), postId, postType }, '[AI] 存储 Embedding 失败');
  }
}

export async function searchByEmbedding(
  queryText: string,
  postType: string,
  limit: number = 20,
): Promise<Array<{ postId: string; similarity: number }>> {
  const queryEmbedding = await generateEmbedding(queryText);
  if (!queryEmbedding) {
    return [];
  }

  try {
    const result = await query(
      `SELECT post_id, embedding FROM post_embeddings WHERE post_type = $1`,
      [postType],
    );

    // 行数据先按 EmbeddingRow 收窄，再统一映射
    const rows = result.rows as EmbeddingRow[];
    const scored = rows
      .map((row) => {
        // embedding 可能是 number[] 或 JSON 字符串（pg 返回形态不固定）
        // JSON.parse 返回 unknown，这里显式断言为 number[]，cosineSimilarity 内部会做长度校验
        const storedEmbedding: number[] = Array.isArray(row.embedding)
          ? row.embedding
          : (JSON.parse(row.embedding) as number[]);
        return {
          postId: row.post_id,
          similarity: cosineSimilarity(queryEmbedding, storedEmbedding),
        };
      })
      .filter((item) => item.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored;
  } catch (err) {
    logger.error({ err: extractErrorMessage(err), postType }, '[AI] Embedding 搜索失败');
    return [];
  }
}

// ==================== 需求分类 ====================

// 关键词降级匹配表
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '家政': ['保洁', '打扫', '洗衣', '做饭'],
  '维修': ['修理', '维修', '水电', '电器'],
  '教育': ['辅导', '教学', '功课', '培训'],
  '搬运': ['搬家', '搬运', '运送'],
  '医疗': ['买药', '陪诊', '医院'],
  '宠物': ['遛狗', '喂猫', '宠物'],
};

const URGENCY_KEYWORDS: Record<string, string[]> = {
  critical: ['发烧', '骨折', '出血', '昏迷', '火灾', '心脏'],
  high: ['漏水', '停电', '受伤', '中毒'],
  medium: ['帮忙', '修理', '搬运', '买药'],
};

/**
 * 需求分类：返回 { category, urgency }
 * 降级策略：LLM 失败时用关键词匹配
 */
export async function classifyContent(text: string): Promise<ContentClassification> {
  const prompt = `请对以下文本进行分类，返回 JSON 格式：{"category":"分类","urgency":"紧急程度"}
分类从以下选择：家政、维修、教育、搬运、医疗、宠物、其他
紧急程度从以下选择：low、medium、high、critical
只返回 JSON，不要其他内容。

文本：${text}`;

  const result = await callLLM(prompt, { maxTokens: 100, temperature: 0.1 });
  if (result) {
    try {
      // parseJsonFromLLM 返回 unknown，需收窄为 LLMJsonResult 后访问字段
      const parsed = parseJsonFromLLM(result) as LLMJsonResult;
      const category = parsed.category;
      const urgency = parsed.urgency;
      if (typeof category === 'string' && typeof urgency === 'string') {
        // 校验 urgency 是否在合法枚举内
        const validUrgency: ContentClassification['urgency'][] = ['low', 'medium', 'high', 'critical'];
        if (validUrgency.includes(urgency as ContentClassification['urgency'])) {
          return { category, urgency: urgency as ContentClassification['urgency'] };
        }
      }
    } catch (err) {
      logger.error({ err }, '[AI] 分类解析失败，降级为关键词匹配');
    }
  }

  return classifyByKeyword(text);
}

function classifyByKeyword(text: string): ContentClassification {
  let category = '其他';
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      category = cat;
      break;
    }
  }

  let urgency: ContentClassification['urgency'] = 'low';
  for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      urgency = level as ContentClassification['urgency'];
      break;
    }
  }

  return { category, urgency };
}

// ==================== 安全风控 ====================

/**
 * 检测异常行为
 * - 高频下单（24 小时内 > 10 单）
 * - 刷分（短时间内大量 earn）
 * - 异常 IP（1 小时内多个不同 IP）
 *
 * 返回 { isAbnormal, reason, score }
 * score: 0-100，越高越异常；isAbnormal: score >= 60
 */
export async function detectAbnormalBehavior(userId: string): Promise<AbnormalBehaviorResult> {
  // 并行查询三项指标
  const [orderCount, earnStats, ipStats] = await Promise.all([
    countRecentOrders(userId),
    fetchRecentEarnStats(userId),
    fetchRecentIpStats(userId),
  ]);

  // 规则评分
  let score = 0;
  const reasons: string[] = [];

  // 高频下单：24h 内 > 10 单
  if (orderCount > 10) {
    score += 40;
    reasons.push(`24小时内下单 ${orderCount} 单，超出阈值 10`);
  }

  // 刷分：1 小时内 earn > 200 分钟
  if (earnStats.recentEarn > 200) {
    score += 30;
    reasons.push(`1小时内获得 ${earnStats.recentEarn} 分钟收益，疑似刷分`);
  }

  // 异常 IP：1 小时内 > 3 个不同 IP
  if (ipStats.distinctIpCount > 3) {
    score += 30;
    reasons.push(`1小时内使用 ${ipStats.distinctIpCount} 个不同 IP，疑似异常`);
  }

  // 规则触发时调用 LLM 评估风险（降级：仅用规则评分）
  if (reasons.length > 0) {
    const llmScore = await evaluateRiskByLLM(orderCount, earnStats.recentEarn, ipStats.distinctIpCount, reasons);
    if (llmScore !== null) {
      score = Math.max(score, llmScore.score);
      if (llmScore.reason) {
        reasons.push(llmScore.reason);
      }
    }
  }

  return {
    isAbnormal: score >= 60,
    reason: reasons.join('；') || '正常',
    score: Math.min(100, score),
  };
}

async function evaluateRiskByLLM(
  orderCount: number,
  recentEarn: number,
  distinctIpCount: number,
  reasons: string[],
): Promise<{ score: number; reason: string } | null> {
  const prompt = `你是安全风控专家。请根据以下用户行为数据评估风险等级（0-100），返回 JSON：{"score":75,"reason":"简要原因"}
只返回 JSON，不要其他内容。

用户行为：
- 24小时下单数：${orderCount}
- 1小时获得收益：${recentEarn} 分钟
- 1小时使用 IP 数：${distinctIpCount}
- 规则触发：${reasons.join('；') || '无'}`;

  const result = await callLLM(prompt, { maxTokens: 150, temperature: 0.2 });
  if (!result) return null;

  try {
    // parseJsonFromLLM 返回 unknown，需收窄为 LLMJsonResult 后访问字段
    const parsed = parseJsonFromLLM(result) as LLMJsonResult;
    const score = parsed.score;
    if (typeof score === 'number') {
      const reason = parsed.reason;
      return {
        score: Math.max(0, Math.min(100, score)),
        reason: typeof reason === 'string' ? reason : '',
      };
    }
  } catch (err) {
    logger.error({ err }, '[AI] 风控评分解析失败，使用规则评分');
  }
  return null;
}

async function countRecentOrders(userId: string): Promise<number> {
  // 统计 24h 内作为买家或卖家的技能订单 + 时间银行订单
  const [skillResult, timeResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS cnt FROM skill_orders
       WHERE (buyer_id = $1 OR seller_id = $1) AND created_at >= NOW() - INTERVAL '24 hours'`,
      [userId],
    ),
    query(
      `SELECT COUNT(*)::int AS cnt FROM time_orders
       WHERE (provider_id = $1 OR requester_id = $1) AND created_at >= NOW() - INTERVAL '24 hours'`,
      [userId],
    ),
  ]);
  return (skillResult.rows[0]?.cnt || 0) + (timeResult.rows[0]?.cnt || 0);
}

async function fetchRecentEarnStats(userId: string): Promise<{ recentEarn: number }> {
  const result = await query(
    `SELECT COALESCE(SUM(amount), 0)::int AS total FROM time_transactions
     WHERE to_user_id = $1 AND type = 'earn' AND created_at >= NOW() - INTERVAL '1 hour'`,
    [userId],
  );
  return { recentEarn: result.rows[0]?.total || 0 };
}

async function fetchRecentIpStats(userId: string): Promise<{ distinctIpCount: number }> {
  // 通过 audit_logs 表统计不同 IP 数
  const result = await query(
    `SELECT COUNT(DISTINCT ip)::int AS cnt FROM audit_logs
     WHERE user_id = $1 AND ip IS NOT NULL AND created_at >= NOW() - INTERVAL '1 hour'`,
    [userId],
  );
  return { distinctIpCount: result.rows[0]?.cnt || 0 };
}

// ==================== 应急附近响应 ====================

/**
 * 查找附近应急响应者（基于 emergency_resources 表的 POINT 字段）
 * @param lat 纬度
 * @param lng 经度
 * @param radius 搜索半径（米），默认 300
 */
export async function findNearbyResponders(
  lat: number,
  lng: number,
  radius: number = 300,
): Promise<NearbyResponder[]> {
  // 将米转换为度（近似：1 度 ≈ 111km）
  const radiusDegrees = radius / METERS_PER_DEGREE;

  const result = await query(
    `SELECT id, type, name, address, location,
            (location <-> point($1, $2)) AS distance_degrees
     FROM emergency_resources
     WHERE deleted_at IS NULL
       AND location IS NOT NULL
       AND (location <-> point($1, $2)) < $3
     ORDER BY location <-> point($1, $2)
     LIMIT 20`,
    [lng, lat, radiusDegrees],
  );

  // 行数据按 EmergencyResourceRow 收窄，避免逐字段 any
  const rows = result.rows as EmergencyResourceRow[];
  return rows.map((row) => {
    // 将度距离转换为米（近似）
    const distanceMeters = Math.round(parseFloat(String(row.distance_degrees)) * METERS_PER_DEGREE);
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      address: row.address,
      location: parsePoint(row.location),
      distance: distanceMeters,
    };
  });
}

// ==================== 处理链路 ====================

interface PipelineResult {
  classification: { category: string; urgency: string };
  riskAssessment: { score: number; isAbnormal: boolean; reason: string };
  preMatches: Array<{ userId: string; nickname: string; matchScore: number }>;
}

export async function processPostPipeline(
  text: string,
  userId: string,
  postType: 'skill' | 'time_service' = 'skill',
): Promise<PipelineResult> {
  let classification: { category: string; urgency: string } = { category: '其他', urgency: 'low' };
  try {
    classification = await classifyContent(text);
  } catch (err) {
    logger.error({ err }, '[Pipeline] 分类步骤失败，使用默认值');
  }

  let riskAssessment = { score: 0, isAbnormal: false, reason: '正常' };
  try {
    riskAssessment = await detectAbnormalBehavior(userId);
  } catch (err) {
    logger.error({ err }, '[Pipeline] 风控步骤失败，使用默认值');
  }

  let preMatches: PipelineResult['preMatches'] = [];
  try {
    const results = await searchByEmbedding(text, postType, 5);
    preMatches = results.map(r => ({
      userId: r.postId,
      nickname: '',
      matchScore: r.similarity,
    }));
  } catch (err) {
    logger.error({ err }, '[Pipeline] 匹配预推荐步骤失败，返回空数组');
  }

  return { classification, riskAssessment, preMatches };
}

// ==================== 工具函数 ====================

/**
 * 从 LLM 返回中解析 JSON
 * 兼容模型返回带 markdown 代码块的情况
 * 返回 unknown 由调用方按需收窄，避免 any 散播
 */
function parseJsonFromLLM(text: string): unknown {
  const jsonStr = text
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim();
  return JSON.parse(jsonStr);
}

/**
 * 计算两个 POINT 之间的距离（米）
 * 使用 Haversine 公式
 * POINT 格式：(lng, lat)
 */
function computeDistance(p1: string | GeoPoint | null, p2: string | GeoPoint | null): number | null {
  const point1 = parsePoint(p1);
  const point2 = parsePoint(p2);
  if (!point1 || !point2) return null;

  const R = 6371000; // 地球半径（米）
  const dLat = toRad(point2.lat - point1.lat);
  const dLng = toRad(point2.lng - point1.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(point1.lat)) * Math.cos(toRad(point2.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 解析 PostgreSQL POINT 类型
 * 输入可能是字符串 "(lng,lat)" 或 pg 返回的对象 {x, y}
 * 设计原因：pg POINT 字段在不同驱动版本下返回形态不同，统一收窄入口
 */
function parsePoint(point: string | GeoPoint | null): GeoPoint | null {
  if (!point) return null;

  if (typeof point === 'string') {
    const match = point.match(/\(([-\d.]+),([-\d.]+)\)/);
    if (match) {
      return { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
    }
    return null;
  }

  // pg 返回 {x, y} 对象时，需要显式收窄为 GeoPoint
  const obj = point as { x?: unknown; y?: unknown };
  if (typeof obj.x !== 'undefined' && typeof obj.y !== 'undefined') {
    return {
      lng: parseFloat(String(obj.x)),
      lat: parseFloat(String(obj.y)),
    };
  }

  // 已经是 GeoPoint 结构（如 {lng, lat}）的情况
  if (typeof point.lng === 'number' && typeof point.lat === 'number') {
    return { lng: point.lng, lat: point.lat };
  }

  return null;
}

// ==================== 服务导出 ====================

export const aiService = {
  callLLM,
  matchSkill,
  matchTimeService,
  classifyContent,
  detectAbnormalBehavior,
  findNearbyResponders,
  generateEmbedding,
  cosineSimilarity,
  storeEmbedding,
  searchByEmbedding,
  processPostPipeline,
};
