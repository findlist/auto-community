import { pool } from '../config/database';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

// 系统指标类型定义
export interface SystemMetrics {
  database: {
    status: 'healthy' | 'unhealthy';
    poolSize: number;
    idleConnections: number;
    waitingCount: number;
  };
  redis: {
    status: 'healthy' | 'unhealthy';
    connected: boolean;
    memoryUsage: string;
  };
  server: {
    uptime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    requestQueueLength: number;
  };
}

// 告警日志类型
export interface AlertLog {
  timestamp: string;
  type: 'database' | 'redis' | 'memory';
  level: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
}

// 内存中存储最近的告警日志（最多保留 100 条）
const alertLogs: AlertLog[] = [];
const MAX_ALERT_LOGS = 100;

// 告警阈值配置
const ALERT_THRESHOLDS = {
  dbWaitingCount: 10,
  memoryUsagePercent: 80,
};

// 记录告警日志
function recordAlert(
  type: AlertLog['type'],
  level: AlertLog['level'],
  message: string,
  details: Record<string, unknown>
): void {
  const alert: AlertLog = {
    timestamp: new Date().toISOString(),
    type,
    level,
    message,
    details,
  };

  alertLogs.unshift(alert);

  // 保持日志数量限制
  if (alertLogs.length > MAX_ALERT_LOGS) {
    alertLogs.pop();
  }

  // 同时写入 pino 日志
  if (level === 'critical') {
    logger.error({ alert }, `[告警] ${message}`);
  } else {
    logger.warn({ alert }, `[告警] ${message}`);
  }
}

// 获取数据库连接池状态
async function getDatabaseMetrics(): Promise<SystemMetrics['database']> {
  try {
    // 获取连接池状态
    const poolStatus = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    // 检查数据库连接是否正常
    const client = await pool.connect();
    client.release();

    // 检查告警条件：等待数 > 10
    if (poolStatus.waitingCount > ALERT_THRESHOLDS.dbWaitingCount) {
      recordAlert(
        'database',
        'warning',
        `数据库连接池等待数过高: ${poolStatus.waitingCount}`,
        { waitingCount: poolStatus.waitingCount, threshold: ALERT_THRESHOLDS.dbWaitingCount }
      );
    }

    return {
      status: 'healthy',
      poolSize: poolStatus.totalCount,
      idleConnections: poolStatus.idleCount,
      waitingCount: poolStatus.waitingCount,
    };
  } catch (error) {
    recordAlert(
      'database',
      'critical',
      '数据库连接失败',
      { error: error instanceof Error ? error.message : 'Unknown error' }
    );
    return {
      status: 'unhealthy',
      poolSize: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
  }
}

// 获取 Redis 连接状态
async function getRedisMetrics(): Promise<SystemMetrics['redis']> {
  try {
    // 检查 Redis 是否连接
    const isConnected = redisClient.isOpen;

    if (!isConnected) {
      recordAlert('redis', 'critical', 'Redis 连接已断开', { connected: false });
      return {
        status: 'unhealthy',
        connected: false,
        memoryUsage: 'N/A',
      };
    }

    // 获取 Redis 内存使用信息
    const info = await redisClient.info('memory');
    const usedMemoryMatch = info.match(/used_memory_human:(\S+)/);
    const memoryUsage = usedMemoryMatch ? usedMemoryMatch[1] : 'N/A';

    return {
      status: 'healthy',
      connected: true,
      memoryUsage,
    };
  } catch (error) {
    recordAlert(
      'redis',
      'critical',
      'Redis 状态检查失败',
      { error: error instanceof Error ? error.message : 'Unknown error' }
    );
    return {
      status: 'unhealthy',
      connected: false,
      memoryUsage: 'N/A',
    };
  }
}

// 获取服务器状态
function getServerMetrics(): SystemMetrics['server'] {
  const memUsage = process.memoryUsage();
  const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  // 检查内存告警：使用率 > 80%
  if (heapUsedPercent > ALERT_THRESHOLDS.memoryUsagePercent) {
    recordAlert(
      'memory',
      'warning',
      `内存使用率过高: ${heapUsedPercent.toFixed(1)}%`,
      {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        percent: heapUsedPercent,
      }
    );
  }

  return {
    uptime: process.uptime(),
    memoryUsage: {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
    },
    requestQueueLength: 0, // Express 不直接提供请求队列长度，这里设为 0
  };
}

// 获取完整系统指标
export async function getSystemMetrics(): Promise<SystemMetrics> {
  const [database, redis] = await Promise.all([getDatabaseMetrics(), getRedisMetrics()]);

  return {
    database,
    redis,
    server: getServerMetrics(),
  };
}

// 获取告警日志
export function getAlertLogs(limit: number = 50): AlertLog[] {
  return alertLogs.slice(0, Math.min(limit, alertLogs.length));
}

// 清除告警日志
export function clearAlertLogs(): void {
  alertLogs.length = 0;
  logger.info('告警日志已清除');
}