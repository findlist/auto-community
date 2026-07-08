import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
// validate 包装 express-validator 校验链，校验失败时标准化返回 422
// 设计原因：仅传入 body() 数组不会自动拦截非法请求，必须经 validate 检查 validationResult 后短路返回
import { validate, getPagination } from '../middleware/validator';
import { body } from 'express-validator';
import { createPostLimiter, orderLimiter } from '../middleware/rateLimiter';
import { auditMiddleware } from '../middleware/auditLog';
import { success, created, paginated, deleted } from '../utils/response';
import { skillService } from '../services/skill.service';
import type { CreateSkillPostDTO, UpdateSkillPostDTO } from '../services/skill.service';
import { skillOrderService } from '../services/skill-order.service';
import type { ResolveAction } from '../services/skill-order.service';
import { aiService, processPostPipeline } from '../services/ai.service';
import { logger } from '../utils/logger';
import { BadRequestError } from '../utils/errors';

const router = Router();

// ===================== 请求体类型定义 =====================
// 复用 service 层导出的 DTO 类型，避免重复定义；编译期与运行时双重校验
type CreateSkillPostBody = CreateSkillPostDTO;
type UpdateSkillPostBody = UpdateSkillPostDTO;
interface CreateSkillOrderBody {
  post_id: string;
}
interface UpdateSkillOrderStatusBody {
  status: 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'cancelled' | 'disputed';
  // rating/review 仅 completed 状态时使用，类型上保持 optional
  rating?: number;
  review?: string;
}
interface DisputeOrderBody {
  reason: string;
}
interface ResolveDisputeBody {
  resolution: string;
  action: ResolveAction;
}

// 智能推荐：基于指定帖子，调用 AI 匹配推荐用户（需认证）
router.get('/recommend', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const postId = req.query.post_id as string;
  if (!postId) {
    throw new BadRequestError('post_id 参数必填');
  }
  const recommendations = await aiService.matchSkill(postId, req.user?.id);
  success(res, recommendations);
}));

/**
 * @openapi
 * /skills/posts:
 *   get:
 *     tags: [技能]
 *     summary: 获取技能帖子列表
 *     description: 支持按类型、分类、关键词筛选，分页返回技能帖子列表。
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [offer, request]
 *         description: 帖子类型（offer 提供 / request 求助）
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: 帖子分类
 *       - in: query
 *         name: keyword
 *         schema:
 *           type: string
 *         description: 标题/描述关键词
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
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
 *                   properties:
 *                     list:
 *                       type: array
 *                       items:
 *                         type: object
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     pageSize:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     hasNext:
 *                       type: boolean
 */
