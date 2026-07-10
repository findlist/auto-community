/**
 * notifications 路由集成测试
 *
 * 测试目标：
 * - GET /：分页返回通知列表（authenticate→getPagination→getNotifications→paginated）
 * - GET /unread-count：返回未读数量（authenticate→getUnreadCount→success）
 * - POST /:id/read：标记单条已读，false 时抛 NotFoundError→404（authenticate→markAsRead）
 * - POST /read-all：标记全部已读（authenticate→markAllAsRead→success）
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate（根据 Authorization 头动态决定通过/拒绝，覆盖 401 与 200 两条路径）
 * - mock services/notification.service 的 notificationService（避免真实 DB 查询）
 * - 真实挂载 getPagination 工具函数（从 req.query 解析 page/pageSize，无副作用可直接复用）
 * - 挂载 errorHandler 中间件（验证 NotFoundError 标准化为 404 响应）
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
const { mockAuthenticate, mockGetNotifications, mockGetUnreadCount, mockMarkAsRead, mockMarkAllAsRead } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockGetNotifications: vi.fn(),
  mockGetUnreadCount: vi.fn(),
  mockMarkAsRead: vi.fn(),
  mockMarkAllAsRead: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../services/notification.service', () => ({
  notificationService: {
    getNotifications: mockGetNotifications,
    getUnreadCount: mockGetUnreadCount,
    markAsRead: mockMarkAsRead,
    markAllAsRead: mockMarkAllAsRead,
  },
}));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import notificationsRouter from '../notifications';
import { errorHandler } from '../../middleware/errorHandler';
import { UnauthorizedError } from '../../utils/errors';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 handler 转发的 NotFoundError，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(notificationsRouter);
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

describe('notifications 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 通过并设置 req.user
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    // 默认 getNotifications 返回单条结果
    mockGetNotifications.mockResolvedValue({
      list: [
        {
          id: 'notif-uuid-001',
          userId: 'user-uuid-001',
          type: 'order_status',
          title: '订单状态更新',
          content: '您的订单已确认',
          referenceId: 'order-uuid-001',
          referenceType: 'skill_order',
          readAt: undefined,
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mockGetUnreadCount.mockResolvedValue(5);
    mockMarkAsRead.mockResolvedValue(true);
    mockMarkAllAsRead.mockResolvedValue(3);
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /', () => {
    it('认证通过返回通知分页列表 200', async () => {
      const res = await fetch(`${baseUrl}/?page=1&pageSize=20`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      // paginated 响应结构：{ code, message, data: { list, total, page, pageSize, totalPages, hasNext } }
      expect(data.code).toBe('SUCCESS');
      const dataData = data.data as Record<string, unknown>;
      const list = dataData.list as Record<string, unknown>[];
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('notif-uuid-001');
      expect(dataData.total).toBe(1);
      expect(dataData.page).toBe(1);
      expect(dataData.pageSize).toBe(20);
      // 验证 getNotifications 收到正确的 userId 与分页参数
      expect(mockGetNotifications).toHaveBeenCalledWith('user-uuid-001', 1, 20);
    });

    it('未携带 Authorization 头时 authenticate 转发 401', async () => {
      // 重写 mock：未携带 token 时 authenticate 转发 UnauthorizedError
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(401);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.message).toBe('未提供认证令牌');
      // getNotifications 不应被调用（被 authenticate 拦截）
      expect(mockGetNotifications).not.toHaveBeenCalled();
    });

    it('getNotifications 抛错时由 errorHandler 返回 500', async () => {
      mockGetNotifications.mockRejectedValue(new Error('数据库查询失败'));
      const res = await fetch(`${baseUrl}/`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(data.message).toBe('数据库查询失败');
    });
  });

  describe('GET /unread-count', () => {
    it('认证通过返回未读数量 200', async () => {
      const res = await fetch(`${baseUrl}/unread-count`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      // success 响应结构：{ code, message, data: { unreadCount } }
      expect(data.code).toBe('SUCCESS');
      const dataData = data.data as Record<string, unknown>;
      expect(dataData.unreadCount).toBe(5);
      expect(mockGetUnreadCount).toHaveBeenCalledWith('user-uuid-001');
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

  describe('POST /:id/read', () => {
    it('标记成功返回 200', async () => {
      const res = await fetch(`${baseUrl}/notif-uuid-001/read`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect(data.message).toBe('标记已读成功');
      // 验证 markAsRead 收到正确的 userId 与 notificationId
      expect(mockMarkAsRead).toHaveBeenCalledWith('user-uuid-001', 'notif-uuid-001');
    });

    it('通知不存在或已读时 markAsRead 返回 false 抛 NotFoundError 返回 404', async () => {
      mockMarkAsRead.mockResolvedValue(false);
      const res = await fetch(`${baseUrl}/non-existent-id/read`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(404);
      const data = (await res.json()) as Record<string, unknown>;
      // NotFoundError 标准化响应：code 为 NOT_FOUND（CommonErrorCode.NOT_FOUND）
      expect(data.code).toBe('NOT_FOUND');
      expect(data.message).toContain('通知');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/notif-uuid-001/read`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(mockMarkAsRead).not.toHaveBeenCalled();
    });
  });

  describe('POST /read-all', () => {
    it('全部标记已读成功返回 200 含 markedCount', async () => {
      const res = await fetch(`${baseUrl}/read-all`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      const dataData = data.data as Record<string, unknown>;
      expect(dataData.markedCount).toBe(3);
      expect(mockMarkAllAsRead).toHaveBeenCalledWith('user-uuid-001');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new UnauthorizedError('未提供认证令牌'));
      });
      const res = await fetch(`${baseUrl}/read-all`, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(mockMarkAllAsRead).not.toHaveBeenCalled();
    });

    it('markAllAsRead 抛错时由 errorHandler 返回 500', async () => {
      mockMarkAllAsRead.mockRejectedValue(new Error('更新失败'));
      const res = await fetch(`${baseUrl}/read-all`, {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(500);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });
});
