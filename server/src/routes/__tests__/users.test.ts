/**
 * users 路由集成测试
 *
 * 测试目标：覆盖用户资料、积分/时间流水、实名认证、账号注销全链路
 * 测试策略：
 * - mock middleware/auth 的 authenticate（根据 Authorization 头动态决定通过/拒绝）
 * - mock services/user.service 与 services/data-deletion.service（避免真实 DB 读写）
 * - 真实挂载 validate 与 getPagination（验证 express-validator 与分页参数解析链路）
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
  mockGetProfile,
  mockUpdateProfile,
  mockGetUserById,
  mockGetCreditHistory,
  mockGetTimeHistory,
  mockSubmitVerification,
  mockGetVerificationStatus,
  mockSubmitDeletionRequest,
  mockGetDeletionRequestStatus,
  mockCancelDeletionRequest,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockGetProfile: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockGetUserById: vi.fn(),
  mockGetCreditHistory: vi.fn(),
  mockGetTimeHistory: vi.fn(),
  mockSubmitVerification: vi.fn(),
  mockGetVerificationStatus: vi.fn(),
  mockSubmitDeletionRequest: vi.fn(),
  mockGetDeletionRequestStatus: vi.fn(),
  mockCancelDeletionRequest: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../services/user.service', () => ({
  userService: {
    getProfile: mockGetProfile,
    updateProfile: mockUpdateProfile,
    getUserById: mockGetUserById,
    getCreditHistory: mockGetCreditHistory,
    getTimeHistory: mockGetTimeHistory,
    submitVerification: mockSubmitVerification,
    getVerificationStatus: mockGetVerificationStatus,
  },
}));
vi.mock('../../services/data-deletion.service', () => ({
  dataDeletionService: {
    submitDeletionRequest: mockSubmitDeletionRequest,
    getDeletionRequestStatus: mockGetDeletionRequestStatus,
    cancelDeletionRequest: mockCancelDeletionRequest,
  },
}));

import usersRouter from '../users';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError, NotFoundError, BadRequestError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 validate 与 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(usersRouter);
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

/** 构造合法 Authorization 头，authenticate 默认放行时用于通过认证 */
const authHeader = { Authorization: 'Bearer valid-token' };

