/**
 * address 路由集成测试
 *
 * 测试目标：
 * - GET /：获取地址列表，串联 authenticate→asyncHandler→addressService.listByUser
 * - POST /：创建地址，串联 authenticate→validate→asyncHandler→addressService.create
 * - PUT /:id：更新地址，串联 authenticate→validate→asyncHandler→addressService.update
 * - DELETE /:id：删除地址，串联 authenticate→asyncHandler→addressService.remove
 * - PUT /:id/default：设为默认，串联 authenticate→asyncHandler→addressService.setDefault
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate（根据 Authorization 头动态决定通过/拒绝，覆盖 401 与 200 两条路径）
 * - mock services/address.service 的 addressService 5 个方法（避免真实 DB 事务）
 * - 真实挂载 validate 中间件（验证 express-validator 收件人/手机号/地址字段校验链路完整可用）
 * - 挂载 errorHandler 中间件（验证 NotFoundError 标准化为 404 响应、未知错误标際化为 500）
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
const { mockAuthenticate, mockAuditMiddleware, mockListByUser, mockCreate, mockUpdate, mockRemove, mockSetDefault } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  // 设计原因：address 路由本身不依赖审计中间件的具体行为，审计逻辑由 auditLog 单测覆盖
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockListByUser: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockRemove: vi.fn(),
  mockSetDefault: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
// auditMiddleware mock 为 pass-through 工厂，审计逻辑由 auditLog 单测覆盖
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
vi.mock('../../services/address.service', () => ({
  addressService: {
    listByUser: mockListByUser,
    create: mockCreate,
    update: mockUpdate,
    remove: mockRemove,
    setDefault: mockSetDefault,
  },
}));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import addressRouter from '../address';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError, NotFoundError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 validate 与 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(addressRouter);
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

/** 构造一个固定结构的地址对象，供多测试用例复用 */
function buildAddress(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'addr-uuid-001',
    userId: 'user-uuid-001',
    recipient: '张三',
    phone: '13800138000',
    address: '北京市朝阳区某街道某号',
    isDefault: false,
    createdAt: new Date('2026-07-08T00:00:00Z'),
    updatedAt: new Date('2026-07-08T00:00:00Z'),
    ...overrides,
  };
}

