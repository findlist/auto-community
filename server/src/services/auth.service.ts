import { query, transaction } from '../config/database';
import { redisClient } from '../config/redis';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken
} from '../middleware/auth';
import { UnauthorizedError, ConflictError, BadRequestError, NotFoundError } from '../utils/errors';
import { tokenBlacklist } from '../utils/tokenBlacklist';
import { encryptPhone, decryptPhone, hashPhone } from '../utils/crypto';
import { maskPhone } from '../utils/mask';
import { logger } from '../utils/logger';
import { sanitizeXss } from '../utils/sanitize';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// 验证码相关常量
const VERIFY_CODE_PREFIX = 'verify:reset:';
const VERIFY_CODE_TTL = 300; // 5分钟有效期

export interface UserResponse {
  id: string;
  phone: string;
  nickname: string;
  avatar: string | null;
  creditBalance: number;
  timeBalance: number;
  reputationScore: number;
  role: string;
  // 设计原因：序列化为 JSON 时统一为 ISO 字符串，避免前端处理 Date 与 string 两种类型
  createdAt: string;
}

// 用户表 DB Row：覆盖 toUserResponse 所需字段
// 设计原因：原 row: any 让字段拼写错误无法在编译期暴露，收紧后 reputation_score 为 string
// （pg 默认将 DECIMAL 解析为 string），需在序列化时用 Number() 转换为 number
// 导出供 user.service.ts 等调用方为 query 添加泛型使用
export interface UserRow {
  id: string;
  phone: string;
  nickname: string;
  avatar: string | null;
  credit_balance: number;
  time_balance: number;
  reputation_score: string | number;
  role: string | null;
  created_at: Date;
}

// users 表响应构造列：覆盖 toUserResponse 所需字段 + password_hash（登录密码校验用）
// 设计原因：users 表含 phone_hash/id_card_encrypted/id_card_hash 等敏感字段，
// SELECT */RETURNING * 会返回全部字段，显式列名仅返回响应构造与登录校验必需字段，
// 降低敏感数据暴露面。auth/user 两个 service 共享此常量避免列名定义分裂
export const USER_COLUMNS = `id, phone, nickname, avatar, credit_balance, time_balance,
  reputation_score, role, created_at, password_hash`;

// 兼容历史命名：登录查询专用列即 USER_COLUMNS，保留导出避免破坏外部引用
export const USER_LOGIN_COLUMNS = USER_COLUMNS;

/**
 * 将数据库行转换为用户响应对象
 * @param row 数据库行（phone 字段为密文）
 * @param isSelf 是否为用户本人查询：true 时返回解密后的完整手机号，false 时返回脱敏手机号
 *
 * 安全考虑：默认脱敏，仅本人查询时才解密返回完整手机号，避免 PII 泄露
 */
export function toUserResponse(row: UserRow, isSelf: boolean = false): UserResponse {
  let phone: string;
  try {
    // 解密手机号：本人查询返回明文，他人查询返回脱敏后的字符串
    const plainPhone = decryptPhone(row.phone);
    phone = isSelf ? plainPhone : maskPhone(plainPhone);
  } catch {
    // 解密失败时返回脱敏占位，避免抛错导致接口 500（可能是历史数据未加密）
    phone = '******';
  }

  return {
    id: row.id,
    phone,
    nickname: row.nickname,
    avatar: row.avatar,
    creditBalance: row.credit_balance,
    timeBalance: row.time_balance,
    // pg 默认将 DECIMAL 解析为 string，用 Number() 转换为 number 匹配 UserResponse 类型
    reputationScore: Number(row.reputation_score),
    role: row.role || 'user',
    // created_at 为 Date 时转为 ISO 字符串，兼容历史数据可能为 string 的情况
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  };
}

async function register(phone: string, password: string, nickname: string, privacyConsentVersion: string) {
  // 服务层防御性校验：手机号格式（路由层已有校验，此处为纵深防御）
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw new BadRequestError('手机号格式不正确');
  }

  // 入库前清洗昵称，防止存储型 XSS
  // 设计原因：nickname 会在社区列表/详情/评论等多处前端场景渲染，未清洗将导致存储型 XSS
  const safeNickname = sanitizeXss(nickname);

  // 按 phone_hash 查询：phone 字段已加密无法等值查询，使用哈希索引
  const phoneHash = hashPhone(phone);
  const existing = await query('SELECT id FROM users WHERE phone_hash = $1', [phoneHash]);
  if (existing.rows.length > 0) {
    throw new ConflictError('该手机号已注册');
  }

  // 异步哈希：避免 hashSync 阻塞 Node 事件循环（cost=10 约 100ms），影响高并发吞吐量
  const passwordHash = await bcrypt.hash(password, 10);
  // 加密手机号：写入数据库的是密文，不可逆查询
  const encryptedPhone = encryptPhone(phone);

  const result = await transaction(async (client) => {
    // RETURNING 显式列名：仅返回 toUserResponse 所需字段，避免 phone_hash/id_card_encrypted 等敏感字段出现在结果集
    const userResult = await client.query<UserRow>(
      `INSERT INTO users (phone, phone_hash, password_hash, nickname, credit_balance, privacy_consent_version, privacy_consent_at) VALUES ($1, $2, $3, $4, 100, $5, NOW()) RETURNING ${USER_COLUMNS}`,
      [encryptedPhone, phoneHash, passwordHash, safeNickname, privacyConsentVersion]
    );
    const user = userResult.rows[0];

    await client.query(
      'INSERT INTO credit_transactions (user_id, type, amount, balance_after, description) VALUES ($1, $2, $3, $4, $5)',
      [user.id, 'earn', 100, 100, '新用户注册奖励']
    );

    return user;
  });

  // JWT payload 不再携带 phone，避免 token 泄露后暴露 PII
  // 使用 safeNickname 确保 token 内也是清洗后的值，避免 JWT 解码后被注入 XSS
  const token = generateAccessToken({ id: result.id, nickname: safeNickname });
  const refreshToken = generateRefreshToken({ id: result.id, nickname: safeNickname });

  return {
    token,
    refreshToken,
    user: toUserResponse(result, true)
  };
}

