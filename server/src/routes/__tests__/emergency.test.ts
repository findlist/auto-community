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
  mockAuditMiddleware,
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
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  // 设计原因：emergency 路由本身不依赖审计中间件的具体行为，审计逻辑由 auditLog 单测覆盖
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
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
// auditMiddleware mock 为 pass-through 工厂，审计逻辑由 auditLog 单测覆盖
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
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

// 测试 fixture UUID：路由层加 uuidParam 前置校验后，路径参数必须用合法 UUID
// 设计原因：原 'req-1'/'resp-1' 等非 UUID fixture 会被路由层 422 拦截，无法进入 service mock 验证路径
// 按业务实体分别命名避免跨用例混淆，与 users.test.ts/address.test.ts/admin.test.ts 风格对齐
const REQUEST_UUID = '550e8400-e29b-41d4-a716-446655440001';
const RESPONSE_UUID = '550e8400-e29b-41d4-a716-446655440002';
const REPORT_UUID = '550e8400-e29b-41d4-a716-446655440003';
const RESOURCE_UUID = '550e8400-e29b-41d4-a716-446655440004';
// 非法 id fixture：用于验证 uuidParam 前置校验在路由层 422 拦截，不进入 service 层
const INVALID_ID = 'not-a-uuid';

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
      mockGetRequestById.mockResolvedValue({ id: REQUEST_UUID, title: '求助1' });
      const res = await fetch(`${baseUrl}/requests/${REQUEST_UUID}`);
      expect(res.status).toBe(200);
      // optionalAuth 通过时透传 req.user.id
      expect(mockGetRequestById).toHaveBeenCalledWith(REQUEST_UUID, 'user-001');
    });

    it('非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）', async () => {
      // 守护路由层 uuidParam 前置校验：非法 id 应在路由层 422 拦截，避免穿透到 service 层
      const res = await fetch(`${baseUrl}/requests/${INVALID_ID}`);
      expect(res.status).toBe(422);
      expect(mockGetRequestById).not.toHaveBeenCalled();
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

    it('category 非字符串（数字）返回 422，不调用 service', async () => {
      // 守护 isString 前置校验：notEmpty 对数字类型放行，isString 严格校验字符串类型
      const res = await fetch(`${baseUrl}/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ category: 123, title: '求助', description: '描述' }),
      });
      expect(res.status).toBe(422);
      expect(mockCreateRequest).not.toHaveBeenCalled();
    });
  });

  describe('POST /requests/:id/respond', () => {
    it('创建响应成功并透传 eta', async () => {
      mockRespondToRequest.mockResolvedValue({ id: 'resp-1' });
      const res = await fetch(`${baseUrl}/requests/${REQUEST_UUID}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ message: '我来帮忙', eta: 10 }),
      });
      expect(res.status).toBe(200);
      expect(mockRespondToRequest).toHaveBeenCalledWith('user-001', REQUEST_UUID, { message: '我来帮忙', eta: 10 });
    });

    it('缺少 message 校验失败返回 422', async () => {
      const res = await fetch(`${baseUrl}/requests/${REQUEST_UUID}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ eta: 10 }),
      });
      expect(res.status).toBe(422);
    });

    it('message 非字符串（数字）返回 422，不调用 service', async () => {
      // 守护 isString 前置校验：notEmpty 对数字类型放行，isString 严格校验字符串类型
      const res = await fetch(`${baseUrl}/requests/${REQUEST_UUID}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ message: 123 }),
      });
      expect(res.status).toBe(422);
      expect(mockRespondToRequest).not.toHaveBeenCalled();
    });

    it('非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）', async () => {
      // 守护路由层 uuidParam 前置校验：非法 id 应在路由层 422 拦截，避免穿透到 service 层
      const res = await fetch(`${baseUrl}/requests/${INVALID_ID}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ message: '我来帮忙' }),
      });
      expect(res.status).toBe(422);
      expect(mockRespondToRequest).not.toHaveBeenCalled();
    });

    it('接入审计中间件并以 requestId 作为 resourceId', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      vi.resetModules();
      await import('../emergency');
      expect(mockAuditMiddleware).toHaveBeenCalledWith(
        'RESPOND_EMERGENCY_REQUEST',
        expect.objectContaining({
          resourceType: 'emergency_request',
          getResourceId: expect.any(Function),
        }),
      );
      // 验证 getResourceId 从 req.params.id 提取，确保审计日志能定位到具体资源
      const calls = mockAuditMiddleware.mock.calls as unknown as Array<[string, { getResourceId?: (req: { params: { id: string } }) => string }]>;
      const respondCall = calls.find(([action]) => action === 'RESPOND_EMERGENCY_REQUEST');
      expect(respondCall?.[1]?.getResourceId?.({ params: { id: 'req-123' } })).toBe('req-123');
    });
  });

  describe('PUT /responses/:id/status', () => {
    it('arrived 状态更新成功', async () => {
      mockUpdateResponseStatus.mockResolvedValue({ id: 'resp-1', status: 'arrived' });
      const res = await fetch(`${baseUrl}/responses/${RESPONSE_UUID}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'arrived' }),
      });
      expect(res.status).toBe(200);
      // arrived 状态不带 rating/review，reviewData 应为 undefined
      expect(mockUpdateResponseStatus).toHaveBeenCalledWith('user-001', RESPONSE_UUID, 'arrived', undefined);
    });

    it('completed 状态带 rating/review 构建评价数据', async () => {
      mockUpdateResponseStatus.mockResolvedValue({ id: 'resp-1', status: 'completed' });
      const res = await fetch(`${baseUrl}/responses/${RESPONSE_UUID}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'completed', rating: 5, review: '很满意' }),
      });
      expect(res.status).toBe(200);
      // completed 且同时提供 rating 与 review 时构建 reviewData 对象
      expect(mockUpdateResponseStatus).toHaveBeenCalledWith('user-001', RESPONSE_UUID, 'completed', {
        rating: 5,
        review: '很满意',
      });
    });

    it('非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）', async () => {
      // 守护路由层 uuidParam 前置校验：非法 id 应在路由层 422 拦截，避免穿透到 service 层
      const res = await fetch(`${baseUrl}/responses/${INVALID_ID}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'arrived' }),
      });
      expect(res.status).toBe(422);
      expect(mockUpdateResponseStatus).not.toHaveBeenCalled();
    });
  });

  describe('POST /false-reports', () => {
    it('举报成功', async () => {
      mockCreateReport.mockResolvedValue({ id: 'report-1' });
      const res = await fetch(`${baseUrl}/false-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ request_id: REQUEST_UUID, reason: '虚假信息' }),
      });
      expect(res.status).toBe(200);
      expect(mockCreateReport).toHaveBeenCalledWith('user-001', REQUEST_UUID, '虚假信息');
    });

    it('缺少 reason 校验失败返回 422', async () => {
      const res = await fetch(`${baseUrl}/false-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ request_id: REQUEST_UUID }),
      });
      expect(res.status).toBe(422);
    });

    it('request_id 非 UUID 返回 422，不调用 service', async () => {
      // 守护 isUUID 前置校验：notEmpty 仅校验非空，任意字符串可穿透；isUUID 严格校验 UUID 格式
      const res = await fetch(`${baseUrl}/false-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ request_id: 'not-a-uuid', reason: '虚假信息' }),
      });
      expect(res.status).toBe(422);
      expect(mockCreateReport).not.toHaveBeenCalled();
    });
  });

  describe('PUT /false-reports/:id/resolve', () => {
    it('管理员处理举报成功', async () => {
      mockResolveFalseReport.mockResolvedValue({ id: 'report-1', status: 'resolved' });
      const res = await fetch(`${baseUrl}/false-reports/${REPORT_UUID}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ penalty: 'warning', resolution: '警告处理' }),
      });
      expect(res.status).toBe(200);
      expect(mockResolveFalseReport).toHaveBeenCalledWith(REPORT_UUID, 'user-001', 'warning', '警告处理');
    });

    it('非管理员返回 403', async () => {
      // requireRole 中间件拒绝：抛 ForbiddenError
      mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new ForbiddenError('权限不足'));
      });
      const res = await fetch(`${baseUrl}/false-reports/${REPORT_UUID}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ penalty: 'warning', resolution: '警告处理' }),
      });
      expect(res.status).toBe(403);
    });

    it('非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）', async () => {
      // 守护路由层 uuidParam 前置校验：非法 id 应在路由层 422 拦截，避免穿透到 service 层
      // 注意：requireRole 在 validate 之前，但默认 mock 为通过，所以仍能到达 validate 拦截
      const res = await fetch(`${baseUrl}/false-reports/${INVALID_ID}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ penalty: 'warning', resolution: '警告处理' }),
      });
      expect(res.status).toBe(422);
      expect(mockResolveFalseReport).not.toHaveBeenCalled();
    });

    it('接入审计中间件并以 reportId 作为 resourceId', async () => {
      // 守护审计接入不变式：处罚涉及用户封禁（7d/30d/permanent），是高风险管理操作，必须留痕便于申诉复核
      // 设计原因：vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      vi.resetModules();
      await import('../emergency');
      expect(mockAuditMiddleware).toHaveBeenCalledWith(
        'RESOLVE_FALSE_REPORT',
        expect.objectContaining({
          resourceType: 'false_report',
          getResourceId: expect.any(Function),
        }),
      );
      // 验证 getResourceId 从 req.params.id 提取，确保审计日志能定位到具体举报记录
      const calls = mockAuditMiddleware.mock.calls as unknown as Array<[string, { getResourceId?: (req: { params: { id: string } }) => string }]>;
      const resolveCall = calls.find(([action]) => action === 'RESOLVE_FALSE_REPORT');
      expect(resolveCall?.[1]?.getResourceId?.({ params: { id: 'report-456' } })).toBe('report-456');
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
      const res = await fetch(`${baseUrl}/resources/${RESOURCE_UUID}`);
      expect(res.status).toBe(200);
      expect(mockGetResourceById).toHaveBeenCalledWith(RESOURCE_UUID);
    });

    it('非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）', async () => {
      // 守护路由层 uuidParam 前置校验：非法 id 应在路由层 422 拦截，避免穿透到 service 层
      const res = await fetch(`${baseUrl}/resources/${INVALID_ID}`);
      expect(res.status).toBe(422);
      expect(mockGetResourceById).not.toHaveBeenCalled();
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

    it('type 非字符串（数字）返回 422，不调用 service', async () => {
      // 守护 isString 前置校验：notEmpty 对数字类型放行，isString 严格校验字符串类型
      const res = await fetch(`${baseUrl}/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ type: 123, name: '避难所' }),
      });
      expect(res.status).toBe(422);
      expect(mockResourceCreate).not.toHaveBeenCalled();
    });
  });

  describe('PUT /resources/:id', () => {
    it('管理员更新资源成功', async () => {
      mockResourceUpdate.mockResolvedValue({ id: 'res-1', name: '新名称' });
      const res = await fetch(`${baseUrl}/resources/${RESOURCE_UUID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ name: '新名称' }),
      });
      expect(res.status).toBe(200);
      expect(mockResourceUpdate).toHaveBeenCalledWith(RESOURCE_UUID, { name: '新名称' });
    });

    it('非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）', async () => {
      // 守护路由层 uuidParam 前置校验：非法 id 应在路由层 422 拦截，避免穿透到 service 层
      const res = await fetch(`${baseUrl}/resources/${INVALID_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ name: '新名称' }),
      });
      expect(res.status).toBe(422);
      expect(mockResourceUpdate).not.toHaveBeenCalled();
    });

    it('name 非字符串（数字）返回 422，不调用 service', async () => {
      // 守护 isString 前置校验：optional + notEmpty 对数字类型放行，isString 严格校验字符串类型
      const res = await fetch(`${baseUrl}/resources/${RESOURCE_UUID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ name: 123 }),
      });
      expect(res.status).toBe(422);
      expect(mockResourceUpdate).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /resources/:id', () => {
    it('管理员删除资源成功', async () => {
      mockResourceRemove.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/resources/${RESOURCE_UUID}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      expect(mockResourceRemove).toHaveBeenCalledWith(RESOURCE_UUID);
    });

    it('非 UUID 格式的 id 应返回 422（前置校验拦截，不进入 service 层）', async () => {
      // 守护路由层 uuidParam 前置校验：非法 id 应在路由层 422 拦截，避免穿透到 service 层
      const res = await fetch(`${baseUrl}/resources/${INVALID_ID}`, { method: 'DELETE' });
      expect(res.status).toBe(422);
      expect(mockResourceRemove).not.toHaveBeenCalled();
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

    it('address 超长（>200 字符）返回 422，不调用 mapService', async () => {
      // 防御性测试：超长地址在路由层 422 拦截，避免穿透到高德 API 导致 URL 过长或请求超时
      const longAddress = 'a'.repeat(201);
      const res = await fetch(`${baseUrl}/map/geocode?address=${longAddress}`);
      expect(res.status).toBe(422);
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

    it('lng=0&lat=0 边界值不应被误判为缺失（修复原 !lngNum 0 值 bug）', async () => {
      // 回归测试：原代码 !lngNum || !latNum 在 lng=0 或 lat=0 时会误判为缺失返回 null
      // 0 是合法经纬度（本初子午线 lng=0 / 赤道 lat=0），应正常调用 mapService
      mockRegeo.mockResolvedValue({ address: '本初子午线与赤道交点' });
      const res = await fetch(`${baseUrl}/map/regeo?lng=0&lat=0`);
      expect(res.status).toBe(200);
      expect(mockRegeo).toHaveBeenCalledWith(0, 0);
    });

    it('lng 越界（>180）返回 400，不调用 mapService', async () => {
      // 防御性测试：经度范围 [-180, 180]，越界值直接 400 拦截，避免穿透到高德 API
      const res = await fetch(`${baseUrl}/map/regeo?lng=200&lat=39.908`);
      expect(res.status).toBe(400);
      expect(mockRegeo).not.toHaveBeenCalled();
    });

    it('lat 越界（>90）返回 400，不调用 mapService', async () => {
      // 防御性测试：纬度范围 [-90, 90]，越界值直接 400 拦截
      const res = await fetch(`${baseUrl}/map/regeo?lng=116.397&lat=100`);
      expect(res.status).toBe(400);
      expect(mockRegeo).not.toHaveBeenCalled();
    });

    it('lng=abc 非数字返回 null（保持原行为，不破坏兼容）', async () => {
      // 兼容性测试：parseFloat('abc') 返回 NaN，Number.isFinite(NaN) 为 false
      // 与原 !lngNum 行为一致（NaN 也走短路返回 null），保持兼容
      const res = await fetch(`${baseUrl}/map/regeo?lng=abc&lat=39.908`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.data).toBeNull();
      expect(mockRegeo).not.toHaveBeenCalled();
    });
  });

  describe('审计接入不变式（全量）', () => {
    it('8 处敏感操作路由均以正确 action 与 resourceType 调用 auditMiddleware', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      // 覆盖范围：2 处原有（RESPOND_EMERGENCY_REQUEST/RESOLVE_FALSE_REPORT）+ 6 处本轮新增
      vi.resetModules();
      await import('../emergency');

      // 验证 auditMiddleware 被调用 8 次
      expect(mockAuditMiddleware).toHaveBeenCalledTimes(8);

      // 验证 8 处接入的 action 与 resourceType 参数完整
      expect(mockAuditMiddleware).toHaveBeenCalledWith('CREATE_EMERGENCY_REQUEST', expect.objectContaining({ resourceType: 'emergency_request' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('RESPOND_EMERGENCY_REQUEST', expect.objectContaining({ resourceType: 'emergency_request' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('UPDATE_EMERGENCY_RESPONSE_STATUS', expect.objectContaining({ resourceType: 'emergency_response' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('CREATE_FALSE_REPORT', expect.objectContaining({ resourceType: 'false_report' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('RESOLVE_FALSE_REPORT', expect.objectContaining({ resourceType: 'false_report' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('CREATE_EMERGENCY_RESOURCE', expect.objectContaining({ resourceType: 'emergency_resource' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('UPDATE_EMERGENCY_RESOURCE', expect.objectContaining({ resourceType: 'emergency_resource' }));
      expect(mockAuditMiddleware).toHaveBeenCalledWith('DELETE_EMERGENCY_RESOURCE', expect.objectContaining({ resourceType: 'emergency_resource' }));

      // 验证带 getResourceId 的路由能正确提取资源 ID（params.id 或 body.request_id）
      const calls = mockAuditMiddleware.mock.calls as unknown as Array<[string, { getResourceId?: (req: { params: { id: string }; body?: { request_id?: string } }) => string | undefined }]>;
      const getById = (action: string) => calls.find(([a]) => a === action)?.[1]?.getResourceId;

      // UPDATE_EMERGENCY_RESPONSE_STATUS 从 req.params.id 提取
      expect(getById('UPDATE_EMERGENCY_RESPONSE_STATUS')?.({ params: { id: 'resp-123' } })).toBe('resp-123');
      // CREATE_FALSE_REPORT 从 req.body.request_id 提取（被举报的求助 ID）
      expect(getById('CREATE_FALSE_REPORT')?.({ params: { id: '' }, body: { request_id: 'req-456' } })).toBe('req-456');
      // UPDATE/DELETE_EMERGENCY_RESOURCE 从 req.params.id 提取
      expect(getById('UPDATE_EMERGENCY_RESOURCE')?.({ params: { id: 'res-789' } })).toBe('res-789');
      expect(getById('DELETE_EMERGENCY_RESOURCE')?.({ params: { id: 'res-999' } })).toBe('res-999');
      // CREATE_EMERGENCY_REQUEST 与 CREATE_EMERGENCY_RESOURCE 无 getResourceId（创建时无 id）
      expect(getById('CREATE_EMERGENCY_REQUEST')).toBeUndefined();
      expect(getById('CREATE_EMERGENCY_RESOURCE')).toBeUndefined();
    });
  });
});
