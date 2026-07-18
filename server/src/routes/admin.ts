import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth';
import { validate, getPagination } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
import { auditMiddleware } from '../middleware/auditLog';
import { adminService } from '../services/admin.service';
import type { ReportStatus, UserRole } from '../services/admin.service';
import { auditService } from '../services/audit.service';
import { dataDeletionService } from '../services/data-deletion.service';
import { success, paginated, error } from '../utils/response';

const router = Router();

// 所有 admin 路由都需要认证 + 管理员权限
router.use(authenticate, requireRole('admin'));

// ===================== 请求体类型定义 =====================
// 集中定义各路由的 req.body 接口，配合 express-validator 形成双重保障：
// 运行时由 validator 校验字段格式，编译期由 TS 校验字段访问类型安全
interface UpdateRoleBody {
  role: UserRole;
}
interface BatchUserIdsBody {
  userIds: string[];
}
interface UpdateContentStatusBody {
  status: string;
}
interface BatchUpdateContentStatusBody {
  ids: string[];
  status: 'active' | 'inactive';
}
interface UpdateHomepageImageBody {
  url: string;
}
interface ForceCancelOrderBody {
  reason: string;
}
interface HandleReportBody {
  status: 'resolved' | 'rejected';
  handleNote: string;
}
interface ReviewVerificationBody {
  action: 'approve' | 'reject';
  // rejectReason 仅 action='reject' 时必填（validator 用 if 链控制），类型上保持 optional
  rejectReason?: string;
}
interface UpdateSettingBody {
  value: string;
  // description 允许传 null（validator optional + nullable），用于显式清空说明
  description?: string | null;
  valueType?: 'string' | 'int' | 'float';
}

// ===================== 用户管理 =====================

// 用户列表
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const search = req.query.search as string | undefined;
  const result = await adminService.getUsers(page, pageSize, search);
  paginated(res, result.list, result.total, page, pageSize);
}));

// 封禁用户
// 审计接入：单点封禁属高危管理操作，需记录操作者与目标用户便于申诉复核
router.put('/users/:id/ban', auditMiddleware('BAN_USER', {
  resourceType: 'user',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.banUser(req.params.id);
  success(res, result, '用户已封禁');
}));

// 解封用户
router.put('/users/:id/unban', auditMiddleware('UNBAN_USER', {
  resourceType: 'user',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.unbanUser(req.params.id);
  success(res, result, '用户已解封');
}));

// 修改用户角色
router.put('/users/:id/role', validate([
  body('role').isIn(['admin', 'user']).withMessage('角色只能为 admin 或 user'),
]), auditMiddleware('UPDATE_USER_ROLE', {
  resourceType: 'user',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, UpdateRoleBody>, res: Response) => {
  const { role } = req.body;
  const result = await adminService.updateUserRole(req.params.id, role);
  success(res, result, '用户角色已更新');
}));

/**
 * @openapi
 * /admin/users/batch-ban:
 *   post:
 *     tags: [Admin]
 *     summary: 批量封禁用户
 *     description: 跳过管理员角色与操作者自身，避免误封导致后台失联；单次最多 50 条
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: 批量封禁结果（含成功/跳过/失败明细）
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     successfulIds: { type: array, items: { type: string } }
 *                     skippedAdminIds: { type: array, items: { type: string } }
 *                     skippedSelfId: { type: array, items: { type: string } }
 *                     failedIds: { type: array, items: { type: string } }
 */
router.post('/users/batch-ban', validate([
  body('userIds').isArray({ min: 1, max: 50 }).withMessage('用户ID列表需为1-50条'),
  body('userIds.*').isString().withMessage('用户ID必须为字符串'),
]), auditMiddleware('BATCH_BAN_USERS', { resourceType: 'user' }), asyncHandler(async (req: Request<Record<string, string>, unknown, BatchUserIdsBody>, res: Response) => {
  const { userIds } = req.body;
  const result = await adminService.batchBanUsers(userIds, req.user!.id);
  success(res, result, `成功封禁 ${result.successfulIds.length} 个用户`);
}));

/**
 * @openapi
 * /admin/users/batch-unban:
 *   post:
 *     tags: [Admin]
 *     summary: 批量解封用户
 *     description: 仅解封已封禁用户，单次最多 50 条
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 items: { type: string }
 *     responses:
 *       200:
 *         description: 批量解封结果
 */