describe('address 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 通过并设置 req.user，与 reports.test.ts 保持一致
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /', () => {
    it('认证通过返回地址列表', async () => {
      mockListByUser.mockResolvedValue([buildAddress(), buildAddress({ id: 'addr-uuid-002', isDefault: true })]);
      const res = await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer valid-token' } });
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(2);
      // 验证 listByUser 收到正确的 userId
      expect(mockListByUser).toHaveBeenCalledWith('user-uuid-001');
    });

    it('空地址列表返回空数组', async () => {
      mockListByUser.mockResolvedValue([]);
      const res = await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer valid-token' } });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.data).toEqual([]);
    });

    it('未携带 Authorization 头时返回 401', async () => {
      // 重写 mock：未携带 token 时 authenticate 转发 UnauthorizedError
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toBe('未提供认证令牌');
      // listByUser 不应被调用（被 authenticate 拦截）
      expect(mockListByUser).not.toHaveBeenCalled();
    });

    it('listByUser 抛错时由 errorHandler 返回 500', async () => {
      mockListByUser.mockRejectedValue(new Error('数据库查询失败'));
      const res = await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer valid-token' } });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(data.message).toBe('数据库查询失败');
    });
  });

  describe('POST /', () => {
    it('合法请求体创建地址成功返回 200', async () => {
      mockCreate.mockResolvedValue(buildAddress({ isDefault: true }));
      const body = { recipient: '张三', phone: '13800138000', address: '北京市朝阳区某街道某号', isDefault: true };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect(data.message).toBe('地址已添加');
      expect((data.data as Record<string, unknown>).id).toBe('addr-uuid-001');
      // 验证 create 收到正确的 userId 与 body
      expect(mockCreate).toHaveBeenCalledWith('user-uuid-001', body);
    });

    it('未认证时返回 401 且 create 不被调用', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const body = { recipient: '张三', phone: '13800138000', address: '北京市朝阳区某街道某号' };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('recipient 缺失时 validate 返回 422', async () => {
      const body = { phone: '13800138000', address: '北京市朝阳区某街道某号' };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'recipient')).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('phone 格式错误时 validate 返回 422', async () => {
      const body = { recipient: '张三', phone: '12345', address: '北京市朝阳区某街道某号' };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'phone')).toBe(true);
    });

    it('address 缺失时 validate 返回 422', async () => {
      const body = { recipient: '张三', phone: '13800138000' };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'address')).toBe(true);
    });

    it('create 抛错时由 errorHandler 返回 500', async () => {
      mockCreate.mockRejectedValue(new Error('写入失败'));
      const body = { recipient: '张三', phone: '13800138000', address: '北京市朝阳区某街道某号' };
      const res = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('PUT /:id', () => {
    it('合法请求体更新地址成功返回 200', async () => {
      mockUpdate.mockResolvedValue(buildAddress({ recipient: '李四' }));
      const body = { recipient: '李四', phone: '13900139000' };
      const res = await fetch(`${baseUrl}/addr-uuid-001`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toBe('地址已更新');
      // 验证 update 收到正确的 id、userId 与 body
      expect(mockUpdate).toHaveBeenCalledWith('addr-uuid-001', 'user-uuid-001', body);
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/addr-uuid-001`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: '李四' }),
      });
      expect(res.status).toBe(401);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('phone 格式错误时 validate 返回 422（可选字段仍需校验格式）', async () => {
      const body = { phone: 'invalid' };
      const res = await fetch(`${baseUrl}/addr-uuid-001`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.errors as Array<{ field: string }>).some((e: { field: string }) => e.field === 'phone')).toBe(true);
    });

    it('update 抛 NotFoundError 时由 errorHandler 标准化为 404', async () => {
      // addressService.update 在地址不存在或非本人时抛 NotFoundError
      mockUpdate.mockRejectedValue(new NotFoundError('地址'));
      const res = await fetch(`${baseUrl}/addr-uuid-001`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({ recipient: '李四' }),
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /:id', () => {
    it('正常删除返回 200', async () => {
      mockRemove.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/addr-uuid-001`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toBe('地址已删除');
      expect(mockRemove).toHaveBeenCalledWith('addr-uuid-001', 'user-uuid-001');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/addr-uuid-001`, { method: 'DELETE' });
      expect(res.status).toBe(401);
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it('remove 抛 NotFoundError 时返回 404', async () => {
      mockRemove.mockRejectedValue(new NotFoundError('地址'));
      const res = await fetch(`${baseUrl}/addr-uuid-001`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });
  });

  describe('PUT /:id/default', () => {
    it('正常设为默认返回 200', async () => {
      mockSetDefault.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/addr-uuid-001/default`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toBe('已设为默认地址');
      expect(mockSetDefault).toHaveBeenCalledWith('addr-uuid-001', 'user-uuid-001');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/addr-uuid-001/default`, { method: 'PUT' });
      expect(res.status).toBe(401);
      expect(mockSetDefault).not.toHaveBeenCalled();
    });

    it('setDefault 抛 NotFoundError 时返回 404', async () => {
      mockSetDefault.mockRejectedValue(new NotFoundError('地址'));
      const res = await fetch(`${baseUrl}/addr-uuid-001/default`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });
  });

  describe('审计接入不变式', () => {
    it('4 处 PII 操作路由均以正确 action 与 resourceType 调用 auditMiddleware', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      vi.resetModules();
      await import('../address');

      // 验证 auditMiddleware 被调用 4 次，分别对应 CREATE/UPDATE/DELETE/SET_DEFAULT_ADDRESS
      expect(mockAuditMiddleware).toHaveBeenCalledTimes(4);

      // 验证 4 处接入的 action 与 resourceType 参数完整
      expect(mockAuditMiddleware).toHaveBeenCalledWith('CREATE_ADDRESS', expect.objectContaining({ resourceType: 'address' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('UPDATE_ADDRESS', expect.objectContaining({
        resourceType: 'address',
        getResourceId: expect.any(Function),
      }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('DELETE_ADDRESS', expect.objectContaining({
        resourceType: 'address',
        getResourceId: expect.any(Function),
      }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('SET_DEFAULT_ADDRESS', expect.objectContaining({
        resourceType: 'address',
        getResourceId: expect.any(Function),
      }));

      // 验证 getResourceId 从 req.params.id 提取，确保审计日志能定位到具体资源
      const calls = mockAuditMiddleware.mock.calls as unknown as Array<[string, { getResourceId?: (req: { params: { id: string } }) => string }]>;
      const getById = (action: string) => calls.find(([a]) => a === action)?.[1]?.getResourceId;
      expect(getById('UPDATE_ADDRESS')?.({ params: { id: 'addr-123' } })).toBe('addr-123');
      expect(getById('DELETE_ADDRESS')?.({ params: { id: 'addr-456' } })).toBe('addr-456');
      expect(getById('SET_DEFAULT_ADDRESS')?.({ params: { id: 'addr-789' } })).toBe('addr-789');
    });
  });
});
