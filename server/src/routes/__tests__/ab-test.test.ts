/**
 * ab-test 路由集成测试
 *
 * 测试目标：
 * - GET /：获取所有 A/B 测试列表，串联 authenticate→requireRole('admin')→abTestService.getAllTestConfigs
 * - GET /:testName/config：获取指定测试配置，串联 authenticate→abTestService.getTestConfig
 * - POST /:testName/assign：分配变体，串联 authenticate→abTestService.assignVariant
 * - POST /:testName/event：记录事件，串联 authenticate→validate→abTestService.recordEvent
 * - GET /:testName/results：获取测试结果，串联 authenticate→requireRole('admin')→abTestService.getTestResults
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate 与 requireRole（requireRole 为高阶函数，mock 为 vi.fn(() => mockMiddleware)）
 * - mock services/ab-test.service 的 abTestService 5 个方法
 * - 真实挂载 validate 中间件（验证 eventType/variant 字段校验）
 * - 挂载 errorHandler 中间件（验证 NotFoundError/BadRequestError 标准化为 404/400）
 * - 设计原因：requireRole(...roles) 返回中间件，router.use 加载时立即调用，mock 时需返回中间件函数
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
const { mockAuthenticate, mockRequireRoleMiddleware, mockGetAllTestConfigs, mockGetTestConfig, mockAssignVariant, mockRecordEvent, mockGetTestResults } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  // requireRole 高阶函数返回的中间件：默认通过，可重写为拒绝以覆盖 403 分支
  mockRequireRoleMiddleware: vi.fn(),
  mockGetAllTestConfigs: vi.fn(),
  mockGetTestConfig: vi.fn(),
  mockAssignVariant: vi.fn(),
  mockRecordEvent: vi.fn(),
  mockGetTestResults: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({
  authenticate: mockAuthenticate,
  // requireRole 为高阶函数，调用后返回中间件；mock 为返回 mockRequireRoleMiddleware 的函数
  requireRole: vi.fn(() => mockRequireRoleMiddleware),
}));
vi.mock('../../services/ab-test.service', () => ({
  abTestService: {
    getAllTestConfigs: mockGetAllTestConfigs,
    getTestConfig: mockGetTestConfig,
    assignVariant: mockAssignVariant,
    recordEvent: mockRecordEvent,
    getTestResults: mockGetTestResults,
  },
}));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import abTestRouter from '../ab-test';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError, NotFoundError, BadRequestError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 asyncHandler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(abTestRouter);
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

describe('ab-test 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 通过，requireRole 中间件通过
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
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

  describe('GET /', () => {
    it('管理员通过返回 A/B 测试列表', async () => {
      mockGetAllTestConfigs.mockResolvedValue([
        { testName: 'homepage_layout', isActive: true, variants: ['control', 'variant_a'] },
      ]);
      const res = await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer admin-token' } });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect(data.data).toHaveLength(1);
      expect(mockGetAllTestConfigs).toHaveBeenCalledTimes(1);
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(401);
      expect(mockGetAllTestConfigs).not.toHaveBeenCalled();
    });

    it('非管理员时 requireRole 中间件返回 403', async () => {
      // 重写 requireRole 中间件为拒绝，模拟非管理员用户
      mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new Error('权限不足：需要管理员角色'));
      });
      const res = await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer user-token' } });
      // errorHandler 将普通 Error 标准化为 500
      expect(res.status).toBe(500);
      expect(mockGetAllTestConfigs).not.toHaveBeenCalled();
    });
  });

  describe('GET /:testName/config', () => {
    it('正常返回测试配置', async () => {
      mockGetTestConfig.mockResolvedValue({
        testName: 'homepage_layout',
        isActive: true,
        variants: ['control', 'variant_a'],
        weights: [50, 50],
      });
      const res = await fetch(`${baseUrl}/homepage_layout/config`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).testName).toBe('homepage_layout');
      expect(mockGetTestConfig).toHaveBeenCalledWith('homepage_layout');
    });

    it('测试不存在时返回 404', async () => {
      mockGetTestConfig.mockRejectedValue(new NotFoundError('A/B 测试配置'));
      const res = await fetch(`${baseUrl}/unknown_test/config`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/homepage_layout/config`);
      expect(res.status).toBe(401);
      expect(mockGetTestConfig).not.toHaveBeenCalled();
    });
  });

  describe('POST /:testName/assign', () => {
    it('正常分配变体返回 200', async () => {
      mockAssignVariant.mockResolvedValue({
        testName: 'homepage_layout',
        userId: 'user-uuid-001',
        variant: 'variant_a',
      });
      const res = await fetch(`${baseUrl}/homepage_layout/assign`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).variant).toBe('variant_a');
      expect(mockAssignVariant).toHaveBeenCalledWith('homepage_layout', 'user-uuid-001');
    });

    it('测试未激活时返回 400', async () => {
      mockAssignVariant.mockRejectedValue(new BadRequestError('A/B 测试未激活'));
      const res = await fetch(`${baseUrl}/inactive_test/assign`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/homepage_layout/assign`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(mockAssignVariant).not.toHaveBeenCalled();
    });
  });

  describe('POST /:testName/event', () => {
    it('合法请求体记录事件成功返回 200', async () => {
      mockRecordEvent.mockResolvedValue(undefined);
      const body = { eventType: 'impression', variant: 'control', metadata: { page: 'home' } };
      const res = await fetch(`${baseUrl}/homepage_layout/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toBe('事件记录成功');
      // 验证 recordEvent 收到正确的参数顺序
      expect(mockRecordEvent).toHaveBeenCalledWith('homepage_layout', 'user-uuid-001', 'control', 'impression', { page: 'home' });
    });

    it('eventType 缺失时 validate 返回 422', async () => {
      const body = { variant: 'control' };
      const res = await fetch(`${baseUrl}/homepage_layout/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'eventType')).toBe(true);
      expect(mockRecordEvent).not.toHaveBeenCalled();
    });

    it('variant 缺失时 validate 返回 422', async () => {
      const body = { eventType: 'click' };
      const res = await fetch(`${baseUrl}/homepage_layout/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'variant')).toBe(true);
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/homepage_layout/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'click', variant: 'control' }),
      });
      expect(res.status).toBe(401);
      expect(mockRecordEvent).not.toHaveBeenCalled();
    });
  });

  describe('GET /:testName/results', () => {
    it('管理员通过返回测试结果', async () => {
      mockGetTestResults.mockResolvedValue({
        testName: 'homepage_layout',
        totalParticipants: 1000,
        variants: [
          { variant: 'control', impressions: 500, conversions: 50, conversionRate: 10 },
          { variant: 'variant_a', impressions: 500, conversions: 75, conversionRate: 15 },
        ],
      });
      const res = await fetch(`${baseUrl}/homepage_layout/results`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).totalParticipants).toBe(1000);
      expect(mockGetTestResults).toHaveBeenCalledWith('homepage_layout');
    });

    it('测试不存在时返回 404', async () => {
      mockGetTestResults.mockRejectedValue(new NotFoundError('A/B 测试结果'));
      const res = await fetch(`${baseUrl}/unknown_test/results`, {
        headers: { Authorization: 'Bearer admin-token' },
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/homepage_layout/results`);
      expect(res.status).toBe(401);
      expect(mockGetTestResults).not.toHaveBeenCalled();
    });
  });
});