router.post('/users/batch-unban', validate([
  body('userIds').isArray({ min: 1, max: 50 }).withMessage('用户ID列表需为1-50条'),
  body('userIds.*').isString().withMessage('用户ID必须为字符串'),
]), auditMiddleware('BATCH_UNBAN_USERS', { resourceType: 'user' }), asyncHandler(async (req: Request<Record<string, string>, unknown, BatchUserIdsBody>, res: Response) => {
  const { userIds } = req.body;
  const result = await adminService.batchUnbanUsers(userIds);
  success(res, result, `成功解封 ${result.successfulIds.length} 个用户`);
}));

// ===================== 内容审核 =====================

// 内容列表
router.get('/content', asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const type = req.query.type as 'skill' | 'kitchen' | 'time_bank' | 'emergency';
  const status = req.query.status as string | undefined;
  const result = await adminService.getContent(type, status, page, pageSize);
  paginated(res, result.list, result.total, page, pageSize);
}));

// 更新内容状态
// 审计接入：内容上下架影响用户可见性与交易，需记录操作者与目标内容便于追溯
router.put('/content/:type/:id/status', validate([
  body('status').isString().withMessage('状态必须为字符串'),
]), auditMiddleware('UPDATE_CONTENT_STATUS', {
  resourceType: 'content',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, UpdateContentStatusBody>, res: Response) => {
  const { type, id } = req.params;
  const { status } = req.body;
  const result = await adminService.updateContentStatus(type as 'skill' | 'kitchen' | 'time_bank' | 'emergency', id, status);
  success(res, result, '内容状态已更新');
}));

/**
 * @openapi
 * /admin/content/{type}/batch-status:
 *   post:
 *     tags: [Admin]
 *     summary: 批量更新内容状态（上架/下架）
 *     description: 单次最多 50 条，返回成功与未命中明细，便于排查失败项
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [skill, kitchen, time_bank, emergency] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids, status]
 *             properties:
 *               ids:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 50
 *                 items: { type: string }
 *               status: { type: string, enum: [active, inactive] }
 *     responses:
 *       200:
 *         description: 批量更新结果
 */
router.post('/content/:type/batch-status', validate([
  body('ids').isArray({ min: 1, max: 50 }).withMessage('内容ID列表需为1-50条'),
  body('ids.*').isString().withMessage('内容ID必须为字符串'),
  body('status').isIn(['active', 'inactive']).withMessage('状态只能为 active 或 inactive'),
]), auditMiddleware('BATCH_UPDATE_CONTENT_STATUS', { resourceType: 'content' }), asyncHandler(async (req: Request<Record<string, string>, unknown, BatchUpdateContentStatusBody>, res: Response) => {
  const { type } = req.params;
  const { ids, status } = req.body;
  const result = await adminService.batchUpdateContentStatus(type as 'skill' | 'kitchen' | 'time_bank' | 'emergency', ids, status);
  success(res, result, `成功更新 ${result.successfulIds.length} 条内容`);
}));

// 获取内容详情（含图片等可编辑字段）
router.get('/content/:type/:id', asyncHandler(async (req: Request, res: Response) => {
  const { type, id } = req.params;
  const result = await adminService.getContentDetail(type as 'skill' | 'kitchen' | 'time_bank' | 'emergency', id);
  success(res, result);
}));

// 管理员编辑内容（标题/描述/图片/价格等）
// 审计接入：管理员编辑内容属高危篡改操作，需记录操作者与目标内容便于事后追溯
router.put('/content/:type/:id', auditMiddleware('ADMIN_UPDATE_CONTENT', {
  resourceType: 'content',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, Record<string, unknown>>, res: Response) => {
  const { type, id } = req.params;
  const result = await adminService.updateContent(type as 'skill' | 'kitchen' | 'time_bank' | 'emergency', id, req.body, req.user!.id);
  success(res, result, '内容已更新');
}));

// ===================== 首页展示图片管理 =====================

// 获取首页展示图片
router.get('/homepage-image', asyncHandler(async (_req: Request, res: Response) => {
  const url = await adminService.getHomepageImage();
  success(res, { url });
}));

