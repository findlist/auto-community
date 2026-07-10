/**
 * emergency 路由集成测试
 *
 * 测试目标：覆盖 emergency.ts 的 13 个路由，验证完整中间件链路
 * - 求助相关：GET/POST /requests、GET /requests/:id、POST /requests/:id/respond、PUT /responses/:id/status
 * - 举报相关：POST /false-reports、PUT /false-reports/:id/resolve
 * - 资源相关：GET/POST /resources、GET/PUT/DELETE /resources/:id
 * - 地图相关：GET /map/geocode、GET /map/regeo
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate/optionalAuth/requireRole（requireRole 为高阶函数，调用后返回中间件）
 * - mock middleware/rateLimiter 的 createPostLimiter（直接放行，限流逻辑由专门单测覆盖）
 * - mock 三个 service（emergencyService/emergencyResourceService/mapService）避免真实 DB 调用
 * - 真实挂载 validate（验证 express-validator 链路）与 errorHandler（验证错误标准化）
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
  mockOptionalAuth,
  mockRequireRoleMiddleware,
  mockCreatePostLimiter,
  mockGetRequests,
  mockGetRequestById,
  mockCreateRequest,
  mockRespondToRequest,
  mockUpdateResponseStatus,
  mockCreateReport,
  mockResolveFalseReport,
  mockGetResources,
  mockGetResourceById,
  mockResourceCreate,
  mockResourceUpdate,
  mockResourceRemove,
  mockGeocode,
  mockRegeo,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockOptionalAuth: vi.fn(),
  // requireRole 为高阶函数，调用后返回中间件；mock 为返回 mockRequireRoleMiddleware 的函数
  mockRequireRoleMiddleware: vi.fn(),
  mockCreatePostLimiter: vi.fn(),
  mockGetRequests: vi.fn(),
  mockGetRequestById: vi.fn(),
  mockCreateRequest: vi.fn(),
  mockRespondToRequest: vi.fn(),
  mockUpdateResponseStatus: vi.fn(),
  mockCreateReport: vi.fn(),
  mockResolveFalseReport: vi.fn(),
  mockGetResources: vi.fn(),
  mockGetResourceById: vi.fn(),
  mockResourceCreate: vi.fn(),
  mockResourceUpdate: vi.fn(),
  mockResourceRemove: vi.fn(),
  mockGeocode: vi.fn(),
  mockRegeo: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({
  authenticate: mockAuthenticate,
  optionalAuth: mockOptionalAuth,
  requireRole: vi.fn(() => mockRequireRoleMiddleware),
}));
// createPostLimiter 直接放行，限流逻辑由 rateLimiter 单测覆盖
vi.mock('../../middleware/rateLimiter', () => ({
  createPostLimiter: mockCreatePostLimiter,
  orderLimiter: vi.fn((req: Request, _res: Response, next: NextFunction) => next()),
}));
vi.mock('../../services/emergency.service', () => ({
  emergencyService: {
    getRequests: mockGetRequests,
    getRequestById: mockGetRequestById,
    createRequest: mockCreateRequest,
    respondToRequest: mockRespondToRequest,
    updateResponseStatus: mockUpdateResponseStatus,
    createReport: mockCreateReport,
    resolveFalseReport: mockResolveFalseReport,
  },
}));
vi.mock('../../services/emergency-resource.service', () => ({
  emergencyResourceService: {
    getResources: mockGetResources,
    getResourceById: mockGetResourceById,
    create: mockResourceCreate,
    update: mockResourceUpdate,
    remove: mockResourceRemove,
  },
}));
vi.mock('../../services/map.service', () => ({
  mapService: {
    geocode: mockGeocode,
    regeo: mockRegeo,
  },
}));

import emergencyRouter from '../emergency';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 validate 与 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(emergencyRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('emergency 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 与 optionalAuth 均通过并设置 req.user
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-001', nickname: 'tester' };
      next();
    });
    mockOptionalAuth.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-001', nickname: 'tester' };
      next();
    });
    // requireRole 中间件默认通过（管理员身份）
    mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    // createPostLimiter 直接放行
    mockCreatePostLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /requests', () => {
    it('返回分页求助列表', async () => {
      mockGetRequests.mockResolvedValue({
        list: [{ id: 'req-1', title: '求助1' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const res = await fetch(`${baseUrl}/requests`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).list).toHaveLength(1);
      // 验证 getPagination 默认值与 query 透传
      expect(mockGetRequests).toHaveBeenCalledWith({
        type: undefined,
        status: undefined,
        page: 1,
        pageSize: 20,
      });
    });

    it('支持 type 与 status 筛选', async () => {
      mockGetRequests.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 20 });
      await fetch(`${baseUrl}/requests?type=medical&status=pending&page=2`);
      expect(mockGetRequests).toHaveBeenCalledWith({
        type: 'medical',
        status: 'pending',
        page: 2,
        pageSize: 20,
      });
    });
  });

  describe('GET /requests/:id', () => {
    it('返回求助详情并透传 userId', async () => {
      mockGetRequestById.mockResolvedValue({ id: 'req-1', title: '求助1' });
      const res = await fetch(`${baseUrl}/requests/req-1`);
      expect(res.status).toBe(200);
      // optionalAuth 通过时透传 req.user.id
      expect(mockGetRequestById).toHaveBeenCalledWith('req-1', 'user-001');
    });
  });

  describe('POST /requests', () => {
    it('认证通过创建求助成功', async () => {
      mockCreateRequest.mockResolvedValue({ id: 'req-1', title: '求助' });
      const res = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ category: 'medical', title: '求助', description: '描述' }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateRequest).toHaveBeenCalledWith('user-001', {
        category: 'medical',
        title: '求助',
        description: '描述',
      });
    });

    it('未认证返回 401', async () => {
      // 单次覆盖未认证路径：authenticate 抛 UnauthorizedError
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未登录'));
      });
      const res = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'medical', title: '求助', description: '描述' }),
      });
      expect(res.status).toBe(401);
    });

    it('缺少 title 校验失败返回 422', async () => {
      const res = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ category: 'medical', description: '描述' }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('POST /requests/:id/respond', () => {
    it('创建响应成功并透传 eta', async () => {
      mockRespondToRequest.mockResolvedValue({ id: 'resp-1' });
      const res = await fetch(`${baseUrl}/requests/req-1/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ message: '我来帮忙', eta: 10 }),
      });
      expect(res.status).toBe(200);
      expect(mockRespondToRequest).toHaveBeenCalledWith('user-001', 'req-1', { message: '我来帮忙', eta: 10 });
    });

    it('缺少 message 校验失败返回 422', async () => {
      const res = await fetch(`${baseUrl}/requests/req-1/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ eta: 10 }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('PUT /responses/:id/status', () => {
    it('arrived 状态更新成功', async () => {
      mockUpdateResponseStatus.mockResolvedValue({ id: 'resp-1', status: 'arrived' });
      const res = await fetch(`${baseUrl}/responses/resp-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'arrived' }),
      });
      expect(res.status).toBe(200);
      // arrived 状态不带 rating/review，reviewData 应为 undefined
      expect(mockUpdateResponseStatus).toHaveBeenCalledWith('user-001', 'resp-1', 'arrived', undefined);
    });

    it('completed 状态带 rating/review 构建评价数据', async () => {
      mockUpdateResponseStatus.mockResolvedValue({ id: 'resp-1', status: 'completed' });
      const res = await fetch(`${baseUrl}/responses/resp-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'completed', rating: 5, review: '很满意' }),
      });
      expect(res.status).toBe(200);
      // completed 且同时提供 rating 与 review 时构建 reviewData 对象
      expect(mockUpdateResponseStatus).toHaveBeenCalledWith('user-001', 'resp-1', 'completed', {
        rating: 5,
        review: '很满意',
      });
    });
  });

  describe('POST /false-reports', () => {
    it('举报成功', async () => {
      mockCreateReport.mockResolvedValue({ id: 'report-1' });
      const res = await fetch(`${baseUrl}/false-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ requestId: 'req-1', reason: '虚假信息' }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateReport).toHaveBeenCalledWith('user-001', 'req-1', '虚假信息');
    });

    it('缺少 reason 校验失败返回 422', async () => {
      const res = await fetch(`${baseUrl}/false-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ requestId: 'req-1' }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('PUT /false-reports/:id/resolve', () => {
    it('管理员处理举报成功', async () => {
      mockResolveFalseReport.mockResolvedValue({ id: 'report-1', status: 'resolved' });
      const res = await fetch(`${baseUrl}/false-reports/report-1/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ penalty: 'warning', resolution: '警告处理' }),
      });
      expect(res.status).toBe(200);
      expect(mockResolveFalseReport).toHaveBeenCalledWith('report-1', 'user-001', 'warning', '警告处理');
    });

    it('非管理员返回 403', async () => {
      // requireRole 中间件拒绝：抛 ForbiddenError
      mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new ForbiddenError('权限不足'));
      });
      const res = await fetch(`${baseUrl}/false-reports/report-1/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ penalty: 'warning', resolution: '警告处理' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /resources', () => {
    it('返回分页资源列表', async () => {
      mockGetResources.mockResolvedValue({
        list: [{ id: 'res-1', name: '应急物资' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const res = await fetch(`${baseUrl}/resources`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).list).toHaveLength(1);
      expect(mockGetResources).toHaveBeenCalledWith({ type: undefined, page: 1, pageSize: 20 });
    });
  });

  describe('GET /resources/:id', () => {
    it('返回资源详情', async () => {
      mockGetResourceById.mockResolvedValue({ id: 'res-1', name: '应急物资' });
      const res = await fetch(`${baseUrl}/resources/res-1`);
      expect(res.status).toBe(200);
      expect(mockGetResourceById).toHaveBeenCalledWith('res-1');
    });
  });

  describe('POST /resources', () => {
    it('管理员创建资源成功', async () => {
      mockResourceCreate.mockResolvedValue({ id: 'res-1', name: '物资' });
      const res = await fetch(`${baseUrl}/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ type: 'shelter', name: '避难所' }),
      });
      expect(res.status).toBe(200);
      expect(mockResourceCreate).toHaveBeenCalledWith({ type: 'shelter', name: '避难所' });
    });

    it('非管理员返回 403', async () => {
      mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new ForbiddenError('权限不足'));
      });
      const res = await fetch(`${baseUrl}/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ type: 'shelter', name: '避难所' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /resources/:id', () => {
    it('管理员更新资源成功', async () => {
      mockResourceUpdate.mockResolvedValue({ id: 'res-1', name: '新名称' });
      const res = await fetch(`${baseUrl}/resources/res-1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ name: '新名称' }),
      });
      expect(res.status).toBe(200);
      expect(mockResourceUpdate).toHaveBeenCalledWith('res-1', { name: '新名称' });
    });
  });

  describe('DELETE /resources/:id', () => {
    it('管理员删除资源成功', async () => {
      mockResourceRemove.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/resources/res-1`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(mockResourceRemove).toHaveBeenCalledWith('res-1');
    });
  });

  describe('GET /map/geocode', () => {
    it('地址转经纬度成功', async () => {
      mockGeocode.mockResolvedValue({ lng: 116.397, lat: 39.908 });
      const res = await fetch(`${baseUrl}/map/geocode?address=北京`);
      expect(res.status).toBe(200);
      expect(mockGeocode).toHaveBeenCalledWith('北京');
    });

    it('缺少 address 参数返回 null', async () => {
      const res = await fetch(`${baseUrl}/map/geocode`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.data).toBeNull();
      // 缺 address 时短路返回，不调用 mapService
      expect(mockGeocode).not.toHaveBeenCalled();
    });
  });

  describe('GET /map/regeo', () => {
    it('经纬度转地址成功', async () => {
      mockRegeo.mockResolvedValue({ address: '北京市朝阳区' });
      const res = await fetch(`${baseUrl}/map/regeo?lng=116.397&lat=39.908`);
      expect(res.status).toBe(200);
      expect(mockRegeo).toHaveBeenCalledWith(116.397, 39.908);
    });

    it('缺少经纬度参数返回 null', async () => {
      const res = await fetch(`${baseUrl}/map/regeo`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.data).toBeNull();
      expect(mockRegeo).not.toHaveBeenCalled();
    });
  });
});
