import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validator';
import { getPagination } from '../middleware/validator';
import { createPostLimiter, orderLimiter } from '../middleware/rateLimiter';
import { auditMiddleware } from '../middleware/auditLog';
import { kitchenService } from '../services/kitchen.service';
import { kitchenOrderService } from '../services/kitchen-order.service';
import { groupOrderService } from '../services/group-order.service';
import { aiService } from '../services/ai.service';
import { success, paginated, created, deleted } from '../utils/response';
import { query, SqlParam } from '../config/database';
import { body } from 'express-validator';
import { BadRequestError } from '../utils/errors';

const router = Router();

// ===================== 请求体类型定义 =====================
// 集中定义各路由的 req.body 接口，与对应 service 函数入参对齐，
// 配合 express-validator 形成运行时 + 编译期双重类型保障
interface CreateKitchenPostBody {
  type: 'offer' | 'need';
  title: string;
  description?: string;
  category: string;
  price?: number;
  quantity: number;
  pickupTime?: string;
  pickupLocation?: string;
  pickupType?: 'self_pickup' | 'delivery';
  images?: string[];
  allergens?: string[];
  healthCert?: boolean;
}
interface UpdateKitchenPostBody {
  title?: string;
  description?: string;
  category?: string;
  price?: number;
  quantity?: number;
  pickupTime?: string;
  pickupLocation?: string;
  pickupType?: string;
  images?: string[];
  allergens?: string[];
  status?: string;
}
interface CreateKitchenOrderBody {
  postId: string;
  quantity: number;
  pickupType?: 'self_pickup' | 'delivery';
  pickupTime?: string;
  deliveryAddress?: string;
  remark?: string;
}
interface CompleteKitchenOrderBody {
  rating: number;
  content?: string;
}
interface CreateGroupOrderBody {
  title: string;
  description?: string;
  targetAmount: number;
  minParticipants: number;
  maxParticipants: number;
  address: string;
  deadline: string;
}
interface JoinGroupOrderBody {
  amount: number;
}
interface CancelGroupOrderBody {
  reason?: string;
}

// ==================== 美食分享 API ====================

// POST /api/kitchen/posts - 发布美食
router.post('/posts',
  authenticate,
  createPostLimiter,
  validate([
    body('type').isIn(['offer', 'need']).withMessage('类型必须是 offer 或 need'),
    body('title').isLength({ min: 1, max: 100 }).withMessage('标题长度为1-100字符'),
    body('category').isLength({ min: 1, max: 50 }).withMessage('类别不能为空'),
    body('quantity').isInt({ min: 1 }).withMessage('份数必须大于0'),
    body('price').optional().isInt({ min: 0 }).withMessage('价格必须为非负整数'),
    body('pickupType').optional().isIn(['self_pickup', 'delivery']).withMessage('领取方式不正确'),
    body('images').optional().isArray().withMessage('图片格式不正确'),
    // 过敏原必须为数组：即使为空数组也需显式传入，便于消费方明确知晓是否含过敏原
    body('allergens').isArray().withMessage('过敏原必须为数组'),
    body('healthCert').optional().isBoolean().withMessage('健康证标识必须为布尔值'),
  ]),
  asyncHandler(async (req: Request<Record<string, string>, any, CreateKitchenPostBody>, res: Response) => {
    // offer 类型（提供美食）强制要求持有健康证，保障食品安全
    if (req.body.type === 'offer' && req.body.healthCert !== true) {
      throw new BadRequestError('提供美食分享时必须持有健康证');
    }
    const result = await kitchenService.create(req.user!.id, req.body);
    aiService.storeEmbedding(result.id, 'kitchen', `${result.title} ${result.description || ''}`).catch(() => {});
    created(res, result, '发布成功');
  })
);