// 设置首页展示图片
// 审计接入：首页门面图片属高危篡改目标，需记录操作者便于事后追溯
router.put('/homepage-image', validate([
  body('url').isString().withMessage('图片 URL 必须为字符串'),
]), auditMiddleware('UPDATE_HOMEPAGE_IMAGE', { resourceType: 'homepage_image' }), asyncHandler(async (req: Request<Record<string, string>, unknown, UpdateHomepageImageBody>, res: Response) => {
  const { url } = req.body;
  const result = await adminService.setHomepageImage(url, req.user!.id);
  success(res, result, '首页展示图片已更新');
}));

// ===================== 审计日志 =====================

// 查询审计日志：支持按用户、操作类型、状态、时间范围筛选
router.get('/audit-logs', asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { userId, action, status, startDate, endDate } = req.query as Record<string, string | undefined>;
  const result = await auditService.getAuditLogs(
    {
      userId: userId as string | undefined,
      action: action as string | undefined,
      status: status as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    },
    page,
    pageSize,
  );
  // auditService.getAuditLogs 已返回分页结构，展开后交给 paginated 输出统一格式
  paginated(res, result.list, result.total, result.page, result.pageSize);
}));

// ===================== 订单管理 =====================

// 订单列表
router.get('/orders/:type', asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const { type } = req.params;
  const status = req.query.status as string | undefined;
  const result = await adminService.getOrders(type as 'skill' | 'kitchen' | 'time_bank', status, page, pageSize);
  paginated(res, result.list, result.total, page, pageSize);
}));

// 强制取消订单
// 审计接入：强制取消订单影响用户交易权益，需记录操作者、目标订单与取消原因便于申诉复核
router.put('/orders/:type/:id/cancel', validate([
  body('reason').isLength({ min: 2, max: 200 }).withMessage('取消原因需在2-200字符之间'),
]), auditMiddleware('FORCE_CANCEL_ORDER', {
  resourceType: 'order',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, ForceCancelOrderBody>, res: Response) => {
  const { type, id } = req.params;
  const { reason } = req.body;
  const result = await adminService.forceCancelOrder(type as 'skill' | 'kitchen' | 'time_bank', id, reason, req.user!.id);
  success(res, result, '订单已强制取消');
}));

// ===================== 数据统计 =====================

// 平台概览
router.get('/dashboard', asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getDashboard();
  success(res, result);
}));

// 7日趋势图
router.get('/dashboard/trend', asyncHandler(async (req: Request, res: Response) => {
  const type = req.query.type as 'registration' | 'order';
  // days 白名单 clamp 到 [1, 365]：
  // - 负数会让 generate_series 反向生成空集
  // - 极大值（如 100000）会让三张订单表的 created_at >= CURRENT_DATE - '99999 days'::interval 退化为全表扫描
  // 默认值 7，未传或非法值回退到 7 天视图
  const rawDays = parseInt(req.query.days as string, 10) || 7;
  const days = Math.min(Math.max(rawDays, 1), 365);
  const result = type === 'order'
    ? await adminService.getOrderTrend(days)
    : await adminService.getRegistrationTrend(days);
  success(res, result);
}));

// 信誉分分布
router.get('/dashboard/reputation', asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getReputationDistribution();
  success(res, result);
}));

// 模块对比
router.get('/dashboard/modules', asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getModuleActivity();
  success(res, result);
}));

// 系统指标
router.get('/dashboard/system', asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getSystemMetrics();
  success(res, result);
}));

// ===================== 举报处理 =====================

// 举报列表
router.get('/reports', asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  // 查询参数 status 收窄为 ReportStatus 联合类型，运行时由 getReports 内部参数化查询保证安全
  const status = req.query.status as ReportStatus | undefined;
  const result = await adminService.getReports(page, pageSize, status);
  paginated(res, result.list, result.total, page, pageSize);
}));

// 处理举报
// 审计接入：举报处理结果影响被举报用户权益，需记录操作者、处理结论与说明便于复核
router.put('/reports/:id', validate([
  body('status').isIn(['resolved', 'rejected']).withMessage('状态只能为 resolved 或 rejected'),
  body('handleNote').isLength({ min: 2, max: 500 }).withMessage('处理说明需在2-500字符之间'),
]), auditMiddleware('HANDLE_REPORT', {
  resourceType: 'report',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, HandleReportBody>, res: Response) => {
  const { status, handleNote } = req.body;
  const result = await adminService.handleReport(req.params.id, req.user!.id, status, handleNote);
  success(res, result, '举报已处理');
}));

// ===================== 实名认证审核 =====================

