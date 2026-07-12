import { query, transaction, SqlParam } from '../config/database';
import { BadRequestError, NotFoundError, ConflictError } from '../utils/errors';
import { userCache } from './cache.service';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// ===================== 类型定义 =====================

export type DeletionRequestStatus = 'pending' | 'approved' | 'rejected' | 'completed';

export interface DeletionRequest {
  id: string;
  userId: string;
  status: DeletionRequestStatus;
  reason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  reviewerNickname: string | null;
  completedAt: Date | null;
}

export interface DeletionRequestList {
  list: DeletionRequest[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// deletion_requests 表审核查询列：仅返回审核逻辑消费的 3 个字段
// 设计原因：reviewDeletionRequest 只需校验 status 和获取 user_id，无需返回 reason 等字段
const DELETION_REQUEST_REVIEW_COLUMNS = 'id, user_id, status';

// ===================== 匿名化工具函数 =====================

/**
 * 生成匿名化昵称：deleted_user_{id}
 */
function generateAnonymousNickname(userId: string): string {
  return `deleted_user_${userId}`;
}

/**
 * 生成匿名化手机号哈希：deleted_phone_{hash}
 * 使用短哈希避免字段长度溢出
 */
function generateAnonymousPhoneHash(userId: string): string {
  const hash = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 16);
  return `deleted_phone_${hash}`;
}

/**
 * 生成匿名化手机号密文（占位符）
 */
function generateAnonymousPhone(): string {
  return 'ANONYMIZED';
}

/**
 * 软删除数据保留天数（超过此天数的数据将被彻底清理）
 */
const SOFT_DELETE_RETENTION_DAYS = 90;

// ===================== 用户注销申请 =====================

/**
 * 用户提交注销申请
 * @param userId 用户ID
 * @param reason 注销原因（可选）
 */
async function submitDeletionRequest(userId: string, reason?: string): Promise<{ id: string; status: string; message: string }> {
  // 检查用户是否存在且未删除
  const userResult = await query(
    'SELECT id, status FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId],
  );
  if (userResult.rows.length === 0) {
    throw new NotFoundError('用户');
  }

  // 检查用户状态：已封禁用户不允许注销
  if (userResult.rows[0].status === 'banned') {
    throw new BadRequestError('账号已被封禁，无法申请注销');
  }

  // 检查是否已有待处理的注销申请
  const existingResult = await query(
    "SELECT id FROM deletion_requests WHERE user_id = $1 AND status IN ('pending', 'approved')",
    [userId],
  );
  if (existingResult.rows.length > 0) {
    throw new ConflictError('您已提交过注销申请，请等待审核');
  }

  // 创建注销申请记录
  const { rows } = await query(
    `INSERT INTO deletion_requests (user_id, reason, status)
     VALUES ($1, $2, 'pending')
     RETURNING id, status`,
    [userId, reason || null],
  );

  logger.info({ userId, requestId: rows[0].id }, '[数据删除] 用户提交注销申请');

  return {
    id: rows[0].id,
    status: 'pending',
    message: '注销申请已提交，请等待管理员审核',
  };
}

/**
 * 获取用户注销申请状态
 * @param userId 用户ID
 */
async function getDeletionRequestStatus(userId: string): Promise<DeletionRequest | null> {
  const { rows } = await query(
    `SELECT dr.id, dr.user_id, dr.status, dr.reason, dr.created_at,
            dr.reviewed_at, dr.reviewed_by, dr.completed_at,
            reviewer.nickname as reviewer_nickname
     FROM deletion_requests dr
     LEFT JOIN users reviewer ON dr.reviewed_by = reviewer.id
     WHERE dr.user_id = $1
     ORDER BY dr.created_at DESC LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewerNickname: row.reviewer_nickname,
    completedAt: row.completed_at,
  };
}

/**
 * 取消注销申请（仅 pending 状态可取消）
 * @param userId 用户ID
 */
async function cancelDeletionRequest(userId: string): Promise<void> {
  const { rows } = await query(
    "DELETE FROM deletion_requests WHERE user_id = $1 AND status = 'pending' RETURNING id",
    [userId],
  );

  if (rows.length === 0) {
    throw new BadRequestError('无可取消的注销申请');
  }

  logger.info({ userId, requestId: rows[0].id }, '[数据删除] 用户取消注销申请');
}

// ===================== 管理员审核注销申请 =====================

/**
 * 分页查询注销申请列表
 */
async function getDeletionRequests(
  page: number,
  pageSize: number,
  status?: DeletionRequestStatus,
): Promise<DeletionRequestList> {
  const conditions: string[] = ['1=1'];
  // params 承载 status/pageSize/offset 三种入参（string|number），用 SqlParam 收紧以对齐 query 函数签名
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM deletion_requests WHERE ${whereClause}`, params),
    query(
      `SELECT dr.id, dr.user_id, dr.status, dr.reason, dr.created_at,
              dr.reviewed_at, dr.reviewed_by, dr.completed_at,
              u.nickname as user_nickname,
              reviewer.nickname as reviewer_nickname
       FROM deletion_requests dr
       LEFT JOIN users u ON dr.user_id = u.id
       LEFT JOIN users reviewer ON dr.reviewed_by = reviewer.id
       WHERE ${whereClause}
       ORDER BY dr.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const list = listResult.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userNickname: row.user_nickname,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewerNickname: row.reviewer_nickname,
    completedAt: row.completed_at,
  }));

  return {
    list,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * 审核注销申请
 * @param requestId 申请ID
 * @param reviewerId 审核人ID
 * @param action approve 或 reject
 * @param rejectReason 拒绝原因（reject 时必填）
 */
async function reviewDeletionRequest(
  requestId: string,
  reviewerId: string,
  action: 'approve' | 'reject',
  rejectReason?: string,
): Promise<{ id: string; status: string }> {
  // 查询申请记录
  const requestResult = await query(
    `SELECT ${DELETION_REQUEST_REVIEW_COLUMNS} FROM deletion_requests WHERE id = $1`,
    [requestId],
  );
  if (requestResult.rows.length === 0) {
    throw new NotFoundError('注销申请');
  }

  const request = requestResult.rows[0];
  if (request.status !== 'pending') {
    throw new BadRequestError('该申请已被审核，无法重复操作');
  }

  // 拒绝时必须提供原因
  if (action === 'reject' && !rejectReason) {
    throw new BadRequestError('拒绝注销申请时必须提供原因');
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  // 更新申请状态
  await query(
    `UPDATE deletion_requests
     SET status = $1, reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $3`,
    [newStatus, reviewerId, requestId],
  );

  logger.info({ requestId, reviewerId, action }, '[数据删除] 管理员审核注销申请');

  // 审核通过后立即执行匿名化
  if (action === 'approve') {
    await executeAnonymization(request.user_id);
    // 更新申请状态为已完成
    await query(
      "UPDATE deletion_requests SET status = 'completed', completed_at = NOW() WHERE id = $1",
      [requestId],
    );
  }

  return { id: requestId, status: newStatus };
}

// ===================== 数据匿名化执行 =====================

/**
 * 执行用户数据匿名化
 * 将 PII 字段置为匿名值，并标记用户为已删除
 * @param userId 用户ID
 */
async function executeAnonymization(userId: string): Promise<void> {
  const anonymousNickname = generateAnonymousNickname(userId);
  const anonymousPhoneHash = generateAnonymousPhoneHash(userId);
  const anonymousPhone = generateAnonymousPhone();

  await transaction(async (client) => {
    // 更新用户表：匿名化 PII 字段，设置 deleted_at
    // 注意：users 表无 id_card_hash 字段（该字段在 verification_requests 表），
    // 实名认证敏感数据通过下方 DELETE FROM verification_requests 统一清理，
    // 此处仅清理 users 表中的 id_card_encrypted 字段
    await client.query(
      `UPDATE users
       SET nickname = $1,
           phone = $2,
           phone_hash = $3,
           avatar = NULL,
           real_name = NULL,
           id_card_encrypted = NULL,
           status = 'deleted',
           deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [anonymousNickname, anonymousPhone, anonymousPhoneHash, userId],
    );

    // 删除实名认证申请记录（包含敏感信息）
    await client.query(
      'DELETE FROM verification_requests WHERE user_id = $1',
      [userId],
    );

    // 清除用户缓存
    await userCache.invalidate(userId);
  });

  logger.info({ userId }, '[数据删除] 用户数据匿名化完成');
}

