import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import { env } from './config/env';
import { swaggerSpec } from './config/swagger';
import { initWebSocket } from './websocket';
import { errorHandler } from './middleware/errorHandler';
import { AppError } from './utils/errors';
import { apiLimiter } from './middleware/rateLimiter';
import routes from './routes';
import healthRouter from './routes/health';
import { initScheduler, SchedulerHandle } from './jobs/scheduler';
import { disconnectRedis } from './config/redis';
import { closePool } from './config/database';
import { logger } from './utils/logger';

const app = express();
const server = createServer(app);

// 优雅关闭相关引用：在 listen 回调中赋值，关闭流程中按顺序释放
let wss: WebSocketServer | null = null;
let schedulerHandle: SchedulerHandle | null = null;
// 防止 SIGTERM/SIGINT 重复触发优雅关闭
let isShuttingDown = false;

// 安全头
app.use(helmet());

// CORS配置
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// JSON解析
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 静态文件服务：提供上传文件的访问
const uploadsDir = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir, {
  // 设置缓存，减少重复请求
  maxAge: '7d',
  // 禁止目录列表
  index: false
}));

// 全局限流
app.use(apiLimiter);

// Swagger API 文档：挂载在 /api-docs，提供可视化接口调试入口
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// API路由
app.use('/api', routes);

// 健康检查（含数据库连接探测）
app.use('/', healthRouter);

// 404处理
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`接口 ${req.originalUrl} 不存在`, 404));
});

// 全局错误处理
app.use(errorHandler);

// 启动服务器
server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, '服务器已启动');
  wss = initWebSocket(server);
  logger.info('WebSocket 服务已启动');
  // 启动定时任务调度器，处理各模块超时订单
  schedulerHandle = initScheduler();
});

// 优雅关闭：依次释放各资源，每步独立 try/catch 避免单点失败中断后续关闭
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.info({ signal }, '关闭流程已在进行中，忽略重复信号');
    return;
  }
  isShuttingDown = true;
  logger.info({ signal }, '收到信号，开始优雅关闭');

  // 10 秒超时强制退出，防止关闭流程卡死导致进程僵死
  const forceExitTimer = setTimeout(() => {
    logger.error('[优雅关闭] 超时未完成，强制退出');
    process.exit(1);
  }, 10000);

  // 1. 停止接受新 HTTP 请求，等待现有请求处理完成
  try {
    await new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          logger.error({ err }, '[优雅关闭] 关闭 HTTP 服务器出错');
        }
        resolve();
      });
    });
    logger.info('[优雅关闭] HTTP 服务器已关闭');
  } catch (error) {
    logger.error({ err: error }, '[优雅关闭] 关闭 HTTP 服务器失败');
  }

  // 2. 关闭 Redis 连接
  try {
    await disconnectRedis();
  } catch (error) {
    logger.error({ err: error }, '[优雅关闭] 关闭 Redis 连接失败');
  }

  // 3. 关闭 PostgreSQL 连接池
  try {
    await closePool();
  } catch (error) {
    logger.error({ err: error }, '[优雅关闭] 关闭数据库连接池失败');
  }

  // 4. 停止定时任务
  try {
    schedulerHandle?.stop();
  } catch (error) {
    logger.error({ err: error }, '[优雅关闭] 停止定时任务失败');
  }

  // 5. 关闭 WebSocket 服务
  try {
    wss?.close();
  } catch (error) {
    logger.error({ err: error }, '[优雅关闭] 关闭 WebSocket 服务失败');
  }

  clearTimeout(forceExitTimer);
  logger.info('[优雅关闭] 所有资源已释放，退出进程');
  process.exit(0);
}

// SIGTERM 与 SIGINT 均触发优雅关闭
process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});

export { app, server };