// GET /api/kitchen/posts - 获取美食列表
/**
 * @openapi
 * /kitchen/posts:
 *   get:
 *     tags: [美食]
 *     summary: 获取美食分享列表
 *     description: 支持按类型、分类、关键词筛选，分页返回美食分享列表。
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [offer, need]
 *         description: 类型（offer 提供 / need 需要）
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: 分类
 *       - in: query
 *         name: keyword
 *         schema:
 *           type: string
 *         description: 关键词
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
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageSize } = getPagination(req);
    // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
    const { type, category, keyword } = req.query as Record<string, string | undefined>;

    const result = await kitchenService.getList(
      { type: type as string, category: category as string, keyword: keyword as string },
      page,
      pageSize
    );

    paginated(res, result.list, result.total, page, pageSize);
  })
);

// GET /api/kitchen/posts/:id - 获取美食详情
router.get('/posts/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await kitchenService.getById(req.params.id);
    success(res, result);
  })
);

// PUT /api/kitchen/posts/:id - 更新美食
router.put('/posts/:id',
  authenticate,
  asyncHandler(async (req: Request<Record<string, string>, any, UpdateKitchenPostBody>, res: Response) => {
    const result = await kitchenService.update(req.params.id, req.user!.id, req.body);
    success(res, result, '更新成功');
  })
);

// DELETE /api/kitchen/posts/:id - 删除美食
router.delete('/posts/:id',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await kitchenService.remove(req.params.id, req.user!.id);
    deleted(res, '删除成功');
  })
);

// ==================== 订单 API ====================

// POST /api/kitchen/orders - 预约领取
/**
 * @openapi
 * /kitchen/orders:
 *   post:
 *     tags: [美食]
 *     summary: 预约领取美食
 *     description: 买家预约领取美食分享，系统冻结相应积分。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [postId, quantity]
 *             properties:
 *               postId:
 *                 type: string
 *                 format: uuid
 *                 description: 美食帖子 ID
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 description: 预约份数
 *               pickupType:
 *                 type: string
 *                 enum: [self_pickup, delivery]
 *                 description: 领取方式
 *     responses:
 *       201:
 *         description: 预约成功
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
 *         description: 剩余份数不足
 *       404:
 *         description: 美食不存在
 *       422:
 *         description: 参数校验失败
 *       429:
 *         description: 操作过于频繁
 */
router.post('/orders',
  authenticate,
  orderLimiter,
  auditMiddleware('CREATE_ORDER', { resourceType: 'order' }),
  validate([
    body('postId').isUUID().withMessage('美食ID格式不正确'),
    body('quantity').isInt({ min: 1 }).withMessage('份数必须大于0'),
    body('pickupType').optional().isIn(['self_pickup', 'delivery']).withMessage('领取方式不正确'),
  ]),
  asyncHandler(async (req: Request<Record<string, string>, any, CreateKitchenOrderBody>, res: Response) => {
    const result = await kitchenOrderService.create(req.user!.id, req.body);
    created(res, result, '预约成功');
  })
);

// GET /api/kitchen/orders - 获取订单列表
router.get('/orders',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageSize } = getPagination(req);
    // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
    const { role, status } = req.query as Record<string, string | undefined>;
    
    const result = await kitchenOrderService.getList(
      req.user!.id,
      { role: role as 'buyer' | 'seller', status: status as string },
      page,
      pageSize
    );
    
    paginated(res, result.list, result.total, page, pageSize);
  })
);

// PUT /api/kitchen/orders/:id/confirm - 确认订单
router.put('/orders/:id/confirm',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await kitchenOrderService.confirm(req.params.id, req.user!.id);
    success(res, result, '确认成功');
  })
);

// PUT /api/kitchen/orders/:id/complete - 完成订单
router.put('/orders/:id/complete',
  authenticate,
  validate([
    body('rating').isInt({ min: 1, max: 5 }).withMessage('评分必须为1-5'),
    body('content').optional().isLength({ max: 500 }).withMessage('评价内容不超过500字符'),
  ]),
  asyncHandler(async (req: Request<Record<string, string>, any, CompleteKitchenOrderBody>, res: Response) => {
    const result = await kitchenOrderService.complete(req.params.id, req.user!.id, req.body);
    success(res, result, '完成成功');
  })
);

// PUT /api/kitchen/orders/:id/cancel - 取消订单
router.put('/orders/:id/cancel',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await kitchenOrderService.cancel(req.params.id, req.user!.id);
    success(res, result, '取消成功');
  })
);

// ==================== 拼单 API ====================

