/**
 * auth 路由集成测试
 *
 * 测试目标：覆盖注册、登录、刷新令牌、登出、忘记密码、重置密码、简化重置密码全链路
 * 测试策略：
 * - mock middleware/auth 的 authenticate（仅在 /logout 路由生效，动态决定通过/拒绝）
 * - mock middleware/rateLimiter 的 authLimiter（限流中间件直接放行，聚焦业务逻辑验证）
 * - mock middleware/auditLog 的 auditMiddleware（审计中间件直接放行，避免审计副作用）
 * - mock services/auth.service 的 authService（避免真实 DB 读写与 Redis 操作）
 * - 真实挂载 validate 中间件（验证 express-validator 链路完整可用）
 * - 挂载 errorHandler 捕获 handler 转发的异常，验证标准化错误响应
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
  mockAuthLimiter,
  mockAuditMiddleware,
  mockRegister,
  mockLogin,
  mockRefreshToken,
  mockLogout,
  mockForgotPassword,
  mockResetPassword,
  mockSimpleResetPassword,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  // authLimiter 与 auditMiddleware 为高阶中间件，mock 为直接放行的 pass-through 函数
  mockAuthLimiter: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  // auditMiddleware 是工厂函数，调用后返回中间件；mock 为返回 pass-through 的函数
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockRegister: vi.fn(),
  mockLogin: vi.fn(),
  mockRefreshToken: vi.fn(),
  mockLogout: vi.fn(),
  mockForgotPassword: vi.fn(),
  mockResetPassword: vi.fn(),
  mockSimpleResetPassword: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../middleware/rateLimiter', () => ({ authLimiter: mockAuthLimiter }));
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
vi.mock('../../services/auth.service', () => ({
  authService: {
    register: mockRegister,
    login: mockLogin,
    refreshToken: mockRefreshToken,
    logout: mockLogout,
    forgotPassword: mockForgotPassword,
    resetPassword: mockResetPassword,
    simpleResetPassword: mockSimpleResetPassword,
  },
}));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError, BadRequestError, NotFoundError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 validate 与 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
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

/** 构造合法 Authorization 头，/logout 路由认证通过时使用 */
const authHeader = { Authorization: 'Bearer valid-token' };

