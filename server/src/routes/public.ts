import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { query } from '../config/database';
import { getCache, setCache } from '../config/redis';
import { success } from '../utils/response';
import { adminService } from '../services/admin.service';

const router = Router();

// 公开统计接口缓存：未鉴权接口每访客访问都会触发 3 表全表 COUNT UNION ALL，
// 用 60s 缓存避免首页流量直接打满 DB（容忍 60s 数据延迟）
const PUBLIC_STATS_CACHE_KEY = 'public:stats';
const PUBLIC_STATS_CACHE_TTL = 60;

router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
  // 缓存命中时直接返回，避免每次请求都触发 DB 全表聚合
  const cached = await getCache<{ totalUsers: number; totalMutualAids: number }>(PUBLIC_STATS_CACHE_KEY);
  if (cached) {
    success(res, cached);
    return;
  }

  // 互助完成数加 30 天时间窗：与 admin.service.getSystemMetrics 保持一致语义，
  // 避免长期累计的历史订单拖慢 COUNT 聚合（首页只需近期活跃度）
  const [usersResult, mutualAidsResult] = await Promise.all([
    query('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'),
    query(
      `SELECT SUM(cnt) FROM (
         SELECT COUNT(*) AS cnt FROM skill_orders WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '30 days'
         UNION ALL
         SELECT COUNT(*) FROM kitchen_orders WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '30 days'
         UNION ALL
         SELECT COUNT(*) FROM time_orders WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '30 days'
       ) t`,
    ),
  ]);

  const payload = {
    totalUsers: parseInt(usersResult.rows[0].count, 10),
    totalMutualAids: parseInt(mutualAidsResult.rows[0].sum || '0', 10),
  };

  // 写缓存用 void 不阻塞响应（缓存写入失败不应影响接口可用性）
  void setCache(PUBLIC_STATS_CACHE_KEY, payload, PUBLIC_STATS_CACHE_TTL);

  success(res, payload);
}));

// 公开获取首页展示图片：未配置时返回 null，前端使用默认图
router.get('/homepage-image', asyncHandler(async (_req: Request, res: Response) => {
  const url = await adminService.getHomepageImage();
  success(res, { url });
}));

export default router;
