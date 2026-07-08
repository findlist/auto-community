import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { query } from '../config/database';
import { success } from '../utils/response';
import { adminService } from '../services/admin.service';

const router = Router();

router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
  const [usersResult, mutualAidsResult] = await Promise.all([
    query('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'),
    query(
      `SELECT SUM(cnt) FROM (
         SELECT COUNT(*) AS cnt FROM skill_orders WHERE status = 'completed'
         UNION ALL
         SELECT COUNT(*) FROM kitchen_orders WHERE status = 'completed'
         UNION ALL
         SELECT COUNT(*) FROM time_orders WHERE status = 'completed'
       ) t`,
    ),
  ]);

  success(res, {
    totalUsers: parseInt(usersResult.rows[0].count, 10),
    totalMutualAids: parseInt(mutualAidsResult.rows[0].sum || '0', 10),
  });
}));

// 公开获取首页展示图片：未配置时返回 null，前端使用默认图
router.get('/homepage-image', asyncHandler(async (_req: Request, res: Response) => {
  const url = await adminService.getHomepageImage();
  success(res, { url });
}));

export default router;
