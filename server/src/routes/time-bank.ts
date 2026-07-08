import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { authenticate, optionalAuth } from '../middleware/auth';
import { createPostLimiter, orderLimiter } from '../middleware/rateLimiter';
import { auditMiddleware } from '../middleware/auditLog';
import { success, paginated, created, updated, cursorPaginated } from '../utils/response';
import { getPagination } from '../middleware/validator';
import { timeBankService } from '../services/time-bank.service';
import { aiService, processPostPipeline } from '../services/ai.service';
import { logger } from '../utils/logger';
import { BadRequestError } from '../utils/errors';

const router = Router();

// ===================== 请求体类型定义 =====================
// 与 time-bank.service 各函数入参对齐，编译期校验 req.body 字段访问类型安全
interface TimeServiceLocation {
  x: number;
  y: number;
}
interface CreateTimeServiceBody {
  type: string;
  category: string;
  title: string;
  description?: string;
  duration_minutes: number;
  location?: TimeServiceLocation;
  address?: string;
  certification?: Record<string, unknown> | null;
  images?: string[];
}
interface UpdateTimeServiceBody {
  type?: string;
  category?: string;
  title?: string;
  description?: string;
  duration_minutes?: number;
  address?: string;
  status?: string;
  images?: string[];
}
interface CreateTimeOrderBody {
  service_id: string;
}
interface UpdateTimeOrderStatusBody {
  action: string;
  // actual_duration/rating/review 仅 action='complete' 时使用，类型上保持 optional
  actual_duration?: number;
  rating?: number;
  review?: string;
}
interface TransferTimeBody {
  to_user_id: string;
  amount: number;
  remark?: string;
}
interface DonateTimeBody {
  to_user_id: string;
  amount: number;
  remark?: string;
}
interface CreateFamilyBindingBody {
  parent_phone: string;
  relationship: string;
}
interface CreateReviewBody {
  order_id: string;
  rating: number;
  content?: string;
}
interface CreateDisputeBody {
  order_id: string;
  reason: string;
  description?: string;
  evidence?: string[];
}

// 智能推荐：基于指定服务，调用 AI 匹配推荐用户（需认证）
router.get('/recommend', authenticate, asyncHandler(async (req, res) => {
  const serviceId = req.query.service_id as string;
  if (!serviceId) {
    throw new BadRequestError('service_id 参数必填');
  }
  const recommendations = await aiService.matchTimeService(serviceId, req.user?.id);
  success(res, recommendations);
}));

/**
 * @openapi
 * /time-bank/services:
 *   get:
 *     tags: [时间银行]
 *     summary: 获取时间服务列表
 *     description: 分页返回时间银行服务列表，支持按类型与分类筛选。未登录可查看，但敏感字段会被隐藏。
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: 服务类型
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: 服务分类
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
router.get('/services', optionalAuth, asyncHandler(async (req, res) => {
  const { page, pageSize } = getPagination(req);
  const filters = { type: req.query.type as string, category: req.query.category as string };
  const result = await timeBankService.getServiceList(filters, { page, pageSize });
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

// 未登录可查看服务详情，但 service 层会隐藏 address/location/certification 等敏感信息
router.get('/services/:id', optionalAuth, asyncHandler(async (req, res) => {
  const result = await timeBankService.getServiceById(req.params.id, req.user?.id);
  success(res, result);
}));

router.post('/services', authenticate, createPostLimiter, asyncHandler(async (req: Request<Record<string, string>, any, CreateTimeServiceBody>, res: Response) => {
  const { type, category, title, description, duration_minutes, location, address, certification, images } = req.body;
  const result = await timeBankService.createService(req.user!.id, { type, category, title, description, duration_minutes, location, address, certification, images });
  aiService.storeEmbedding(result.id, 'time_service', `${title} ${description || ''}`).catch(() => {});
  created(res, result);

  const serviceText = `${title} ${description}`;
  processPostPipeline(serviceText, req.user!.id, 'time_service')
    .then((pipelineResult) => {
      logger.info({ serviceId: result.id, classification: pipelineResult.classification, riskScore: pipelineResult.riskAssessment.score }, '[Pipeline] 时间银行服务处理完成');
    })
    .catch(() => {});
}));

router.put('/services/:id', authenticate, asyncHandler(async (req: Request<Record<string, string>, any, UpdateTimeServiceBody>, res: Response) => {
  const result = await timeBankService.updateService(req.params.id, req.user!.id, req.body);
  updated(res, result);
}));

router.post('/orders', authenticate, orderLimiter, asyncHandler(async (req: Request<Record<string, string>, any, CreateTimeOrderBody>, res: Response) => {
  const { service_id } = req.body;
  const result = await timeBankService.createOrder(req.user!.id, service_id);
  created(res, result);
}));

router.get('/orders', authenticate, asyncHandler(async (req, res) => {
  const { page, pageSize } = getPagination(req);
  const result = await timeBankService.getOrders(req.user!.id, { page, pageSize });
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

router.put('/orders/:id/status', authenticate, asyncHandler(async (req: Request<Record<string, string>, any, UpdateTimeOrderStatusBody>, res: Response) => {
  const { action, actual_duration, rating, review } = req.body;
  if (action === 'complete') {
    // complete action 必须提供实际服务时长，运行时校验避免 undefined 传入 service 层
    if (actual_duration === undefined) {
      throw new BadRequestError('完成订单时必须提供实际服务时长');
    }
    const result = await timeBankService.completeOrder(req.params.id, req.user!.id, actual_duration, rating, review);
    success(res, result);
  } else {
    const result = await timeBankService.updateOrderStatus(req.params.id, req.user!.id, action);
    success(res, result);
  }
}));

router.get('/account', authenticate, asyncHandler(async (req, res) => {
  const result = await timeBankService.getAccount(req.user!.id);
  success(res, result);
}));

// 时间币转账：限流防止高频转账刷量
/**
 * @openapi
 * /time-bank/transfer:
 *   post:
 *     tags: [时间银行]
 *     summary: 时间币转账
 *     description: 将自己的时间币余额转给其他用户，限流防止高频转账刷量。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to_user_id, amount]
 *             properties:
 *               to_user_id:
 *                 type: string
 *                 format: uuid
 *                 description: 收款用户 ID
 *               amount:
 *                 type: integer
 *                 minimum: 1
 *                 description: 转账金额（分钟）
 *               remark:
 *                 type: string
 *                 description: 转账备注
 *     responses:
 *       200:
 *         description: 转账成功
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
 *                   description: 转账结果
 *       400:
 *         description: 不能向自己转账 / 金额非法
 *       403:
 *         description: 权限不足
 *       404:
 *         description: 用户不存在
 *       422:
 *         description: 参数校验失败
 *       429:
 *         description: 操作过于频繁
 */
