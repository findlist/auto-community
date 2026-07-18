import { query, transaction, SqlParam } from '../config/database';
import { NotFoundError, BadRequestError, ConflictError } from '../utils/errors';
import { toUserResponse, UserRow, USER_COLUMNS } from './auth.service';
import { userCache } from './cache.service';
import { encryptIdCard, hashIdCard } from '../utils/crypto';
import { validateImageUrl, sanitizeXss } from '../utils/sanitize';
import logger from '../utils/logger';

// credit_transactions 表显式查询列：替代 SELECT *，防御未来新增字段意外泄露
// 字段对齐 CreditTransactionRow 接口声明，列为硬编码常量非用户输入，模板插值无注入风险
const CREDIT_TRANSACTION_COLUMNS = `id, user_id, type, amount, balance_after, reference_id,
  reference_type, description, created_at`;

// 积分流水 DB Row：与 credit_transactions 表结构对齐
interface CreditTransactionRow {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  balance_after: number;
  reference_id: string | null;
  reference_type: string | null;
  description: string | null;
  created_at: Date;
}

// 用户认证状态查询行：submitVerification 中校验当前状态用
interface UserVerifyStatusRow {
  verify_status: string | null;
}

// 认证申请查重行：submitVerification 中检查身份证号是否已被其他用户占用
interface VerificationRequestExistsRow {
  user_id: string;
}

// 认证详情查询行：getVerificationStatus 的 users LEFT JOIN verification_requests 结果
interface VerificationDetailRow {
  verify_status: string | null;
  verify_submitted_at: Date | null;
  request_id: string | null;
  real_name: string | null;
  request_status: string | null;
  reject_reason: string | null;
  created_at: Date | null;
  reviewed_at: Date | null;
}

function toCreditTransaction(row: CreditTransactionRow) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balance_after,
    referenceId: row.reference_id,
    referenceType: row.reference_type,
    description: row.description,
    createdAt: row.created_at,
  };
}

async function getProfile(userId: string) {
  const { rows } = await query<UserRow>(
    `SELECT id, phone, nickname, avatar, credit_balance, time_balance, reputation_score, created_at
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (rows.length === 0) throw new NotFoundError('用户');
  // 本人查询：isSelf=true，返回解密后的完整手机号
  return toUserResponse(rows[0], true);
}

async function updateProfile(userId: string, data: { nickname?: string; avatar?: string }) {
  // 头像 URL 校验：与图片字段保持一致，支持 /uploads/ 相对路径与 HTTPS 白名单域名
  // 设计原因：本地上传返回 /uploads/ 相对路径，旧 isURL 校验会拒绝；统一走 validateImageUrl
  if (data.avatar !== undefined && data.avatar !== null && data.avatar !== '') {
    validateImageUrl(data.avatar);
  }

  // nickname XSS 清洗：与 auth.service register 入口对齐
  // 设计原因：nickname 在几乎所有业务列表中渲染（帖子/订单/评价/通知），未清洗会触发存储型 XSS
  const safeNickname = data.nickname !== undefined ? sanitizeXss(data.nickname) as string : undefined;

  const fields: string[] = [];
  // SQL 参数数组：收紧为 SqlParam[]，避免误传函数/Symbol 等非 SQL 友好类型
  const values: SqlParam[] = [];
  let paramIndex = 1;

  if (safeNickname !== undefined) {
    fields.push(`nickname = $${paramIndex++}`);
    values.push(safeNickname);
  }
  if (data.avatar !== undefined) {
    fields.push(`avatar = $${paramIndex++}`);
    values.push(data.avatar);
  }

  fields.push('updated_at = NOW()');
  values.push(userId);

  // RETURNING 显式列名：仅返回 toUserResponse 所需字段，避免 phone_hash/id_card_encrypted 等敏感字段泄露
  const { rows } = await query<UserRow>(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} AND deleted_at IS NULL RETURNING ${USER_COLUMNS}`,
    values,
  );
  if (rows.length === 0) throw new NotFoundError('用户');

  // 用户信息更新后清除缓存
  await userCache.invalidate(userId);

  // 本人更新资料：isSelf=true，返回完整手机号
  return toUserResponse(rows[0], true);
}

