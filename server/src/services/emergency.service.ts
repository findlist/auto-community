import { query, transaction, SqlParam } from '../config/database';
import { QueryResultRow } from 'pg';
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  PermissionDeniedError,
  OrderStatusInvalidError,
} from '../utils/errors';
import { idempotency } from '../utils/idempotency';
import { reputationService } from './reputation.service';
import { maskPhone } from '../utils/mask';
import { aiService } from './ai.service';
import { sanitizeObject, sanitizeXss, validateImageUrls } from '../utils/sanitize';
import { safeNotify } from '../utils/safeNotify';
import { notificationService } from './notification.service';
import { creditService } from './credit.service';
import { prefixColumns } from '../utils/sql';
import { REVIEW_COLUMNS } from './review.service';

/**
 * emergency_requests 表显式查询列：替代 SELECT *，与数据库实际列结构对齐（17 字段，不含 deleted_at）。
 * 含 type（迁移 002_emergency.sql 添加）。列为硬编码常量非用户输入，模板插值无注入风险。
 */
const EMERGENCY_REQUEST_COLUMNS = `id, user_id, type, category, title, description, urgency, location, address,
  contact_phone, is_anonymous, images, status, timeout_at, created_at, updated_at`;

/**
 * emergency_responses 表显式查询列：替代 SELECT *，与数据库实际列结构对齐（11 字段）。
 * 含 eta/timeout_at（迁移 002_emergency.sql 添加）。列为硬编码常量非用户输入，模板插值无注入风险。
 */
const EMERGENCY_RESPONSE_COLUMNS = `id, request_id, responder_id, message, status, eta, timeout_at,
  arrived_at, completed_at, created_at, updated_at`;

/**
 * false_reports 表显式查询列：替代 SELECT *，与数据库实际列结构对齐（12 字段）。
 * 含 resolution（迁移 009_emergency_enhancements.sql 添加）。列为硬编码常量非用户输入，模板插值无注入风险。
 */
const FALSE_REPORT_COLUMNS = `id, request_id, reporter_id, reason, evidence, status, penalty, resolution,
  resolved_at, resolved_by, created_at, updated_at`;

// 导出供 routes 层收窄 req.body 类型，避免重复定义
export interface CreateRequestData {
  type?: string;
  category: string;
  title: string;
  description: string;
  urgency?: string;
  location?: { lat: number; lng: number };
  address?: string;
  contactPhone?: string;
  isAnonymous?: boolean;
  images?: string[];
}

/**
 * emergency_requests 表行类型（toRequestResponse 实际消费的列）
 * 设计原因：原 row: any 导致字段拼写错误无法在编译期暴露，列变更不触发类型告警
 */
