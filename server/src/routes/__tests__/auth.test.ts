/**
 * auth 路由集成测试
 *
 * 测试目标：覆盖认证全链路（register/login/refresh-token/logout/forgot-password/reset-password）
 * 测试策略：
 * - mock middleware/auth 的 authenticate（logout 路由使用，默认放行设置 req.user）
 * - mock middleware/rateLimiter 的 authLimiter（直接中间件，mock 为 pass-through）
 * - mock middleware/auditLog 的 auditMiddleware（高阶函数，mock 为返回 pass-through 的工厂）
 * - mock services/auth.service 的 6 个方法避免真实 DB 读写
 * - mock utils/logger 避免 console 噪音
 * - 重点验证本轮新增的 isString 类型校验在路由层 422 拦截非字符串输入
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
} = vi.hoisted(() => ({
  // authenticate 默认放行并设置 req.user（logout 路由依赖 req.headers.authorization）
  mockAuthenticate: vi.fn(),
  // authLimiter 为直接中间件，mock 为 pass-through
  mockAuthLimiter: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockRegister: vi.fn(),
  mockLogin: vi.fn(),
  mockRefreshToken: vi.fn(),
  mockLogout: vi.fn(),
  mockForgotPassword: vi.fn(),
  mockResetPassword: vi.fn(),
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
  },
}));

import authRouter from '../auth';
import { errorHandler } from '../../middleware/errorHandler';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 handler 转发的异常，验证错误响应标准化逻辑
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

describe('auth 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    // resetAllMocks 彻底清除 mock 行为，避免跨测试污染
    vi.resetAllMocks();
    // 重新设置 pass-through 中间件默认行为（resetAllMocks 会清除 mockImplementation）
    mockAuthLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockAuditMiddleware.mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    // authenticate 默认通过并设置 req.user（logout 路由使用）
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
    const validBody = {
      phone: '13800138000',
      password: 'pass123',
      nickname: 'tester',
      privacyConsentVersion: 'v1.0',
    };

    it('合法输入应返回 200 并调用 authService.register', async () => {
      mockRegister.mockResolvedValue({ user: { id: 'u-1' }, accessToken: 'tok' });
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
      expect(mockRegister).toHaveBeenCalledWith('13800138000', 'pass123', 'tester', 'v1.0');
    });

    it('password 非字符串（数字）返回 422，不调用 service', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, password: 123456 }),
      });
      expect(res.status).toBe(422);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('nickname 非字符串（数字）返回 422，不调用 service', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, nickname: 12345 }),
      });
      expect(res.status).toBe(422);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('privacyConsentVersion 非字符串（数字）返回 422，不调用 service', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, privacyConsentVersion: 1 }),
      });
      expect(res.status).toBe(422);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('手机号格式错误返回 422', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, phone: 'abc' }),
      });
      expect(res.status).toBe(422);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('password 太短（<6）返回 422', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, password: '123' }),
      });
      expect(res.status).toBe(422);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it('nickname 太短（<2）返回 422', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, nickname: 'a' }),
      });
      expect(res.status).toBe(422);
      expect(mockRegister).not.toHaveBeenCalled();
    });
  });

  // ===================== POST /login =====================
  describe('POST /login', () => {
    const validBody = {
      phone: '13800138000',
      password: 'pass123',
    };

    it('合法输入应返回 200 并调用 authService.login', async () => {
      mockLogin.mockResolvedValue({ accessToken: 'tok', refreshToken: 'rt' });
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
      expect(mockLogin).toHaveBeenCalledWith('13800138000', 'pass123');
    });

    it('phone 非手机号格式返回 422', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: 'abc', password: 'pass123' }),
      });
      expect(res.status).toBe(422);
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('password 非字符串（数字）返回 422，不调用 service', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '13800138000', password: 123456 }),
      });
      expect(res.status).toBe(422);
      expect(mockLogin).not.toHaveBeenCalled();
    });

    it('password 空字符串返回 422', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '13800138000', password: '' }),
      });
      expect(res.status).toBe(422);
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });

  // ===================== POST /refresh-token =====================
  describe('POST /refresh-token', () => {
    it('合法 refreshToken 应返回 200 并调用 authService.refreshToken', async () => {
      mockRefreshToken.mockResolvedValue({ accessToken: 'new-tok' });
      const res = await fetch(`${baseUrl}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'some-refresh-token' }),
      });
      expect(res.status).toBe(200);
      expect(mockRefreshToken).toHaveBeenCalledWith('some-refresh-token');
    });

    it('refreshToken 非字符串（数字）返回 422，不调用 service', async () => {
      const res = await fetch(`${baseUrl}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 12345 }),
      });
      expect(res.status).toBe(422);
      expect(mockRefreshToken).not.toHaveBeenCalled();
    });

    it('refreshToken 空字符串返回 422', async () => {
      const res = await fetch(`${baseUrl}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: '' }),
      });
      expect(res.status).toBe(422);
      expect(mockRefreshToken).not.toHaveBeenCalled();
    });
  });

  // ===================== POST /logout =====================
  describe('POST /logout', () => {
    it('携带 Bearer token 应返回 200 并调用 authService.logout', async () => {
      mockLogout.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: { Authorization: 'Bearer some-token' },
      });
      expect(res.status).toBe(200);
      expect(mockLogout).toHaveBeenCalledWith('some-token');
    });

    it('未携带 Authorization 头时传入空字符串调用 logout', async () => {
      mockLogout.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/logout`, { method: 'POST' });
      expect(res.status).toBe(200);
      // 设计原因：handler 内 token = authHeader?.startsWith('Bearer ') ? substring(7) : ''
      // 未携带 Authorization 时 authHeader 为 undefined，token 回退为空字符串
      expect(mockLogout).toHaveBeenCalledWith('');
    });
  });

  // ===================== POST /forgot-password =====================
  describe('POST /forgot-password', () => {
    it('合法手机号应返回 200 并调用 authService.forgotPassword', async () => {
      mockForgotPassword.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '13800138000' }),
      });
      expect(res.status).toBe(200);
      expect(mockForgotPassword).toHaveBeenCalledWith('13800138000');
    });

    it('手机号格式错误返回 422', async () => {
      const res = await fetch(`${baseUrl}/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: 'abc' }),
      });
      expect(res.status).toBe(422);
      expect(mockForgotPassword).not.toHaveBeenCalled();
    });
  });

  // ===================== POST /reset-password =====================
  describe('POST /reset-password', () => {
    const validBody = {
      phone: '13800138000',
      code: '123456',
      password: 'newpass123',
    };

    it('合法输入应返回 200 并调用 authService.resetPassword', async () => {
      mockResetPassword.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
      expect(mockResetPassword).toHaveBeenCalledWith('13800138000', '123456', 'newpass123');
    });

    it('code 非字符串（数字）返回 422，不调用 service', async () => {
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, code: 123456 }),
      });
      expect(res.status).toBe(422);
      expect(mockResetPassword).not.toHaveBeenCalled();
    });

    it('password 非字符串（数字）返回 422，不调用 service', async () => {
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, password: 123456 }),
      });
      expect(res.status).toBe(422);
      expect(mockResetPassword).not.toHaveBeenCalled();
    });

    it('code 长度不为6返回 422', async () => {
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, code: '12345' }),
      });
      expect(res.status).toBe(422);
      expect(mockResetPassword).not.toHaveBeenCalled();
    });

    it('password 太短（<6）返回 422', async () => {
      const res = await fetch(`${baseUrl}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validBody, password: '123' }),
      });
      expect(res.status).toBe(422);
      expect(mockResetPassword).not.toHaveBeenCalled();
    });
  });
});