// POST /api/kitchen/group-orders - 创建拼单
router.post('/group-orders',
  authenticate,
  createPostLimiter,
  validate([
    body('title').isLength({ min: 1, max: 100 }).withMessage('标题长度为1-100字符'),
    body('targetAmount').isInt({ min: 1 }).withMessage('目标金额必须大于0'),
    body('minParticipants').isInt({ min: 2 }).withMessage('最小参与人数至少2人'),
    body('maxParticipants').isInt({ min: 2 }).withMessage('最大参与人数至少2人'),
    body('address').isLength({ min: 1 }).withMessage('集合地点不能为空'),
    body('deadline').isISO8601().withMessage('截止时间格式不正确'),
  ]),
  asyncHandler(async (req: Request<Record<string, string>, any, CreateGroupOrderBody>, res: Response) => {
    const result = await groupOrderService.create(req.user!.id, req.body);
    created(res, result, '拼单创建成功');
  })
);

// GET /api/kitchen/group-orders - 获取拼单列表
router.get('/group-orders',
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageSize } = getPagination(req);
    // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
    const { status } = req.query as Record<string, string | undefined>;
    
    const result = await groupOrderService.getList(
      { status: status as string },
      page,
      pageSize
    );
    
    paginated(res, result.list, result.total, page, pageSize);
  })
);

// GET /api/kitchen/group-orders/:id - 获取拼单详情
router.get('/group-orders/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await groupOrderService.getById(req.params.id);
    success(res, result);
  })
);

// POST /api/kitchen/group-orders/:id/join - 参与拼单
router.post('/group-orders/:id/join',
  authenticate,
  orderLimiter,
  validate([
    body('amount').isInt({ min: 0 }).withMessage('分摊金额必须为非负整数'),
  ]),
  asyncHandler(async (req: Request<Record<string, string>, any, JoinGroupOrderBody>, res: Response) => {
    const result = await groupOrderService.join(req.params.id, req.user!.id, req.body.amount);
    success(res, result, '参与成功');
  })
);

// POST /api/kitchen/group-orders/:id/cancel - 取消拼单（仅发起人）
router.post('/group-orders/:id/cancel',
  authenticate,
  validate([
    body('reason').optional().isLength({ max: 255 }).withMessage('取消原因不超过255字符'),
  ]),
  asyncHandler(async (req: Request<Record<string, string>, any, CancelGroupOrderBody>, res: Response) => {
    await groupOrderService.cancel(req.params.id, req.user!.id, req.body.reason);
    success(res, null, '拼单已取消');
  })
);

// POST /api/kitchen/group-orders/:id/complete - 完成拼单结算（仅发起人）
router.post('/group-orders/:id/complete',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await groupOrderService.complete(req.params.id, req.user!.id);
    success(res, null, '拼单已完成');
  })
);

// POST /api/kitchen/group-orders/:id/exit - 退出拼单（参与者主动退出并退款）
router.post('/group-orders/:id/exit',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    await groupOrderService.exit(req.params.id, req.user!.id);
    success(res, null, '已退出拼单并退款');
  })
);

// ==================== 评价 API ====================

// GET /api/kitchen/reviews - 获取评价列表
router.get('/reviews',
  asyncHandler(async (req: Request, res: Response) => {
    const { page, pageSize } = getPagination(req);
    // userId 来自查询参数，收窄为 string | undefined 以匹配 SqlParam 类型
    const userId = req.query.userId as string | undefined;

    const conditions = ["order_type = 'kitchen'"];
    // params 承载 userId（string），用 SqlParam 收紧以对齐 query 函数签名
    const params: SqlParam[] = [];
    let paramIndex = 1;

    if (userId) {
      conditions.push(`reviewed_id = $${paramIndex++}`);
      params.push(userId);
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) FROM reviews WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const offset = (page - 1) * pageSize;
    const listResult = await query(
      `SELECT r.*, u.nickname as reviewer_nickname, u.avatar as reviewer_avatar
       FROM reviews r
       LEFT JOIN users u ON r.reviewer_id = u.id
       WHERE ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset]
    );

    const list = listResult.rows.map(row => ({
      id: row.id,
      reviewerId: row.reviewer_id,
      reviewer: { nickname: row.reviewer_nickname, avatar: row.reviewer_avatar },
      reviewedId: row.reviewed_id,
      orderId: row.order_id,
      rating: parseFloat(row.rating),
      content: row.content,
      createdAt: row.created_at
    }));

    paginated(res, list, total, page, pageSize);
  })
);

export default router;
