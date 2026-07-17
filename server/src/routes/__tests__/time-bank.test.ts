/**
 * time-bank 路由集成测试
 *
 * 测试目标：覆盖时间银行服务、订单、账户、转账/捐赠、亲情绑定、评价、争议全链路
 * 测试策略：
 * - mock middleware/auth 的 authenticate（默认放行设置 req.user）与 optionalAuth（默认放行不设置 req.user）
 * - mock middleware/rateLimiter 的 createPostLimiter/orderLimiter（直接中间件，mock 为 pass-through）
 * - mock middleware/auditLog 的 auditMiddleware（高阶函数，mock 为返回 pass-through 的工厂）
 * - mock services/time-bank.service 的 20 个方法避免真实 DB 读写
 * - mock services/ai.service 的 matchTimeService/storeEmbedding 与 processPostPipeline（fire-and-forget）
 * - mock utils/logger 避免 console 噪音
 * - 真实挂载 getPagination 验证分页参数解析链路
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
  mockCreatePostLimiter,
  mockOrderLimiter,
  mockAuditMiddleware,
  mockMatchTimeService,
  mockStoreEmbedding,
  mockProcessPostPipeline,
  mockLoggerInfo,
  mockCreateService,
  mockGetServiceList,
  mockGetServiceById,
  mockUpdateService,
  mockCreateOrder,
  mockUpdateOrderStatus,
  mockCompleteOrder,
  mockGetOrders,
  mockGetAccount,
  mockTransferTime,
  mockDonateTime,
  mockGetTransactions,
  mockCreateFamilyBinding,
  mockConfirmFamilyBinding,
  mockRejectFamilyBinding,
  mockUnbindFamilyBinding,
  mockGetFamilyBindings,
  mockCreateReview,
  mockCreateDispute,
  mockGetDisputes,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  // optionalAuth 默认放行不设置 req.user（未登录可访问）
  mockOptionalAuth: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  mockCreatePostLimiter: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  mockOrderLimiter: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockMatchTimeService: vi.fn(),
  // storeEmbedding/processPostPipeline 为 fire-and-forget 调用（safeNotify 包装），必须返回 Promise
  mockStoreEmbedding: vi.fn().mockResolvedValue(undefined),
  mockProcessPostPipeline: vi.fn().mockResolvedValue({ classification: 'normal', riskAssessment: { score: 0 } }),
  mockLoggerInfo: vi.fn(),
  mockCreateService: vi.fn(),
  mockGetServiceList: vi.fn(),
  mockGetServiceById: vi.fn(),
  mockUpdateService: vi.fn(),
  mockCreateOrder: vi.fn(),
  mockUpdateOrderStatus: vi.fn(),
  mockCompleteOrder: vi.fn(),
  mockGetOrders: vi.fn(),
  mockGetAccount: vi.fn(),
  mockTransferTime: vi.fn(),
  mockDonateTime: vi.fn(),
  mockGetTransactions: vi.fn(),
  mockCreateFamilyBinding: vi.fn(),
  mockConfirmFamilyBinding: vi.fn(),
  mockRejectFamilyBinding: vi.fn(),
  mockUnbindFamilyBinding: vi.fn(),
  mockGetFamilyBindings: vi.fn(),
  mockCreateReview: vi.fn(),
  mockCreateDispute: vi.fn(),
  mockGetDisputes: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate, optionalAuth: mockOptionalAuth }));
vi.mock('../../middleware/rateLimiter', () => ({
  createPostLimiter: mockCreatePostLimiter,
  orderLimiter: mockOrderLimiter,
}));
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
vi.mock('../../services/ai.service', () => ({
  aiService: {
    matchTimeService: mockMatchTimeService,
    storeEmbedding: mockStoreEmbedding,
  },
  processPostPipeline: mockProcessPostPipeline,
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: mockLoggerInfo, error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/time-bank.service', () => ({
  timeBankService: {
    createService: mockCreateService,
    getServiceList: mockGetServiceList,
    getServiceById: mockGetServiceById,
    updateService: mockUpdateService,
    createOrder: mockCreateOrder,
    updateOrderStatus: mockUpdateOrderStatus,
    completeOrder: mockCompleteOrder,
    getOrders: mockGetOrders,
    getAccount: mockGetAccount,
    transferTime: mockTransferTime,
    donateTime: mockDonateTime,
    getTransactions: mockGetTransactions,
    createFamilyBinding: mockCreateFamilyBinding,
    confirmFamilyBinding: mockConfirmFamilyBinding,
    rejectFamilyBinding: mockRejectFamilyBinding,
    unbindFamilyBinding: mockUnbindFamilyBinding,
    getFamilyBindings: mockGetFamilyBindings,
    createReview: mockCreateReview,
    createDispute: mockCreateDispute,
    getDisputes: mockGetDisputes,
  },
}));

import timeBankRouter from '../time-bank';
import { errorHandler } from '../../middleware/errorHandler';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(timeBankRouter);
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
const authHeader = { Authorization: 'Bearer valid-token' };

describe('time-bank 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    // resetAllMocks 彻底清除 mock 行为，避免跨测试污染
    vi.resetAllMocks();
    // 重新设置 pass-through 中间件默认行为（resetAllMocks 会清除 mockImplementation）
    mockOptionalAuth.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockCreatePostLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockOrderLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockAuditMiddleware.mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    // fire-and-forget 调用必须返回 Promise 避免 .catch 抛 TypeError
    mockStoreEmbedding.mockResolvedValue(undefined);
    mockProcessPostPipeline.mockResolvedValue({ classification: 'normal', riskAssessment: { score: 0 } });
    // authenticate 默认通过并设置 req.user
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  // ===================== GET /recommend =====================
  describe('GET /recommend', () => {
    it('认证通过返回推荐列表', async () => {
      mockMatchTimeService.mockResolvedValue([{ userId: 'u-2', score: 0.95 }]);
      const res = await fetch(`${baseUrl}/recommend?service_id=svc-1`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockMatchTimeService).toHaveBeenCalledWith('svc-1', 'user-uuid-001');
    });

    it('缺 service_id 抛 BadRequestError 400', async () => {
      const res = await fetch(`${baseUrl}/recommend`, { headers: authHeader });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(mockMatchTimeService).not.toHaveBeenCalled();
    });
  });

  // ===================== GET /services =====================
  describe('GET /services', () => {
    it('返回分页服务列表', async () => {
      mockGetServiceList.mockResolvedValue({
        list: [{ id: 'svc-1', title: '陪诊' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      const res = await fetch(`${baseUrl}/services?page=1&pageSize=10`);
      expect(res.status).toBe(200);
      expect(mockGetServiceList).toHaveBeenCalledWith(
        { type: undefined, category: undefined },
        { page: 1, pageSize: 10 },
      );
    });

    it('支持 type/category 筛选', async () => {
      mockGetServiceList.mockResolvedValue({ list: [], total: 0, page: 1, pageSize: 20 });
      const res = await fetch(`${baseUrl}/services?type=offer&category=医疗`);
      expect(res.status).toBe(200);
      expect(mockGetServiceList).toHaveBeenCalledWith(
        { type: 'offer', category: '医疗' },
        { page: 1, pageSize: 20 },
      );
    });
  });

  // ===================== GET /services/:id =====================
  describe('GET /services/:id', () => {
    it('返回服务详情', async () => {
      mockGetServiceById.mockResolvedValue({ id: 'svc-1', title: '陪诊' });
      const res = await fetch(`${baseUrl}/services/svc-1`);
      expect(res.status).toBe(200);
      // optionalAuth 默认放行不设置 req.user，验证 userId 为 undefined
      expect(mockGetServiceById).toHaveBeenCalledWith('svc-1', undefined);
    });
  });

  // ===================== POST /services =====================
  describe('POST /services', () => {
    const validServiceBody = {
      type: 'offer',
      category: '医疗',
      title: '陪诊服务',
      description: '陪同就医',
      duration_minutes: 120,
    };

    it('创建成功并触发 storeEmbedding 与 processPostPipeline', async () => {
      mockCreateService.mockResolvedValue({ id: 'svc-1', title: '陪诊服务' });
      const res = await fetch(`${baseUrl}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(validServiceBody),
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('CREATED');
      expect(mockCreateService).toHaveBeenCalledWith('user-uuid-001', expect.objectContaining({ title: '陪诊服务' }));
      // storeEmbedding 是 fire-and-forget 异步调用，验证传入正确参数
      expect(mockStoreEmbedding).toHaveBeenCalledWith('svc-1', 'time_service', '陪诊服务 陪同就医');
      // processPostPipeline 也是 fire-and-forget，验证传入文本与 userId
      expect(mockProcessPostPipeline).toHaveBeenCalledWith('陪诊服务 陪同就医', 'user-uuid-001', 'time_service');
    });

    it('未认证返回 401', async () => {
      // 模拟 authenticate 拒绝：抛出 UnauthorizedError 由 errorHandler 标准化为 401
      const { UnauthorizedError } = await import('../../utils/errors');
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validServiceBody),
      });
      expect(res.status).toBe(401);
      expect(mockCreateService).not.toHaveBeenCalled();
    });
  });

  // ===================== PUT /services/:id =====================
  describe('PUT /services/:id', () => {
    it('更新成功', async () => {
      mockUpdateService.mockResolvedValue({ id: 'svc-1', title: '新标题' });
      const res = await fetch(`${baseUrl}/services/svc-1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ title: '新标题' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateService).toHaveBeenCalledWith('svc-1', 'user-uuid-001', { title: '新标题' });
    });
  });

  // ===================== POST /orders =====================
  describe('POST /orders', () => {
    it('创建订单成功', async () => {
      mockCreateOrder.mockResolvedValue({ id: 'order-1', status: 'pending' });
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ service_id: 'svc-1' }),
      });
      expect(res.status).toBe(201);
      expect(mockCreateOrder).toHaveBeenCalledWith('user-uuid-001', 'svc-1');
    });

    it('接入审计中间件 CREATE_TIME_ORDER', async () => {
      // 守护审计接入不变式：订单创建涉及时间账本预扣，需留痕便于事后追溯
      // 设计原因：vi.resetAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      vi.resetModules();
      await import('../time-bank');
      expect(mockAuditMiddleware).toHaveBeenCalledWith(
        'CREATE_TIME_ORDER',
        expect.objectContaining({
          resourceType: 'time_order',
        }),
      );
    });
  });

  // ===================== GET /orders =====================
  describe('GET /orders', () => {
    it('返回分页订单列表', async () => {
      mockGetOrders.mockResolvedValue({ list: [{ id: 'order-1' }], total: 1, page: 1, pageSize: 20 });
      const res = await fetch(`${baseUrl}/orders?page=1&pageSize=10`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockGetOrders).toHaveBeenCalledWith('user-uuid-001', { page: 1, pageSize: 10 });
    });
  });

  // ===================== PUT /orders/:id/status =====================
  describe('PUT /orders/:id/status', () => {
    it('complete action 成功（带 actual_duration）', async () => {
      mockCompleteOrder.mockResolvedValue({ id: 'order-1', status: 'completed' });
      const res = await fetch(`${baseUrl}/orders/order-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'complete', actual_duration: 90, rating: 5, review: '很棒' }),
      });
      expect(res.status).toBe(200);
      expect(mockCompleteOrder).toHaveBeenCalledWith('order-1', 'user-uuid-001', 90, 5, '很棒');
      // complete 路径不应调用 updateOrderStatus
      expect(mockUpdateOrderStatus).not.toHaveBeenCalled();
    });

    it('complete action 缺 actual_duration 抛 BadRequestError 400', async () => {
      const res = await fetch(`${baseUrl}/orders/order-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'complete' }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(mockCompleteOrder).not.toHaveBeenCalled();
    });

    it('其他 action 走 updateOrderStatus', async () => {
      mockUpdateOrderStatus.mockResolvedValue({ id: 'order-1', status: 'accepted' });
      const res = await fetch(`${baseUrl}/orders/order-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ action: 'accept' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdateOrderStatus).toHaveBeenCalledWith('order-1', 'user-uuid-001', 'accept');
      expect(mockCompleteOrder).not.toHaveBeenCalled();
    });

    it('接入审计中间件并以 orderId 作为 resourceId，按 action 动态生成 action 名称', async () => {
      // 守护审计接入不变式：状态变更涉及时间账本结算（complete）/ 退款（cancel），需留痕并按 action 区分
      // 设计原因：vi.resetAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      vi.resetModules();
      await import('../time-bank');
      expect(mockAuditMiddleware).toHaveBeenCalledWith(
        'UPDATE_TIME_ORDER_STATUS',
        expect.objectContaining({
          resourceType: 'time_order',
          getResourceId: expect.any(Function),
          getAction: expect.any(Function),
        }),
      );
      // 验证 getResourceId 从 req.params.id 提取，确保审计日志能定位到具体订单
      const calls = mockAuditMiddleware.mock.calls as unknown as Array<{
        0: string;
        1: {
          getResourceId?: (req: { params: { id: string } }) => string;
          getAction?: (req: { body: { action?: string } }) => string;
        };
      }>;
      const statusCall = calls.find((call) => call[0] === 'UPDATE_TIME_ORDER_STATUS');
      const options = statusCall?.[1];
      expect(options?.getResourceId?.({ params: { id: 'order-789' } })).toBe('order-789');
      // getAction 根据请求体 action 动态生成具体 action 名称，便于审计查询按操作类型筛选
      expect(options?.getAction?.({ body: { action: 'complete' } })).toBe('COMPLETE_TIME_ORDER');
      expect(options?.getAction?.({ body: { action: 'cancel' } })).toBe('CANCEL_TIME_ORDER');
      expect(options?.getAction?.({ body: { action: 'unknown' } })).toBe('UPDATE_TIME_ORDER_STATUS');
    });
  });

  // ===================== GET /account =====================
  describe('GET /account', () => {
    it('返回账户信息', async () => {
      mockGetAccount.mockResolvedValue({ balance: 100, totalEarned: 500 });
      const res = await fetch(`${baseUrl}/account`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockGetAccount).toHaveBeenCalledWith('user-uuid-001');
    });
  });

  // ===================== POST /transfer =====================
  describe('POST /transfer', () => {
    it('转账成功', async () => {
      mockTransferTime.mockResolvedValue({ id: 'tx-1', amount: 30 });
      const res = await fetch(`${baseUrl}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ to_user_id: 'user-uuid-002', amount: 30, remark: '感谢' }),
      });
      expect(res.status).toBe(200);
      expect(mockTransferTime).toHaveBeenCalledWith('user-uuid-001', 'user-uuid-002', 30, '感谢');
    });
  });

  // ===================== POST /donate =====================
  describe('POST /donate', () => {
    it('捐赠成功', async () => {
      mockDonateTime.mockResolvedValue({ id: 'tx-2', amount: 10 });
      const res = await fetch(`${baseUrl}/donate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ to_user_id: 'user-uuid-002', amount: 10 }),
      });
      expect(res.status).toBe(200);
      expect(mockDonateTime).toHaveBeenCalledWith('user-uuid-001', 'user-uuid-002', 10, undefined);
    });
  });

  // ===================== GET /transactions =====================
  describe('GET /transactions', () => {
    it('返回游标分页列表', async () => {
      mockGetTransactions.mockResolvedValue({
        list: [{ id: 'tx-1', amount: 30 }],
        nextCursor: 'tx-1',
        hasMore: true,
      });
      const res = await fetch(`${baseUrl}/transactions?cursor=tx-0&limit=10`, { headers: authHeader });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect((data.data as Record<string, unknown>).nextCursor).toBe('tx-1');
      expect((data.data as Record<string, unknown>).hasMore).toBe(true);
      expect(mockGetTransactions).toHaveBeenCalledWith('user-uuid-001', 'tx-0', 10);
    });

    it('limit 默认 20，最大 100', async () => {
      mockGetTransactions.mockResolvedValue({ list: [], nextCursor: null, hasMore: false });
      // 不传 limit，验证默认 20
      await fetch(`${baseUrl}/transactions`, { headers: authHeader });
      expect(mockGetTransactions).toHaveBeenLastCalledWith('user-uuid-001', undefined, 20);
      // 传入 200，验证被限制为 100
      await fetch(`${baseUrl}/transactions?limit=200`, { headers: authHeader });
      expect(mockGetTransactions).toHaveBeenLastCalledWith('user-uuid-001', undefined, 100);
    });
  });

  // ===================== POST /family =====================
  describe('POST /family', () => {
    it('创建亲情绑定成功', async () => {
      mockCreateFamilyBinding.mockResolvedValue({ id: 'fb-1', status: 'pending' });
      const res = await fetch(`${baseUrl}/family`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ parent_phone: '13800138000', relationship: 'parent' }),
      });
      expect(res.status).toBe(201);
      expect(mockCreateFamilyBinding).toHaveBeenCalledWith('user-uuid-001', '13800138000', 'parent');
    });
  });

  // ===================== PUT /family/:id/confirm =====================
  describe('PUT /family/:id/confirm', () => {
    it('确认绑定成功', async () => {
      mockConfirmFamilyBinding.mockResolvedValue({ id: 'fb-1', status: 'confirmed' });
      const res = await fetch(`${baseUrl}/family/fb-1/confirm`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockConfirmFamilyBinding).toHaveBeenCalledWith('fb-1', 'user-uuid-001');
    });
  });

  // ===================== PUT /family/:id/reject =====================
  describe('PUT /family/:id/reject', () => {
    it('拒绝绑定成功', async () => {
      mockRejectFamilyBinding.mockResolvedValue({ id: 'fb-1', status: 'rejected' });
      const res = await fetch(`${baseUrl}/family/fb-1/reject`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockRejectFamilyBinding).toHaveBeenCalledWith('fb-1', 'user-uuid-001');
    });
  });

  // ===================== PUT /family/:id/unbind =====================
  describe('PUT /family/:id/unbind', () => {
    it('解绑成功', async () => {
      mockUnbindFamilyBinding.mockResolvedValue({ id: 'fb-1', status: 'unbound' });
      const res = await fetch(`${baseUrl}/family/fb-1/unbind`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockUnbindFamilyBinding).toHaveBeenCalledWith('fb-1', 'user-uuid-001');
    });
  });

  // ===================== GET /family =====================
  describe('GET /family', () => {
    it('返回绑定列表', async () => {
      mockGetFamilyBindings.mockResolvedValue([{ id: 'fb-1', status: 'confirmed' }]);
      const res = await fetch(`${baseUrl}/family`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockGetFamilyBindings).toHaveBeenCalledWith('user-uuid-001');
    });
  });

  // ===================== POST /reviews =====================
  describe('POST /reviews', () => {
    it('创建评价成功', async () => {
      mockCreateReview.mockResolvedValue({ id: 'review-1', rating: 5 });
      const res = await fetch(`${baseUrl}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ order_id: 'order-1', rating: 5, content: '很棒' }),
      });
      expect(res.status).toBe(201);
      expect(mockCreateReview).toHaveBeenCalledWith('order-1', 'user-uuid-001', 5, '很棒');
    });
  });

  // ===================== POST /disputes =====================
  describe('POST /disputes', () => {
    it('创建争议成功', async () => {
      mockCreateDispute.mockResolvedValue({ id: 'dispute-1', status: 'open' });
      const res = await fetch(`${baseUrl}/disputes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ order_id: 'order-1', reason: '未提供服务', description: '描述', evidence: ['url'] }),
      });
      expect(res.status).toBe(201);
      expect(mockCreateDispute).toHaveBeenCalledWith('order-1', 'user-uuid-001', '未提供服务', '描述', ['url']);
    });
  });

  // ===================== GET /disputes =====================
  describe('GET /disputes', () => {
    it('返回分页争议列表', async () => {
      mockGetDisputes.mockResolvedValue({ list: [{ id: 'dispute-1' }], total: 1, page: 1, pageSize: 20 });
      const res = await fetch(`${baseUrl}/disputes?page=1&pageSize=10`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockGetDisputes).toHaveBeenCalledWith('user-uuid-001', { page: 1, pageSize: 10 });
    });
  });

  describe('审计接入不变式（全量）', () => {
    it('12 处敏感操作路由均以正确 action 与 resourceType 调用 auditMiddleware', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：beforeEach 的 vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      // 覆盖范围：4 处本轮新增（CREATE/UPDATE_TIME_SERVICE + CREATE_TIME_REVIEW + CREATE_TIME_DISPUTE）+ 8 处原有（CREATE_TIME_ORDER/UPDATE_TIME_ORDER_STATUS/TRANSFER/DONATE/FAMILY_BIND/CONFIRM/REJECT/UNBIND）
      vi.resetModules();
      await import('../time-bank');

      // 期望的 action 与 resourceType 映射表（数据驱动断言，新增接入只需在此追加一行）
      const expected: Array<{ action: string; resourceType: string; hasResourceId?: boolean }> = [
        { action: 'CREATE_TIME_SERVICE', resourceType: 'time_service' },
        { action: 'UPDATE_TIME_SERVICE', resourceType: 'time_service', hasResourceId: true },
        { action: 'CREATE_TIME_ORDER', resourceType: 'time_order' },
        { action: 'UPDATE_TIME_ORDER_STATUS', resourceType: 'time_order', hasResourceId: true },
        { action: 'TRANSFER', resourceType: 'transaction' },
        { action: 'DONATE', resourceType: 'transaction' },
        { action: 'FAMILY_BIND', resourceType: 'family' },
        { action: 'FAMILY_CONFIRM', resourceType: 'family', hasResourceId: true },
        { action: 'FAMILY_REJECT', resourceType: 'family', hasResourceId: true },
        { action: 'FAMILY_UNBIND', resourceType: 'family', hasResourceId: true },
        { action: 'CREATE_TIME_REVIEW', resourceType: 'time_review' },
        { action: 'CREATE_TIME_DISPUTE', resourceType: 'time_dispute' },
      ];

      // 验证 auditMiddleware 被调用 12 次
      expect(mockAuditMiddleware).toHaveBeenCalledTimes(expected.length);

      // 逐项验证 action 与 resourceType 参数完整
      for (const item of expected) {
        expect(mockAuditMiddleware).toHaveBeenCalledWith(item.action, expect.objectContaining({ resourceType: item.resourceType }));
      }

      // 验证带 getResourceId 的路由能正确提取 req.params.id
      const calls = mockAuditMiddleware.mock.calls as unknown as Array<[string, { getResourceId?: (req: { params: { id: string } }) => string }]>;
      const getById = (action: string) => calls.find(([a]) => a === action)?.[1]?.getResourceId;
      for (const item of expected) {
        if (item.hasResourceId) {
          expect(getById(item.action)?.({ params: { id: `${item.action}-id` } })).toBe(`${item.action}-id`);
        }
      }
    });
  });
});
