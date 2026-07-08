/**
 * messages 路由集成测试
 *
 * 测试目标：
 * - GET /：游标分页获取聊天记录（authenticate→parseOrderType→getMessages→cursorPaginated）
 * - POST /read：标记订单消息已读（authenticate→parseOrderType→markAsRead→success）
 * - GET /unread-count：获取未读消息数（authenticate→parseOrderType→getUnreadCount→success）
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate（根据 Authorization 头动态决定通过/拒绝）
 * - mock services/message.service 的 messageService（避免真实 DB 查询）
 * - 真实挂载路由内 parseOrderType 逻辑（验证 order_type 默认 skill、非法值抛 BadRequestError）
 * - 挂载 errorHandler 中间件（验证 BadRequestError 标准化为 400 响应）
 * - 设计原因：messages 路由含路由内 parseOrderType 业务逻辑，需通过真实 HTTP 调用验证
 *   order_type 缺失默认、非法值拒绝、合法值透传三种分支
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
  mockGetMessages,
  mockMarkAsRead,
  mockGetUnreadCount,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockGetMessages: vi.fn(),
  mockMarkAsRead: vi.fn(),
  mockGetUnreadCount: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../services/message.service', () => ({
  messageService: {
    getMessages: mockGetMessages,
    markAsRead: mockMarkAsRead,
    getUnreadCount: mockGetUnreadCount,
  },
}));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import messagesRouter from '../messages';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 handler 转发的 BadRequestError，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(messagesRouter);
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

describe('messages 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 通过并设置 req.user
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    // 默认 getMessages 返回游标分页结果
    mockGetMessages.mockResolvedValue({
      list: [
        {
          id: 'msg-uuid-001',
          orderId: 'order-uuid-001',
          orderType: 'skill',
          senderId: 'user-uuid-002',
          content: '你好',
          type: 'text',
          readAt: null,
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      ],
      nextCursor: 'msg-uuid-001',
      hasMore: false,
    });
    mockMarkAsRead.mockResolvedValue(undefined);
    mockGetUnreadCount.mockResolvedValue({ skill: 3, kitchen: 1, time: 0, emergency: 0 });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /', () => {
    it('认证通过返回聊天记录游标分页 200 默认 order_type=skill', async () => {
      const res = await fetch(`${baseUrl}/?order_id=order-uuid-001`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      // cursorPaginated 响应结构：{ code, message, data: { list, nextCursor, hasMore } }
      expect(data.code).toBe('SUCCESS');
      expect(data.data.list).toHaveLength(1);
      expect(data.data.list[0].id).toBe('msg-uuid-001');
      expect(data.data.nextCursor).toBe('msg-uuid-001');
      expect(data.data.hasMore).toBe(false);
      // 验证 getMessages 收到正确的参数（order_id, userId, cursor, limit, orderType）
      // 默认 order_type=skill，cursor=undefined，limit=50
      expect(mockGetMessages).toHaveBeenCalledWith(
        'order-uuid-001',
        'user-uuid-001',
        undefined,
        50,
        'skill',
      );
    });

    it('order_id 缺失时抛 BadRequestError 返回 400', async () => {
      const res = await fetch(`${baseUrl}/`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, any>;
      // BadRequestError 标准化响应：code 为 BAD_REQUEST（CommonErrorCode.BAD_REQUEST）
      expect(data.code).toBe('BAD_REQUEST');
      expect(data.message).toContain('order_id');
      expect(mockGetMessages).not.toHaveBeenCalled();
    });

    it('order_type 非法值时抛 BadRequestError 返回 400', async () => {
      const res = await fetch(`${baseUrl}/?order_id=order-uuid-001&order_type=invalid`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(data.message).toContain('order_type');
      expect(mockGetMessages).not.toHaveBeenCalled();
    });

    it('order_type=kitchen 与 cursor/limit query 透传到 service', async () => {
      const res = await fetch(
        `${baseUrl}/?order_id=order-uuid-001&order_type=kitchen&cursor=msg-uuid-000&limit=10`,
        { headers: { Authorization: 'Bearer valid-token' } },
      );
      expect(res.status).toBe(200);
      expect(mockGetMessages).toHaveBeenCalledWith(
        'order-uuid-001',
        'user-uuid-001',
        'msg-uuid-000',
        10,
        'kitchen',
      );
    });

    it('limit 超过 100 时被截断为 100', async () => {
      const res = await fetch(
        `${baseUrl}/?order_id=order-uuid-001&limit=200`,
        { headers: { Authorization: 'Bearer valid-token' } },
      );
      expect(res.status).toBe(200);
      // Math.min(200, 100) = 100，验证 limit 上限保护
      expect(mockGetMessages).toHaveBeenCalledWith(
        'order-uuid-001',
        'user-uuid-001',
        undefined,
        100,
        'skill',
      );
    });

    it('未携带 Authorization 头时 authenticate 转发 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/?order_id=order-uuid-001`);
      expect(res.status).toBe(401);
      expect(mockGetMessages).not.toHaveBeenCalled();
    });

    it('getMessages 抛错时由 errorHandler 返回 500', async () => {
      mockGetMessages.mockRejectedValue(new Error('权限校验失败'));
      const res = await fetch(`${baseUrl}/?order_id=order-uuid-001`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('POST /read', () => {
    it('标记已读成功返回 200', async () => {
      const res = await fetch(`${baseUrl}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({ order_id: 'order-uuid-001' }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('SUCCESS');
      expect(data.message).toBe('标记已读成功');
      // 默认 order_type=skill
      expect(mockMarkAsRead).toHaveBeenCalledWith('order-uuid-001', 'user-uuid-001', 'skill');
    });

    it('order_id 缺失时抛 BadRequestError 返回 400', async () => {
      const res = await fetch(`${baseUrl}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });

    it('order_type=time 透传到 service', async () => {
      const res = await fetch(`${baseUrl}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({ order_id: 'order-uuid-001', order_type: 'time' }),
      });
      expect(res.status).toBe(200);
      expect(mockMarkAsRead).toHaveBeenCalledWith('order-uuid-001', 'user-uuid-001', 'time');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: 'order-uuid-001' }),
      });
      expect(res.status).toBe(401);
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });
  });

  describe('GET /unread-count', () => {
    it('认证通过返回未读数量 200 默认 order_type=skill', async () => {
      const res = await fetch(`${baseUrl}/unread-count`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, any>;
      expect(data.code).toBe('SUCCESS');
      // getUnreadCount 返回值直接传给 success
      expect(data.data).toEqual({ skill: 3, kitchen: 1, time: 0, emergency: 0 });
      expect(mockGetUnreadCount).toHaveBeenCalledWith('user-uuid-001', 'skill');
    });

    it('order_type=emergency 透传到 service', async () => {
      const res = await fetch(`${baseUrl}/unread-count?order_type=emergency`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      expect(mockGetUnreadCount).toHaveBeenCalledWith('user-uuid-001', 'emergency');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/unread-count`);
      expect(res.status).toBe(401);
      expect(mockGetUnreadCount).not.toHaveBeenCalled();
    });
  });
});