// 实名认证申请列表
router.get('/verifications', asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const status = req.query.status as string | undefined;
  const result = await adminService.getVerificationRequests(page, pageSize, status);
  paginated(res, result.list, result.total, page, pageSize);
}));

// 审核实名认证申请
// 审计接入：实名认证审核结果影响用户身份权限，需记录操作者与审核结论便于申诉复核
router.put('/verifications/:id', validate([
  body('action').isIn(['approve', 'reject']).withMessage('操作只能为 approve 或 reject'),
  body('rejectReason').if(body('action').equals('reject')).isLength({ min: 2, max: 200 }).withMessage('拒绝原因需在2-200字符之间'),
]), auditMiddleware('REVIEW_VERIFICATION', {
  resourceType: 'verification',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, ReviewVerificationBody>, res: Response) => {
  const { action, rejectReason } = req.body;
  const result = await adminService.reviewVerificationRequest(req.params.id, req.user!.id, action, rejectReason);
  success(res, result, action === 'approve' ? '认证已通过' : '认证已拒绝');
}));

// ===================== 注销申请审核 =====================

// 注销申请列表
router.get('/deletion-requests', asyncHandler(async (req: Request, res: Response) => {
  const { page, pageSize } = getPagination(req);
  const status = req.query.status as 'pending' | 'approved' | 'rejected' | 'completed' | undefined;
  const result = await dataDeletionService.getDeletionRequests(page, pageSize, status);
  paginated(res, result.list, result.total, page, pageSize);
}));

// 审核注销申请
// 审计接入：注销审核通过会触发用户数据匿名化（不可逆），必须留痕便于事后审计与合规追溯
router.put('/deletion-requests/:id', validate([
  body('action').isIn(['approve', 'reject']).withMessage('操作只能为 approve 或 reject'),
  body('rejectReason').if(body('action').equals('reject')).isLength({ min: 2, max: 200 }).withMessage('拒绝原因需在2-200字符之间'),
]), auditMiddleware('REVIEW_DELETION_REQUEST', {
  resourceType: 'deletion_request',
  getResourceId: (req) => req.params.id,
}), asyncHandler(async (req: Request<Record<string, string>, unknown, ReviewVerificationBody>, res: Response) => {
  const { action, rejectReason } = req.body;
  const result = await dataDeletionService.reviewDeletionRequest(req.params.id, req.user!.id, action, rejectReason);
  success(res, result, action === 'approve' ? '注销申请已通过，用户数据已匿名化' : '注销申请已拒绝');
}));

// ===================== 数据导出 =====================

// 支持导出的数据类型白名单
const EXPORT_TYPES = ['users', 'orders', 'reports', 'audit-logs'] as const;
type ExportType = typeof EXPORT_TYPES[number];

// CSV 字段转义：含逗号/引号/换行时用双引号包裹，内部双引号转义为两个双引号
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * @swagger
 * /api/admin/export/{type}:
 *   get:
 *     summary: 导出数据为 CSV 或 Excel（用户/订单/举报/审计日志）
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema: { type: string, enum: [users, orders, reports, audit-logs] }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [csv, xlsx], default: csv }
 *         description: 导出格式，csv 为默认，xlsx 为 Excel 表格
 *       - in: query
 *         name: orderType
 *         schema: { type: string, enum: [skill, kitchen, time_bank] }
 *         description: 仅 type=orders 时生效
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: 文件流（CSV 或 Excel）
 *         content:
 *           text/csv:
 *             schema: { type: string }
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema: { type: string, format: binary }
 */
