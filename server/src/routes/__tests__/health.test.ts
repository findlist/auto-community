/**
 * health 路由集成测试
 *
 * 测试目标：
 * - GET /health：数据库连接健康检查，正常返回 200、异常返回 503
 * - GET /health/metrics：聚合系统指标与告警日志，正常返回 200、异常返回 500
 * - DELETE /health/metrics/alerts：清除告警日志
 *
 * 测试策略：
 * - mock config/database 的 pool（health.ts 直接调用 pool.connect 释放连接）
 * - mock services/metrics.service 的三个函数（避免真实 DB/Redis 依赖）
 * - 使用 Express 挂载 router + Node http 启动随机端口服务器，fetch 发起真实 HTTP 调用
 * - 设计原因：路由集成测试能覆盖完整中间件链路（Router→handler→response），
 *   比单独 mock Request/Response 更接近真实运行时行为，覆盖率统计也更精准
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Request, Response, NextFunction } from 'express';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// vi.hoisted 提前创建 mock 引用，避免 vi.mock 工厂内 TDZ 问题
const {
  mockPool,
  mockGetSystemMetrics,
  mockGetAlertLogs,
  mockClearAlertLogs,
  mockAuthenticate,
  mockRequireRoleMiddleware,
  mockAuditMiddleware,
  mockLogger,
} = vi.hoisted(() => ({
  mockPool: { connect: vi.fn() },
  mockGetSystemMetrics: vi.fn(),
  mockGetAlertLogs: vi.fn(),
  mockClearAlertLogs: vi.fn(),
  mockAuthenticate: vi.fn(),
  mockRequireRoleMiddleware: vi.fn(),
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  // 设计原因：mockAuditMiddleware 直接作为 auditMiddleware 工厂，便于不变式测试断言 toHaveBeenCalledWith(action, options)
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  // mock logger 避免 catch 块的日志输出污染测试控制台，同时便于断言日志调用
  mockLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// mock 路径相对于测试文件解析：routes/__tests__/ → 上一层到 routes/ → 再上一层到 src/
vi.mock('../../config/database', () => ({ pool: mockPool }));
vi.mock('../../services/metrics.service', () => ({
  getSystemMetrics: mockGetSystemMetrics,
  getAlertLogs: mockGetAlertLogs,
  clearAlertLogs: mockClearAlertLogs,
}));
// mock 认证中间件：/health/metrics 与 /health/metrics/alerts 需管理员权限
// 默认行为：authenticate 设置 req.user 并放行，requireRole 直接放行
vi.mock('../../middleware/auth', () => ({
  authenticate: mockAuthenticate,
  requireRole: vi.fn(() => mockRequireRoleMiddleware),
}));
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
vi.mock('../../utils/logger', () => ({ logger: mockLogger }));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import healthRouter from '../health';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 返回 baseUrl 供 fetch 调用，server 句柄用于 afterEach 关闭防泄漏
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** 关闭服务器，避免句柄泄漏导致测试进程无法退出 */
async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('health 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：数据库连接正常、metrics 函数返回空值
    mockPool.connect.mockResolvedValue({ release: vi.fn() });
    mockGetSystemMetrics.mockResolvedValue({ database: { status: 'healthy' } });
    mockGetAlertLogs.mockReturnValue([]);
    mockClearAlertLogs.mockReset();
    // 认证中间件默认放行：设置 req.user 并调用 next()
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'admin-001', nickname: 'admin' };
      next();
    });
    mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
      next();
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /health', () => {
    it('数据库连接正常时返回 200 与 ok 状态', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      // 设计原因：测试断言需要访问响应体多个字段，逐字段类型守卫会让测试代码冗长，
      // 用 Record<string, unknown> 收窄到字典类型即可，unknown 仅出现在测试断言层不泛滥到业务代码
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.status).toBe('ok');
      expect(data.database).toBe('connected');
      expect(data.timestamp).toBeTypeOf('string');
      expect(data.uptime).toBeTypeOf('number');
      // 验证 connect 后立即 release，避免连接泄漏
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
    });

    it('数据库连接失败时返回 503 与 error 状态', async () => {
      mockPool.connect.mockRejectedValue(new Error('Connection refused'));
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(503);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      // 设计原因：测试断言需要访问响应体多个字段，逐字段类型守卫会让测试代码冗长，
      // 用 Record<string, unknown> 收窄到字典类型即可，unknown 仅出现在测试断言层不泛滥到业务代码
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.status).toBe('error');
      expect(data.database).toBe('disconnected');
      expect(data.error).toBe('Connection refused');
      // 验证 logger.error 被调用，运维侧服务端日志应留痕便于定位连接失败真实原因
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        '[健康检查] 数据库连接失败，返回 503 降级响应',
      );
    });

    it('数据库抛出非 Error 对象时错误信息降级为 Unknown error', async () => {
      // 边界场景：throw 字符串等非 Error 值时，instanceof Error 分支不命中
      mockPool.connect.mockRejectedValue('string error');
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(503);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      // 设计原因：测试断言需要访问响应体多个字段，逐字段类型守卫会让测试代码冗长，
      // 用 Record<string, unknown> 收窄到字典类型即可，unknown 仅出现在测试断言层不泛滥到业务代码
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.error).toBe('Unknown error');
      // 非 Error 对象也应触发 logger.error 留痕，不依赖 instanceof 判断
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('GET /health/metrics', () => {
    it('聚合返回系统指标与告警日志，limit 默认 50', async () => {
      const fakeMetrics = {
        database: { status: 'healthy', connections: { total: 10, idle: 5, waiting: 0 } },
        redis: { status: 'healthy', memoryUsage: '1.5M' },
        server: { uptime: 1000, memoryUsage: '50M', requestQueueLength: 0 },
      };
      mockGetSystemMetrics.mockResolvedValue(fakeMetrics);
      const fakeAlerts = [{ level: 'warning', message: 'waitingCount 偏高', timestamp: '2026-07-08T00:00:00Z' }];
      mockGetAlertLogs.mockReturnValue(fakeAlerts);

      const res = await fetch(`${baseUrl}/health/metrics`);
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      // 设计原因：测试断言需要访问响应体多个字段，逐字段类型守卫会让测试代码冗长，
      // 用 Record<string, unknown> 收窄到字典类型即可，unknown 仅出现在测试断言层不泛滥到业务代码
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe(0);
      expect((data.data as Record<string, unknown>).metrics).toEqual(fakeMetrics);
      expect((data.data as Record<string, unknown>).alerts).toEqual(fakeAlerts);
      // 验证告警日志查询使用默认 limit=50
      expect(mockGetAlertLogs).toHaveBeenCalledWith(50);
    });

    it('getSystemMetrics 抛错时返回 500 与失败消息', async () => {
      mockGetSystemMetrics.mockRejectedValue(new Error('Redis 不可用'));
      const res = await fetch(`${baseUrl}/health/metrics`);
      expect(res.status).toBe(500);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      // 设计原因：测试断言需要访问响应体多个字段，逐字段类型守卫会让测试代码冗长，
      // 用 Record<string, unknown> 收窄到字典类型即可，unknown 仅出现在测试断言层不泛滥到业务代码
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe(500);
      expect(data.message).toBe('获取系统指标失败');
      expect(data.error).toBe('Redis 不可用');
      // 验证 logger.error 被调用，运维侧服务端日志应留痕便于定位指标采集失败真实原因
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        '[健康检查] 获取系统指标失败，返回 500 错误响应',
      );
    });

    it('getSystemMetrics 抛非 Error 时错误信息降级为 Unknown error', async () => {
      mockGetSystemMetrics.mockRejectedValue(null);
      const res = await fetch(`${baseUrl}/health/metrics`);
      expect(res.status).toBe(500);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      // 设计原因：测试断言需要访问响应体多个字段，逐字段类型守卫会让测试代码冗长，
      // 用 Record<string, unknown> 收窄到字典类型即可，unknown 仅出现在测试断言层不泛滥到业务代码
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.error).toBe('Unknown error');
    });
  });

  describe('DELETE /health/metrics/alerts', () => {
    it('清除告警日志返回 200 与成功消息', async () => {
      const res = await fetch(`${baseUrl}/health/metrics/alerts`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      // 设计原因：测试断言需要访问响应体多个字段，逐字段类型守卫会让测试代码冗长，
      // 用 Record<string, unknown> 收窄到字典类型即可，unknown 仅出现在测试断言层不泛滥到业务代码
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe(0);
      expect(data.message).toBe('告警日志已清除');
      expect(mockClearAlertLogs).toHaveBeenCalledTimes(1);
    });
  });

  describe('审计接入不变式（全量）', () => {
    it('1 处清除告警路由以正确 action 与 resourceType 调用 auditMiddleware', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：beforeEach 的 vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      // 覆盖范围：1 处本轮新增（CLEAR_ALERT_LOGS）
      vi.resetModules();
      await import('../health');

      // 期望的 action 与 resourceType 映射表（数据驱动断言，新增接入只需在此追加一行）
      const expected: Array<{ action: string; resourceType: string }> = [
        { action: 'CLEAR_ALERT_LOGS', resourceType: 'alert_log' },
      ];

      // 验证 auditMiddleware 被调用 1 次
      expect(mockAuditMiddleware).toHaveBeenCalledTimes(expected.length);

      // 逐项验证 action 与 resourceType 参数完整
      for (const item of expected) {
        expect(mockAuditMiddleware).toHaveBeenCalledWith(item.action, expect.objectContaining({ resourceType: item.resourceType }));
      }
    });
  });
});