async function login(phone: string, password: string) {
  // 按 phone_hash 查询：phone 字段已加密，无法直接等值查询
  const phoneHash = hashPhone(phone);
  const result = await query<UserRow & { password_hash: string }>(
    `SELECT ${USER_LOGIN_COLUMNS} FROM users WHERE phone_hash = $1 AND deleted_at IS NULL`,
    [phoneHash]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('手机号或密码错误');
  }

  const row = result.rows[0];
  // 异步比较：避免 compareSync 阻塞事件循环，与 register/resetPassword 保持一致的异步风格
  const isValidPassword = await bcrypt.compare(password, row.password_hash);
  if (!isValidPassword) {
    throw new UnauthorizedError('手机号或密码错误');
  }

  // JWT payload 不再携带 phone
  const token = generateAccessToken({ id: row.id, nickname: row.nickname });
  const refreshToken = generateRefreshToken({ id: row.id, nickname: row.nickname });

  return {
    token,
    refreshToken,
    user: toUserResponse(row, true)
  };
}

async function refreshToken(token: string) {
  // 设计原因：原 payload: any 让 payload.id 访问无类型保护，
  // 收紧为 verifyRefreshToken 的返回类型，编译期即可校验 id 字段存在
  let payload: ReturnType<typeof verifyRefreshToken>;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new UnauthorizedError('refresh token 已过期，请重新登录');
  }

  const result = await query(
    'SELECT id, nickname FROM users WHERE id = $1 AND deleted_at IS NULL',
    [payload.id]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('refresh token 已过期，请重新登录');
  }

  const row = result.rows[0];
  // JWT payload 不再携带 phone
  const newToken = generateAccessToken({ id: row.id, nickname: row.nickname });
  const newRefreshToken = generateRefreshToken({ id: row.id, nickname: row.nickname });

  return {
    token: newToken,
    refreshToken: newRefreshToken
  };
}

async function logout(token: string) {
  // 仅解码 payload 获取过期时间，不验证签名（登出时 token 已被认证中间件校验过）
  const decoded = jwt.decode(token) as { exp?: number } | null;
  if (decoded && decoded.exp) {
    // Redis 写入为异步操作，需要 await 确保黑名单生效后再返回
    await tokenBlacklist.addToBlacklist(token, decoded.exp);
  }
}

/**
 * 生成6位数字验证码
 */
function generateVerifyCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 发送密码重置验证码
 * @param phone 手机号
 */
async function forgotPassword(phone: string): Promise<void> {
  // 校验手机号格式
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw new BadRequestError('手机号格式不正确');
  }

  // 检查用户是否存在
  const phoneHash = hashPhone(phone);
  const result = await query(
    'SELECT id FROM users WHERE phone_hash = $1 AND deleted_at IS NULL',
    [phoneHash]
  );

  if (result.rows.length === 0) {
    // 安全考虑：不暴露用户是否存在，但实际不发送验证码
    logger.info({ phone: maskPhone(phone) }, '密码重置请求：用户不存在');
    return;
  }

  // 生成验证码
  const code = generateVerifyCode();
  const key = `${VERIFY_CODE_PREFIX}${phoneHash}`;

  // 存储到 Redis，有效期 5 分钟
  await redisClient.setEx(key, VERIFY_CODE_TTL, code);

  // 模拟发送验证码（实际项目中接入短信服务）
  // 安全考虑：日志中不记录明文验证码，避免日志泄露后验证码被冒用重置密码
  logger.info({ phone: maskPhone(phone) }, '密码重置验证码已生成（模拟发送）');
}

/**
 * 重置密码
 * @param phone 手机号
 * @param code 验证码
 * @param newPassword 新密码
 */
async function resetPassword(phone: string, code: string, newPassword: string): Promise<void> {
  // 校验手机号格式
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    throw new BadRequestError('手机号格式不正确');
  }

  // 校验密码长度
  if (!newPassword || newPassword.length < 6) {
    throw new BadRequestError('密码至少6位');
  }

  // 校验验证码
  const phoneHash = hashPhone(phone);
  const key = `${VERIFY_CODE_PREFIX}${phoneHash}`;
  const storedCode = await redisClient.get(key);

  if (!storedCode || storedCode !== code) {
    throw new BadRequestError('验证码错误或已过期');
  }

  // 查询用户
  const result = await query(
    'SELECT id FROM users WHERE phone_hash = $1 AND deleted_at IS NULL',
    [phoneHash]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('用户不存在');
  }

  // 异步哈希：与 register 保持一致，避免阻塞事件循环
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [passwordHash, result.rows[0].id]
  );

  // 删除验证码，防止重复使用
  await redisClient.del(key);

  logger.info({ phone: maskPhone(phone) }, '密码重置成功');
}

export const authService = {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
};
