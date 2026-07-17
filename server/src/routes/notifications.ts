import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { getPagination } from '../middleware/validator';
import { auditMiddleware } from '../middleware/auditLog';
import { success, paginated } from '../utils/response';
import { notificationService } from '../services/notification.service';
import { NotFoundError } from '../utils/errors';

const router = Router();

// 获取通知列表
/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [通知]
 *     summary: 获取用户通知列表
 *     description: 分页返回用户的通知列表，按时间倒序排列。
 *     security:
 *       - bearerAuth: []
 *     parameters:
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
 *                         properties:
 *                           id:
 *                             type: string
 *                           userId:
 *                             type: string
 *                           type:
 *                             type: string
 *                           title:
 *                             type: string
 *                           content:
 *                             type: string
 *                           referenceId:
 *                             type: string
 *                           referenceType:
 *                             type: string
 *                           readAt:
 *                             type: string
 *                           createdAt:
 *                             type: string
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
 *       401:
 *         description: 未授权
 */
router.get('/', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const result = await notificationService.getNotifications(req.user!.id, page, pageSize);
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

// 获取未读通知数量
/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [通知]
 *     summary: 获取未读通知数量
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
 *                   properties:
 *                     unreadCount:
 *                       type: integer
 *       401:
 *         description: 未授权
 */
router.get('/unread-count', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const unreadCount = await notificationService.getUnreadCount(req.user!.id);
  success(res, { unreadCount });
}));

// 标记单条通知已读
/**
 * @openapi
 * /notifications/{id}/read:
 *   post:
 *     tags: [通知]
 *     summary: 标记单条通知已读
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: 标记成功
 *       404:
 *         description: 通知不存在或已读
 *       401:
 *         description: 未授权
 */
router.post('/:id/read', authenticate, auditMiddleware('MARK_NOTIFICATION_READ', {
  resourceType: 'notification',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const marked = await notificationService.markAsRead(req.user!.id, id);
  if (!marked) {
    throw new NotFoundError('通知');
  }
  success(res, null, '标记已读成功');
}));

// 标记所有通知已读
/**
 * @openapi
 * /notifications/read-all:
 *   post:
 *     tags: [通知]
 *     summary: 标记所有通知已读
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 标记成功
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
 *                     markedCount:
 *                       type: integer
 *       401:
 *         description: 未授权
 */
router.post('/read-all', authenticate, auditMiddleware('MARK_ALL_NOTIFICATIONS_READ', {
  resourceType: 'notification',
  // 批量操作无单一资源 id，用当前登录用户 id 作为关联键，便于按用户追溯批量已读行为
  getResourceId: (req) => req.user!.id,
}), asyncHandler(async (req: Request, res: Response) => {
  const markedCount = await notificationService.markAllAsRead(req.user!.id);
  success(res, { markedCount }, '全部标记已读成功');
}));

export default router;