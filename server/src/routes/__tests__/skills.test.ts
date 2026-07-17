/**
 * skills 路由集成测试
 *
 * 测试目标：覆盖 skills.ts 的 11 个路由，验证完整中间件链路与状态分支
 * - 帖子：GET /posts、GET /posts/:id、POST /posts、PUT /posts/:id、DELETE /posts/:id
 * - 推荐：GET /recommend
 * - 订单：POST /orders、GET /orders、PUT /orders/:id/status（多状态分支）、POST /orders/:id/dispute、PUT /orders/:id/resolve
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate/requireRole（requireRole 高阶函数）
 * - mock middleware/rateLimiter 的 createPostLimiter/orderLimiter（直接放行）
 * - mock middleware/auditLog 的 auditMiddleware（高阶函数，直接放行，审计逻辑由专门单测覆盖）
 * - mock skillService/skillOrderService/aiService/processPostPipeline 避免真实 DB/AI 调用
 * - 真实挂载 validate 与 errorHandler，验证校验链路与错误标准化
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Request, Response, NextFunction } from 'express';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

const {
  mockAuthenticate,
  mockRequireRoleMiddleware,
  mockCreatePostLimiter,
  mockOrderLimiter,
  mockAuditMiddleware,
  mockGetPostList,
  mockGetPostById,
  mockCreatePost,
  mockUpdatePost,
  mockDeletePost,
  mockMatchSkill,
  mockStoreEmbedding,
  mockProcessPostPipeline,
  mockCreateOrder,
  mockGetOrderList,
  mockAcceptOrder,
  mockRejectOrder,
  mockCompleteOrder,
  mockCancelOrder,
  mockGetOrderById,
  mockDisputeOrder,
  mockResolveDispute,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockRequireRoleMiddleware: vi.fn(),
  mockCreatePostLimiter: vi.fn(),
  mockOrderLimiter: vi.fn(),
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  // 设计原因：mockAuditMiddleware 直接作为 auditMiddleware 工厂，便于不变式测试断言 toHaveBeenCalledWith(action, options)
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockGetPostList: vi.fn(),
  mockGetPostById: vi.fn(),
  mockCreatePost: vi.fn(),
  mockUpdatePost: vi.fn(),
  mockDeletePost: vi.fn(),
  mockMatchSkill: vi.fn(),
  mockStoreEmbedding: vi.fn(),
  mockProcessPostPipeline: vi.fn(),
  mockCreateOrder: vi.fn(),
  mockGetOrderList: vi.fn(),
  mockAcceptOrder: vi.fn(),
  mockRejectOrder: vi.fn(),
  mockCompleteOrder: vi.fn(),
  mockCancelOrder: vi.fn(),
  mockGetOrderById: vi.fn(),
  mockDisputeOrder: vi.fn(),
  mockResolveDispute: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({
  authenticate: mockAuthenticate,
  requireRole: vi.fn(() => mockRequireRoleMiddleware),
}));
vi.mock('../../middleware/rateLimiter', () => ({
  createPostLimiter: mockCreatePostLimiter,
  orderLimiter: mockOrderLimiter,
}));
// auditMiddleware 高阶函数 mock：mockAuditMiddleware 直接作为 auditMiddleware 工厂
vi.mock('../../middleware/auditLog', () => ({
  auditMiddleware: mockAuditMiddleware,
}));
vi.mock('../../services/skill.service', () => ({
  skillService: {
    getPostList: mockGetPostList,
    getPostById: mockGetPostById,
    createPost: mockCreatePost,
    updatePost: mockUpdatePost,
    deletePost: mockDeletePost,
  },
}));
vi.mock('../../services/skill-order.service', () => ({
  skillOrderService: {
    createOrder: mockCreateOrder,
    getOrderList: mockGetOrderList,
    acceptOrder: mockAcceptOrder,
    rejectOrder: mockRejectOrder,
    completeOrder: mockCompleteOrder,
    cancelOrder: mockCancelOrder,
    getOrderById: mockGetOrderById,
    disputeOrder: mockDisputeOrder,
    resolveDispute: mockResolveDispute,
  },
}));
vi.mock('../../services/ai.service', () => ({
  aiService: {
    matchSkill: mockMatchSkill,
    storeEmbedding: mockStoreEmbedding,
  },
  // processPostPipeline 为命名导出，mock 为 resolved Promise 避免 .then/.catch 链路报错
  processPostPipeline: mockProcessPostPipeline,
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import skillsRouter from '../skills';
import { errorHandler } from '../../middleware/errorHandler';
import { ForbiddenError } from '../../utils/errors';

async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(skillsRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('skills 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-001', nickname: 'tester' };
      next();
    });
    mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockCreatePostLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    mockOrderLimiter.mockImplementation((_req: Request, _res: Response, next: NextFunction) => next());
    // mockAuditMiddleware 为 auditMiddleware 工厂，mockImplementation 设置工厂返回 pass-through 中间件
    mockAuditMiddleware.mockImplementation(() => (_req: Request, _res: Response, next: NextFunction) => next());
    // storeEmbedding 与 processPostPipeline 均返回 resolved Promise
    // 设计原因：handler 中 safeNotify 期望传入 Promise，mock 默认返回 undefined 会抛 TypeError
    mockStoreEmbedding.mockResolvedValue(undefined);
    mockProcessPostPipeline.mockResolvedValue({ classification: 'normal', riskAssessment: { score: 0 } });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /recommend', () => {
    it('认证通过返回推荐列表', async () => {
      mockMatchSkill.mockResolvedValue([{ userId: 'u-2', score: 0.9 }]);
      const res = await fetch(`${baseUrl}/recommend?post_id=post-1`, {
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(200);
      expect(mockMatchSkill).toHaveBeenCalledWith('post-1', 'user-001');
    });

    it('缺 post_id 返回 400', async () => {
      const res = await fetch(`${baseUrl}/recommend`, {
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /posts', () => {
    it('返回分页帖子列表', async () => {
      mockGetPostList.mockResolvedValue({ list: [{ id: 'p-1' }], total: 1, page: 1, pageSize: 20 });
      const res = await fetch(`${baseUrl}/posts?type=offer&category=tech&keyword=react`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).list).toHaveLength(1);
      expect(mockGetPostList).toHaveBeenCalledWith(
        { type: 'offer', category: 'tech', keyword: 'react' },
        1,
        20,
      );
    });
  });

  describe('GET /posts/:id', () => {
    it('返回帖子详情', async () => {
      mockGetPostById.mockResolvedValue({ id: 'p-1', title: '技能' });
      const res = await fetch(`${baseUrl}/posts/p-1`);
      expect(res.status).toBe(200);
      expect(mockGetPostById).toHaveBeenCalledWith('p-1');
    });
  });

  describe('POST /posts', () => {
    it('创建成功并触发异步 AI 管道', async () => {
      mockCreatePost.mockResolvedValue({ id: 'p-1', title: '技能', description: '描述' });
      const res = await fetch(`${baseUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ type: 'offer', category: 'tech', title: '技能', description: '描述' }),
      });
      expect(res.status).toBe(201);
      expect(mockCreatePost).toHaveBeenCalledWith('user-001', {
        type: 'offer',
        category: 'tech',
        title: '技能',
        description: '描述',
      });
      // 验证异步触发 embedding 存储与 pipeline 处理（不阻塞主流程）
      expect(mockStoreEmbedding).toHaveBeenCalled();
      expect(mockProcessPostPipeline).toHaveBeenCalled();
    });

    it('缺 title 校验失败返回 422', async () => {
      const res = await fetch(`${baseUrl}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ type: 'offer', category: 'tech' }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('PUT /posts/:id', () => {
    it('更新成功', async () => {
      mockUpdatePost.mockResolvedValue({ id: 'p-1', title: '新标题' });
      const res = await fetch(`${baseUrl}/posts/p-1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ title: '新标题' }),
      });
      expect(res.status).toBe(200);
      expect(mockUpdatePost).toHaveBeenCalledWith('p-1', 'user-001', { title: '新标题' });
    });
  });

  describe('DELETE /posts/:id', () => {
    it('删除成功', async () => {
      mockDeletePost.mockResolvedValue(undefined);
      const res = await fetch(`${baseUrl}/posts/p-1`, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(200);
      expect(mockDeletePost).toHaveBeenCalledWith('p-1', 'user-001');
    });
  });

  describe('POST /orders', () => {
    it('创建订单成功', async () => {
      mockCreateOrder.mockResolvedValue({ id: 'o-1', status: 'pending' });
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ post_id: '123e4567-e89b-12d3-a456-426614174000' }),
      });
      expect(res.status).toBe(201);
      expect(mockCreateOrder).toHaveBeenCalledWith('user-001', '123e4567-e89b-12d3-a456-426614174000');
    });

    it('post_id 非 UUID 校验失败返回 422', async () => {
      const res = await fetch(`${baseUrl}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ post_id: 'not-uuid' }),
      });
      expect(res.status).toBe(422);
    });
  });

  describe('GET /orders', () => {
    it('返回分页订单列表', async () => {
      mockGetOrderList.mockResolvedValue({ list: [{ id: 'o-1' }], total: 1, page: 1, pageSize: 20 });
      const res = await fetch(`${baseUrl}/orders?status=completed`, {
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(200);
      expect(mockGetOrderList).toHaveBeenCalledWith('user-001', { status: 'completed' }, 1, 20);
    });
  });

  describe('PUT /orders/:id/status', () => {
    it('accepted 状态调用 acceptOrder', async () => {
      mockAcceptOrder.mockResolvedValue({ id: 'o-1', status: 'accepted' });
      await fetch(`${baseUrl}/orders/o-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'accepted' }),
      });
      expect(mockAcceptOrder).toHaveBeenCalledWith('o-1', 'user-001');
    });

    it('completed 状态带 rating/review 调用 completeOrder', async () => {
      mockCompleteOrder.mockResolvedValue({ id: 'o-1', status: 'completed' });
      await fetch(`${baseUrl}/orders/o-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'completed', rating: 5, review: '好评' }),
      });
      expect(mockCompleteOrder).toHaveBeenCalledWith('o-1', 'user-001', 5, '好评');
    });

    it('cancelled 状态调用 cancelOrder', async () => {
      mockCancelOrder.mockResolvedValue({ id: 'o-1', status: 'cancelled' });
      await fetch(`${baseUrl}/orders/o-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      expect(mockCancelOrder).toHaveBeenCalledWith('o-1', 'user-001');
    });

    it('disputed 状态调用 getOrderById 查询详情', async () => {
      // disputed 不能直接通过 status 接口完成争议，仅返回订单详情
      mockGetOrderById.mockResolvedValue({ id: 'o-1', status: 'disputed' });
      await fetch(`${baseUrl}/orders/o-1/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ status: 'disputed' }),
      });
      expect(mockGetOrderById).toHaveBeenCalledWith('o-1', 'user-001');
    });
  });

  describe('POST /orders/:id/dispute', () => {
    it('发起争议成功', async () => {
      mockDisputeOrder.mockResolvedValue({ id: 'o-1', status: 'disputed' });
      const res = await fetch(`${baseUrl}/orders/o-1/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ reason: '服务未完成' }),
      });
      expect(res.status).toBe(200);
      expect(mockDisputeOrder).toHaveBeenCalledWith('o-1', 'user-001', '服务未完成');
    });
  });

  describe('PUT /orders/:id/resolve', () => {
    it('管理员裁决成功', async () => {
      mockResolveDispute.mockResolvedValue({ id: 'o-1', status: 'cancelled' });
      const res = await fetch(`${baseUrl}/orders/o-1/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ resolution: '退款处理', action: 'refund' }),
      });
      expect(res.status).toBe(200);
      expect(mockResolveDispute).toHaveBeenCalledWith('o-1', 'user-001', '退款处理', 'refund');
    });

    it('非管理员返回 403', async () => {
      mockRequireRoleMiddleware.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new ForbiddenError('权限不足'));
      });
      const res = await fetch(`${baseUrl}/orders/o-1/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ resolution: '退款', action: 'refund' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('审计接入不变式（全量）', () => {
    it('7 处敏感操作路由均以正确 action 与 resourceType 调用 auditMiddleware', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：beforeEach 的 vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      // 覆盖范围：3 处帖子 CRUD（CREATE/UPDATE/DELETE_SKILL_POST）+ 4 处订单操作（CREATE_ORDER/UPDATE_ORDER_STATUS/DISPUTE_ORDER/RESOLVE_DISPUTE）
      vi.resetModules();
      await import('../skills');

      // 期望的 action 与 resourceType 映射表（数据驱动断言，新增接入只需在此追加一行）
      const expected: Array<{ action: string; resourceType: string; hasResourceId?: boolean }> = [
        { action: 'CREATE_SKILL_POST', resourceType: 'skill_post' },
        { action: 'UPDATE_SKILL_POST', resourceType: 'skill_post', hasResourceId: true },
        { action: 'DELETE_SKILL_POST', resourceType: 'skill_post', hasResourceId: true },
        { action: 'CREATE_ORDER', resourceType: 'order' },
        { action: 'UPDATE_ORDER_STATUS', resourceType: 'order', hasResourceId: true },
        { action: 'DISPUTE_ORDER', resourceType: 'order', hasResourceId: true },
        { action: 'RESOLVE_DISPUTE', resourceType: 'order', hasResourceId: true },
      ];

      // 验证 auditMiddleware 被调用 7 次
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
