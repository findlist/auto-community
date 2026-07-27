import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
// validate 包装 express-validator 校验链，校验失败时标准化返回 422
// 设计原因：仅传入 body() 数组不会自动拦截非法请求，必须经 validate 检查 validationResult 后短路返回
import { validate, getPagination, uuidParam, uuidQuery, queryStringLength } from '../middleware/validator';
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
import { safeNotify } from '../utils/safeNotify';
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
// uuidQuery 格式校验 + if 必填校验分层：
// - 未传 post_id：uuidQuery（optional=true）不触发，if 抛 400 BadRequestError（缺少必填参数）
// - 传了非法 post_id（如 'abc'）：uuidQuery 校验失败抛 422（参数格式错误）
// - 传了合法 post_id：两层校验均通过，进入 service 层
router.get('/recommend', authenticate, validate([
  uuidQuery('post_id'),
]), asyncHandler(async (req: Request, res: Response) => {
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
router.get('/posts',
  // keyword 长度上限 100 字符：防止超长搜索关键词穿透到 service 层拼入 ILIKE 查询，造成 DB 全表扫描压力
  // category 长度上限 50 字符：对齐 skill_posts.category VARCHAR(50) schema，超长值无法命中索引属无效查询
  validate([
    queryStringLength('keyword', 100),
    queryStringLength('category', 50),
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    // 设计原因：req.query 字段类型为 string | ParsedQs | 数组，service 层 SkillPostFilters 要求 string，
    // 此处显式收窄为 string | undefined，避免 ParsedQs 对象静默流入 SQL 参数
    const { type, category, keyword } = req.query as Record<string, string | undefined>;
    const { page, pageSize } = getPagination(req);
    const result = await skillService.getPostList({ type, category, keyword }, page, pageSize);
    paginated(res, result.list, result.total, result.page, result.pageSize);
  }));

// GET /api/skills/posts/:id - 获取技能帖子详情
// uuidParam 前置校验：与 users/address/emergency/kitchen 路由范式对齐，非法 id 在路由层 422 拦截
router.get('/posts/:id',
  validate([uuidParam()]),
  asyncHandler(async (req: Request, res: Response) => {
    const post = await skillService.getPostById(req.params.id);
    success(res, post);
  })
);

router.post('/posts', authenticate, createPostLimiter, auditMiddleware('CREATE_SKILL_POST', { resourceType: 'skill_post' }), validate([
  body('type').isIn(['offer', 'request']).withMessage('type 必须为 offer 或 request'),
  // isString 前置校验类型：notEmpty 对数字/对象等非字符串类型放行，isString 严格校验字符串类型
  // isLength 同时校验非空（min:1）与上限（对齐 DB schema VARCHAR），替代 notEmpty 的语义模糊行为
  body('category').isString().isLength({ min: 1, max: 50 }).withMessage('类别不能为空且不超过50字符'),
  body('title').isString().isLength({ min: 1, max: 100 }).withMessage('标题不能为空且不超过100字符'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, CreateSkillPostBody>, res: Response) => {
  const post = await skillService.createPost(req.user!.id, req.body);
  // 向量入库 + Pipeline 处理均为 fire-and-forget，失败不阻塞主流程但需记录日志便于排查
  // 保留 .then 内的成功 info 日志，对 .then 链整体用 safeNotify 包装吞错并加 warn 日志
  safeNotify(
    aiService.storeEmbedding(post.id, 'skill', `${post.title} ${post.description}`),
    { userId: req.user!.id, postId: post.id, type: 'skill' },
  );
  created(res, post);
  const postText = `${req.body.title} ${req.body.description}`;
  safeNotify(
    processPostPipeline(postText, req.user!.id, 'skill').then((result) => {
      logger.info({ postId: post.id, classification: result.classification, riskScore: result.riskAssessment.score }, '[Pipeline] 技能帖子处理完成');
    }),
    { userId: req.user!.id, postId: post.id, type: 'skill' },
  );
}));

// PUT /api/skills/posts/:id - 更新技能帖子
// 中间件顺序：authenticate → validate → auditMiddleware → asyncHandler（与 emergency/kitchen 范式对齐）
router.put('/posts/:id', authenticate, validate([
  // uuidParam 前置校验：非法 id 在路由层 422 拦截，避免穿透到 service 层
  uuidParam(),
  // 更新场景字段全部 optional（Partial<CreateSkillPostDTO>），仅校验传入字段格式
  // 设计原因：原实现无 validate 中间件，req.body 直接透传 service 层，
  // 非法值（负数 credit_price、超长 title）依赖 service 层兜底校验或导致 500
  // updatePost 字段补 isString：isLength 对非字符串行为不确定，isString 前置校验保证类型安全
  body('title').optional().isString().isLength({ min: 1, max: 100 }).withMessage('标题长度为1-100字符'),
  body('category').optional().isString().isLength({ min: 1, max: 50 }).withMessage('类别长度为1-50字符'),
  body('description').optional().isString().isLength({ max: 2000 }).withMessage('描述不能超过2000字符'),
  body('credit_price').optional().isInt({ min: 0 }).withMessage('积分价格必须为非负整数'),
  body('images').optional().isArray().withMessage('图片必须为数组'),
  body('tags').optional().isArray().withMessage('标签必须为数组'),
  body('address').optional().isString().isLength({ max: 200 }).withMessage('地址不能超过200字符'),
]), auditMiddleware('UPDATE_SKILL_POST', { resourceType: 'skill_post', getResourceId: (req) => req.params.id }), asyncHandler(async (req: Request<Record<string, string>, unknown, UpdateSkillPostBody>, res: Response) => {
  const post = await skillService.updatePost(req.params.id, req.user!.id, req.body);
  success(res, post);
}));

// DELETE /api/skills/posts/:id - 删除技能帖子
// 中间件顺序：authenticate → validate → auditMiddleware → asyncHandler
router.delete('/posts/:id', authenticate, validate([uuidParam()]), auditMiddleware('DELETE_SKILL_POST', { resourceType: 'skill_post', getResourceId: (req) => req.params.id }), asyncHandler(async (req: Request, res: Response) => {
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
]), asyncHandler(async (req: Request<Record<string, string>, unknown, CreateSkillOrderBody>, res: Response) => {
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

// PUT /api/skills/orders/:id/status - 更新订单状态
// 中间件顺序：authenticate → validate → auditMiddleware → asyncHandler
// 设计原因：校验失败时不进入 auditMiddleware，避免记录「未到达 handler 的失败请求」污染审计日志
router.put('/orders/:id/status', authenticate, validate([
  uuidParam(),
  body('status').isIn(['accepted', 'rejected', 'in_progress', 'completed', 'cancelled', 'disputed']).withMessage('无效的状态值'),
  // rating 仅 completed 状态使用，若提供则必须为 1-5，避免非法评分污染信誉分
  body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('评分必须为1-5'),
  body('review').optional().isLength({ max: 500 }).withMessage('评价内容不超过500字符'),
]), auditMiddleware('UPDATE_ORDER_STATUS', {
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
}), asyncHandler(async (req: Request<Record<string, string>, unknown, UpdateSkillOrderStatusBody>, res: Response) => {
  const { status, rating, review } = req.body;
  const userId = req.user!.id;
  const orderId = req.params.id;

  let order;
  switch (status) {
    case 'accepted':
      order = await skillOrderService.acceptOrder(orderId, userId);
      break;
    case 'in_progress':
      // 卖家在 accepted 状态下开始服务，推进到 in_progress
      order = await skillOrderService.startOrder(orderId, userId);
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
// 中间件顺序：authenticate → validate → auditMiddleware → asyncHandler
router.post('/orders/:id/dispute', authenticate, validate([
  uuidParam(),
  // isString 前置校验：notEmpty 对数字/对象等非字符串类型放行，isString 严格校验字符串类型
  // isLength 同时校验非空（min:1）与上限（500字符，对齐 emergency 举报原因范式），替代 notEmpty 的语义模糊行为
  body('reason').isString().isLength({ min: 1, max: 500 }).withMessage('争议原因不能为空且不超过500字符'),
]), auditMiddleware('DISPUTE_ORDER', {
  resourceType: 'order',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, DisputeOrderBody>, res: Response) => {
  const order = await skillOrderService.disputeOrder(req.params.id, req.user!.id, req.body.reason);
  success(res, order);
}));

// 处理争议：仅管理员可裁决，支持 refund/continue/cancel 三种 action
// 中间件顺序：authenticate → requireRole → validate → auditMiddleware → asyncHandler
router.put('/orders/:id/resolve', authenticate, requireRole('admin'), validate([
  uuidParam(),
  // resolution 是裁决说明：管理员操作记录需留痕便于申诉复核，isString 严格校验避免对象/数组类型穿透
  // isLength 上限 500 字符对齐 dispute.reason 范式，保持争议双方字段语义一致
  body('resolution').isString().isLength({ min: 1, max: 500 }).withMessage('处理结果说明不能为空且不超过500字符'),
  body('action').isIn(['refund', 'continue', 'cancel']).withMessage('action 必须为 refund/continue/cancel'),
]), auditMiddleware('RESOLVE_DISPUTE', {
  resourceType: 'order',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, ResolveDisputeBody>, res: Response) => {
  const { resolution, action } = req.body;
  const order = await skillOrderService.resolveDispute(req.params.id, req.user!.id, resolution, action);
  success(res, order);
}));

export default router;
