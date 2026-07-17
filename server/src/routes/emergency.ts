import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate, optionalAuth, requireRole } from '../middleware/auth';
import { createPostLimiter } from '../middleware/rateLimiter';
import { validate, getPagination } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
// 审计中间件：覆盖应急场景全部敏感操作（响应求助/状态变更/举报与审核/资源 CRUD）的审计追踪
import { auditMiddleware } from '../middleware/auditLog';
import { emergencyService } from '../services/emergency.service';
import type { CreateRequestData } from '../services/emergency.service';
import { emergencyResourceService } from '../services/emergency-resource.service';
import type { ResourceMutationData } from '../services/emergency-resource.service';
import { mapService } from '../services/map.service';
import { success, paginated } from '../utils/response';

const router = Router();

// ===================== 请求体类型定义 =====================
// 与 service 层函数入参签名对齐，编译期校验 req.body 字段访问类型安全

// 发布求助：复用 service 层 DTO，避免重复定义
type CreateRequestBody = CreateRequestData;

// 响应求助：与 respondToRequest 第 3 参对齐
interface RespondRequestBody {
  message: string;
  eta?: number;
}

// 更新响应状态：rating/review 仅 status='completed' 时使用，类型上保持 optional
interface UpdateResponseStatusBody {
  status: 'arrived' | 'completed';
  rating?: number;
  review?: string;
}

// 举报虚假求助
interface CreateFalseReportBody {
  requestId: string;
  reason: string;
}

// 审核虚假举报
interface ResolveFalseReportBody {
  penalty: 'warning' | 'ban_7d' | 'ban_30d' | 'permanent';
  resolution: string;
}

// 创建/更新应急资源：复用 service 层 DTO，避免重复定义
type ResourceMutationBody = ResourceMutationData;

/**
 * @openapi
 * /emergency/requests:
 *   get:
 *     tags: [应急]
 *     summary: 获取求助列表
 *     description: 分页返回紧急求助列表，支持按类型与状态筛选。未登录可查看。
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: 求助类型
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: 求助状态
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
router.get('/requests', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { type, status } = req.query as Record<string, string | undefined>;
  const result = await emergencyService.getRequests({
    type: type as string,
    status: status as string,
    page,
    pageSize,
  });
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

router.get('/requests/:id', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const result = await emergencyService.getRequestById(req.params.id, req.user?.id);
  success(res, result);
}));

/**
 * @openapi
 * /emergency/requests:
 *   post:
 *     tags: [应急]
 *     summary: 发布紧急求助
 *     description: 登录用户发布紧急求助信息，需提供类别、标题与描述。
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, title, description]
 *             properties:
 *               category:
 *                 type: string
 *                 description: 求助类别
 *               title:
 *                 type: string
 *                 maxLength: 100
 *                 description: 求助标题
 *               description:
 *                 type: string
 *                 description: 求助描述
 *     responses:
 *       200:
 *         description: 发布成功
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
 *                   description: 求助详情
 *       401:
 *         description: 未授权
 *       422:
 *         description: 参数校验失败
 *       429:
 *         description: 发布过于频繁
 */
