import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
import { auditMiddleware } from '../middleware/auditLog';
import { authService } from '../services/auth.service';
import { success } from '../utils/response';

const router = Router();

// 认证相关请求体类型定义
// 设计原因：Express 默认将 req.body 推断为 any，此处显式声明每个路由的请求体结构，
// 让编译期即可发现字段拼写错误与类型不匹配，配合 express-validator 形成双重保障
interface RegisterBody {
  phone: string;
  password: string;
  nickname: string;
  privacyConsentVersion: string;
}

interface LoginBody {
  phone: string;
  password: string;
}

interface RefreshTokenBody {
  refreshToken: string;
}

interface ForgotPasswordBody {
  phone: string;
}

interface ResetPasswordBody {
  phone: string;
  code: string;
  password: string;
}

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [认证]
 *     summary: 用户注册
 *     description: 通过手机号、密码、昵称注册新用户，注册成功后返回用户信息。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, password, nickname]
 *             properties:
 *               phone:
 *                 type: string
 *                 description: 手机号（符合中国大陆手机号格式）
 *                 example: "13800138000"
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 description: 密码（至少 6 位）
 *               nickname:
 *                 type: string
 *                 minLength: 2
 *                 description: 昵称（至少 2 个字符）
 *     responses:
 *       200:
 *         description: 注册成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                   example: 注册成功
 *                 data:
 *                   type: object
 *                   description: 用户信息与令牌
 *       422:
 *         description: 参数校验失败
 *       429:
 *         description: 请求过于频繁
 */
// POST /register - 用户注册
router.post('/register', authLimiter, auditMiddleware('REGISTER', { resourceType: 'user' }), validate([
  body('phone').matches(/^1[3-9]\d{9}$/).withMessage('手机号格式不正确'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6位'),
  body('nickname').isLength({ min: 2 }).withMessage('昵称至少2个字符'),
  body('privacyConsentVersion').notEmpty().withMessage('必须同意隐私政策')
]), asyncHandler(async (req: Request<Record<string, string>, unknown, RegisterBody>, res: Response) => {
  const { phone, password, nickname, privacyConsentVersion } = req.body;
  const result = await authService.register(phone, password, nickname, privacyConsentVersion);
  success(res, result, '注册成功');
}));

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [认证]
 *     summary: 用户登录
 *     description: 通过手机号与密码登录，返回 accessToken 与 refreshToken。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, password]
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "13800138000"
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 登录成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                   example: 登录成功
 *                 data:
 *                   type: object
 *                   description: 令牌与用户信息
 *       401:
 *         description: 手机号或密码错误
 *       429:
 *         description: 登录尝试过多
 */
// POST /login - 用户登录
router.post('/login', authLimiter, auditMiddleware('LOGIN', { resourceType: 'user' }), validate([
  body('phone').notEmpty().withMessage('请输入手机号'),
  body('password').notEmpty().withMessage('请输入密码')
]), asyncHandler(async (req: Request<Record<string, string>, unknown, LoginBody>, res: Response) => {
  const { phone, password } = req.body;
  const result = await authService.login(phone, password);
  success(res, result, '登录成功');
}));

/**
 * @openapi
 * /auth/refresh-token:
 *   post:
 *     tags: [认证]
 *     summary: 刷新令牌
 *     description: 使用 refreshToken 换取新的 accessToken，避免频繁登录。
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: 登录时返回的 refreshToken
 *     responses:
 *       200:
 *         description: 刷新成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: SUCCESS
 *                 data:
 *                   type: object
 *                   description: 新的令牌信息
 *       401:
 *         description: refreshToken 无效或已过期
 */
// POST /refresh-token - 刷新令牌（限流：防止通过暴力刷新令牌规避安全策略）
router.post('/refresh-token', authLimiter, validate([
  body('refreshToken').notEmpty().withMessage('请提供refreshToken')
]), asyncHandler(async (req: Request<Record<string, string>, unknown, RefreshTokenBody>, res: Response) => {
  const { refreshToken } = req.body;
  const result = await authService.refreshToken(refreshToken);
  success(res, result, '刷新成功');
}));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [认证]
 *     summary: 用户登出
 *     description: 将当前 accessToken 加入黑名单，使其立即失效。
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 登出成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: SUCCESS
 *                 message:
 *                   type: string
 *                   example: 登出成功
 *       401:
 *         description: 未授权
 */
// POST /logout - 用户登出
router.post('/logout', authenticate, auditMiddleware('LOGOUT', { resourceType: 'user' }), asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : '';
  await authService.logout(token);
  success(res, null, '登出成功');
}));

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [认证]
 *     summary: 忘记密码
 *     description: 发送密码重置验证码到手机
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone]
 *             properties:
 *               phone:
 *                 type: string
 *                 description: 手机号
 *                 example: "13800138000"
 *     responses:
 *       200:
 *         description: 验证码已发送
 *       422:
 *         description: 参数校验失败
 */
// POST /forgot-password - 忘记密码，发送验证码
router.post('/forgot-password', authLimiter, validate([
  body('phone').matches(/^1[3-9]\d{9}$/).withMessage('手机号格式不正确')
]), asyncHandler(async (req: Request<Record<string, string>, unknown, ForgotPasswordBody>, res: Response) => {
  const { phone } = req.body;
  await authService.forgotPassword(phone);
  success(res, null, '验证码已发送，请查收');
}));

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [认证]
 *     summary: 重置密码
 *     description: 使用验证码重置密码
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, code, password]
 *             properties:
 *               phone:
 *                 type: string
 *                 description: 手机号
 *                 example: "13800138000"
 *               code:
 *                 type: string
 *                 description: 6位验证码
 *                 example: "123456"
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 description: 新密码（至少6位）
 *     responses:
 *       200:
 *         description: 密码重置成功
 *       400:
 *         description: 验证码错误或已过期
 *       422:
 *         description: 参数校验失败
 */
// POST /reset-password - 重置密码
// 审计接入：密码重置为高风险操作（凭验证码即可改密），需记录操作者手机号与脱敏后的请求体便于事后追溯
// sanitizeRequestBody 会自动将 phone/password 字段脱敏为 ***，code 字段不在敏感关键词清单中保留原值用于排查
router.post('/reset-password', authLimiter, auditMiddleware('RESET_PASSWORD', { resourceType: 'user' }), validate([
  body('phone').matches(/^1[3-9]\d{9}$/).withMessage('手机号格式不正确'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('验证码为6位数字'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6位')
]), asyncHandler(async (req: Request<Record<string, string>, unknown, ResetPasswordBody>, res: Response) => {
  const { phone, code, password } = req.body;
  await authService.resetPassword(phone, code, password);
  success(res, null, '密码重置成功，请登录');
}));

export default router;