// ===================== 软删除数据清理 =====================

/**
 * 清理超过 90 天的软删除数据
 * 彻底删除或归档（根据业务需求）
 * @returns 清理的记录数
 */
async function cleanupSoftDeletedData(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - SOFT_DELETE_RETENTION_DAYS);

  // 查询超过保留期的已删除用户
  const usersResult = await query<{ id: string }>(
    `SELECT id FROM users
     WHERE deleted_at IS NOT NULL AND deleted_at < $1`,
    [cutoffDate],
  );

  if (usersResult.rows.length === 0) {
    return 0;
  }

  const userIds = usersResult.rows.map((r) => r.id);

  // 彻底删除用户相关数据（按依赖顺序删除）
  await transaction(async (client) => {
    // 删除积分流水
    await client.query(
      'DELETE FROM credit_transactions WHERE user_id = ANY($1)',
      [userIds],
    );

    // 删除时间银行流水
    await client.query(
      'DELETE FROM time_transactions WHERE to_user_id = ANY($1) OR from_user_id = ANY($1)',
      [userIds],
    );

    // 删除时间账户
    await client.query(
      'DELETE FROM time_accounts WHERE user_id = ANY($1)',
      [userIds],
    );

    // 删除注销申请记录
    await client.query(
      'DELETE FROM deletion_requests WHERE user_id = ANY($1)',
      [userIds],
    );

    // 删除举报记录
    await client.query(
      'DELETE FROM reports WHERE reporter_id = ANY($1)',
      [userIds],
    );

    // 删除用户本身
    await client.query(
      'DELETE FROM users WHERE id = ANY($1)',
      [userIds],
    );
  });

  logger.info({ count: userIds.length }, '[数据删除] 软删除数据清理完成');

  return userIds.length;
}

export const dataDeletionService = {
  submitDeletionRequest,
  getDeletionRequestStatus,
  cancelDeletionRequest,
  getDeletionRequests,
  reviewDeletionRequest,
  executeAnonymization,
  cleanupSoftDeletedData,
};