import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
import { auditMiddleware } from '../middleware/auditLog';
import { adminService } from '../services/admin.service';
import type { ReportTargetType } from '../services/admin.service';
import { success } from '../utils/response';

const router = Router();

// 举报请求体类型定义
// 设计原因：收窄 req.body 隐式 any，targetType 使用 ReportTargetType 联合类型，
// 与 express-validator isIn() 校验的合法值集合保持一致，编译期即可发现非法举报类型
// 字段命名使用 snake_case：前端 axios 拦截器将 camelCase 请求体统一转为 snake_case，
// 后端需用 snake_case 字段名才能匹配，否则 validate 校验失败返回 422
interface CreateReportBody {
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
}

// 创建举报接入审计：举报影响被举报用户内容审核流程，需留痕便于事后追溯
router.post('/', authenticate, auditMiddleware('CREATE_REPORT', { resourceType: 'report' }), validate([
  body('target_type').isIn(['skill', 'kitchen', 'time_bank', 'emergency', 'user']).withMessage('无效的举报类型'),
  body('target_id').isUUID().withMessage('无效的目标ID'),
  body('reason').isLength({ min: 5, max: 500 }).withMessage('举报原因需在5-500字符之间'),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, CreateReportBody>, res: Response) => {
  const { target_type, target_id, reason } = req.body;
  const report = await adminService.createReport(req.user!.id, target_type, target_id, reason);
  success(res, report, '举报成功');
}));

export default router;