describe('auth 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    // 使用 resetAllMocks 彻底清除 mock 行为，避免 mockResolvedValue/mockRejectedValue 跨测试污染
    vi.resetAllMocks();
    // 重新设置 pass-through 中间件默认行为（resetAllMocks 会清除 mockImplementation）
    mockAuthLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockAuditMiddleware.mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    // authenticate 默认通过并设置 req.user，供 /logout 路由使用
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  // ===================== POST /register =====================
  describe('POST /register', () => {
    it('合法请求体注册成功返回 200', async () => {
      mockRegister.mockResolvedValue({ user: { id: 'new-user' }, accessToken: 'token', refreshToken: 'rtn' });
      const body = {
        phone: '13800138000',
        password: 'password123',
        nickname: '新用户',
        privacyConsentVersion: 'v1.0',
      };
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('SUCCESS');
      // 验证 register 收到正确的参数
      expect(mockRegister).toHaveBeenCalledWith('13800138000', 'password123', '新用户', 'v1.0');
    });

    it('手机号格式错误时 validate 返回 422', async () => {
      const body = {
        phone: 'invalid-phone',
        password: 'password123',
        nickname: '新用户',
        privacyConsentVersion: 'v1.0',
      };
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect(data.errors.some((e: { field: string }) => e.field === 'phone')).toBe(true);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('密码少于 6 位时 validate 返回 422', async () => {
      const body = {
        phone: '13800138000',
        password: '12345',
        nickname: '新用户',
        privacyConsentVersion: 'v1.0',
      };
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, any>;
      expect(data.errors.some((e: { field: string }) => e.field === 'password')).toBe(true);
    });

    it('未同意隐私政策时 validate 返回 422', async () => {
      const body = {
        phone: '13800138000',
        password: 'password123',
        nickname: '新用户',
        // privacyConsentVersion 缺失
      };
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, any>;
      expect(data.errors.some((e: { field: string }) => e.field === 'privacyConsentVersion')).toBe(true);
    });

    it('register 抛错时由 errorHandler 返回 500', async () => {
      mockRegister.mockRejectedValue(new Error('数据库写入失败'));
      const body = {
        phone: '13800138000',
        password: 'password123',
        nickname: '新用户',
        privacyConsentVersion: 'v1.0',
      };
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  // ===================== POST /login =====================
  describe('POST /login', () => {
    it('合法凭据登录成功返回 200', async () => {
      mockLogin.mockResolvedValue({ user: { id: 'user-001' }, accessToken: 'token', refreshToken: 'rtn' });
      const body = { phone: '13800138000', password: 'password123' };
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockLogin).toHaveBeenCalledWith('13800138000', 'password123');
    });

    it('未提供手机号时 validate 返回 422', async () => {
      const body = { password: 'password123' };
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, any>;
      expect(data.errors.some((e: { field: string }) => e.field === 'phone')).toBe(true);
    });

    it('账号不存在时 UnauthorizedError 标准化为 401', async () => {
      mockLogin.mockRejectedValue(new UnauthorizedError('手机号或密码错误'));
      const body = { phone: '13800138000', password: 'wrong-password' };
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('UNAUTHORIZED');
    });
  });

  // ===================== POST /refresh-token =====================
  describe('POST /refresh-token', () => {
    it('合法 refreshToken 刷新成功返回 200', async () => {
      mockRefreshToken.mockResolvedValue({ accessToken: 'new-token', refreshToken: 'new-rtn' });
      const body = { refreshToken: 'valid-refresh-token' };
      const res = await fetch(`${baseUrl}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockRefreshToken).toHaveBeenCalledWith('valid-refresh-token');
    });

    it('未提供 refreshToken 时 validate 返回 422', async () => {
      const body = {};
      const res = await fetch(`${baseUrl}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, any>;
      expect(data.errors.some((e: { field: string }) => e.field === 'refreshToken')).toBe(true);
    });

    it('refreshToken 无效时 UnauthorizedError 标准化为 401', async () => {
      mockRefreshToken.mockRejectedValue(new UnauthorizedError('refreshToken 无效或已过期'));
      const body = { refreshToken: 'invalid-token' };
      const res = await fetch(`${baseUrl}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
    });
  });

  // ===================== POST /logout =====================
  describe('POST /logout', () => {
    it('认证通过登出成功返回 200', async () => {
      mockLogout.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: authHeader,
      });
      expect(res.status).toBe(200);
      // 验证 logout 收到从 Authorization 头提取的 token
      expect(mockLogout).toHaveBeenCalledWith('valid-token');
    });

    it('未携带 Authorization 头时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/logout`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(mockLogout).not.toHaveBeenCalled();
    });

    it('logout 抛错时由 errorHandler 返回 500', async () => {
      mockLogout.mockRejectedValue(new Error('Redis 删除失败'));
      const res = await fetch(`${baseUrl}/logout`, { method: 'POST', headers: authHeader });
      expect(res.status).toBe(500);
    });
  });

  // ===================== POST /forgot-password =====================
  describe('POST /forgot-password', () => {
    it('合法手机号发送验证码成功返回 200', async () => {
      mockForgotPassword.mockResolvedValue(undefined);
      const body = { phone: '13800138000' };
      const res = await fetch(`${baseUrl}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockForgotPassword).toHaveBeenCalledWith('13800138000');
    });

    it('手机号格式错误时 validate 返回 422', async () => {
      const body = { phone: 'invalid' };
      const res = await fetch(`${baseUrl}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      expect(mockForgotPassword).not.toHaveBeenCalled();
    });
  });

  // ===================== POST /reset-password =====================
  describe('POST /reset-password', () => {
    it('合法请求体重置密码成功返回 200', async () => {
      mockResetPassword.mockResolvedValue(undefined);
      const body = { phone: '13800138000', code: '123456', password: 'newpassword' };
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockResetPassword).toHaveBeenCalledWith('13800138000', '123456', 'newpassword');
    });

    it('验证码非 6 位时 validate 返回 422', async () => {
      const body = { phone: '13800138000', code: '12345', password: 'newpassword' };
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, any>;
      expect(data.errors.some((e: { field: string }) => e.field === 'code')).toBe(true);
    });

    it('验证码错误时 BadRequestError 标准化为 400', async () => {
      mockResetPassword.mockRejectedValue(new BadRequestError('验证码错误或已过期'));
      const body = { phone: '13800138000', code: '000000', password: 'newpassword' };
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('BAD_REQUEST');
    });
  });

  // ===================== POST /simple-reset-password =====================
  describe('POST /simple-reset-password', () => {
    it('合法请求体简化重置密码成功返回 200', async () => {
      mockSimpleResetPassword.mockResolvedValue(undefined);
      const body = { phone: '13800138000', password: 'newpassword' };
      const res = await fetch(`${baseUrl}/simple-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      expect(mockSimpleResetPassword).toHaveBeenCalledWith('13800138000', 'newpassword');
    });

    it('密码少于 6 位时 validate 返回 422', async () => {
      const body = { phone: '13800138000', password: '12345' };
      const res = await fetch(`${baseUrl}/simple-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, any>;
      expect(data.errors.some((e: { field: string }) => e.field === 'password')).toBe(true);
    });

    it('账号不存在时 NotFoundError 标准化为 404', async () => {
      mockSimpleResetPassword.mockRejectedValue(new NotFoundError('账号不存在'));
      const body = { phone: '13800138000', password: 'newpassword' };
      const res = await fetch(`${baseUrl}/simple-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('NOT_FOUND');
    });
  });
});
