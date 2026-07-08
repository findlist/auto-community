/**
 * metrics 路由集成测试
 *
 * 测试目标：
 * - GET /dashboard：仪表盘指标概览（authenticate→requireRole('admin')→getDashboardMetrics）
 * - GET /:name/summary：指标汇总（含 startDate/endDate query 透传）
 * - GET /:name/trend：指标趋势（含 granularity query 透传，默认 day）
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate 与 requireRole（requireRole 为高阶函数，返回中间件）
 * - mock services/metrics-collector.service 的 metricsCollectorService（避免真实 DB 查询）
 * - 挂载 errorHandler 中间件（验证 UnauthorizedError/ForbiddenError 标准化为 401/403 响应）
 * - 设计原因：metrics 路由通过 router.use(authenticate, requireRole('admin')) 全局应用中间件，
 *   测试需覆盖认证、权限、业务三层错误分支
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
  mockAuthenticate,
  mockRequireRoleMiddleware,
  mockGetDashboardMetrics,
  mockGetMetricSummary,
  mockGetMetricTrend,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockRequireRoleMiddleware: vi.fn(),
  mockGetDashboardMetrics: vi.fn(),
  mockGetMetricSummary: vi.fn(),
  mockGetMetricTrend: vi.fn(),
}));

// requireRole 为高阶函数：requireRole(...roles) 返回中间件
// 模块加载时 router.use(authenticate, requireRole('admin')) 会调用 requireRole('admin')，
// mock requireRole 返回 mockRequireRoleMiddleware，便于在测试中动态切换权限通过/拒绝
vi.mock('../../middleware/auth', () => ({
  authenticate: mockAuthenticate,
  requireRole: vi.fn(() => mockRequireRoleMiddleware),
}));
vi.mock('../../services/metrics-collector.service', () => ({
  metricsCollectorService: {
    getDashboardMetrics: mockGetDashboardMetrics,
    getMetricSummary: mockGetMetricSummary,
    getMetricTrend: mockGetMetricTrend,
  },
}));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import metricsRouter from '../metrics';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 handler 转发的 AppError，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(metricsRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** 关闭服务器，避免句柄泄漏导致测试进程无法退出 */
async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('metrics 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 通过设置 req.user，requireRole 中间件直接放行
    // 注：requireRole 已 mock 为直接 next()，无需在 req.user 中设置 role 字段
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'admin-uuid-001', nickname: 'admin' };
      next();
    });
    mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
      next();
    });
    mockGetDashboardMetrics.mockResolvedValue({
      emergency_response_time: { value: 120, tags: { unit: 'seconds' } },
      match_success_rate: { value: 85.5, tags: {} },
    });
    mockGetMetricSummary.mockResolvedValue({
      avg: 100, min: 50, max: 200, count: 10,
    });
    mockGetMetricTrend.mockResolvedValue([
      { bucket: '2026-07-01', avg: 100, count: 5 },
      { bucket: '2026-07-02', avg: 110, count: 6 },
    ]);
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /dashboard', () => {
    it('管理员认证通过返回仪表盘指标 200', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('SUCCESS');
      expect(data.data.emergency_response_time.value).toBe(120);
      expect(mockGetDashboardMetrics).toHaveBeenCalledTimes(1);
    });

    it('未认证时 authenticate 转发 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/dashboard`);
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, any>;
      expect(data.message).toBe('未提供认证令牌');
      expect(mockGetDashboardMetrics).not.toHaveBeenCalled();
    });

    it('非管理员角色 requireRole 中间件转发 403', async () => {
      mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new ForbiddenError('权限不足，需要管理员权限'));
      });
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Authorization: 'Bearer user-token' },
      });
      expect(res.status).toBe(403);
      const data = (await res.json()) as Record<string, any>;
      // ForbiddenError 标准化响应：code 为 FORBIDDEN（CommonErrorCode.FORBIDDEN）
      expect(data.code).toBe('FORBIDDEN');
      expect(data.message).toContain('权限不足');
      expect(mockGetDashboardMetrics).not.toHaveBeenCalled();
    });

    it('getDashboardMetrics 抛错时由 errorHandler 返回 500', async () => {
      mockGetDashboardMetrics.mockRejectedValue(new Error('聚合查询失败'));
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(data.message).toBe('聚合查询失败');
    });
  });

  describe('GET /:name/summary', () => {
    it('返回指定指标的汇总数据 200', async () => {
      const res = await fetch(`${baseUrl}/emergency_response_time/summary`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('SUCCESS');
      expect(data.data.avg).toBe(100);
      expect(data.data.count).toBe(10);
      // 验证 getMetricSummary 收到正确的 name 参数
      expect(mockGetMetricSummary).toHaveBeenCalledWith(
        'emergency_response_time',
        undefined,
        undefined,
      );
    });

    it('startDate 与 endDate query 参数透传到 service', async () => {
      const res = await fetch(
        `${baseUrl}/match_success_rate/summary?startDate=2026-07-01&endDate=2026-07-08`,
        { headers: { Authorization: 'Bearer admin-token' } },
      );
      expect(res.status).toBe(200);
      // 验证 query 参数透传到 getMetricSummary
      expect(mockGetMetricSummary).toHaveBeenCalledWith(
        'match_success_rate',
        '2026-07-01',
        '2026-07-08',
      );
    });

    it('getMetricSummary 抛错时返回 500', async () => {
      mockGetMetricSummary.mockRejectedValue(new Error('汇总计算失败'));
      const res = await fetch(`${baseUrl}/emergency_response_time/summary`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('GET /:name/trend', () => {
    it('返回指定指标的趋势数据 200', async () => {
      const res = await fetch(`${baseUrl}/emergency_response_time/trend`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('SUCCESS');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(2);
      // 未传 granularity 时默认 'day'
      expect(mockGetMetricTrend).toHaveBeenCalledWith(
        'emergency_response_time',
        undefined,
        undefined,
        'day',
      );
    });

    it('granularity=week 透传到 service', async () => {
      const res = await fetch(
        `${baseUrl}/emergency_response_time/trend?granularity=week`,
        { headers: { Authorization: 'Bearer admin-token' } },
      );
      expect(res.status).toBe(200);
      expect(mockGetMetricTrend).toHaveBeenCalledWith(
        'emergency_response_time',
        undefined,
        undefined,
        'week',
      );
    });

    it('granularity=month 与日期范围同时透传', async () => {
      const res = await fetch(
        `${baseUrl}/match_success_rate/trend?startDate=2026-06-01&endDate=2026-07-01&granularity=month`,
        { headers: { Authorization: 'Bearer admin-token' } },
      );
      expect(res.status).toBe(200);
      expect(mockGetMetricTrend).toHaveBeenCalledWith(
        'match_success_rate',
        '2026-06-01',
        '2026-07-01',
        'month',
      );
    });

    it('getMetricTrend 抛错时返回 500', async () => {
      mockGetMetricTrend.mockRejectedValue(new Error('趋势查询失败'));
      const res = await fetch(`${baseUrl}/emergency_response_time/trend`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });
});
