import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { auditMiddleware } from '../middleware/auditLog';
import { success, cursorPaginated } from '../utils/response';
import { messageService, OrderType } from '../services/message.service';
import { BadRequestError } from '../utils/errors';

const router = Router();

// 合法订单类型集合
const VALID_ORDER_TYPES: OrderType[] = ['skill', 'kitchen', 'time', 'emergency'];

// 标记已读请求体类型定义
// 设计原因：收窄 req.body 隐式 any；order_type 此处为客户端原始输入（string），
// 由 parseOrderType 运行时校验后收窄为 OrderType，故接口中保持 string 而非联合类型
interface MarkReadBody {
  order_id: string;
  order_type?: string;
}

// 从请求中解析 order_type，默认 skill；非法值抛 400
function parseOrderType(value: unknown): OrderType {
  if (value === undefined || value === null || value === '') {
    return 'skill';
  }
  const v = value as string;
  if (!VALID_ORDER_TYPES.includes(v as OrderType)) {
    throw new BadRequestError('order_type 参数非法');
  }
  return v as OrderType;
}

// 获取聊天记录
/**
 * @openapi
 * /messages:
 *   get:
 *     tags: [消息]
 *     summary: 获取订单聊天记录
 *     description: 游标分页返回指定订单的聊天记录，仅订单参与方可见。
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: order_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: 订单 ID
 *       - in: query
 *         name: order_type
 *         schema:
 *           type: string
 *           enum: [skill, kitchen, time, emergency]
 *           default: skill
 *         description: 订单类型
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: 游标（上一页最后一条消息的 ID）
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: 每页条数
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
 *                     nextCursor:
 *                       type: string
 *                       nullable: true
 *                     hasMore:
 *                       type: boolean
 *       400:
 *         description: order_id 参数必填 / order_type 参数非法
 *       401:
 *         description: 未授权
 *       403:
 *         description: 权限不足
 */
router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { order_id } = req.query as Record<string, string | undefined>;
  if (!order_id) throw new BadRequestError('order_id 参数必填');

  const orderType = parseOrderType(req.query.order_type);
  // 游标分页参数：cursor 为上一页最后一条记录的 ID，limit 为每页条数
  const cursor = req.query.cursor as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

  const result = await messageService.getMessages(order_id as string, req.user!.id, cursor, limit, orderType);
  cursorPaginated(res, result.list, result.nextCursor, result.hasMore);
}));

// 标记消息已读
/**
 * @openapi
 * /messages/read:
 *   post:
 *     tags: [消息]
 *     summary: 标记订单消息已读
 *     description: 将指定订单中对方发来的未读消息标记为已读。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [order_id]
 *             properties:
 *               order_id:
 *                 type: string
 *                 format: uuid
 *                 description: 订单 ID
 *               order_type:
 *                 type: string
 *                 enum: [skill, kitchen, time, emergency]
 *                 default: skill
 *                 description: 订单类型
 *     responses:
 *       200:
 *         description: 标记已读成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                   example: SUCCESS
 *       400:
 *         description: order_id 参数必填 / order_type 参数非法
 *       401:
 *         description: 未授权
 */
router.post('/read', authenticate, auditMiddleware('MARK_MESSAGE_READ', {
  resourceType: 'message',
  // getResourceId 从 req.body.order_id 提取（订单维度的消息已读）
  // 设计原因：messages 路由的资源标识是 order_id（订单 ID），与 notifications 的 notification id 不同
  // 标记已读会一次性影响订单内所有未读消息，order_id 是合适的关联键
  getResourceId: (req) => (req.body as { order_id?: string } | undefined)?.order_id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, MarkReadBody>, res: Response) => {
  const { order_id } = req.body;
  if (!order_id) throw new BadRequestError('order_id 参数必填');

  const orderType = parseOrderType(req.body.order_type);
  await messageService.markAsRead(order_id, req.user!.id, orderType);
  success(res, null, '标记已读成功');
}));

// 获取未读消息数
router.get('/unread-count', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const orderType = parseOrderType(req.query.order_type);
  const result = await messageService.getUnreadCount(req.user!.id, orderType);
  success(res, result);
}));

export default router;
