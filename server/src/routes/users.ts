import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate, getPagination } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
import { userService } from '../services/user.service';
import { dataDeletionService } from '../services/data-deletion.service';
import { success, paginated } from '../utils/response';

const router = Router();

// 用户路由请求体类型定义
// 设计原因：收窄 req.body 隐式 any，编译期校验字段访问；optional 字段对应 express-validator 的 optional() 链
interface UpdateProfileBody {
  nickname?: string;
  avatar?: string;
}

interface VerifyBody {
  realName: string;
  idCard: string;
}

interface DeletionRequestBody {
  reason?: string;
}

/**
 * @openapi
 * /users/profile:
 *   get:
 *     tags: [用户]
 *     summary: 获取当前用户资料
 *     description: 返回登录用户的完整资料，含积分余额、信誉分等。
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 查询成功
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
 *                   description: 用户资料
 *       401:
 *         description: 未授权
 */
router.get('/profile', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getProfile(req.user!.id);
  success(res, user);
}));

/**
 * @openapi
 * /users/profile:
 *   put:
 *     tags: [用户]
 *     summary: 更新当前用户资料
 *     description: 更新登录用户的昵称、头像等可编辑字段。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nickname:
 *                 type: string
 *                 minLength: 2
 *                 description: 新昵称
 *               avatar:
 *                 type: string
 *                 format: uri
 *                 description: 头像 URL
 *     responses:
 *       200:
 *         description: 更新成功
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
 *                   description: 更新后的用户资料
 *       401:
 *         description: 未授权
 *       422:
 *         description: 参数校验失败
 */
router.put('/profile', authenticate, validate([
  body('nickname').optional().isLength({ min: 2 }).withMessage('昵称至少2个字符'),
  // avatar 仅校验为字符串，URL 合法性由 service 层 validateImageUrl 统一校验
  // 支持 /uploads/ 相对路径（本地上传）与 HTTPS 白名单域名（OSS/外链）
  body('avatar').optional().isString().withMessage('头像格式不正确'),
]), asyncHandler(async (req: Request<Record<string, string>, any, UpdateProfileBody>, res: Response) => {
  const { nickname, avatar } = req.body;
  const user = await userService.updateProfile(req.user!.id, { nickname, avatar });
  success(res, user, '更新成功');
}));

router.get('/credit-history', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const result = await userService.getCreditHistory(req.user!.id, page, pageSize);
  paginated(res, result.list, result.total, page, pageSize);
}));

router.get('/time-history', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const result = await userService.getTimeHistory(req.user!.id, page, pageSize);
  paginated(res, result.list, result.total, page, pageSize);
}));

// 通配路由 :id 必须放在所有具名 GET 路由之后，否则会拦截 /credit-history、/time-history 等路径
router.get('/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getUserById(req.params.id);
  success(res, user);
}));

// ===================== 实名认证 =====================

/**
 * @openapi
 * /users/verify:
 *   post:
 *     tags: [用户]
 *     summary: 提交实名认证申请
 *     description: 用户提交实名认证申请，包含真实姓名和身份证号。身份证号使用 AES-256-GCM 加密存储。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - realName
 *               - idCard
 *             properties:
 *               realName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 100
 *                 description: 真实姓名
 *               idCard:
 *                 type: string
 *                 pattern: '^[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$'
 *                 description: 身份证号（18位）
 *     responses:
 *       200:
 *         description: 申请提交成功
 *       400:
 *         description: 参数错误或已有认证记录
 *       409:
 *         description: 身份证号已被其他用户认证
 */
router.post('/verify', authenticate, validate([
  body('realName').isLength({ min: 2, max: 100 }).withMessage('真实姓名长度需在2-100字符之间'),
  body('idCard').matches(/^[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/).withMessage('身份证号格式不正确'),
]), asyncHandler(async (req: Request<Record<string, string>, any, VerifyBody>, res: Response) => {
  const { realName, idCard } = req.body;
  const result = await userService.submitVerification(req.user!.id, realName, idCard);
  success(res, result, result.message);
}));

/**
 * @openapi
 * /users/verify/status:
 *   get:
 *     tags: [用户]
 *     summary: 获取实名认证状态
 *     description: 返回当前用户的实名认证状态及申请详情。
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 查询成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verifyStatus:
 *                   type: string
 *                   enum: [pending, approved, rejected, null]
 *                 submittedAt:
 *                   type: string
 *                   format: date-time
 *                 request:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     realName:
 *                       type: string
 *                     status:
 *                       type: string
 *                     rejectReason:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 */
router.get('/verify/status', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.getVerificationStatus(req.user!.id);
  success(res, result);
}));

// ===================== 账号注销 =====================

/**
 * @openapi
 * /users/deletion:
 *   post:
 *     tags: [用户]
 *     summary: 提交账号注销申请
 *     description: 用户提交账号注销申请，需管理员审核后执行匿名化处理。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 description: 注销原因（可选）
 *     responses:
 *       200:
 *         description: 申请提交成功
 *       400:
 *         description: 已被封禁或已有待处理申请
 *       409:
 *         description: 已提交过注销申请
 */
router.post('/deletion', authenticate, validate([
  body('reason').optional().isLength({ max: 500 }).withMessage('注销原因最多500字符'),
]), asyncHandler(async (req: Request<Record<string, string>, any, DeletionRequestBody>, res: Response) => {
  const { reason } = req.body;
  const result = await dataDeletionService.submitDeletionRequest(req.user!.id, reason);
  success(res, result, result.message);
}));

/**
 * @openapi
 * /users/deletion/status:
 *   get:
 *     tags: [用户]
 *     summary: 获取账号注销申请状态
 *     description: 返回当前用户的注销申请状态及详情。
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 查询成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 userId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, approved, rejected, completed]
 *                 reason:
 *                   type: string
 *                 createdAt:
 *                   type: string
 *                   format: date-time
 *                 reviewedAt:
 *                   type: string
 *                   format: date-time
 *                 completedAt:
 *                   type: string
 *                   format: date-time
 */
router.get('/deletion/status', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const result = await dataDeletionService.getDeletionRequestStatus(req.user!.id);
  success(res, result);
}));

/**
 * @openapi
 * /users/deletion:
 *   delete:
 *     tags: [用户]
 *     summary: 取消账号注销申请
 *     description: 取消待审核的注销申请（仅 pending 状态可取消）。
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 取消成功
 *       400:
 *         description: 无可取消的申请
 */
router.delete('/deletion', authenticate, asyncHandler(async (req: Request, res: Response) => {
  await dataDeletionService.cancelDeletionRequest(req.user!.id);
  success(res, null, '注销申请已取消');
}));

export default router;