describe('users 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    // 使用 resetAllMocks 而非 clearAllMocks：
    // clearAllMocks 仅清除调用记录，不会清除 mockResolvedValue/mockRejectedValue，
    // 会导致上一个测试设置的 mock 行为污染后续测试（例如 NotFoundError 测试设置的
    // mockRejectedValue 会让后续 /credit-history 被 /:id 匹配时仍抛 404）
    vi.resetAllMocks();
    // 默认行为：authenticate 通过并设置 req.user
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  // ===================== GET /profile =====================
  describe('GET /profile', () => {
    it('认证通过返回当前用户资料', async () => {
      mockGetProfile.mockResolvedValue({ id: 'user-uuid-001', nickname: 'tester' });
      const res = await fetch(`${baseUrl}/profile`, { headers: authHeader });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect((data.data as Record<string, unknown>).id).toBe('user-uuid-001');
      expect(mockGetProfile).toHaveBeenCalledWith('user-uuid-001');
    });

    it('未携带 Authorization 头时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/profile`);
      expect(res.status).toBe(401);
      expect(mockGetProfile).not.toHaveBeenCalled();
    });

    it('getProfile 抛错时由 errorHandler 返回 500', async () => {
      mockGetProfile.mockRejectedValue(new Error('数据库查询失败'));
      const res = await fetch(`${baseUrl}/profile`, { headers: authHeader });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  // ===================== PUT /profile =====================
  describe('PUT /profile', () => {
    it('合法请求体更新成功返回 200', async () => {
      mockUpdateProfile.mockResolvedValue({ id: 'user-uuid-001', nickname: '新昵称' });
      const res = await fetch(`${baseUrl}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ nickname: '新昵称' }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      // 验证 updateProfile 收到 userId 与 body 字段
      expect(mockUpdateProfile).toHaveBeenCalledWith('user-uuid-001', { nickname: '新昵称' });
    });

    it('昵称少于 2 字符时 validate 返回 422', async () => {
      const res = await fetch(`${baseUrl}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ nickname: 'a' }),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect(mockUpdateProfile).not.toHaveBeenCalled();
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: '新昵称' }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ===================== GET /:id =====================
  describe('GET /:id', () => {
    it('返回指定用户资料', async () => {
      mockGetUserById.mockResolvedValue({ id: 'other-user', nickname: 'other' });
      const res = await fetch(`${baseUrl}/other-user`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockGetUserById).toHaveBeenCalledWith('other-user');
    });

    it('用户不存在时 NotFoundError 标准化为 404', async () => {
      mockGetUserById.mockRejectedValue(new NotFoundError('用户不存在'));
      const res = await fetch(`${baseUrl}/non-existent`, { headers: authHeader });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });
  });

  // ===================== GET /credit-history =====================
  describe('GET /credit-history', () => {
    it('返回分页积分流水', async () => {
      mockGetCreditHistory.mockResolvedValue({
        list: [{ id: 'tx-1', amount: 10, type: 'earn' }],
        total: 1,
      });
      const res = await fetch(`${baseUrl}/credit-history?page=1&pageSize=10`, { headers: authHeader });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      // 请求传入 page=1, pageSize=10
      expect(mockGetCreditHistory).toHaveBeenCalledWith('user-uuid-001', 1, 10);
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/credit-history`);
      expect(res.status).toBe(401);
    });
  });

  // ===================== GET /time-history =====================
  describe('GET /time-history', () => {
    it('返回分页时间流水', async () => {
      mockGetTimeHistory.mockResolvedValue({ list: [], total: 0 });
      const res = await fetch(`${baseUrl}/time-history`, { headers: authHeader });
      expect(res.status).toBe(200);
      // getPagination 默认 pageSize=20（见 middleware/validator.ts）
      expect(mockGetTimeHistory).toHaveBeenCalledWith('user-uuid-001', 1, 20);
    });
  });

  // ===================== POST /verify =====================
  describe('POST /verify', () => {
    it('合法实名信息提交认证成功', async () => {
      mockSubmitVerification.mockResolvedValue({ message: '认证申请已提交', verifyStatus: 'pending' });
      const res = await fetch(`${baseUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ realName: '张三', idCard: '110101199001011234' }),
      });
      expect(res.status).toBe(200);
      // 验证 submitVerification 收到 userId、realName、idCard
      expect(mockSubmitVerification).toHaveBeenCalledWith('user-uuid-001', '张三', '110101199001011234');
    });

    it('身份证号格式错误时 validate 返回 422', async () => {
      const res = await fetch(`${baseUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ realName: '张三', idCard: 'invalid-id' }),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'idCard')).toBe(true);
    });

    it('真实姓名过短时 validate 返回 422', async () => {
      const res = await fetch(`${baseUrl}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ realName: '张', idCard: '110101199001011234' }),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'realName')).toBe(true);
    });
  });

  // ===================== GET /verify/status =====================
  describe('GET /verify/status', () => {
    it('返回当前用户认证状态', async () => {
      mockGetVerificationStatus.mockResolvedValue({ verifyStatus: 'approved' });
      const res = await fetch(`${baseUrl}/verify/status`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockGetVerificationStatus).toHaveBeenCalledWith('user-uuid-001');
    });
  });

  // ===================== POST /deletion =====================
  describe('POST /deletion', () => {
    it('提交注销申请成功', async () => {
      mockSubmitDeletionRequest.mockResolvedValue({ message: '申请已提交' });
      const res = await fetch(`${baseUrl}/deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ reason: '不再使用' }),
      });
      expect(res.status).toBe(200);
      expect(mockSubmitDeletionRequest).toHaveBeenCalledWith('user-uuid-001', '不再使用');
    });

    it('注销原因超过 500 字符时 validate 返回 422', async () => {
      const res = await fetch(`${baseUrl}/deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ reason: 'x'.repeat(501) }),
      });
      expect(res.status).toBe(422);
      expect(mockSubmitDeletionRequest).not.toHaveBeenCalled();
    });

    it('已被封禁时 BadRequestError 标准化为 400', async () => {
      mockSubmitDeletionRequest.mockRejectedValue(new BadRequestError('账号已被封禁，无法申请注销'));
      const res = await fetch(`${baseUrl}/deletion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ reason: '不再使用' }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
    });
  });

  // ===================== GET /deletion/status =====================
  describe('GET /deletion/status', () => {
    it('返回当前用户注销申请状态', async () => {
      mockGetDeletionRequestStatus.mockResolvedValue({ status: 'pending' });
      const res = await fetch(`${baseUrl}/deletion/status`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockGetDeletionRequestStatus).toHaveBeenCalledWith('user-uuid-001');
    });
  });

  // ===================== DELETE /deletion =====================
  describe('DELETE /deletion', () => {
    it('取消注销申请成功', async () => {
      mockCancelDeletionRequest.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/deletion`, { method: 'DELETE', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockCancelDeletionRequest).toHaveBeenCalledWith('user-uuid-001');
    });

    it('无可取消申请时 BadRequestError 标准化为 400', async () => {
      mockCancelDeletionRequest.mockRejectedValue(new BadRequestError('无可取消的注销申请'));
      const res = await fetch(`${baseUrl}/deletion`, { method: 'DELETE', headers: authHeader });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
    });
  });
});
