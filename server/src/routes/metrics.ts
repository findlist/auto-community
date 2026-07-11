import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { success } from '../utils/response';
import { metricsCollectorService } from '../services/metrics-collector.service';

const router = Router();

// 所有 metrics 路由都需要认证 + 管理员权限
router.use(authenticate, requireRole('admin'));

/**
 * @swagger
 * /metrics/dashboard:
 *   get:
 *     summary: 获取仪表盘指标概览
 *     description: 获取所有核心指标的最新值
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功
 *       401:
 *         description: 未授权
 *       403:
 *         description: 权限不足
 */
router.get('/dashboard', asyncHandler(async (_req: Request, res: Response) => {
  const metrics = await metricsCollectorService.getDashboardMetrics();
  success(res, metrics);
}));

/**
 * @swagger
 * /metrics/{name}/summary:
 *   get:
 *     summary: 获取指标汇总
 *     description: 获取指定指标的汇总数据（avg, min, max, count）
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: 指标名称
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 开始日期
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 结束日期
 *     responses:
 *       200:
 *         description: 成功
 *       401:
 *         description: 未授权
 *       403:
 *         description: 权限不足
 */
router.get('/:name/summary', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { startDate, endDate } = req.query as Record<string, string | undefined>;

  const summary = await metricsCollectorService.getMetricSummary(
    name,
    startDate as string | undefined,
    endDate as string | undefined
  );

  success(res, summary);
}));

/**
 * @swagger
 * /metrics/{name}/trend:
 *   get:
 *     summary: 获取指标趋势数据
 *     description: 获取指定指标的时间序列数据
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: 指标名称
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 开始日期
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: 结束日期
 *       - in: query
 *         name: granularity
 *         schema:
 *           type: string
 *           enum: [day, week, month]
 *         description: 数据粒度
 *     responses:
 *       200:
 *         description: 成功
 *       401:
 *         description: 未授权
 *       403:
 *         description: 权限不足
 */
router.get('/:name/trend', asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.params;
  // 收窄 query 类型：ParsedQs → string | undefined，避免解构变量类型泛滥
  const { startDate, endDate, granularity } = req.query as Record<string, string | undefined>;

  // granularity 白名单校验：移除原 as 断言（绕过 TS 检查），非法值回退 'day'
  // service 层亦做 defense-in-depth，此处前置校验可更早拦截并减少无效入参透传
  const VALID_GRANULARITIES = ['day', 'week', 'month'] as const;
  const safeGranularity = granularity && (VALID_GRANULARITIES as readonly string[]).includes(granularity)
    ? granularity
    : 'day';

  const trend = await metricsCollectorService.getMetricTrend(
    name,
    startDate,
    endDate,
    safeGranularity,
  );

  success(res, trend);
}));

export default router;