interface EmergencyRequestRow extends QueryResultRow {
  id: string;
  user_id: string;
  type: string;
  category: string;
  title: string;
  description: string;
  urgency: string;
  location: string | { lng: number; lat: number } | null;
  address: string;
  contact_phone: string | null;
  is_anonymous: boolean;
  images: string[];
  status: string;
  timeout_at: Date | string;
  requester_id?: string;
  requester_nickname?: string;
  requester_avatar?: string;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * emergency_responses 表行类型（toResponseResponse 实际消费的列）
 */
interface EmergencyResponseRow extends QueryResultRow {
  id: string;
  request_id: string;
  responder_id: string;
  message: string;
  eta: number | null;
  status: string;
  timeout_at: Date | string;
  arrived_at: Date | string | null;
  completed_at: Date | string | null;
  responder_nickname?: string;
  responder_avatar?: string;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * reviews 表行类型（求助评价视图）
 */
interface ReviewRow extends QueryResultRow {
  id: string;
  reviewer_id: string;
  reviewed_id: string;
  rating: number;
  content: string;
  reviewer_nickname?: string;
  reviewer_avatar?: string;
  created_at: Date | string;
}

/**
 * false_reports 表行类型（toReportResponse 实际消费的列）
 */
interface FalseReportRow extends QueryResultRow {
  id: string;
  request_id: string;
  reporter_id: string;
  reason: string;
  evidence?: unknown;
  status: string;
  penalty: string | null;
  resolution: string | null;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

// 紧急程度关键词降级匹配表（AI 失败时使用）
const URGENCY_KEYWORDS: Record<string, string[]> = {
  critical: ['发烧', '骨折', '出血', '昏迷', '火灾', '地震', '心脏'],
  high: ['漏水', '停电', '困住', '受伤', '中毒'],
  medium: ['帮忙', '修理', '搬运', '买药'],
};

/**
 * 关键词降级分类：AI 不可用时使用
 */
function classifyUrgencyByKeyword(title: string, description: string): string {
  const text = `${title} ${description}`;
  for (const [level, keywords] of Object.entries(URGENCY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return level;
    }
  }
  return 'low';
}

/**
 * 紧急程度分类：优先调用 AI 模型，失败时降级为关键词匹配
 *
 * 安全考虑：仅传入 title 与 description，不携带 contactPhone 等敏感字段
 */
async function classifyUrgency(title: string, description: string): Promise<string> {
  const prompt = `请判断以下求助内容的紧急程度，只返回一个词：critical、high、medium 或 low。
- critical：危及生命或财产安全（如火灾、心脏骤停、大出血）
- high：紧急但暂不危及生命（如漏水、受伤）
- medium：需要帮助但不紧急（如修理、搬运）
- low：一般咨询或非紧急求助

标题：${title}
描述：${description}

只返回一个词，不要其他内容。`;

  const result = await aiService.callLLM(prompt, { maxTokens: 20, temperature: 0.1 });
  if (result) {
    const level = result.trim().toLowerCase();
    if (['critical', 'high', 'medium', 'low'].includes(level)) {
      return level;
    }
  }

  // 降级：关键词匹配
  return classifyUrgencyByKeyword(title, description);
}

/**
 * 将求助记录行转换为响应对象
 * @param row 数据库行
 * @param isResponder 是否为响应者：true 时返回完整 contactPhone，false 时返回脱敏后的 contactPhone
 *
 * 安全考虑：contactPhone 为 PII，仅响应者（需要联系求助者）可见完整号码，其他用户看到脱敏后的号码
 */
function toRequestResponse(row: EmergencyRequestRow, isResponder: boolean = false) {
  const contactPhone = row.contact_phone
    ? (isResponder ? row.contact_phone : maskPhone(row.contact_phone))
    : null;

  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    category: row.category,
    title: row.title,
    description: row.description,
    urgency: row.urgency,
    location: row.location,
    address: row.address,
    contactPhone,
    isAnonymous: row.is_anonymous,
    images: row.images,
    status: row.status,
    timeoutAt: row.timeout_at,
    // 字段名用 user 而非 requester，与前端 EmergencyRequest.user 类型定义对齐
    user: row.requester_id
      ? {
          id: row.requester_id,
          nickname: row.is_anonymous ? '匿名用户' : row.requester_nickname,
          avatar: row.is_anonymous ? null : row.requester_avatar,
        }
      : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function toResponseResponse(row: EmergencyResponseRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    responderId: row.responder_id,
    message: row.message,
    eta: row.eta,
    status: row.status,
    timeoutAt: row.timeout_at,
    arrivedAt: row.arrived_at,
    completedAt: row.completed_at,
    // 字段名用 user 而非 responder，与前端 EmergencyResponse.user 类型定义对齐
    user: row.responder_id
      ? {
          id: row.responder_id,
          nickname: row.responder_nickname,
          avatar: row.responder_avatar,
        }
      : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function toReportResponse(row: FalseReportRow) {
  return {
    id: row.id,
    requestId: row.request_id,
    reporterId: row.reporter_id,
    reason: row.reason,
    evidence: row.evidence,
    status: row.status,
    penalty: row.penalty,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

async function createRequest(userId: string, data: CreateRequestData) {
  // 入库前清洗富文本字段，防止存储型 XSS
  const sanitized = sanitizeObject(data, ['title', 'description']);
  // 校验图片 URL：必须 HTTPS 且在域名白名单内
  validateImageUrls(sanitized.images);

  // classifyUrgency 已改为异步（优先调用 AI，失败降级关键词匹配）
  const urgency = sanitized.urgency || await classifyUrgency(sanitized.title, sanitized.description);
  const location = sanitized.location ? `(${sanitized.location.lng},${sanitized.location.lat})` : null;

  const result = await query(
    `INSERT INTO emergency_requests
      (user_id, type, category, title, description, urgency, location, address, contact_phone, is_anonymous, images, status, timeout_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::point,$8,$9,$10,$11,'open', NOW() + INTERVAL '30 minutes')
     RETURNING ${EMERGENCY_REQUEST_COLUMNS}`,
    [
      userId,
      sanitized.type || 'emergency',
      sanitized.category,
      sanitized.title,
      sanitized.description,
      urgency,
      location,
      sanitized.address || null,
      sanitized.contactPhone || null,
      sanitized.isAnonymous || false,
      sanitized.images || [],
    ]
  );

  return toRequestResponse(result.rows[0] as EmergencyRequestRow);
}

async function getRequests(params: { type?: string; status?: string; page: number; pageSize: number }) {
  const conditions: string[] = ['er.deleted_at IS NULL'];
  // SQL 参数仅可能为 string/number，统一用 SqlParam 联合类型
  const values: SqlParam[] = [];
  let idx = 1;

  if (params.type) {
    conditions.push(`er.type = $${idx++}`);
    values.push(params.type);
  }
  if (params.status) {
    conditions.push(`er.status = $${idx++}`);
    values.push(params.status);
  }

  const where = conditions.join(' AND ');
  const offset = (params.page - 1) * params.pageSize;

  const countResult = await query(
    `SELECT COUNT(*) FROM emergency_requests er WHERE ${where}`,
    values
  );

  const listResult = await query(
    `SELECT ${prefixColumns(EMERGENCY_REQUEST_COLUMNS, 'er')}, u.id AS requester_id, u.nickname AS requester_nickname, u.avatar AS requester_avatar
     FROM emergency_requests er
     LEFT JOIN users u ON er.user_id = u.id
     WHERE ${where}
     ORDER BY er.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, params.pageSize, offset]
  );

  return {
    // 列表视图：非响应者查看，contactPhone 脱敏；行数据按 EmergencyRequestRow 收窄
    list: (listResult.rows as EmergencyRequestRow[]).map((row) => toRequestResponse(row)),
    total: parseInt(countResult.rows[0].count, 10),
    page: params.page,
    pageSize: params.pageSize,
  };
}

async function getRequestById(id: string, viewerUserId?: string) {
  const result = await query(
    `SELECT ${prefixColumns(EMERGENCY_REQUEST_COLUMNS, 'er')}, u.id AS requester_id, u.nickname AS requester_nickname, u.avatar AS requester_avatar
     FROM emergency_requests er
     LEFT JOIN users u ON er.user_id = u.id
     WHERE er.id = $1 AND er.deleted_at IS NULL`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('求助信息');
  }

  const requestRow = result.rows[0] as EmergencyRequestRow;

  const responsesResult = await query(
    `SELECT ${prefixColumns(EMERGENCY_RESPONSE_COLUMNS, 'r')}, u.id AS responder_id, u.nickname AS responder_nickname, u.avatar AS responder_avatar
     FROM emergency_responses r
     LEFT JOIN users u ON r.responder_id = u.id
     WHERE r.request_id = $1
     ORDER BY r.created_at ASC`,
    [id]
  );

  const reviewsResult = await query(
    `SELECT ${prefixColumns(REVIEW_COLUMNS, 'rv')}, u.nickname AS reviewer_nickname, u.avatar AS reviewer_avatar
     FROM reviews rv
     LEFT JOIN users u ON rv.reviewer_id = u.id
     WHERE rv.order_id = $1 AND rv.order_type = 'emergency'
     ORDER BY rv.created_at DESC`,
    [id]
  );

  // 超时处理交由 scheduler 统一处理，读操作不再产生写副作用
  // 避免 GET 请求触发 UPDATE，保证读接口幂等且不引入并发写问题
  const responseRows = responsesResult.rows as EmergencyResponseRow[];
  const responses = responseRows.map((row) => toResponseResponse(row));

  // 判断当前查看者是否为该求助的响应者：响应者可见完整 contactPhone
  const isResponder = !!viewerUserId && responseRows.some(
    (row) => row.responder_id === viewerUserId
  );

  const reviewRows = reviewsResult.rows as ReviewRow[];
  const reviews = reviewRows.map((row) => ({
    id: row.id,
    reviewerId: row.reviewer_id,
    reviewedId: row.reviewed_id,
    rating: row.rating,
    content: row.content,
    reviewer: row.reviewer_id
      ? { nickname: row.reviewer_nickname, avatar: row.reviewer_avatar }
      : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));

  const requestResponse = toRequestResponse(requestRow, isResponder);
  // 未登录查看者完全隐藏 contactPhone，避免未认证用户获取任何形式的联系方式
  if (!viewerUserId) {
    requestResponse.contactPhone = null;
  }

  return {
    ...requestResponse,
    responses,
    reviews,
  };
}

async function respondToRequest(userId: string, requestId: string, data: { message: string; eta?: number }) {
  // 幂等检查：5 秒内对同一求助的重复响应请求直接返回缓存结果
  const idempotencyKey = idempotency.buildKey(userId, 'emergency_response', requestId);
  const cached = await idempotency.checkIdempotency(idempotencyKey);
  // cached.data 为 unknown，但写入方在本函数末尾用 setIdempotencyResult 存入的是
  // toResponseResponse 的返回值，因此断言为 ReturnType<typeof toResponseResponse> 是安全的
  if (cached.hit) return cached.data as ReturnType<typeof toResponseResponse>;

  const requestResult = await query(
    `SELECT ${EMERGENCY_REQUEST_COLUMNS} FROM emergency_requests WHERE id = $1 AND deleted_at IS NULL`,
    [requestId]
  );

  if (requestResult.rows.length === 0) {
    throw new NotFoundError('求助信息');
  }

  const request = requestResult.rows[0];
  if (!['open', 'responding'].includes(request.status)) {
    throw new OrderStatusInvalidError('求助已关闭');
  }

  const existing = await query(
    'SELECT id FROM emergency_responses WHERE request_id = $1 AND responder_id = $2',
    [requestId, userId]
  );

  if (existing.rows.length > 0) {
    throw new ConflictError('您已响应过此求助');
  }

  // 入库前清洗响应留言，防止存储型 XSS
  const sanitizedMessage = sanitizeXss(data.message) as string;

  // 获取响应者昵称，用于通知内容
  const responderResult = await query('SELECT nickname FROM users WHERE id = $1', [userId]);
  const responderNickname = responderResult.rows[0]?.nickname || '邻居';

  // 事务包裹 INSERT emergency_responses + UPDATE emergency_requests.status：
  // 避免 INSERT 成功但 UPDATE 失败时产生孤儿响应记录，导致求助状态机不一致
  // （其他用户仍可继续响应、updateResponseStatus 基于错误前置状态流转）
  const result = await transaction(async (client) => {
    const insertResult = await client.query(
      `INSERT INTO emergency_responses (request_id, responder_id, message, eta, status, timeout_at)
       VALUES ($1, $2, $3, $4, 'accepted', NOW() + INTERVAL '15 minutes')
       RETURNING ${EMERGENCY_RESPONSE_COLUMNS}`,
      [requestId, userId, sanitizedMessage, data.eta || null]
    );

    await client.query(
      "UPDATE emergency_requests SET status = 'responding', updated_at = NOW() WHERE id = $1",
      [requestId]
    );

    return insertResult;
  });

  const response = toResponseResponse(result.rows[0] as EmergencyResponseRow);
  // 创建成功后写入幂等缓存，防止短时间内重复提交
  await idempotency.setIdempotencyResult(idempotencyKey, response);

  // 发送通知给求助者：您的求助已有人响应
  // safeNotify 吞错不阻塞主流程，同时记录 warn 日志便于监控
  safeNotify(
    notificationService.notifyEmergencyResponse(
      request.user_id,
      requestId,
      responderNickname,
    ),
    { userId: request.user_id, requestId },
  );

  return response;
}

// 注意：本函数的并发安全（行锁 + 状态校验）尚未有自动化测试覆盖。
// 项目当前未配置测试框架（jest/mocha/vitest），待引入后再补充
// emergency.concurrent.test.ts，模拟并发完成同一响应以验证不会重复发积分。
async function updateResponseStatus(
  userId: string,
  responseId: string,
  status: string,
  reviewData?: { rating: number; review: string }
) {
  // 事务外先查响应记录，用于 arrived 路径以及获取 request_id
  const responseResult = await query(
    `SELECT ${EMERGENCY_RESPONSE_COLUMNS} FROM emergency_responses WHERE id = $1`,
    [responseId]
  );

  if (responseResult.rows.length === 0) {
    throw new NotFoundError('响应记录');
  }

  const response = responseResult.rows[0];

  if (status === 'arrived') {
    // 只有响应者本人可以标记到达，防止他人误操作
    if (response.responder_id !== userId) {
      throw new PermissionDeniedError('只有响应者可以标记到达');
    }
    const result = await query(
      `UPDATE emergency_responses SET status = 'arrived', arrived_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING ${EMERGENCY_RESPONSE_COLUMNS}`,
      [responseId]
    );
    return toResponseResponse(result.rows[0] as EmergencyResponseRow);
  }

  if (status !== 'completed') {
    throw new BadRequestError('无效的状态');
  }

  // 完成响应：使用事务 + 行锁，防止并发请求重复触发积分发放
  const result = await transaction(async (client) => {
    // 先锁 emergency_requests 行，再锁 emergency_responses 行（固定加锁顺序，避免死锁）
    const requestResult = await client.query(
      `SELECT ${EMERGENCY_REQUEST_COLUMNS} FROM emergency_requests WHERE id = $1 FOR UPDATE`,
      [response.request_id]
    );
    if (requestResult.rows.length === 0) {
      throw new NotFoundError('求助信息');
    }
    const request = requestResult.rows[0];

    // 加锁查询当前响应，确保基于最新数据做状态校验
    const lockedResponseResult = await client.query(
      `SELECT ${EMERGENCY_RESPONSE_COLUMNS} FROM emergency_responses WHERE id = $1 FOR UPDATE`,
      [responseId]
    );
    if (lockedResponseResult.rows.length === 0) {
      throw new NotFoundError('响应记录');
    }
    const lockedResponse = lockedResponseResult.rows[0];

    // 权限校验：只有求助者可以确认完成
    if (request.user_id !== userId) {
      throw new PermissionDeniedError('只有求助者可以确认完成');
    }

    // 状态校验：仅 accepted/arrived 状态的响应可完成，已完成/已取消等状态拒绝
    if (!['accepted', 'arrived'].includes(lockedResponse.status)) {
      throw new OrderStatusInvalidError('当前响应状态不允许完成');
    }
    // 状态校验：求助必须处于 responding 状态才能完成响应
    if (request.status !== 'responding') {
      throw new OrderStatusInvalidError('求助状态不允许完成响应');
    }

    // 多人响应协调：将其他 accepted 状态的响应置为 cancelled，避免多个响应者同时完成
    await client.query(
      "UPDATE emergency_responses SET status = 'cancelled', updated_at = NOW() WHERE request_id = $1 AND id != $2 AND status = 'accepted'",
      [response.request_id, responseId]
    );

    // 更新当前响应为已完成
    const updatedResponse = await client.query(
      `UPDATE emergency_responses SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING ${EMERGENCY_RESPONSE_COLUMNS}`,
      [responseId]
    );

    // 更新求助状态为已解决
    await client.query(
      "UPDATE emergency_requests SET status = 'resolved', updated_at = NOW() WHERE id = $1",
      [response.request_id]
    );

    // 计算积分：紧急求助基础 100，普通求助基础 50，5 星评价额外奖励 10
    const baseCredit = request.type === 'emergency' ? 100 : 50;
    const bonusCredit = reviewData?.rating === 5 ? 10 : 0;
    const totalCredit = baseCredit + bonusCredit;

    // 写入评价（如有）：review 字段对应 reviews.content，入库前过滤 XSS
    if (reviewData) {
      const sanitizedReview = sanitizeXss(reviewData.review) as string;
      await client.query(
        `INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
         VALUES ($1, $2, $3, 'emergency', $4, $5)`,
        [userId, lockedResponse.responder_id, response.request_id, reviewData.rating, sanitizedReview]
      );
    }

    // 发放积分给响应者：统一走 creditService.earnCredits，与其他模块（拼单/技能/时间银行）保持一致
    // 设计原因：若 creditService 未来增加风控 hook 或审计逻辑，emergency 模块不会绕过
    await creditService.earnCredits(
      client,
      lockedResponse.responder_id,
      totalCredit,
      '完成求助奖励',
      response.request_id,
      'emergency',
    );

    // 更新响应者信誉分（基于最近评价，仅在有新评价时刷新）
    if (reviewData) {
      await reputationService.updateReputationScore(client, lockedResponse.responder_id);
    }

    return updatedResponse.rows[0];
  });

  return toResponseResponse(result);
}

async function createReport(userId: string, requestId: string, reason: string) {
  const requestResult = await query(
    'SELECT id FROM emergency_requests WHERE id = $1 AND deleted_at IS NULL',
    [requestId]
  );

  if (requestResult.rows.length === 0) {
    throw new NotFoundError('求助信息');
  }

  const existing = await query(
    'SELECT id FROM false_reports WHERE request_id = $1 AND reporter_id = $2',
    [requestId, userId]
  );

  if (existing.rows.length > 0) {
    throw new ConflictError('您已举报过此求助');
  }

  const result = await query(
    `INSERT INTO false_reports (request_id, reporter_id, reason, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING ${FALSE_REPORT_COLUMNS}`,
    [requestId, userId, reason]
  );

  return toReportResponse(result.rows[0] as FalseReportRow);
}

// 处罚类型与对应的用户状态、封禁时长映射
// warning：仅记录，不改变用户状态；ban_7d/ban_30d：限时封禁；permanent：永久封禁
const PENALTY_CONFIG: Record<string, { status: string | null; banInterval: string | null }> = {
  warning: { status: null, banInterval: null },
  ban_7d: { status: 'banned', banInterval: '7 days' },
  ban_30d: { status: 'banned', banInterval: '30 days' },
  permanent: { status: 'permanent_banned', banInterval: null },
};

/**
 * 审核虚假举报：事务内更新举报状态并根据处罚类型执行对求助者的处罚
 *
 * 处罚对象为 emergency_requests.user_id（发布虚假求助者），而非举报者
 * 事务保证举报状态与用户处罚同时成功或同时失败
 */
async function resolveFalseReport(
  reportId: string,
  adminId: string,
  penalty: string,
  resolution: string
) {
  // 校验处罚类型，防止非法值
  const penaltyConfig = PENALTY_CONFIG[penalty];
  if (!penaltyConfig) {
    throw new BadRequestError('无效的处罚类型');
  }

  return transaction(async (client) => {
    // 行锁查询举报记录，确保并发审核安全
    const reportResult = await client.query(
      `SELECT ${FALSE_REPORT_COLUMNS} FROM false_reports WHERE id = $1 FOR UPDATE`,
      [reportId]
    );
    if (reportResult.rows.length === 0) {
      throw new NotFoundError('举报记录');
    }
    const report = reportResult.rows[0];

    // 状态校验：仅 pending 状态可审核，避免重复处理
    if (report.status !== 'pending') {
      throw new BadRequestError('该举报已被处理，无法重复处理');
    }

    // 查询被举报的求助记录，获取求助者 ID（处罚对象）
    const requestResult = await client.query(
      'SELECT user_id FROM emergency_requests WHERE id = $1',
      [report.request_id]
    );
    if (requestResult.rows.length === 0) {
      throw new NotFoundError('求助信息');
    }
    const requesterId = requestResult.rows[0].user_id;

    // 更新举报状态为 resolved，记录处理人、处罚结果与处理意见
    const updatedReport = await client.query(
      `UPDATE false_reports
       SET status = 'resolved', penalty = $1, resolution = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $4
       RETURNING ${FALSE_REPORT_COLUMNS}`,
      [penalty, resolution, adminId, reportId]
    );

    // 执行处罚：根据处罚类型更新用户状态与封禁到期时间
    if (penaltyConfig.status) {
      if (penaltyConfig.banInterval) {
        // 限时封禁：设置 status=banned 与 ban_until=NOW()+interval
        // 参数化 interval：banInterval 虽来自硬编码常量无注入风险，但参数化可统一 SQL 规范、避免拼接风格扩散
        await client.query(
          `UPDATE users SET status = $1, ban_until = NOW() + $2::interval, updated_at = NOW() WHERE id = $3`,
          [penaltyConfig.status, penaltyConfig.banInterval, requesterId]
        );
      } else {
        // 永久封禁：status=permanent_banned，ban_until 置空
        await client.query(
          `UPDATE users SET status = $1, ban_until = NULL, updated_at = NOW() WHERE id = $2`,
          [penaltyConfig.status, requesterId]
        );
      }
    }
    // warning 类型：不修改用户状态，仅记录处罚结果到举报表

    // 发送通知给举报者：您的举报已处理
    // safeNotify 吞错不阻塞主流程，同时记录 warn 日志便于监控
    safeNotify(
      notificationService.notifyReportResult(
        report.reporter_id,
        report.request_id,
        resolution,
      ),
      { userId: report.reporter_id, requestId: report.request_id },
    );

    return toReportResponse(updatedReport.rows[0]);
  });
}

export const emergencyService = {
  classifyUrgency,
  createRequest,
  getRequests,
  getRequestById,
  respondToRequest,
  updateResponseStatus,
  createReport,
  resolveFalseReport,
};