router.get('/export/:type', auditMiddleware('EXPORT_DATA', { resourceType: 'export' }), asyncHandler(async (req: Request, res: Response) => {
  const { type } = req.params;
  if (!EXPORT_TYPES.includes(type as ExportType)) {
    error(res, '无效的导出类型，支持：users/orders/reports/audit-logs', 'BAD_REQUEST');
    return;
  }

  // 导出格式：默认 csv，支持 xlsx；非法值回退 csv 以保持向后兼容
  const formatRaw = (req.query.format as string | undefined)?.toLowerCase();
  const format: 'csv' | 'xlsx' = formatRaw === 'xlsx' ? 'xlsx' : 'csv';

  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { orderType, status, startDate, endDate } = req.query as Record<string, string | undefined>;
  const { columns, rows } = await adminService.getExportData(type as ExportType, {
    orderType: orderType as 'skill' | 'kitchen' | 'time_bank' | undefined,
    status: status as string | undefined,
    startDate: startDate as string | undefined,
    endDate: endDate as string | undefined,
  });

  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  if (format === 'xlsx') {
    // Excel 路径：用 exceljs 构建二进制 Buffer，按类型命名工作表
    const sheetNameMap: Record<ExportType, string> = {
      users: '用户', orders: '订单', reports: '举报', 'audit-logs': '审计日志',
    };
    const buffer = await adminService.buildExcelBuffer(
      columns,
      rows as Record<string, unknown>[],
      sheetNameMap[type as ExportType],
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="export-${type}-${dateStr}.xlsx"`);
    res.send(buffer);
    return;
  }

  // CSV 路径：拼装 UTF-8 BOM + 表头 + 数据行（\r\n 兼容 Windows）
  const headerLine = columns.map(c => escapeCsvField(c.header)).join(',');
  const dataLines = rows.map((row: Record<string, unknown>) =>
    columns.map(c => escapeCsvField(row[c.field])).join(','),
  );
  const csv = '\ufeff' + [headerLine, ...dataLines].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export-${type}-${dateStr}.csv"`);
  res.send(csv);
}));

// ===================== 系统配置管理 =====================

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Admin]
 *     summary: 获取全部系统配置项
 *     description: 返回 site_settings 表全部配置，按 key 字典序排序，供后台可视化管理
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 配置列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key: { type: string, example: "daily_earn_limit" }
 *                       value: { type: string, nullable: true, example: "120" }
 *                       description: { type: string, nullable: true, example: "每日时间币收益上限" }
 *                       updatedBy: { type: string, nullable: true }
 *                       updatedAt: { type: string, format: date-time }
 */
router.get('/settings', asyncHandler(async (_req: Request, res: Response) => {
  const list = await adminService.listSettings();
  success(res, list);
}));

/**
 * @openapi
 * /admin/settings/{key}:
 *   get:
 *     tags: [Admin]
 *     summary: 获取单个系统配置项
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 配置详情 }
 *       404: { description: 配置项不存在 }
 */
router.get('/settings/:key', asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.getSetting(req.params.key);
  success(res, result);
}));

/**
 * @openapi
 * /admin/settings/{key}:
 *   put:
 *     tags: [Admin]
 *     summary: 新增或更新系统配置项（upsert）
 *     description: 管理员可新增自定义配置或修改现有配置，统一用 ON CONFLICT 处理；受保护键也允许改值但不允许删除
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string, pattern: '^[a-z][a-z0-9_]{0,63}$' }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: { type: string, maxLength: 2000, description: "配置值，统一以字符串存储，业务侧自行解析" }
 *               description: { type: string, description: "配置说明，可选，传 null 保留原值" }
 *               valueType: { type: string, enum: [string, int, float], description: "配置值类型，驱动前端滑块步长，缺省 string" }
 *     responses:
 *       200: { description: 配置已保存 }
 *       400: { description: 配置键格式不合法或值超长 }
 */
router.put('/settings/:key', validate([
  body('value').isString().withMessage('配置值必须为字符串'),
  body('description').optional({ nullable: true }).isString().withMessage('配置说明必须为字符串'),
  body('valueType').optional().isIn(['string', 'int', 'float']).withMessage('配置类型仅允许 string/int/float'),
]), auditMiddleware('UPDATE_SYSTEM_CONFIG', { resourceType: 'system_setting' }), asyncHandler(async (req: Request<Record<string, string>, unknown, UpdateSettingBody>, res: Response) => {
  const { value, description, valueType } = req.body;
  const result = await adminService.setSetting(req.params.key, value, description, req.user!.id, valueType);
  success(res, result, '配置已保存');
}));

/**
 * @openapi
 * /admin/settings/{key}:
 *   delete:
 *     tags: [Admin]
 *     summary: 删除系统配置项
 *     description: 受保护键（如 homepage_hero_image）禁止删除，避免误删导致核心功能异常
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 配置已删除 }
 *       400: { description: 受保护键禁止删除 }
 *       404: { description: 配置项不存在 }
 */
router.delete('/settings/:key', auditMiddleware('DELETE_SYSTEM_CONFIG', { resourceType: 'system_setting' }), asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.deleteSetting(req.params.key);
  success(res, result, '配置已删除');
}));

export default router;
