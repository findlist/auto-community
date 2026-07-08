/**
 * AI 能力路由
 * 暴露智能匹配、需求分类、安全风控等 AI 接口
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { success, error } from '../utils/response';
import { aiService } from '../services/ai.service';
import { logger } from '../utils/logger';

const router = Router();

// 内容分类请求体类型定义
// 设计原因：收窄 req.body 隐式 any，text 为可选字段（手动校验非空后再调用 AI 服务）
interface ClassifyBody {
  text?: string;
}

/**
 * @swagger
 * /api/ai/match/skills/:postId:
 *   get:
 *     summary: 获取技能帖子 AI 智能推荐
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: 推荐列表 }
 */
router.get('/match/skills/:postId', authenticate, async (req, res) => {
  try {
    const candidates = await aiService.matchSkill(req.params.postId);
    // success/error 为辅助函数，直接传入 res 并内部调用 res.json，不应再包裹
    success(res, candidates);
  } catch (err: unknown) {
    // err 仅用于日志记录，不访问字段，用 unknown 比 any 更安全（强制消费方类型收窄）
    logger.error({ err }, '[AI] 技能匹配失败');
    error(res, '推荐服务暂不可用', 'INTERNAL_ERROR');
  }
});

/**
 * @swagger
 * /api/ai/match/time-bank/:serviceId:
 *   get:
 *     summary: 获取时间银行服务 AI 智能推荐
 *     tags: [AI]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/match/time-bank/:serviceId', authenticate, async (req, res) => {
  try {
    const candidates = await aiService.matchTimeService(req.params.serviceId);
    success(res, candidates);
  } catch (err: unknown) {
    logger.error({ err }, '[AI] 时间银行匹配失败');
    error(res, '推荐服务暂不可用', 'INTERNAL_ERROR');
  }
});

/**
 * @swagger
 * /api/ai/classify:
 *   post:
 *     summary: 内容智能分类与紧急程度判断
 *     tags: [AI]
 */
router.post('/classify', authenticate, async (req: Request<{}, any, ClassifyBody>, res: Response) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      // 校验失败直接返回，避免后续调用 AI 服务浪费资源
      error(res, '文本不能为空', 'BAD_REQUEST');
      return;
    }
    const result = await aiService.classifyContent(text);
    success(res, result);
  } catch (err: unknown) {
    logger.error({ err }, '[AI] 内容分类失败');
    error(res, '分类服务暂不可用', 'INTERNAL_ERROR');
  }
});

export default router;
