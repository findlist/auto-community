/**
 * reports 路由集成测试
 *
 * 测试目标：
 * - POST /：创建举报接口，串联 authenticate→validate→asyncHandler→adminService.createReport
 * - 验证 401（未认证）/ 422（参数校验失败）/ 200（创建成功）/ 500（服务异常）四类响应
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate（根据 Authorization 头动态决定通过/拒绝，覆盖 401 与 200 两条路径）
 * - mock services/admin.service 的 createReport（避免真实 DB 写入）
 * - 真实挂载 validate 中间件（验证 express-validator 链路完整可用）
 * - 挂载 errorHandler 中间件（验证 AppError 标准化错误响应）
 * - 设计原因：路由集成测试覆盖完整中间件链路，比 mock 单个 handler 更接近真实运行时行为
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
const { mockAuthenticate, mockCreateReport } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockCreateReport: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../services/admin.service', () => ({
  adminService: { createReport: mockCreateReport },
}));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import reportsRouter from '../reports';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 validate 与 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(reportsRouter);
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

describe('reports 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 通过并设置 req.user，createReport 返回固定 report
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    mockCreateReport.mockResolvedValue({
      id: 'report-uuid-001',
      reporter_id: 'user-uuid-001',
      target_type: 'skill',
      target_id: 'target-uuid-001',
      reason: '举报原因内容',
      status: 'pending',
      created_at: new Date('2026-07-08T00:00:00Z'),
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('POST /', () => {
    it('合法请求体创建举报成功返回 200', async () => {
      const body = {
        targetType: 'skill',
        targetId: '550e8400-e29b-41d4-a716-446655440000',
        reason: '内容存在违规行为需要举报',
      };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      // success 响应结构：{ code, message, data }
      expect(data.code).toBe('SUCCESS');
      expect(data.message).toBe('举报成功');
      expect((data.data as Record<string, unknown>).id).toBe('report-uuid-001');
      // 验证 createReport 收到正确的 userId 与 body 字段
      expect(mockCreateReport).toHaveBeenCalledWith(
        'user-uuid-001',
        'skill',
        '550e8400-e29b-41d4-a716-446655440000',
        '内容存在违规行为需要举报',
      );
    });

    it('未携带 Authorization 头时 authenticate 转发 401', async () => {
      // 重写 mock：未携带 token 时 authenticate 转发 UnauthorizedError
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const body = {
        targetType: 'skill',
        targetId: '550e8400-e29b-41d4-a716-446655440000',
        reason: '内容存在违规行为需要举报',
      };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      // AppError 标准化响应：code 为错误码字符串，message 为错误消息
      expect(data.message).toBe('未提供认证令牌');
      // createReport 不应被调用（被 authenticate 拦截）
      expect(mockCreateReport).not.toHaveBeenCalled();
    });

    it('targetType 非法时 validate 返回 422 与字段级错误', async () => {
      const body = {
        targetType: 'invalid_type', // 非白名单值
        targetId: '550e8400-e29b-41d4-a716-446655440000',
        reason: '内容存在违规行为需要举报',
      };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect(data.message).toBe('参数验证失败');
      // 验证 errors 数组包含 targetType 字段错误
      expect(Array.isArray(data.errors)).toBe(true);
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'targetType')).toBe(true);
      expect(mockCreateReport).not.toHaveBeenCalled();
    });

    it('targetId 非 UUID 时 validate 返回 422', async () => {
      const body = {
        targetType: 'kitchen',
        targetId: 'not-a-uuid',
        reason: '内容存在违规行为需要举报',
      };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'targetId')).toBe(true);
    });

    it('reason 长度不足 5 时 validate 返回 422', async () => {
      const body = {
        targetType: 'time_bank',
        targetId: '550e8400-e29b-41d4-a716-446655440000',
        reason: '太短', // 仅 2 个字符，小于 min:5
      };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'reason')).toBe(true);
    });

    it('createReport 抛错时由 errorHandler 返回 500', async () => {
      mockCreateReport.mockRejectedValue(new Error('数据库写入失败'));
      const body = {
        targetType: 'user',
        targetId: '550e8400-e29b-41d4-a716-446655440000',
        reason: '内容存在违规行为需要举报',
      };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(500);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(data.message).toBe('数据库写入失败');
    });

    it('未提供 reason 字段时 validate 返回 422', async () => {
      // 缺少必填字段的边界场景
      const body = {
        targetType: 'skill',
        targetId: '550e8400-e29b-41d4-a716-446655440000',
        // reason 缺失
      };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'reason')).toBe(true);
    });
  });
});
