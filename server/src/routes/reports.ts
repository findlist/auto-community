import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
import { adminService } from '../services/admin.service';
import type { ReportTargetType } from '../services/admin.service';
import { success } from '../utils/response';

const router = Router();

// 举报请求体类型定义
// 设计原因：收窄 req.body 隐式 any，targetType 使用 ReportTargetType 联合类型，
// 与 express-validator isIn() 校验的合法值集合保持一致，编译期即可发现非法举报类型
interface CreateReportBody {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
}

// 创建举报（普通用户即可）
router.post('/', authenticate, validate([
  body('targetType').isIn(['skill', 'kitchen', 'time_bank', 'emergency', 'user']).withMessage('无效的举报类型'),
  body('targetId').isUUID().withMessage('无效的目标ID'),
  body('reason').isLength({ min: 5, max: 500 }).withMessage('举报原因需在5-500字符之间'),
]), asyncHandler(async (req: Request<{}, any, CreateReportBody>, res: Response) => {
  const { targetType, targetId, reason } = req.body;
  const report = await adminService.createReport(req.user!.id, targetType, targetId, reason);
  success(res, report, '举报成功');
}));

export default router;
