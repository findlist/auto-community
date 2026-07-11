import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getSystemMetrics, getAlertLogs, clearAlertLogs } from '../services/metrics.service';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// 健康检查接口：检测服务存活与数据库连接状态
router.get('/health', async (req: Request, res: Response) => {
  // 在 try 外声明 client，确保 finally 能访问到；release 必须在 finally 中执行，
  // 防止后续维护在 try 内插入新逻辑时因异常导致连接泄漏（连接池耗尽将拖垮整个服务）
  let client;
  try {
    // 检查数据库连接
    client = await pool.connect();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
      uptime: process.uptime(),
    });
  } catch (error) {
    // 数据库不可用时返回 503，便于运维/网关识别降级状态
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    // 无论成功还是异常都释放连接回连接池，杜绝泄漏
    client?.release();
  }
});

// 系统指标接口：返回数据库、Redis、服务器状态及告警日志
// 需要管理员权限：暴露系统内部运行状态，非管理员不可访问
router.get('/health/metrics', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const metrics = await getSystemMetrics();
    const alerts = getAlertLogs(50);

    res.json({
      code: 0,
      data: {
        metrics,
        alerts,
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: '获取系统指标失败',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 清除告警日志接口：需要管理员权限，避免任意用户清除运维告警记录
router.delete('/health/metrics/alerts', authenticate, requireRole('admin'), (req: Request, res: Response) => {
  clearAlertLogs();
  res.json({
    code: 0,
    message: '告警日志已清除',
  });
});

export default router;
