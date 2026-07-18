import { pool, query, SqlParam } from '../config/database';
import { logger } from '../utils/logger';
import { createPaginatedResponse } from '../utils/pagination';
import { prefixColumns } from '../utils/sql';
import { sanitizeXss } from '../utils/sanitize';

// audit_logs 表列常量：仅包含 toAuditLog 消费的字段，排除 user_agent TEXT 与 request_body JSONB 大字段
// 设计原因：列表查询 SELECT a.* 会无谓返回两个大字段，列表场景从不消费，显式列名可减少网络传输与内存占用
const AUDIT_LOG_COLUMNS = `id, user_id, action, resource_type, resource_id, ip, status, error_message, created_at`;

// 审计日志写入参数
export interface AuditLogParams {
  // 操作者用户 ID，未登录场景（如登录失败）可为空
  userId?: string;
  // 操作类型，如 LOGIN/LOGOUT/REGISTER/TRANSFER/COMPLETE_ORDER
  action: string;
  // 资源类型，如 user/order/transaction
  resourceType?: string;
  // 资源 ID
  resourceId?: string;
  // 客户端 IP
  ip?: string;
  // 客户端 User-Agent
  userAgent?: string;
  // 请求体（脱敏后）：结构不定，用 unknown 替代 any，强制调用方在序列化前做类型处理
  // 设计原因：原 any 让调用方误传任意类型静默通过，unknown 保持类型安全的同时不限制具体结构
  requestBody?: unknown;
  // 操作结果状态：success / failed
  status: 'success' | 'failed';
  // 失败时的错误信息
  errorMessage?: string;
}

// audit_logs 表行类型：与数据库列结构对齐
// 设计原因：原 row: any 让字段拼写错误静默通过编译，收紧后访问错误字段立即报错；
// id 为 BIGSERIAL，pg 默认将 BIGINT 解析为 string，与 UUID 主键行为一致
interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip: string | null;
  status: string;
  error_message: string | null;
  created_at: Date;
}

// 列表查询行：AuditLogRow + LEFT JOIN users 引入的 nickname
interface AuditLogListRow extends AuditLogRow {
  nickname: string | null;
}

/**
 * 写入审计日志
 * 设计原则：审计日志写入失败不影响主流程，仅记录错误日志
 *
 * XSS 清洗：action/resourceType/userAgent/errorMessage 均为字符串字段，会在管理员后台
 * 审计日志页直接渲染。userAgent 来自请求头完全用户可控，errorMessage 可能含异常 message
 * 包含用户输入片段，action/resourceType 通常受控但作为纵深防御一并清洗。
 * requestBody 在 JSON.stringify 后整体清洗，剥离嵌套字符串中的 <script> 等危险节点，
 * 避免管理员后台解析 JSON 后渲染某个 string 字段触发存储型 XSS。
 */
export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  // 入口统一清洗所有字符串字段，与 service 层入口清洗行为对齐
  const safeAction = sanitizeXss(params.action) as string;
  const safeResourceType = params.resourceType !== undefined ? sanitizeXss(params.resourceType) as string : undefined;
  const safeUserAgent = params.userAgent !== undefined ? sanitizeXss(params.userAgent) as string : undefined;
  const safeErrorMessage = params.errorMessage !== undefined ? sanitizeXss(params.errorMessage) as string : undefined;
  // requestBody 序列化后清洗：JSON 字符串中的 <script> 标签字面字符会被剥离，
  // 不影响 JSON 结构（JSON 中 < > 不是语法元素），管理员后台解析 JSON 后渲染 string 字段也安全
  const safeRequestBody = params.requestBody !== undefined
    ? sanitizeXss(JSON.stringify(params.requestBody)) as string
    : null;

  try {
    await pool.query(
      `INSERT INTO audit_logs
        (user_id, action, resource_type, resource_id, ip, user_agent, request_body, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        params.userId ?? null,
        safeAction,
        safeResourceType ?? null,
        params.resourceId ?? null,
        params.ip ?? null,
        safeUserAgent ?? null,
        safeRequestBody,
        params.status,
        safeErrorMessage ?? null,
      ],
    );
  } catch (err) {
    // 审计日志写入失败不抛出，避免影响主业务流程
    logger.error({ err, action: safeAction }, '审计日志写入失败');
  }
}

// 审计日志查询筛选条件
export interface AuditLogQuery {
  userId?: string;
  action?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

// 审计日志序列化：驼峰命名 + 关联用户昵称
function toAuditLog(row: AuditLogListRow) {
  return {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname || null,
    action: row.action,
    resourceType: row.resource_type || null,
    resourceId: row.resource_id || null,
    ip: row.ip || null,
    status: row.status,
    errorMessage: row.error_message || null,
    createdAt: row.created_at,
  };
}

/**
 * 分页查询审计日志
 * 支持按用户、操作类型、状态、时间范围筛选
 */
async function getAuditLogs(
  filters: AuditLogQuery,
  page: number = 1,
  pageSize: number = 20,
) {
  const conditions: string[] = [];
  // SqlParam 收紧：filters 字段均为 string，pageSize/offset 为 number，均属合法 SqlParam
  const params: SqlParam[] = [];
  let paramIndex = 1;

  // 动态构建筛选条件
  if (filters.userId) {
    conditions.push(`a.user_id = $${paramIndex++}`);
    params.push(filters.userId);
  }
  if (filters.action) {
    conditions.push(`a.action = $${paramIndex++}`);
    params.push(filters.action);
  }
  if (filters.status) {
    conditions.push(`a.status = $${paramIndex++}`);
    params.push(filters.status);
  }
  if (filters.startDate) {
    conditions.push(`a.created_at >= $${paramIndex++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`a.created_at <= $${paramIndex++}`);
    params.push(filters.endDate);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // 查询总数：COUNT 返回字符串，泛型 { count: string } 让 parseInt 拿到字符串
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) FROM audit_logs a ${whereClause}`,
    params,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // 查询列表（关联用户表获取昵称）：LEFT JOIN users 引入 nickname，泛型 AuditLogListRow 精确化
  const offset = (page - 1) * pageSize;
  const listResult = await query<AuditLogListRow>(
    `SELECT ${prefixColumns(AUDIT_LOG_COLUMNS, 'a')}, u.nickname
     FROM audit_logs a
     LEFT JOIN users u ON a.user_id = u.id
     ${whereClause}
     ORDER BY a.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, pageSize, offset],
  );

  return createPaginatedResponse(
    listResult.rows.map(toAuditLog),
    total,
    page,
    pageSize,
  );
}

export const auditService = {
  writeAuditLog,
  getAuditLogs,
};
