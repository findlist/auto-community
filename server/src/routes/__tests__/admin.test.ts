/**
 * admin 路由集成测试
 *
 * 测试目标：覆盖管理后台 32 个路由全链路（用户/内容/订单/举报/认证/注销/导出/配置）
 * 测试策略：
 * - mock middleware/auth 的 authenticate + requireRole（requireRole 为高阶函数，mock 为返回 pass-through 的工厂）
 * - mock middleware/auditLog 的 auditMiddleware（高阶函数，mock 为返回 pass-through 的工厂）
 * - mock 三个 service（adminService/auditService/dataDeletionService）避免真实 DB 读写
 * - 真实挂载 validate 与 getPagination 验证校验与分页链路
 * - supertest 替代方案：Express + node:http + fetch
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
  mockAuditMiddleware,
  // adminService 方法
  mockGetUsers,
  mockBanUser,
  mockUnbanUser,
  mockUpdateUserRole,
  mockBatchBanUsers,
  mockBatchUnbanUsers,
  mockGetContent,
  mockUpdateContentStatus,
  mockBatchUpdateContentStatus,
  mockGetContentDetail,
  mockUpdateContent,
  mockGetHomepageImage,
  mockSetHomepageImage,
  mockGetOrders,
  mockForceCancelOrder,
  mockGetDashboard,
  mockGetRegistrationTrend,
  mockGetOrderTrend,
  mockGetReputationDistribution,
  mockGetModuleActivity,
  mockGetSystemMetrics,
  mockGetReports,
  mockHandleReport,
  mockGetVerificationRequests,
  mockReviewVerificationRequest,
  mockGetExportData,
  mockBuildExcelBuffer,
  mockListSettings,
  mockGetSetting,
  mockSetSetting,
  mockDeleteSetting,
  // auditService 方法
  mockGetAuditLogs,
  // dataDeletionService 方法
  mockGetDeletionRequests,
  mockReviewDeletionRequest,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  // requireRole 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  mockRequireRoleMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  // auditMiddleware 同样为高阶函数，mock 为返回 pass-through 的工厂
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockGetUsers: vi.fn(),
  mockBanUser: vi.fn(),
  mockUnbanUser: vi.fn(),
  mockUpdateUserRole: vi.fn(),
  mockBatchBanUsers: vi.fn(),
  mockBatchUnbanUsers: vi.fn(),
  mockGetContent: vi.fn(),
  mockUpdateContentStatus: vi.fn(),
  mockBatchUpdateContentStatus: vi.fn(),
  mockGetContentDetail: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetHomepageImage: vi.fn(),
  mockSetHomepageImage: vi.fn(),
  mockGetOrders: vi.fn(),
  mockForceCancelOrder: vi.fn(),
  mockGetDashboard: vi.fn(),
  mockGetRegistrationTrend: vi.fn(),
  mockGetOrderTrend: vi.fn(),
  mockGetReputationDistribution: vi.fn(),
  mockGetModuleActivity: vi.fn(),
  mockGetSystemMetrics: vi.fn(),
  mockGetReports: vi.fn(),
  mockHandleReport: vi.fn(),
  mockGetVerificationRequests: vi.fn(),
  mockReviewVerificationRequest: vi.fn(),
  mockGetExportData: vi.fn(),
  mockBuildExcelBuffer: vi.fn(),
  mockListSettings: vi.fn(),
  mockGetSetting: vi.fn(),
  mockSetSetting: vi.fn(),
  mockDeleteSetting: vi.fn(),
  mockGetAuditLogs: vi.fn(),
  mockGetDeletionRequests: vi.fn(),
  mockReviewDeletionRequest: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({
  authenticate: mockAuthenticate,
  // requireRole 高阶函数 mock：返回 mockRequireRoleMiddleware 中间件
  requireRole: vi.fn(() => mockRequireRoleMiddleware),
}));
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
vi.mock('../../services/admin.service', () => ({
  adminService: {
    getUsers: mockGetUsers,
    banUser: mockBanUser,
    unbanUser: mockUnbanUser,
    updateUserRole: mockUpdateUserRole,
    batchBanUsers: mockBatchBanUsers,
    batchUnbanUsers: mockBatchUnbanUsers,
    getContent: mockGetContent,
    updateContentStatus: mockUpdateContentStatus,
    batchUpdateContentStatus: mockBatchUpdateContentStatus,
    getContentDetail: mockGetContentDetail,
    updateContent: mockUpdateContent,
    getHomepageImage: mockGetHomepageImage,
    setHomepageImage: mockSetHomepageImage,
    getOrders: mockGetOrders,
    forceCancelOrder: mockForceCancelOrder,
    getDashboard: mockGetDashboard,
    getRegistrationTrend: mockGetRegistrationTrend,
    getOrderTrend: mockGetOrderTrend,
    getReputationDistribution: mockGetReputationDistribution,
    getModuleActivity: mockGetModuleActivity,
    getSystemMetrics: mockGetSystemMetrics,
    getReports: mockGetReports,
    handleReport: mockHandleReport,
    getVerificationRequests: mockGetVerificationRequests,
    reviewVerificationRequest: mockReviewVerificationRequest,
    getExportData: mockGetExportData,
    buildExcelBuffer: mockBuildExcelBuffer,
    listSettings: mockListSettings,
    getSetting: mockGetSetting,
    setSetting: mockSetSetting,
    deleteSetting: mockDeleteSetting,
  },
}));
vi.mock('../../services/audit.service', () => ({
  auditService: {
    getAuditLogs: mockGetAuditLogs,
    // writeAuditLog 在 auditMiddleware 内部调用，已被 mock 替换为 pass-through，无需再 mock
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../services/data-deletion.service', () => ({
  dataDeletionService: {
    getDeletionRequests: mockGetDeletionRequests,
    reviewDeletionRequest: mockReviewDeletionRequest,
  },
}));

import adminRouter from '../admin';
import { errorHandler } from '../../middleware/errorHandler';
import { NotFoundError, BadRequestError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(adminRouter);
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

/** 构造合法 Authorization 头 */
const authHeader = { Authorization: 'Bearer valid-admin-token' };

