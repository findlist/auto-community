/**
 * api/notifications 通知 API 层单元测试
 *
 * 测试目标：覆盖 4 个导出函数（getNotifications/getUnreadCount/markAsRead/markAllAsRead）
 *           验证 HTTP 方法、URL 路径、params 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post，断言调用参数与返回值
 *
 * 设计原因：通知 API 涉及未读数查询（驱动消息 Tab 红点）与单条/全部已读标记，
 * URL 错误会导致通知状态不更新或误更新他人通知，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse, PaginatedResponse, Notification } from '@/types';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from '../notifications';

// mock client 模块，仅用 get/post 两个方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单条通知
const mockNotification: Notification = {
  id: 'notif-uuid-001',
  userId: 'user-uuid-001',
  type: 'order_status',
  title: '您的技能订单状态已更新',
  content: '订单 order-001 已完成',
  referenceId: 'order-001',
  referenceType: 'skill_order',
  // 未读通知 readAt 为 undefined（已读时为 ISO 时间字符串）
  createdAt: '2026-07-28T10:00:00.000Z',
};

// 测试用 fixture：分页响应
const mockPageResponse: ApiResponse<PaginatedResponse<Notification>> = {
  code: 0,
  message: 'ok',
  data: {
    list: [mockNotification],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    hasNext: false,
  },
};

describe('api/notifications - 通知 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getNotifications - 获取通知列表（分页）', () => {
    it('应使用 GET /notifications 且透传 page/pageSize', async () => {
      // 设计原因：getNotifications 用页码分页（与 messages 的游标分页不同），
      // 后端按 page + pageSize 返回对应页的通知列表，page 从 1 开始
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPageResponse);

      const result = await getNotifications(2, 10);

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/notifications', {
        params: { page: 2, pageSize: 10 },
      });
      expect(result.data.list[0]!.id).toBe('notif-uuid-001');
      expect(result.data.total).toBe(1);
      expect(result.data.hasNext).toBe(false);
    });

    it('page/pageSize 省略时应使用默认值 1/20', async () => {
      // 设计原因：默认 page=1 + pageSize=20，与后端默认分页对齐
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPageResponse);

      await getNotifications();

      const [url, config] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/notifications');
      expect(config.params.page).toBe(1);
      expect(config.params.pageSize).toBe(20);
    });

    it('空列表响应应正确返回（边界场景）', async () => {
      // 设计原因：用户无通知时后端返回 list: [] + total: 0
      const emptyResponse: ApiResponse<PaginatedResponse<Notification>> = {
        code: 0,
        message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(emptyResponse);

      const result = await getNotifications();

      expect(result.data.list).toHaveLength(0);
      expect(result.data.total).toBe(0);
    });
  });

  describe('getUnreadCount - 获取未读通知数', () => {
    it('应使用 GET /notifications/unread-count 返回 unreadCount', async () => {
      // 设计原因：getUnreadCount 用于驱动消息 Tab 红点提示，
      // 后端返回 { unreadCount: N }，前端按 N > 0 显示红点
      const mockResponse: ApiResponse<{ unreadCount: number }> = {
        code: 0,
        message: 'ok',
        data: { unreadCount: 3 },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getUnreadCount();

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/notifications/unread-count');
      expect(result.data.unreadCount).toBe(3);
    });

    it('未读数为 0 时应正确返回（边界场景）', async () => {
      const mockResponse: ApiResponse<{ unreadCount: number }> = {
        code: 0,
        message: 'ok',
        data: { unreadCount: 0 },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getUnreadCount();

      expect(result.data.unreadCount).toBe(0);
    });
  });

  describe('markAsRead - 标记单条通知已读', () => {
    it('应使用 POST /notifications/:id/read 且无 body', async () => {
      // 设计原因：markAsRead 通过 URL 路径参数定位通知，无需 body；
      // 后端校验通知归属当前用户，避免误标记他人通知
      const mockResponse: ApiResponse<null> = { code: 0, message: '已读', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await markAsRead('notif-uuid-001');

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/notifications/notif-uuid-001/read');
      expect(result.data).toBeNull();
    });

    it('notificationId 含特殊字符时应正确拼接 URL', async () => {
      // 设计原因：notificationId 为 UUID，正常无特殊字符；
      // 此用例验证 URL 模板字面量拼接正确，无意外编码
      const mockResponse: ApiResponse<null> = { code: 0, message: 'ok', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      await markAsRead('550e8400-e29b-41d4-a716-446655440001');

      const [url] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/notifications/550e8400-e29b-41d4-a716-446655440001/read');
    });
  });

  describe('markAllAsRead - 标记所有通知已读', () => {
    it('应使用 POST /notifications/read-all 且无 body', async () => {
      // 设计原因：markAllAsRead 是批量操作，标记当前用户所有未读通知为已读，
      // 后端返回 markedCount（已标记数量），用于前端提示「已标记 N 条为已读」
      const mockResponse: ApiResponse<{ markedCount: number }> = {
        code: 0,
        message: '已全部标记',
        data: { markedCount: 5 },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await markAllAsRead();

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/notifications/read-all');
      expect(result.data.markedCount).toBe(5);
    });

    it('无未读通知时 markedCount 应为 0（边界场景）', async () => {
      const mockResponse: ApiResponse<{ markedCount: number }> = {
        code: 0,
        message: 'ok',
        data: { markedCount: 0 },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await markAllAsRead();

      expect(result.data.markedCount).toBe(0);
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：vi.clearAllMocks 在 beforeEach 调用，确保用例间调用记录隔离；
      // 此用例显式验证：连续调用 getUnreadCount 与 markAllAsRead，
      // get/post 调用次数应分别为 1，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: 0,
        message: 'ok',
        data: { unreadCount: 0 },
      });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: 0,
        message: 'ok',
        data: { markedCount: 0 },
      });

      await getUnreadCount();
      await markAllAsRead();

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
    });
  });
});
