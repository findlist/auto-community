import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { getSystemMetrics, getAlertLogs, clearAlertLogs } from '../services/metrics.service';

const router = Router();

// 健康检查接口：检测服务存活与数据库连接状态
router.get('/health', async (req: Request, res: Response) => {
  try {
    // 检查数据库连接
    const client = await pool.connect();
    client.release();

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
  }
});

// 系统指标接口：返回数据库、Redis、服务器状态及告警日志
router.get('/health/metrics', async (req: Request, res: Response) => {
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

// 清除告警日志接口
router.delete('/health/metrics/alerts', (req: Request, res: Response) => {
  clearAlertLogs();
  res.json({
    code: 0,
    message: '告警日志已清除',
  });
});

export default router;