router.get('/posts', asyncHandler(async (req: Request, res: Response) => {
  // 设计原因：req.query 字段类型为 string | ParsedQs | 数组，service 层 SkillPostFilters 要求 string，
  // 此处显式收窄为 string | undefined，避免 ParsedQs 对象静默流入 SQL 参数
  const { type, category, keyword } = req.query as Record<string, string | undefined>;
  const { page, pageSize } = getPagination(req);
  const result = await skillService.getPostList({ type, category, keyword }, page, pageSize);
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

router.get('/posts/:id', asyncHandler(async (req: Request, res: Response) => {
  const post = await skillService.getPostById(req.params.id);
  success(res, post);
}));

router.post('/posts', authenticate, createPostLimiter, validate([
  body('type').isIn(['offer', 'request']).withMessage('type 必须为 offer 或 request'),
  body('category').notEmpty().withMessage('category 必填'),
  body('title').notEmpty().isLength({ max: 100 }).withMessage('title 必填且不超过100字符'),
]), asyncHandler(async (req: Request<Record<string, string>, any, CreateSkillPostBody>, res: Response) => {
  const post = await skillService.createPost(req.user!.id, req.body);
  aiService.storeEmbedding(post.id, 'skill', `${post.title} ${post.description}`).catch(() => {});
  created(res, post);
  const postText = `${req.body.title} ${req.body.description}`;
  processPostPipeline(postText, req.user!.id, 'skill')
    .then((result) => {
      logger.info({ postId: post.id, classification: result.classification, riskScore: result.riskAssessment.score }, '[Pipeline] 技能帖子处理完成');
    })
    .catch(() => {});
}));

router.put('/posts/:id', authenticate, asyncHandler(async (req: Request<Record<string, string>, any, UpdateSkillPostBody>, res: Response) => {
  const post = await skillService.updatePost(req.params.id, req.user!.id, req.body);
  success(res, post);
}));

router.delete('/posts/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  await skillService.deletePost(req.params.id, req.user!.id);
  deleted(res);
}));

/**
 * @openapi
 * /skills/orders:
 *   post:
 *     tags: [技能]
 *     summary: 创建技能订单
 *     description: 买家对技能帖子下单，系统冻结相应积分作为担保。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [post_id]
 *             properties:
 *               post_id:
 *                 type: string
 *                 format: uuid
 *                 description: 技能帖子 ID
 *     responses:
 *       201:
 *         description: 下单成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: CREATED
 *                 data:
 *                   type: object
 *                   description: 订单详情
 *       400:
 *         description: 帖子不可交易 / 不能购买自己的帖子
 *       404:
 *         description: 帖子不存在
 *       422:
 *         description: 参数校验失败
 *       429:
 *         description: 操作过于频繁
 */
router.post('/orders', authenticate, orderLimiter, auditMiddleware('CREATE_ORDER', { resourceType: 'order' }), validate([
  body('post_id').isUUID().withMessage('post_id 必须为有效 UUID'),
]), asyncHandler(async (req: Request<Record<string, string>, any, CreateSkillOrderBody>, res: Response) => {
  const order = await skillOrderService.createOrder(req.user!.id, req.body.post_id);
  created(res, order);
}));

router.get('/orders', authenticate, asyncHandler(async (req: Request, res: Response) => {
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { status } = req.query as Record<string, string | undefined>;
  const { page, pageSize } = getPagination(req);
  const result = await skillOrderService.getOrderList(req.user!.id, { status: status as string }, page, pageSize);
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

router.put('/orders/:id/status', authenticate, auditMiddleware('UPDATE_ORDER_STATUS', {
  resourceType: 'order',
  getResourceId: (req) => req.params.id,
  // 根据请求体中的 status 动态生成 action 名称，区分 accept/reject/complete/cancel
  getAction: (req) => {
    const statusActionMap: Record<string, string> = {
      accepted: 'ACCEPT_ORDER',
      rejected: 'REJECT_ORDER',
      completed: 'COMPLETE_ORDER',
      cancelled: 'CANCEL_ORDER',
    };
    const status = req.body?.status as string | undefined;
    return statusActionMap[status ?? ''] ?? 'UPDATE_ORDER_STATUS';
  },
}), validate([
  body('status').isIn(['accepted', 'rejected', 'in_progress', 'completed', 'cancelled', 'disputed']).withMessage('无效的状态值'),
]), asyncHandler(async (req: Request<Record<string, string>, any, UpdateSkillOrderStatusBody>, res: Response) => {
  const { status, rating, review } = req.body;
  const userId = req.user!.id;
  const orderId = req.params.id;

  let order;
  switch (status) {
    case 'accepted':
      order = await skillOrderService.acceptOrder(orderId, userId);
      break;
    case 'rejected':
      order = await skillOrderService.rejectOrder(orderId, userId);
      break;
    case 'completed':
      order = await skillOrderService.completeOrder(orderId, userId, rating, review);
      break;
    case 'cancelled':
      order = await skillOrderService.cancelOrder(orderId, userId);
      break;
    case 'disputed':
      // disputed 状态需通过专用 dispute 接口发起，此处仅返回订单详情（含争议信息）
      order = await skillOrderService.getOrderById(orderId, userId);
      break;
    default:
      order = await skillOrderService.getOrderById(orderId, userId);
  }
  success(res, order);
}));

// 发起争议：买家或卖家在订单进行中可发起争议，状态置为 disputed
router.post('/orders/:id/dispute', authenticate, auditMiddleware('DISPUTE_ORDER', {
  resourceType: 'order',
  getResourceId: (req) => req.params.id,
}), validate([
  body('reason').notEmpty().withMessage('争议原因不能为空'),
]), asyncHandler(async (req: Request<Record<string, string>, any, DisputeOrderBody>, res: Response) => {
  const order = await skillOrderService.disputeOrder(req.params.id, req.user!.id, req.body.reason);
  success(res, order);
}));

// 处理争议：仅管理员可裁决，支持 refund/continue/cancel 三种 action
router.put('/orders/:id/resolve', authenticate, requireRole('admin'), auditMiddleware('RESOLVE_DISPUTE', {
  resourceType: 'order',
  getResourceId: (req) => req.params.id,
}), validate([
  body('resolution').notEmpty().withMessage('处理结果说明不能为空'),
  body('action').isIn(['refund', 'continue', 'cancel']).withMessage('action 必须为 refund/continue/cancel'),
]), asyncHandler(async (req: Request<Record<string, string>, any, ResolveDisputeBody>, res: Response) => {
  const { resolution, action } = req.body;
  const order = await skillOrderService.resolveDispute(req.params.id, req.user!.id, resolution, action);
  success(res, order);
}));

export default router;