router.post('/requests', authenticate, createPostLimiter, validate([
  body('category').notEmpty().withMessage('请选择求助类别'),
  body('title').notEmpty().withMessage('请输入求助标题').isLength({ max: 100 }).withMessage('标题不超过100字'),
  body('description').notEmpty().withMessage('请输入求助描述'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, CreateRequestBody>, res: Response) => {
  const result = await emergencyService.createRequest(req.user!.id, req.body);
  success(res, result, '发布成功');
}));

// 响应求助属敏感操作（响应者承诺参与应急事件），接入审计追踪便于事后回溯责任链
router.post('/requests/:id/respond', authenticate, auditMiddleware('RESPOND_EMERGENCY_REQUEST', {
  resourceType: 'emergency_request',
  getResourceId: (req) => req.params.id,
}), validate([
  body('message').notEmpty().withMessage('请输入响应留言'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, RespondRequestBody>, res: Response) => {
  const { message, eta } = req.body;
  const result = await emergencyService.respondToRequest(req.user!.id, req.params.id, { message, eta });
  success(res, result, '响应成功');
}));

// 响应状态变更（含服务完成评价）接入审计：状态变更影响应急事件责任链，评价影响响应者信用，需留痕
router.put('/responses/:id/status', authenticate, auditMiddleware('UPDATE_EMERGENCY_RESPONSE_STATUS', {
  resourceType: 'emergency_response',
  getResourceId: (req) => req.params.id,
}), validate([
  body('status').isIn(['arrived', 'completed']).withMessage('无效的状态值'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, UpdateResponseStatusBody>, res: Response) => {
  const { status, rating, review } = req.body;
  // 服务完成时同时提供 rating 与 review 才构建评价数据，避免 review 为 undefined 传入 service 层
  const reviewData = status === 'completed' && rating && review ? { rating, review } : undefined;
  const result = await emergencyService.updateResponseStatus(req.user!.id, req.params.id, status, reviewData);
  success(res, result, '状态更新成功');
}));

// 举报虚假求助：限流防止恶意批量举报
// 审计接入：举报可能影响被举报用户信用，需记录举报者与被举报的 requestId 便于恶意举报追溯
// resourceId 取 req.body.requestId（被举报的求助 ID），举报记录自身 ID 在创建后由审计日志的 response 体承载
router.post('/false-reports', authenticate, createPostLimiter, auditMiddleware('CREATE_FALSE_REPORT', {
  resourceType: 'false_report',
  getResourceId: (req) => req.body?.requestId,
}), validate([
  body('requestId').notEmpty().withMessage('请提供求助ID'),
  body('reason').notEmpty().withMessage('请输入举报原因'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, CreateFalseReportBody>, res: Response) => {
  const { requestId, reason } = req.body;
  const result = await emergencyService.createReport(req.user!.id, requestId, reason);
  success(res, result, '举报成功');
}));

// 管理员审核虚假举报：根据处罚类型对求助者执行相应处罚
// 接入审计追踪：处罚涉及用户封禁（7d/30d/permanent），是高风险管理操作，必须留痕便于申诉复核
router.put('/false-reports/:id/resolve', authenticate, requireRole('admin'), auditMiddleware('RESOLVE_FALSE_REPORT', {
  resourceType: 'false_report',
  getResourceId: (req) => req.params.id,
}), validate([
  body('penalty').isIn(['warning', 'ban_7d', 'ban_30d', 'permanent']).withMessage('无效的处罚类型'),
  body('resolution').isLength({ min: 2, max: 500 }).withMessage('处理意见需在2-500字符之间'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, ResolveFalseReportBody>, res: Response) => {
  const { penalty, resolution } = req.body;
  const result = await emergencyService.resolveFalseReport(req.params.id, req.user!.id, penalty, resolution);
  success(res, result, '举报已处理');
}));

// 应急资源列表：未登录可查看（资源信息为公开应急信息），登录后可获取更多详情
router.get('/resources', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { type } = req.query as Record<string, string | undefined>;
  const result = await emergencyResourceService.getResources({
    type: type as string,
    page,
    pageSize,
  });
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

// 应急资源详情：未登录可查看（资源信息为公开应急信息）
router.get('/resources/:id', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const result = await emergencyResourceService.getResourceById(req.params.id);
  success(res, result);
}));

// 管理员创建应急资源
// 审计接入：资源 CRUD 属管理员高危操作，影响应急资源可用性，必须留痕便于运维追溯
router.post('/resources', authenticate, requireRole('admin'), auditMiddleware('CREATE_EMERGENCY_RESOURCE', {
  resourceType: 'emergency_resource',
}), validate([
  body('type').notEmpty().withMessage('请选择资源类型'),
  body('name').notEmpty().withMessage('请输入资源名称').isLength({ max: 100 }).withMessage('名称不超过100字'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, ResourceMutationBody>, res: Response) => {
  const result = await emergencyResourceService.create(req.body);
  success(res, result, '创建成功');
}));

// 管理员更新应急资源
router.put('/resources/:id', authenticate, requireRole('admin'), auditMiddleware('UPDATE_EMERGENCY_RESOURCE', {
  resourceType: 'emergency_resource',
  getResourceId: (req) => req.params.id,
}), validate([
  body('type').optional().notEmpty().withMessage('资源类型不能为空'),
  body('name').optional().notEmpty().withMessage('资源名称不能为空').isLength({ max: 100 }).withMessage('名称不超过100字'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, ResourceMutationBody>, res: Response) => {
  const result = await emergencyResourceService.update(req.params.id, req.body);
  success(res, result, '更新成功');
}));

// 管理员删除应急资源（软删除）
router.delete('/resources/:id', authenticate, requireRole('admin'), auditMiddleware('DELETE_EMERGENCY_RESOURCE', {
  resourceType: 'emergency_resource',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request, res: Response) => {
  await emergencyResourceService.remove(req.params.id);
  success(res, null, '删除成功');
}));

// 地理编码：地址转经纬度（需登录，防止第三方 API 被滥用为免费代理）
router.get('/map/geocode', authenticate, asyncHandler(async (req: Request, res: Response) => {
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { address } = req.query as Record<string, string | undefined>;
  if (!address || typeof address !== 'string') {
    return success(res, null);
  }
  const result = await mapService.geocode(address);
  success(res, result);
}));

// 逆地理编码：经纬度转地址（需登录，防止第三方 API 被滥用为免费代理）
router.get('/map/regeo', authenticate, asyncHandler(async (req: Request, res: Response) => {
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { lng, lat } = req.query as Record<string, string | undefined>;
  const lngNum = parseFloat(lng as string);
  const latNum = parseFloat(lat as string);
  if (!lngNum || !latNum) {
    return success(res, null);
  }
  const result = await mapService.regeo(lngNum, latNum);
  success(res, result);
}));

export default router;