async function getUserById(userId: string) {
  // 使用缓存：先查缓存，未命中时查数据库并缓存结果
  return userCache.get(userId, async () => {
    const { rows } = await query<UserRow>(
      `SELECT id, phone, nickname, avatar, reputation_score, created_at
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundError('用户');
    // 他人查询：isSelf=false（默认），返回脱敏手机号
    return toUserResponse(rows[0]);
  });
}

async function getCreditHistory(userId: string, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) FROM credit_transactions WHERE user_id = $1`, [userId]),
    query<CreditTransactionRow>(
      `SELECT ${CREDIT_TRANSACTION_COLUMNS} FROM credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  return {
    list: listResult.rows.map(toCreditTransaction),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

async function getTimeHistory(userId: string, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) FROM credit_transactions WHERE user_id = $1 AND type IN ('time_earn', 'time_spend')`,
      [userId],
    ),
    query<CreditTransactionRow>(
      `SELECT ${CREDIT_TRANSACTION_COLUMNS} FROM credit_transactions
       WHERE user_id = $1 AND type IN ('time_earn', 'time_spend')
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  return {
    list: listResult.rows.map(toCreditTransaction),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

// ===================== 实名认证 =====================

// 身份证号格式校验：18位，最后一位可以是数字或X
function validateIdCard(idCard: string): boolean {
  return /^[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(idCard);
}

// 提交实名认证申请
async function submitVerification(userId: string, realName: string, idCard: string) {
  // 校验身份证号格式
  if (!validateIdCard(idCard)) {
    throw new BadRequestError('身份证号格式不正确');
  }

  // 校验真实姓名长度
  if (!realName || realName.length < 2 || realName.length > 100) {
    throw new BadRequestError('真实姓名长度需在2-100字符之间');
  }

  // 入库前清洗真实姓名，防止存储型 XSS
  // 设计原因：real_name 会写入 verification_requests 表，管理员后台审核详情页直接渲染，
  // 同时审核结果回执也会展示申请人姓名，未清洗会在管理端与用户端触发存储型 XSS
  const safeRealName = sanitizeXss(realName) as string;

  // 检查用户是否已有认证记录
  const userResult = await query<UserVerifyStatusRow>(
    'SELECT verify_status FROM users WHERE id = $1 AND deleted_at IS NULL',
    [userId],
  );
  if (userResult.rows.length === 0) {
    throw new NotFoundError('用户');
  }

  const currentStatus = userResult.rows[0].verify_status;
  if (currentStatus === 'approved') {
    throw new BadRequestError('您已完成实名认证');
  }
  if (currentStatus === 'pending') {
    throw new BadRequestError('您的认证申请正在审核中，请耐心等待');
  }

  // 计算身份证号哈希，检查是否已被其他用户认证
  const idCardHash = hashIdCard(idCard);
  const existingResult = await query<VerificationRequestExistsRow>(
    'SELECT user_id FROM verification_requests WHERE id_card_hash = $1 AND status IN (\'pending\', \'approved\')',
    [idCardHash],
  );
  if (existingResult.rows.length > 0) {
    throw new ConflictError('该身份证号已被其他用户认证');
  }

  // 加密身份证号
  const idCardEncrypted = encryptIdCard(idCard);

  // 创建认证申请记录并更新用户状态
  // 捕获 PostgreSQL unique_violation（错误码 23505）：
  // 设计原因：SELECT 检查在事务外存在 TOCTOU 边界情况，两个并发请求可能同时通过 SELECT 检查
  // 但只有一个 INSERT 能成功。部分唯一索引（仅约束 pending/approved）是兜底防线，
  // 触发 23505 时转换为 ConflictError 返回 409，避免抛出 QueryFailedError 导致 500。
  try {
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO verification_requests (user_id, real_name, id_card_encrypted, id_card_hash, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [userId, safeRealName, idCardEncrypted, idCardHash],
      );

      await client.query(
        'UPDATE users SET verify_status = \'pending\', verify_submitted_at = NOW() WHERE id = $1',
        [userId],
      );
    });
  } catch (err) {
    // node-postgres 错误对象带 code 字段（字符串 '23505' 表示 unique_violation）
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
      throw new ConflictError('该身份证号已被其他用户认证');
    }
    // 非 23505 错误（连接断开、表损坏等）原样抛出，留痕便于运维定位
    logger.error({ err, userId }, '[submitVerification] 实名认证提交 DB 异常');
    throw err;
  }

  // 清除用户缓存
  await userCache.invalidate(userId);

  return { status: 'pending', message: '实名认证申请已提交，请等待审核' };
}

// 获取用户认证状态
async function getVerificationStatus(userId: string) {
  const { rows } = await query<VerificationDetailRow>(
    `SELECT u.verify_status, u.verify_submitted_at,
            vr.id as request_id, vr.real_name, vr.status as request_status,
            vr.reject_reason, vr.created_at, vr.reviewed_at
     FROM users u
     LEFT JOIN verification_requests vr ON u.id = vr.user_id AND (vr.status != 'rejected' OR (vr.status = 'rejected' AND u.verify_status = 'rejected'))
     WHERE u.id = $1 AND u.deleted_at IS NULL
     ORDER BY vr.created_at DESC LIMIT 1`,
    [userId],
  );

  if (rows.length === 0) {
    throw new NotFoundError('用户');
  }

  const row = rows[0];
  return {
    verifyStatus: row.verify_status || null,
    submittedAt: row.verify_submitted_at || null,
    request: row.request_id ? {
      id: row.request_id,
      realName: row.real_name,
      status: row.request_status,
      rejectReason: row.reject_reason || null,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at || null,
    } : null,
  };
}

export const userService = {
  getProfile,
  updateProfile,
  getUserById,
  getCreditHistory,
  getTimeHistory,
  submitVerification,
  getVerificationStatus,
};
