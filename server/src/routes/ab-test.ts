import { Router, Request, Response } from 'express';
import { body } from 'express-validator';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validator';
import { asyncHandler } from '../middleware/errorHandler';
import { auditMiddleware } from '../middleware/auditLog';
import { success } from '../utils/response';
import { abTestService } from '../services/ab-test.service';

const router = Router();

// A/B 测试事件请求体类型定义
// 设计原因：收窄 req.body 隐式 any，metadata 为任意对象结构用 Record<string, unknown>
interface RecordEventBody {
  eventType: string;
  variant: string;
  metadata?: Record<string, unknown>;
}

/**
 * @swagger
 * /api/ab-tests:
 *   get:
 *     summary: 获取所有 A/B 测试列表
 *     tags: [AB Test]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: 测试列表
 */
router.get('/', authenticate, requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
  const configs = await abTestService.getAllTestConfigs();
  success(res, configs);
}));

/**
 * @swagger
 * /api/ab-tests/{testName}/config:
 *   get:
 *     summary: 获取指定 A/B 测试配置
 *     tags: [AB Test]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: testName
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 测试配置
 *       404:
 *         description: 测试不存在
 */
router.get('/:testName/config', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const config = await abTestService.getTestConfig(req.params.testName);
  success(res, config);
}));

/**
 * @swagger
 * /api/ab-tests/{testName}/assign:
 *   post:
 *     summary: 为当前用户分配变体
 *     tags: [AB Test]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: testName
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 分配结果
 *       400:
 *         description: 测试未激活
 *       404:
 *         description: 测试不存在
 */
router.post('/:testName/assign', authenticate, auditMiddleware('AB_TEST_ASSIGN', {
  resourceType: 'ab_test',
  // getResourceId 从 req.params.testName 提取（实验名称作为资源标识）
  // 设计原因：A/B 测试分桶影响实验数据完整性，实验数据异常时可追溯分桶来源
  getResourceId: (req) => req.params.testName,
}), asyncHandler(async (req: Request, res: Response) => {
  const result = await abTestService.assignVariant(req.params.testName, req.user!.id);
  success(res, result);
}));

/**
 * @swagger
 * /api/ab-tests/{testName}/event:
 *   post:
 *     summary: 记录 A/B 测试事件
 *     tags: [AB Test]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: testName
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [eventType, variant]
 *             properties:
 *               eventType:
 *                 type: string
 *                 example: impression
 *               variant:
 *                 type: string
 *                 example: control
 *               metadata:
 *                 type: object
 *     responses:
 *       200:
 *         description: 事件记录成功
 *       404:
 *         description: 测试不存在
 */
router.post('/:testName/event', authenticate, validate([
  body('eventType').isString().notEmpty().withMessage('事件类型不能为空'),
  body('variant').isString().notEmpty().withMessage('变体名称不能为空'),
  body('metadata').optional().isObject(),
]), asyncHandler(async (req: Request<Record<string, string>, unknown, RecordEventBody>, res: Response) => {
  const { eventType, variant, metadata } = req.body;
  await abTestService.recordEvent(req.params.testName, req.user!.id, variant, eventType, metadata);
  success(res, null, '事件记录成功');
}));

/**
 * @swagger
 * /api/ab-tests/{testName}/results:
 *   get:
 *     summary: 获取 A/B 测试结果统计
 *     tags: [AB Test]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: testName
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: 测试结果
 *       404:
 *         description: 测试不存在
 */
router.get('/:testName/results', authenticate, requireRole('admin'), asyncHandler(async (req: Request, res: Response) => {
  const results = await abTestService.getTestResults(req.params.testName);
  success(res, results);
}));

export default router;