describe('admin 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    // resetAllMocks 彻底清除 mock 行为，避免跨测试污染（含 mockResolvedValue/mockImplementation）
    vi.resetAllMocks();
    // 重新设置 requireRole 中间件默认放行（resetAllMocks 会清除 mockImplementation）
    mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    // auditMiddleware 高阶函数默认返回 pass-through 中间件
    mockAuditMiddleware.mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    // authenticate 默认通过并设置 req.user 为管理员
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'admin-uuid-001', nickname: 'admin' };
      next();
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  // ===================== 用户管理 =====================
  describe('用户管理', () => {
    it('GET /users 返回分页用户列表', async () => {
      mockGetUsers.mockResolvedValue({ list: [{ id: 'u1', nickname: 'A' }], total: 1 });
      const res = await fetch(`${baseUrl}/users?page=1&pageSize=10`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('SUCCESS');
      // 验证 getUsers 收到分页参数与可选 search（未传时为 undefined）
      expect(mockGetUsers).toHaveBeenCalledWith(1, 10, undefined);
    });

    it('GET /users 支持 search 筛选', async () => {
      mockGetUsers.mockResolvedValue({ list: [], total: 0 });
      const res = await fetch(`${baseUrl}/users?search=张三`);
      expect(res.status).toBe(200);
      expect(mockGetUsers).toHaveBeenCalledWith(1, 20, '张三');
    });

    it('PUT /users/:id/ban 封禁成功', async () => {
      mockBanUser.mockResolvedValue({ id: 'u1', status: 'banned' });
      const res = await fetch(`${baseUrl}/users/u1/ban`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockBanUser).toHaveBeenCalledWith('u1');
    });

    it('PUT /users/:id/ban 用户不存在 NotFoundError 404', async () => {
      mockBanUser.mockRejectedValue(new NotFoundError('用户'));
      const res = await fetch(`${baseUrl}/users/u1/ban`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(404);
    });

    it('PUT /users/:id/unban 解封成功', async () => {
      mockUnbanUser.mockResolvedValue({ id: 'u1', status: 'active' });
      const res = await fetch(`${baseUrl}/users/u1/unban`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockUnbanUser).toHaveBeenCalledWith('u1');
    });

    it('PUT /users/:id/role 合法角色更新成功', async () => {
      mockUpdateUserRole.mockResolvedValue({ id: 'u1', role: 'admin' });
      const res = await fetch(`${baseUrl}/users/u1/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateUserRole).toHaveBeenCalledWith('u1', 'admin');
    });

    it('PUT /users/:id/role 非法角色 422', async () => {
      const res = await fetch(`${baseUrl}/users/u1/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ role: 'superadmin' }),
      });
      expect(res.status).toBe(422);
      expect(mockUpdateUserRole).not.toHaveBeenCalled();
    });

    it('POST /users/batch-ban 批量封禁成功', async () => {
      mockBatchBanUsers.mockResolvedValue({
        successfulIds: ['u1', 'u2'],
        skippedAdminIds: [],
        skippedSelfId: [],
        failedIds: [],
      });
      const res = await fetch(`${baseUrl}/users/batch-ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ userIds: ['u1', 'u2'] }),
      });
      expect(res.status).toBe(200);
      // batchBanUsers 第二参为操作者自身 userId（来自 req.user.id）
      expect(mockBatchBanUsers).toHaveBeenCalledWith(['u1', 'u2'], 'admin-uuid-001');
    });

    it('POST /users/batch-ban userIds 缺失 422', async () => {
      const res = await fetch(`${baseUrl}/users/batch-ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(422);
    });

    it('POST /users/batch-ban 数组超过 50 个 422', async () => {
      const ids = Array.from({ length: 51 }, (_, i) => `u${i}`);
      const res = await fetch(`${baseUrl}/users/batch-ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ userIds: ids }),
      });
      expect(res.status).toBe(422);
    });

    it('POST /users/batch-unban 批量解封成功', async () => {
      mockBatchUnbanUsers.mockResolvedValue({
        successfulIds: ['u1'],
        skippedIds: [],
        failedIds: [],
      });
      const res = await fetch(`${baseUrl}/users/batch-unban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ userIds: ['u1'] }),
      });
      expect(res.status).toBe(200);
      expect(mockBatchUnbanUsers).toHaveBeenCalledWith(['u1']);
    });
  });

  // ===================== 内容审核 =====================
  describe('内容审核', () => {
    it('GET /content 返回分页内容列表', async () => {
      mockGetContent.mockResolvedValue({ list: [{ id: 'c1' }], total: 1 });
      const res = await fetch(`${baseUrl}/content?type=skill&page=1&pageSize=10`);
      expect(res.status).toBe(200);
      // type 必填，status 可选
      expect(mockGetContent).toHaveBeenCalledWith('skill', undefined, 1, 10);
    });

    it('GET /content 支持 type + status 筛选', async () => {
      mockGetContent.mockResolvedValue({ list: [], total: 0 });
      const res = await fetch(`${baseUrl}/content?type=kitchen&status=active`);
      expect(res.status).toBe(200);
      expect(mockGetContent).toHaveBeenCalledWith('kitchen', 'active', 1, 20);
    });

    it('PUT /content/:type/:id/status 合法状态更新成功', async () => {
      mockUpdateContentStatus.mockResolvedValue({ id: 'c1', status: 'inactive' });
      const res = await fetch(`${baseUrl}/content/skill/c1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ status: 'inactive' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateContentStatus).toHaveBeenCalledWith('skill', 'c1', 'inactive');
    });

    it('PUT /content/:type/:id/status status 缺失 422', async () => {
      const res = await fetch(`${baseUrl}/content/skill/c1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(422);
    });

    it('POST /content/:type/batch-status 批量更新成功', async () => {
      mockBatchUpdateContentStatus.mockResolvedValue({ successfulIds: ['c1', 'c2'], notFoundIds: [] });
      const res = await fetch(`${baseUrl}/content/kitchen/batch-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ids: ['c1', 'c2'], status: 'inactive' }),
      });
      expect(res.status).toBe(200);
      expect(mockBatchUpdateContentStatus).toHaveBeenCalledWith('kitchen', ['c1', 'c2'], 'inactive');
    });

    it('POST /content/:type/batch-status ids 缺失 422', async () => {
      const res = await fetch(`${baseUrl}/content/kitchen/batch-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ status: 'inactive' }),
      });
      expect(res.status).toBe(422);
    });

    it('POST /content/:type/batch-status status 非法值 422', async () => {
      const res = await fetch(`${baseUrl}/content/kitchen/batch-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ids: ['c1'], status: 'deleted' }),
      });
      expect(res.status).toBe(422);
    });

    it('GET /content/:type/:id 返回内容详情', async () => {
      mockGetContentDetail.mockResolvedValue({ id: 'c1', title: '帖子1' });
      const res = await fetch(`${baseUrl}/content/skill/c1`);
      expect(res.status).toBe(200);
      expect(mockGetContentDetail).toHaveBeenCalledWith('skill', 'c1');
    });

    it('PUT /content/:type/:id 管理员编辑内容成功', async () => {
      mockUpdateContent.mockResolvedValue({ id: 'c1', title: '已修改' });
      const res = await fetch(`${baseUrl}/content/skill/c1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ title: '已修改' }),
      });
      expect(res.status).toBe(200);
      // updateContent 第三参为操作者 userId
      expect(mockUpdateContent).toHaveBeenCalledWith('skill', 'c1', { title: '已修改' }, 'admin-uuid-001');
    });
  });

  // ===================== 首页展示图片 =====================
  describe('首页展示图片', () => {
    it('GET /homepage-image 返回 url', async () => {
      mockGetHomepageImage.mockResolvedValue('https://example.com/hero.jpg');
      const res = await fetch(`${baseUrl}/homepage-image`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.data.url).toBe('https://example.com/hero.jpg');
    });

    it('PUT /homepage-image 合法 url 更新成功', async () => {
      mockSetHomepageImage.mockResolvedValue({ url: 'https://example.com/new.jpg' });
      const res = await fetch(`${baseUrl}/homepage-image`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ url: 'https://example.com/new.jpg' }),
      });
      expect(res.status).toBe(200);
      expect(mockSetHomepageImage).toHaveBeenCalledWith('https://example.com/new.jpg', 'admin-uuid-001');
    });

    it('PUT /homepage-image url 缺失 422', async () => {
      const res = await fetch(`${baseUrl}/homepage-image`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== 审计日志 =====================
  describe('审计日志', () => {
    it('GET /audit-logs 返回分页审计日志', async () => {
      mockGetAuditLogs.mockResolvedValue({ list: [{ id: '1' }], total: 1, page: 1, pageSize: 20 });
      const res = await fetch(`${baseUrl}/audit-logs?page=1&pageSize=20`);
      expect(res.status).toBe(200);
      expect(mockGetAuditLogs).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined, action: undefined, status: undefined }),
        1,
        20,
      );
    });

    it('GET /audit-logs 支持 userId/action/status/startDate/endDate 多条件筛选', async () => {
      mockGetAuditLogs.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 20 });
      const res = await fetch(`${baseUrl}/audit-logs?userId=u1&action=LOGIN&status=success&startDate=2026-01-01&endDate=2026-01-31`);
      expect(res.status).toBe(200);
      // 验证 5 个筛选参数全部透传
      expect(mockGetAuditLogs).toHaveBeenCalledWith(
        {
          userId: 'u1',
          action: 'LOGIN',
          status: 'success',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
        1,
        20,
      );
    });
  });

  // ===================== 订单管理 =====================
  describe('订单管理', () => {
    it('GET /orders/:type 返回分页订单列表', async () => {
      mockGetOrders.mockResolvedValue({ list: [{ id: 'o1' }], total: 1 });
      const res = await fetch(`${baseUrl}/orders/skill?page=1&pageSize=10`);
      expect(res.status).toBe(200);
      expect(mockGetOrders).toHaveBeenCalledWith('skill', undefined, 1, 10);
    });

    it('GET /orders/:type 支持 status 筛选', async () => {
      mockGetOrders.mockResolvedValue({ list: [], total: 0 });
      const res = await fetch(`${baseUrl}/orders/kitchen?status=completed`);
      expect(res.status).toBe(200);
      expect(mockGetOrders).toHaveBeenCalledWith('kitchen', 'completed', 1, 20);
    });

    it('PUT /orders/:type/:id/cancel 合法原因取消成功', async () => {
      mockForceCancelOrder.mockResolvedValue({ id: 'o1', status: 'cancelled' });
      const res = await fetch(`${baseUrl}/orders/skill/o1/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ reason: '违反平台规则' }),
      });
      expect(res.status).toBe(200);
      expect(mockForceCancelOrder).toHaveBeenCalledWith('skill', 'o1', '违反平台规则', 'admin-uuid-001');
    });

    it('PUT /orders/:type/:id/cancel reason 过短 422', async () => {
      const res = await fetch(`${baseUrl}/orders/skill/o1/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ reason: '违' }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== 数据统计 =====================
  describe('数据统计', () => {
    it('GET /dashboard 返回平台概览', async () => {
      mockGetDashboard.mockResolvedValue({ totalUsers: 100, totalOrders: 50 });
      const res = await fetch(`${baseUrl}/dashboard`);
      expect(res.status).toBe(200);
      expect(mockGetDashboard).toHaveBeenCalled();
    });

    it('GET /dashboard/trend type=registration 调用 getRegistrationTrend', async () => {
      mockGetRegistrationTrend.mockResolvedValue([{ date: '2026-01-01', count: 5 }]);
      const res = await fetch(`${baseUrl}/dashboard/trend?type=registration&days=14`);
      expect(res.status).toBe(200);
      expect(mockGetRegistrationTrend).toHaveBeenCalledWith(14);
    });

    it('GET /dashboard/trend type=order 调用 getOrderTrend', async () => {
      mockGetOrderTrend.mockResolvedValue([{ date: '2026-01-01', count: 3 }]);
      const res = await fetch(`${baseUrl}/dashboard/trend?type=order`);
      expect(res.status).toBe(200);
      // 默认 days=7
      expect(mockGetOrderTrend).toHaveBeenCalledWith(7);
    });

    it('GET /dashboard/reputation 返回信誉分分布', async () => {
      mockGetReputationDistribution.mockResolvedValue({ '5.0': 10, '4.5': 20 });
      const res = await fetch(`${baseUrl}/dashboard/reputation`);
      expect(res.status).toBe(200);
    });

    it('GET /dashboard/modules 返回模块对比', async () => {
      mockGetModuleActivity.mockResolvedValue({ skill: 10, kitchen: 20 });
      const res = await fetch(`${baseUrl}/dashboard/modules`);
      expect(res.status).toBe(200);
    });

    it('GET /dashboard/system 返回系统指标', async () => {
      mockGetSystemMetrics.mockResolvedValue({ cpu: 30, memory: 50 });
      const res = await fetch(`${baseUrl}/dashboard/system`);
      expect(res.status).toBe(200);
    });
  });

  // ===================== 举报处理 =====================
  describe('举报处理', () => {
    it('GET /reports 返回分页举报列表', async () => {
      mockGetReports.mockResolvedValue({ list: [{ id: 'r1' }], total: 1 });
      const res = await fetch(`${baseUrl}/reports?page=1&pageSize=10`);
      expect(res.status).toBe(200);
      expect(mockGetReports).toHaveBeenCalledWith(1, 10, undefined);
    });

    it('GET /reports 支持 status 筛选', async () => {
      mockGetReports.mockResolvedValue({ list: [], total: 0 });
      const res = await fetch(`${baseUrl}/reports?status=pending`);
      expect(res.status).toBe(200);
      expect(mockGetReports).toHaveBeenCalledWith(1, 20, 'pending');
    });

    it('PUT /reports/:id 合法处理成功', async () => {
      mockHandleReport.mockResolvedValue({ id: 'r1', status: 'resolved' });
      const res = await fetch(`${baseUrl}/reports/r1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ status: 'resolved', handleNote: '已核实处理' }),
      });
      expect(res.status).toBe(200);
      // handleReport 第二参为操作者 userId
      expect(mockHandleReport).toHaveBeenCalledWith('r1', 'admin-uuid-001', 'resolved', '已核实处理');
    });

    it('PUT /reports/:id status 非法 422', async () => {
      const res = await fetch(`${baseUrl}/reports/r1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ status: 'invalid', handleNote: '说明内容' }),
      });
      expect(res.status).toBe(422);
    });

    it('PUT /reports/:id handleNote 过短 422', async () => {
      const res = await fetch(`${baseUrl}/reports/r1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ status: 'resolved', handleNote: '短' }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== 实名认证审核 =====================
  describe('实名认证审核', () => {
    it('GET /verifications 返回分页申请列表', async () => {
      mockGetVerificationRequests.mockResolvedValue({ list: [{ id: 'v1' }], total: 1 });
      const res = await fetch(`${baseUrl}/verifications?page=1&pageSize=10`);
      expect(res.status).toBe(200);
      expect(mockGetVerificationRequests).toHaveBeenCalledWith(1, 10, undefined);
    });

    it('PUT /verifications/:id approve 通过认证', async () => {
      mockReviewVerificationRequest.mockResolvedValue({ id: 'v1', status: 'approved' });
      const res = await fetch(`${baseUrl}/verifications/v1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'approve' }),
      });
      expect(res.status).toBe(200);
      // approve 时 rejectReason 为 undefined
      expect(mockReviewVerificationRequest).toHaveBeenCalledWith('v1', 'admin-uuid-001', 'approve', undefined);
    });

    it('PUT /verifications/:id reject 带原因拒绝', async () => {
      mockReviewVerificationRequest.mockResolvedValue({ id: 'v1', status: 'rejected' });
      const res = await fetch(`${baseUrl}/verifications/v1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'reject', rejectReason: '身份证照片模糊' }),
      });
      expect(res.status).toBe(200);
      expect(mockReviewVerificationRequest).toHaveBeenCalledWith('v1', 'admin-uuid-001', 'reject', '身份证照片模糊');
    });

    it('PUT /verifications/:id reject 缺原因 422（条件校验）', async () => {
      const res = await fetch(`${baseUrl}/verifications/v1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'reject' }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== 注销申请审核 =====================
  describe('注销申请审核', () => {
    it('GET /deletion-requests 返回分页注销申请', async () => {
      mockGetDeletionRequests.mockResolvedValue({ list: [{ id: 'd1' }], total: 1 });
      const res = await fetch(`${baseUrl}/deletion-requests?page=1&pageSize=10`);
      expect(res.status).toBe(200);
      expect(mockGetDeletionRequests).toHaveBeenCalledWith(1, 10, undefined);
    });

    it('PUT /deletion-requests/:id approve 通过注销', async () => {
      mockReviewDeletionRequest.mockResolvedValue({ id: 'd1', status: 'approved' });
      const res = await fetch(`${baseUrl}/deletion-requests/d1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'approve' }),
      });
      expect(res.status).toBe(200);
      expect(mockReviewDeletionRequest).toHaveBeenCalledWith('d1', 'admin-uuid-001', 'approve', undefined);
    });

    it('PUT /deletion-requests/:id reject 缺原因 422', async () => {
      const res = await fetch(`${baseUrl}/deletion-requests/d1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'reject' }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== 数据导出 =====================
  describe('数据导出', () => {
    it('GET /export/users 默认 csv 格式', async () => {
      mockGetExportData.mockResolvedValue({
        columns: [{ field: 'id', header: 'ID' }, { field: 'nickname', header: '昵称' }],
        rows: [{ id: 'u1', nickname: '张三' }],
      });
      const res = await fetch(`${baseUrl}/export/users`);
      expect(res.status).toBe(200);
      // CSV 必须含 UTF-8 BOM 头（\ufeff）兼容 Windows Excel
      expect(res.headers.get('content-type')).toContain('text/csv');
      // 注意：fetch 的 res.text() 在 Content-Type 为 text/* 时会自动剥离 BOM，
      // 故必须用 arrayBuffer 读取原始字节验证首 3 字节为 EF BB BF
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      expect(bytes[0]).toBe(0xef);
      expect(bytes[1]).toBe(0xbb);
      expect(bytes[2]).toBe(0xbf);
      const text = new TextDecoder('utf-8').decode(buf);
      expect(text).toContain('ID,昵称');
      expect(text).toContain('u1,张三');
    });

    it('GET /export/users?format=xlsx 走 Excel 路径', async () => {
      mockGetExportData.mockResolvedValue({
        columns: [{ field: 'id', header: 'ID' }],
        rows: [{ id: 'u1' }],
      });
      mockBuildExcelBuffer.mockResolvedValue(Buffer.from('fake-xlsx'));
      const res = await fetch(`${baseUrl}/export/users?format=xlsx`);
      expect(res.status).toBe(200);
      // Excel 文件 MIME 类型校验
      expect(res.headers.get('content-type')).toContain('spreadsheetml');
      expect(mockBuildExcelBuffer).toHaveBeenCalled();
    });

    it('GET /export/invalid-type 非法类型 400', async () => {
      const res = await fetch(`${baseUrl}/export/invalid-type`);
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(mockGetExportData).not.toHaveBeenCalled();
    });

    it('GET /export/orders 透传 orderType 筛选参数', async () => {
      mockGetExportData.mockResolvedValue({ columns: [], rows: [] });
      await fetch(`${baseUrl}/export/orders?orderType=skill&status=completed&startDate=2026-01-01&endDate=2026-01-31`);
      // 验证 4 个筛选参数透传至 getExportData 第二参 filters
      expect(mockGetExportData).toHaveBeenCalledWith(
        'orders',
        {
          orderType: 'skill',
          status: 'completed',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
      );
    });

    it('GET /export/users CSV 字段含特殊字符时转义', async () => {
      mockGetExportData.mockResolvedValue({
        columns: [{ field: 'nickname', header: '昵称' }],
        // 含逗号与双引号，需用双引号包裹并转义内部引号
        rows: [{ nickname: '张,三"先生"' }],
      });
      const res = await fetch(`${baseUrl}/export/users`);
      expect(res.status).toBe(200);
      const text = await res.text();
      // 字段值含逗号与引号，应被双引号包裹且内部引号转义为两个双引号
      expect(text).toContain('"张,三""先生"""');
    });
  });

  // ===================== 系统配置管理 =====================
  describe('系统配置管理', () => {
    it('GET /settings 返回全部配置列表', async () => {
      mockListSettings.mockResolvedValue([{ key: 'daily_earn_limit', value: '120' }]);
      const res = await fetch(`${baseUrl}/settings`);
      expect(res.status).toBe(200);
      expect(mockListSettings).toHaveBeenCalled();
    });

    it('GET /settings/:key 返回单个配置', async () => {
      mockGetSetting.mockResolvedValue({ key: 'daily_earn_limit', value: '120' });
      const res = await fetch(`${baseUrl}/settings/daily_earn_limit`);
      expect(res.status).toBe(200);
      expect(mockGetSetting).toHaveBeenCalledWith('daily_earn_limit');
    });

    it('PUT /settings/:key 合法配置更新成功', async () => {
      mockSetSetting.mockResolvedValue({ key: 'daily_earn_limit', value: '240' });
      const res = await fetch(`${baseUrl}/settings/daily_earn_limit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ value: '240', description: '每日时间币收益上限', valueType: 'int' }),
      });
      expect(res.status).toBe(200);
      // setSetting 第五参为 valueType（可选）
      expect(mockSetSetting).toHaveBeenCalledWith('daily_earn_limit', '240', '每日时间币收益上限', 'admin-uuid-001', 'int');
    });

    it('PUT /settings/:key value 缺失 422', async () => {
      const res = await fetch(`${baseUrl}/settings/daily_earn_limit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ description: '描述' }),
      });
      expect(res.status).toBe(422);
    });

    it('PUT /settings/:key valueType 非法 422', async () => {
      const res = await fetch(`${baseUrl}/settings/daily_earn_limit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ value: '240', valueType: 'boolean' }),
      });
      expect(res.status).toBe(422);
    });

    it('DELETE /settings/:key 删除成功', async () => {
      mockDeleteSetting.mockResolvedValue({ key: 'custom_key', deleted: true });
      const res = await fetch(`${baseUrl}/settings/custom_key`, { method: 'DELETE', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockDeleteSetting).toHaveBeenCalledWith('custom_key');
    });

    it('DELETE /settings/:key 受保护键 400', async () => {
      mockDeleteSetting.mockRejectedValue(new BadRequestError('受保护配置禁止删除'));
      const res = await fetch(`${baseUrl}/settings/homepage_hero_image`, { method: 'DELETE', headers: authHeader });
      expect(res.status).toBe(400);
    });
  });

  // ===================== 中间件链路验证 =====================
  describe('中间件链路', () => {
    it('未携带 Authorization 时 authenticate 拒绝 401', async () => {
      // 重写 authenticate 为拒绝（模拟未登录）
      mockAuthenticate.mockImplementation((_req: Request, res: Response, _next: NextFunction) => {
        res.status(401).json({ code: 'UNAUTHORIZED', message: '未登录' });
      });
      const res = await fetch(`${baseUrl}/users`);
      expect(res.status).toBe(401);
      // 拒绝后不应进入业务 handler
      expect(mockGetUsers).not.toHaveBeenCalled();
    });
  });
});