router.post('/transfer', authenticate, orderLimiter, auditMiddleware('TRANSFER', { resourceType: 'transaction' }), asyncHandler(async (req: Request<Record<string, string>, any, TransferTimeBody>, res: Response) => {
  const { to_user_id, amount, remark } = req.body;
  const result = await timeBankService.transferTime(req.user!.id, to_user_id, amount, remark);
  success(res, result);
}));

/**
 * @openapi
 * /time-bank/donate:
 *   post:
 *     tags: [时间银行]
 *     summary: 时间币捐赠
 *     description: 将自己的时间币无偿赠予其他用户。流水 type='donate'，不计入接收方 total_earned，不影响日收益上限。限流防止高频刷量。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to_user_id, amount]
 *             properties:
 *               to_user_id:
 *                 type: string
 *                 format: uuid
 *                 description: 受赠用户 ID
 *               amount:
 *                 type: integer
 *                 minimum: 1
 *                 description: 捐赠金额（分钟）
 *               remark:
 *                 type: string
 *                 description: 捐赠备注
 *     responses:
 *       200:
 *         description: 捐赠成功
 *       400:
 *         description: 不能向自己捐赠 / 金额非法
 *       403:
 *         description: 权限不足
 *       404:
 *         description: 用户不存在
 *       422:
 *         description: 余额不足 / 参数校验失败
 *       429:
 *         description: 操作过于频繁
 */
router.post('/donate', authenticate, orderLimiter, auditMiddleware('DONATE', { resourceType: 'transaction' }), asyncHandler(async (req: Request<Record<string, string>, any, DonateTimeBody>, res: Response) => {
  const { to_user_id, amount, remark } = req.body;
  const result = await timeBankService.donateTime(req.user!.id, to_user_id, amount, remark);
  success(res, result);
}));

router.get('/transactions', authenticate, asyncHandler(async (req, res) => {
  // 游标分页参数：cursor 为上一页最后一条记录的 ID，limit 为每页条数
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

  const result = await timeBankService.getTransactions(req.user!.id, cursor, limit);
  cursorPaginated(res, result.list, result.nextCursor, result.hasMore);
}));

router.post('/family', authenticate, asyncHandler(async (req: Request<Record<string, string>, any, CreateFamilyBindingBody>, res: Response) => {
  const { parent_phone, relationship } = req.body;
  const result = await timeBankService.createFamilyBinding(req.user!.id, parent_phone, relationship);
  created(res, result);
}));

router.put('/family/:id/confirm', authenticate, asyncHandler(async (req, res) => {
  const result = await timeBankService.confirmFamilyBinding(req.params.id, req.user!.id);
  success(res, result);
}));

router.put('/family/:id/reject', authenticate, asyncHandler(async (req, res) => {
  const result = await timeBankService.rejectFamilyBinding(req.params.id, req.user!.id);
  success(res, result);
}));

// 解绑亲情绑定：仅已确认的绑定可解绑，双方均可发起
router.put('/family/:id/unbind', authenticate, asyncHandler(async (req, res) => {
  const result = await timeBankService.unbindFamilyBinding(req.params.id, req.user!.id);
  success(res, result);
}));

router.get('/family', authenticate, asyncHandler(async (req, res) => {
  const result = await timeBankService.getFamilyBindings(req.user!.id);
  success(res, result);
}));

router.post('/reviews', authenticate, asyncHandler(async (req: Request<Record<string, string>, any, CreateReviewBody>, res: Response) => {
  const { order_id, rating, content } = req.body;
  const result = await timeBankService.createReview(order_id, req.user!.id, rating, content);
  created(res, result);
}));

router.post('/disputes', authenticate, asyncHandler(async (req: Request<Record<string, string>, any, CreateDisputeBody>, res: Response) => {
  const { order_id, reason, description, evidence } = req.body;
  const result = await timeBankService.createDispute(order_id, req.user!.id, reason, description, evidence);
  created(res, result);
}));

router.get('/disputes', authenticate, asyncHandler(async (req, res) => {
  const { page, pageSize } = getPagination(req);
  const result = await timeBankService.getDisputes(req.user!.id, { page, pageSize });
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

export default router;
