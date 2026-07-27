/**
 * api/messages 消息 API 层单元测试
 *
 * 测试目标：覆盖 3 个导出函数（getMessages/markMessagesAsRead/getUnreadCount）
 *           验证 HTTP 方法、URL 路径、params/body 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post，断言调用参数与返回值
 *
 * 设计原因：消息 API 涉及游标分页（cursor）与订单类型（orderType）参数组合，
 * 参数错误会导致跨订单消息串台或分页失效，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse, CursorPaginatedResponse, Message } from '@/types';
import {
  getMessages,
  markMessagesAsRead,
  getUnreadCount,
  type OrderType,
} from '../messages';

// mock client 模块，仅用 get/post 两个方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单条消息
const mockMessage: Message = {
  id: 'msg-uuid-001',
  senderId: 'user-uuid-001',
  receiverId: 'user-uuid-002',
  orderId: 'order-uuid-001',
  orderType: 'skill',
  content: '你好，这个技能还能交换吗？',
  type: 'text',
  read: false,
  createdAt: '2026-07-28T10:00:00.000Z',
};

// 测试用 fixture：游标分页响应
const mockCursorResponse: ApiResponse<CursorPaginatedResponse<Message>> = {
  code: 0,
  message: 'ok',
  data: {
    list: [mockMessage],
    nextCursor: 'msg-uuid-002',
    hasMore: true,
  },
};

describe('api/messages - 消息 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMessages - 获取消息列表（游标分页）', () => {
    it('应使用 GET /messages 且透传 order_id/order_type/cursor/limit', async () => {
      // 设计原因：getMessages 用游标分页（cursor）而非页码分页，
      // 后端依赖 order_id + order_type 定位会话，cursor 标识上一页最后一条消息 id
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockCursorResponse);

      const result = await getMessages('order-uuid-001', 'msg-uuid-000', 30, 'kitchen');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/messages', {
        params: {
          order_id: 'order-uuid-001',
          order_type: 'kitchen',
          cursor: 'msg-uuid-000',
          limit: 30,
        },
      });
      // 验证返回值结构（nextCursor/hasMore 用于驱动前端「加载更多」按钮）
      expect(result.data.list[0]!.id).toBe('msg-uuid-001');
      expect(result.data.nextCursor).toBe('msg-uuid-002');
      expect(result.data.hasMore).toBe(true);
    });

    it('cursor 省略时应不传 cursor 字段（首页拉取）', async () => {
      // 设计原因：第一页不传 cursor，后端返回最新一页；后续页传入上次返回的 nextCursor
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockCursorResponse);

      await getMessages('order-uuid-001');

      const [url, config] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/messages');
      expect(config.params.cursor).toBeUndefined();
      // 默认值验证：limit 默认 50，orderType 默认 'skill'
      expect(config.params.limit).toBe(50);
      expect(config.params.order_type).toBe('skill');
    });

    it('limit 自定义时应透传到 params', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockCursorResponse);

      await getMessages('order-uuid-001', undefined, 100);

      const config = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(config.params.limit).toBe(100);
    });

    it('orderType 全部枚举值应可透传', async () => {
      // 设计原因：orderType 与后端 OrderType 对齐，覆盖 skill/kitchen/time/emergency 4 种
      // 错误的 orderType 会导致后端查询错误的表，返回空列表或跨订单消息
      const types: OrderType[] = ['skill', 'kitchen', 'time', 'emergency'];
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockCursorResponse);

      for (const t of types) {
        await getMessages('order-001', undefined, 50, t);
      }

      expect(client.get).toHaveBeenCalledTimes(4);
      const calls = (client.get as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]![1].params.order_type).toBe('skill');
      expect(calls[1]![1].params.order_type).toBe('kitchen');
      expect(calls[2]![1].params.order_type).toBe('time');
      expect(calls[3]![1].params.order_type).toBe('emergency');
    });

    it('空列表响应应正确返回（边界场景）', async () => {
      // 设计原因：会话首次拉取或无消息时，后端返回 list: [] + nextCursor: null + hasMore: false
      const emptyResponse: ApiResponse<CursorPaginatedResponse<Message>> = {
        code: 0,
        message: 'ok',
        data: { list: [], nextCursor: null, hasMore: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(emptyResponse);

      const result = await getMessages('order-uuid-empty');

      expect(result.data.list).toHaveLength(0);
      expect(result.data.nextCursor).toBeNull();
      expect(result.data.hasMore).toBe(false);
    });
  });

  describe('markMessagesAsRead - 标记消息已读', () => {
    it('应使用 POST /messages/read 且透传 order_id/order_type', async () => {
      // 设计原因：markMessagesAsRead 是批量操作，标记某订单下所有未读消息为已读，
      // 后端按 order_id + order_type 定位会话，避免误标记其他订单消息
      const mockResponse: ApiResponse<null> = { code: 0, message: '标记成功', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await markMessagesAsRead('order-uuid-001', 'kitchen');

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/messages/read', {
        order_id: 'order-uuid-001',
        order_type: 'kitchen',
      });
      expect(result.data).toBeNull();
    });

    it('orderType 省略时应使用默认值 skill', async () => {
      // 设计原因：orderType 默认 'skill'，与 getMessages 默认值对齐，
      // 调用方在 skill 订单场景下可省略 orderType 简化调用
      const mockResponse: ApiResponse<null> = { code: 0, message: 'ok', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      await markMessagesAsRead('order-uuid-001');

      const [url, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/messages/read');
      expect(body.order_type).toBe('skill');
    });
  });

  describe('getUnreadCount - 获取未读消息数', () => {
    it('orderType 省略时应使用空 params（查询全部订单未读数）', async () => {
      // 设计原因：orderType 省略时后端返回当前用户所有订单的未读总数，
      // 用于消息 Tab 红点提示；前端不传 order_type 字段，后端按 undefined 处理为全量
      const mockResponse: ApiResponse<{ unreadCount: number }> = {
        code: 0,
        message: 'ok',
        data: { unreadCount: 5 },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getUnreadCount();

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/messages/unread-count', {
        params: {},
      });
      expect(result.data.unreadCount).toBe(5);
    });

    it('orderType 传入时应透传到 params', async () => {
      // 设计原因：传入 orderType 时仅查询该订单类型未读数，用于订单详情页红点
      const mockResponse: ApiResponse<{ unreadCount: number }> = {
        code: 0,
        message: 'ok',
        data: { unreadCount: 2 },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      await getUnreadCount('emergency');

      const [url, config] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/messages/unread-count');
      expect(config.params.order_type).toBe('emergency');
    });

    it('未读数为 0 时应正确返回（边界场景）', async () => {
      const mockResponse: ApiResponse<{ unreadCount: number }> = {
        code: 0,
        message: 'ok',
        data: { unreadCount: 0 },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getUnreadCount('skill');

      expect(result.data.unreadCount).toBe(0);
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：vi.clearAllMocks 在 beforeEach 调用，确保用例间调用记录隔离；
      // 此用例显式验证：连续调用 getMessages 与 markMessagesAsRead，
      // get/post 调用次数应分别为 1，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockCursorResponse);
      const readResponse: ApiResponse<null> = { code: 0, message: 'ok', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(readResponse);

      await getMessages('order-001');
      await markMessagesAsRead('order-001');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
    });
  });
});
