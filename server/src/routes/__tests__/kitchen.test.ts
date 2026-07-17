/**
 * kitchen 路由集成测试
 *
 * 测试目标：覆盖美食分享、厨房订单、拼单、评价四大模块全链路
 * 测试策略：
 * - mock middleware/auth 的 authenticate（默认放行设置 req.user）
 * - mock middleware/rateLimiter 的 createPostLimiter/orderLimiter（直接中间件，mock 为 pass-through）
 * - mock middleware/auditLog 的 auditMiddleware（高阶函数，mock 为返回 pass-through 的工厂）
 * - mock 5 个 service（kitchen/kitchenOrder/groupOrder/ai/review）避免真实 DB 读写
 * - 真实挂载 validate 与 getPagination 验证校验与分页链路
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
  mockCreatePostLimiter,
  mockOrderLimiter,
  mockAuditMiddleware,
  mockKitchenCreate,
  mockKitchenGetList,
  mockKitchenGetById,
  mockKitchenUpdate,
  mockKitchenRemove,
  mockOrderCreate,
  mockOrderConfirm,
  mockOrderComplete,
  mockOrderCancel,
  mockOrderGetList,
  mockGroupCreate,
  mockGroupGetList,
  mockGroupGetById,
  mockGroupJoin,
  mockGroupCancel,
  mockGroupComplete,
  mockGroupExit,
  mockStoreEmbedding,
  mockGetReviewsByOrderType,
  mockQuery,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  // createPostLimiter/orderLimiter 为直接中间件，mock 为 pass-through
  mockCreatePostLimiter: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  mockOrderLimiter: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockKitchenCreate: vi.fn(),
  mockKitchenGetList: vi.fn(),
  mockKitchenGetById: vi.fn(),
  mockKitchenUpdate: vi.fn(),
  mockKitchenRemove: vi.fn(),
  mockOrderCreate: vi.fn(),
  mockOrderConfirm: vi.fn(),
  mockOrderComplete: vi.fn(),
  mockOrderCancel: vi.fn(),
  mockOrderGetList: vi.fn(),
  mockGroupCreate: vi.fn(),
  mockGroupGetList: vi.fn(),
  mockGroupGetById: vi.fn(),
  mockGroupJoin: vi.fn(),
  mockGroupCancel: vi.fn(),
  mockGroupComplete: vi.fn(),
  mockGroupExit: vi.fn(),
  // storeEmbedding 为 fire-and-forget 调用（safeNotify 包装），必须返回 Promise
  mockStoreEmbedding: vi.fn().mockResolvedValue(undefined),
  // getReviewsByOrderType 为 review.service 评价列表查询入口，mock 返回分页结构
  mockGetReviewsByOrderType: vi.fn(),
  // mockQuery 保留给 routes/kitchen.ts 中其他可能直接调 query 的场景（如未来扩展）
  mockQuery: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../middleware/rateLimiter', () => ({
  createPostLimiter: mockCreatePostLimiter,
  orderLimiter: mockOrderLimiter,
}));
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
vi.mock('../../services/kitchen.service', () => ({
  kitchenService: {
    create: mockKitchenCreate,
    getList: mockKitchenGetList,
    getById: mockKitchenGetById,
    update: mockKitchenUpdate,
    remove: mockKitchenRemove,
  },
}));
vi.mock('../../services/kitchen-order.service', () => ({
  kitchenOrderService: {
    create: mockOrderCreate,
    confirm: mockOrderConfirm,
    complete: mockOrderComplete,
    cancel: mockOrderCancel,
    getList: mockOrderGetList,
  },
}));
vi.mock('../../services/group-order.service', () => ({
  groupOrderService: {
    create: mockGroupCreate,
    getList: mockGroupGetList,
    getById: mockGroupGetById,
    join: mockGroupJoin,
    cancel: mockGroupCancel,
    complete: mockGroupComplete,
    exit: mockGroupExit,
  },
}));
vi.mock('../../services/ai.service', () => ({
  aiService: {
    storeEmbedding: mockStoreEmbedding,
  },
}));
// mock review.service：评价列表 SQL 已下沉至 service 层，路由层仅调用 service
vi.mock('../../services/review.service', () => ({
  reviewService: {
    getReviewsByOrderType: mockGetReviewsByOrderType,
  },
}));
vi.mock('../../config/database', () => ({ query: mockQuery }));

import kitchenRouter from '../kitchen';
import { errorHandler } from '../../middleware/errorHandler';
import { NotFoundError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 handler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(kitchenRouter);
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

describe('kitchen 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    // resetAllMocks 彻底清除 mock 行为，避免跨测试污染
    vi.resetAllMocks();
    // 重新设置 pass-through 中间件默认行为（resetAllMocks 会清除 mockImplementation）
    mockCreatePostLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockOrderLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockAuditMiddleware.mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next(),
    );
    // storeEmbedding 为 fire-and-forget，必须返回 Promise 避免 .catch 抛 TypeError
    mockStoreEmbedding.mockResolvedValue(undefined);
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

  // ===================== POST /posts =====================
  describe('POST /posts', () => {
    const validOfferBody = {
      type: 'offer',
      title: '手工蛋糕',
      category: '甜品',
      quantity: 5,
      price: 10,
      pickupType: 'self_pickup',
      images: ['https://example.com/1.jpg'],
      allergens: [],
      healthCert: true,
    };

    it('offer 类型且 healthCert=true 创建成功并触发 storeEmbedding', async () => {
      mockKitchenCreate.mockResolvedValue({ id: 'post-1', title: '手工蛋糕', description: '新鲜制作' });
      const res = await fetch(`${baseUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(validOfferBody),
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('CREATED');
      expect(mockKitchenCreate).toHaveBeenCalledWith('user-uuid-001', expect.objectContaining({ title: '手工蛋糕' }));
      // storeEmbedding 是 fire-and-forget 异步调用，验证传入正确参数
      expect(mockStoreEmbedding).toHaveBeenCalledWith('post-1', 'kitchen', '手工蛋糕 新鲜制作');
    });

    it('offer 类型但未提供 healthCert 抛 BadRequestError 400', async () => {
      const { healthCert: _omit, ...bodyWithoutHealthCert } = validOfferBody;
      const res = await fetch(`${baseUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(bodyWithoutHealthCert),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(mockKitchenCreate).not.toHaveBeenCalled();
    });

    it('need 类型无需 healthCert 创建成功', async () => {
      mockKitchenCreate.mockResolvedValue({ id: 'post-2', title: '求购蛋糕' });
      const res = await fetch(`${baseUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ...validOfferBody, type: 'need', healthCert: false }),
      });
      expect(res.status).toBe(201);
      expect(mockKitchenCreate).toHaveBeenCalledWith('user-uuid-001', expect.objectContaining({ type: 'need' }));
    });

    it('缺 title 校验失败 422', async () => {
      const { title: _omit, ...bodyWithoutTitle } = validOfferBody;
      const res = await fetch(`${baseUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(bodyWithoutTitle),
      });
      expect(res.status).toBe(422);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('VALIDATION_ERROR');
    });

    it('quantity 非正整数校验失败 422', async () => {
      const res = await fetch(`${baseUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ...validOfferBody, quantity: 0 }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== GET /posts =====================
  describe('GET /posts', () => {
    it('返回分页美食列表', async () => {
      mockKitchenGetList.mockResolvedValue({
        list: [{ id: 'post-1', title: '蛋糕' }],
        total: 1,
      });
      const res = await fetch(`${baseUrl}/posts?page=1&pageSize=10`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      // 验证 getList 收到筛选参数
      expect(mockKitchenGetList).toHaveBeenCalledWith(
        { type: undefined, category: undefined, keyword: undefined },
        1,
        10,
      );
    });

    it('支持 type/category/keyword 筛选', async () => {
      mockKitchenGetList.mockResolvedValue({ list: [], total: 0 });
      const res = await fetch(`${baseUrl}/posts?type=offer&category=甜品&keyword=蛋糕`);
      expect(res.status).toBe(200);
      expect(mockKitchenGetList).toHaveBeenCalledWith(
        { type: 'offer', category: '甜品', keyword: '蛋糕' },
        1,
        20,
      );
    });
  });

  // ===================== GET /posts/:id =====================
  describe('GET /posts/:id', () => {
    it('返回美食详情', async () => {
      mockKitchenGetById.mockResolvedValue({ id: 'post-1', title: '蛋糕' });
      const res = await fetch(`${baseUrl}/posts/post-1`);
      expect(res.status).toBe(200);
      expect(mockKitchenGetById).toHaveBeenCalledWith('post-1');
    });

    it('不存在时 NotFoundError 标准化为 404', async () => {
      mockKitchenGetById.mockRejectedValue(new NotFoundError('美食不存在'));
      const res = await fetch(`${baseUrl}/posts/non-existent`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('NOT_FOUND');
    });
  });

  // ===================== PUT /posts/:id =====================
  describe('PUT /posts/:id', () => {
    it('更新成功', async () => {
      mockKitchenUpdate.mockResolvedValue({ id: 'post-1', title: '新标题' });
      const res = await fetch(`${baseUrl}/posts/post-1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ title: '新标题' }),
      });
      expect(res.status).toBe(200);
      expect(mockKitchenUpdate).toHaveBeenCalledWith('post-1', 'user-uuid-001', { title: '新标题' });
    });
  });

  // ===================== DELETE /posts/:id =====================
  describe('DELETE /posts/:id', () => {
    it('删除成功', async () => {
      mockKitchenRemove.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/posts/post-1`, { method: 'DELETE', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockKitchenRemove).toHaveBeenCalledWith('post-1', 'user-uuid-001');
    });
  });

  // ===================== POST /orders =====================
  describe('POST /orders', () => {
    const validOrderBody = {
      postId: '550e8400-e29b-41d4-a716-446655440000',
      quantity: 2,
      pickupType: 'self_pickup',
    };

    it('创建订单成功', async () => {
      mockOrderCreate.mockResolvedValue({ id: 'order-1', status: 'pending' });
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(validOrderBody),
      });
      expect(res.status).toBe(201);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('CREATED');
      expect(mockOrderCreate).toHaveBeenCalledWith('user-uuid-001', expect.objectContaining({ quantity: 2 }));
      // auditMiddleware 在路由模块加载时已被调用（高阶函数返回中间件），
      // beforeEach 的 resetAllMocks 会清除模块加载阶段的调用记录，故此处不验证调用次数
    });

    it('postId 非 UUID 校验失败 422', async () => {
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ...validOrderBody, postId: 'not-a-uuid' }),
      });
      expect(res.status).toBe(422);
      expect(mockOrderCreate).not.toHaveBeenCalled();
    });

    it('quantity 缺失校验失败 422', async () => {
      const { quantity: _omit, ...bodyWithoutQuantity } = validOrderBody;
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(bodyWithoutQuantity),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== GET /orders =====================
  describe('GET /orders', () => {
    it('返回分页订单列表', async () => {
      mockOrderGetList.mockResolvedValue({ list: [{ id: 'order-1' }], total: 1 });
      const res = await fetch(`${baseUrl}/orders?page=1&pageSize=10`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockOrderGetList).toHaveBeenCalledWith(
        'user-uuid-001',
        { role: undefined, status: undefined },
        1,
        10,
      );
    });

    it('支持 role/status 筛选', async () => {
      mockOrderGetList.mockResolvedValue({ list: [], total: 0 });
      const res = await fetch(`${baseUrl}/orders?role=buyer&status=confirmed`, { headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockOrderGetList).toHaveBeenCalledWith(
        'user-uuid-001',
        { role: 'buyer', status: 'confirmed' },
        1,
        20,
      );
    });
  });

  // ===================== PUT /orders/:id/confirm =====================
  describe('PUT /orders/:id/confirm', () => {
    it('确认订单成功', async () => {
      mockOrderConfirm.mockResolvedValue({ id: 'order-1', status: 'confirmed' });
      const res = await fetch(`${baseUrl}/orders/order-1/confirm`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockOrderConfirm).toHaveBeenCalledWith('order-1', 'user-uuid-001');
    });
  });

  // ===================== PUT /orders/:id/complete =====================
  describe('PUT /orders/:id/complete', () => {
    it('完成订单成功', async () => {
      mockOrderComplete.mockResolvedValue({ id: 'order-1', status: 'completed' });
      const res = await fetch(`${baseUrl}/orders/order-1/complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ rating: 5, content: '很棒' }),
      });
      expect(res.status).toBe(200);
      expect(mockOrderComplete).toHaveBeenCalledWith('order-1', 'user-uuid-001', { rating: 5, content: '很棒' });
    });

    it('rating 小于 1 校验失败 422', async () => {
      const res = await fetch(`${baseUrl}/orders/order-1/complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ rating: 0 }),
      });
      expect(res.status).toBe(422);
      expect(mockOrderComplete).not.toHaveBeenCalled();
    });

    it('rating 大于 5 校验失败 422', async () => {
      const res = await fetch(`${baseUrl}/orders/order-1/complete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ rating: 6 }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== PUT /orders/:id/cancel =====================
  describe('PUT /orders/:id/cancel', () => {
    it('取消订单成功', async () => {
      mockOrderCancel.mockResolvedValue({ id: 'order-1', status: 'cancelled' });
      const res = await fetch(`${baseUrl}/orders/order-1/cancel`, { method: 'PUT', headers: authHeader });
      expect(res.status).toBe(200);
      expect(mockOrderCancel).toHaveBeenCalledWith('order-1', 'user-uuid-001');
    });
  });

  // ===================== POST /group-orders =====================
  describe('POST /group-orders', () => {
    const validGroupBody = {
      title: '社区拼单蛋糕',
      targetAmount: 200,
      minParticipants: 2,
      maxParticipants: 5,
      address: '社区广场',
      deadline: '2026-12-31T23:59:59Z',
    };

    it('创建拼单成功', async () => {
      mockGroupCreate.mockResolvedValue({ id: 'group-1', title: '社区拼单蛋糕' });
      const res = await fetch(`${baseUrl}/group-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify(validGroupBody),
      });
      expect(res.status).toBe(201);
      expect(mockGroupCreate).toHaveBeenCalledWith('user-uuid-001', expect.objectContaining({ title: '社区拼单蛋糕' }));
    });

    it('targetAmount 小于 1 校验失败 422', async () => {
      const res = await fetch(`${baseUrl}/group-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ...validGroupBody, targetAmount: 0 }),
      });
      expect(res.status).toBe(422);
      expect(mockGroupCreate).not.toHaveBeenCalled();
    });

    it('deadline 非 ISO8601 校验失败 422', async () => {
      const res = await fetch(`${baseUrl}/group-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ...validGroupBody, deadline: 'not-a-date' }),
      });
      expect(res.status).toBe(422);
    });
  });

  // ===================== GET /group-orders =====================
  describe('GET /group-orders', () => {
    it('返回分页拼单列表', async () => {
      mockGroupGetList.mockResolvedValue({ list: [{ id: 'group-1' }], total: 1 });
      const res = await fetch(`${baseUrl}/group-orders?status=active`);
      expect(res.status).toBe(200);
      expect(mockGroupGetList).toHaveBeenCalledWith({ status: 'active' }, 1, 20);
    });
  });

  // ===================== GET /group-orders/:id =====================
  describe('GET /group-orders/:id', () => {
    it('返回拼单详情', async () => {
      mockGroupGetById.mockResolvedValue({ id: 'group-1', title: '拼单' });
      const res = await fetch(`${baseUrl}/group-orders/group-1`);
      expect(res.status).toBe(200);
      expect(mockGroupGetById).toHaveBeenCalledWith('group-1');
    });
  });

  // ===================== POST /group-orders/:id/join =====================
  describe('POST /group-orders/:id/join', () => {
    it('参与拼单成功', async () => {
      mockGroupJoin.mockResolvedValue({ id: 'group-1', participants: 3 });
      const res = await fetch(`${baseUrl}/group-orders/group-1/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ amount: 50 }),
      });
      expect(res.status).toBe(200);
      expect(mockGroupJoin).toHaveBeenCalledWith('group-1', 'user-uuid-001', 50);
    });

    it('amount 缺失校验失败 422', async () => {
      const res = await fetch(`${baseUrl}/group-orders/group-1/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(422);
      expect(mockGroupJoin).not.toHaveBeenCalled();
    });
  });

  // ===================== POST /group-orders/:id/cancel =====================
  describe('POST /group-orders/:id/cancel', () => {
    it('取消拼单成功', async () => {
      mockGroupCancel.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/group-orders/group-1/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ reason: '人数不足' }),
      });
      expect(res.status).toBe(200);
      expect(mockGroupCancel).toHaveBeenCalledWith('group-1', 'user-uuid-001', '人数不足');
    });
  });

  // ===================== POST /group-orders/:id/complete =====================
  describe('POST /group-orders/:id/complete', () => {
    it('完成拼单成功', async () => {
      mockGroupComplete.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/group-orders/group-1/complete`, {
        method: 'POST',
        headers: authHeader,
      });
      expect(res.status).toBe(200);
      expect(mockGroupComplete).toHaveBeenCalledWith('group-1', 'user-uuid-001');
    });
  });

  // ===================== POST /group-orders/:id/exit =====================
  describe('POST /group-orders/:id/exit', () => {
    it('退出拼单成功', async () => {
      mockGroupExit.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/group-orders/group-1/exit`, {
        method: 'POST',
        headers: authHeader,
      });
      expect(res.status).toBe(200);
      expect(mockGroupExit).toHaveBeenCalledWith('group-1', 'user-uuid-001');
    });
  });

  // ===================== GET /reviews =====================
  describe('GET /reviews', () => {
    it('带 userId 筛选时透传给 service.getReviewsByOrderType', async () => {
      // mock service 返回分页结构（与 review.service.getReviewsByOrderType 真实返回一致）
      mockGetReviewsByOrderType.mockResolvedValue({
        list: [
          {
            id: 'review-1',
            reviewerId: 'reviewer-1',
            reviewer: { id: 'reviewer-1', nickname: '张三', avatar: 'avatar-url' },
            reviewedId: 'user-uuid-001',
            orderId: 'order-1',
            orderType: 'kitchen',
            rating: 5,
            content: '很棒',
            createdAt: '2026-07-08T00:00:00Z',
            updatedAt: '2026-07-08T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        totalPages: 1,
      });

      const res = await fetch(`${baseUrl}/reviews?userId=user-uuid-001&page=1&pageSize=10`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      const dataData = data.data as Record<string, unknown>;
      expect(dataData.total).toBe(1);
      const list = dataData.list as Record<string, unknown>[];
      expect(list).toHaveLength(1);
      // 验证 reviewer 对象结构（service 层 toReview 已构造）
      expect((list[0].reviewer as Record<string, unknown>).nickname).toBe('张三');

      // 关键断言：路由层只透传 orderType='kitchen' + userId + 分页参数给 service
      expect(mockGetReviewsByOrderType).toHaveBeenCalledWith('kitchen', {
        userId: 'user-uuid-001',
        page: 1,
        pageSize: 10,
      });
    });

    it('不带 userId 筛选时 userId 字段为 undefined', async () => {
      // 不传 page/pageSize 时 getPagination 默认 pageSize=20（路由层默认值，与 service 层默认 10 不同）
      mockGetReviewsByOrderType.mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      });

      const res = await fetch(`${baseUrl}/reviews`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      const dataData = data.data as Record<string, unknown>;
      expect(dataData.total).toBe(0);
      expect(dataData.list).toHaveLength(0);

      // 验证未传 userId 时 options.userId 为 undefined（service 层据此跳过 reviewed_id 条件）
      // 用 mock.calls[0] 直接断言，避免 toHaveBeenCalledWith 对含 undefined 字段对象对比的边界差异
      const callArgs = mockGetReviewsByOrderType.mock.calls[0];
      expect(callArgs[0]).toBe('kitchen');
      expect(callArgs[1].page).toBe(1);
      // 路由层 getPagination 默认 pageSize=20，service 收到的即为 20（非 service 层默认 10）
      expect(callArgs[1].pageSize).toBe(20);
      expect(callArgs[1].userId).toBeUndefined();
    });

    it('空结果正常返回', async () => {
      mockGetReviewsByOrderType.mockResolvedValue({
        list: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });

      const res = await fetch(`${baseUrl}/reviews?userId=empty-user`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      const dataData = data.data as Record<string, unknown>;
      expect(dataData.total).toBe(0);
      expect(dataData.list).toEqual([]);
    });
  });

  describe('审计接入不变式（全量）', () => {
    it('12 处敏感操作路由均以正确 action 与 resourceType 调用 auditMiddleware', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：beforeEach 的 vi.resetAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      // 覆盖范围：1 处原有（CREATE_ORDER）+ 11 处本轮新增（posts CRUD + 订单 confirm/complete/cancel + 拼单 create/join/cancel/complete/exit）
      vi.resetModules();
      await import('../kitchen');

      // 期望的 action 与 resourceType 映射表（数据驱动断言，新增接入只需在此追加一行）
      const expected: Array<{ action: string; resourceType: string; hasResourceId?: boolean }> = [
        { action: 'CREATE_KITCHEN_POST', resourceType: 'kitchen_post' },
        { action: 'UPDATE_KITCHEN_POST', resourceType: 'kitchen_post', hasResourceId: true },
        { action: 'DELETE_KITCHEN_POST', resourceType: 'kitchen_post', hasResourceId: true },
        { action: 'CREATE_ORDER', resourceType: 'order' },
        { action: 'CONFIRM_KITCHEN_ORDER', resourceType: 'kitchen_order', hasResourceId: true },
        { action: 'COMPLETE_KITCHEN_ORDER', resourceType: 'kitchen_order', hasResourceId: true },
        { action: 'CANCEL_KITCHEN_ORDER', resourceType: 'kitchen_order', hasResourceId: true },
        { action: 'CREATE_GROUP_ORDER', resourceType: 'group_order' },
        { action: 'JOIN_GROUP_ORDER', resourceType: 'group_order', hasResourceId: true },
        { action: 'CANCEL_GROUP_ORDER', resourceType: 'group_order', hasResourceId: true },
        { action: 'COMPLETE_GROUP_ORDER', resourceType: 'group_order', hasResourceId: true },
        { action: 'EXIT_GROUP_ORDER', resourceType: 'group_order', hasResourceId: true },
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
