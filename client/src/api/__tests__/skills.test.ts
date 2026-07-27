/**
 * api/skills 技能交换 API 层单元测试
 *
 * 测试目标：覆盖 11 个导出函数（getPosts/getPost/createPost/updatePost/deletePost/
 *           createOrder/getOrders/updateOrderStatus/disputeOrder/getOrder/resolveDispute）
 *           验证 HTTP 方法、URL 路径、params/body 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post/put/delete，断言调用参数与返回值
 *
 * 设计原因：skills API 涉及技能帖 CRUD 与订单状态机（含争议裁决），
 * 方法/URL 错误会导致帖子误删、订单状态错乱或争议裁决失效，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse, PaginatedResponse, SkillPost, SkillOrder } from '@/types';
import {
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  createOrder,
  getOrders,
  updateOrderStatus,
  disputeOrder,
  getOrder,
  resolveDispute,
  type CreatePostParams,
  type UpdatePostParams,
} from '../skills';

// mock client 模块，覆盖 get/post/put/delete 4 种方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单条技能帖
const mockPost: SkillPost = {
  id: 'post-uuid-001',
  userId: 'user-uuid-001',
  type: 'offer',
  title: '钢琴教学',
  description: '专业钢琴一对一教学',
  category: '音乐',
  creditPrice: 50,
  location: '线上',
  images: [],
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

// 测试用 fixture：单条技能订单
const mockOrder: SkillOrder = {
  id: 'order-uuid-001',
  postId: 'post-uuid-001',
  buyerId: 'user-uuid-002',
  sellerId: 'user-uuid-001',
  creditsAmount: 50,
  status: 'pending',
  createdAt: '2026-07-28T10:00:00.000Z',
};

describe('api/skills - 技能交换 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPosts - 获取技能帖列表', () => {
    it('应使用 GET /skills/posts 且透传筛选 params', async () => {
      // 设计原因：getPosts 支持按 type/category/keyword/page/pageSize 筛选
      const mockPage: ApiResponse<PaginatedResponse<SkillPost>> = {
        code: 0, message: 'ok',
        data: { list: [mockPost], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getPosts({ type: 'offer', category: '音乐', keyword: '钢琴', page: 1, pageSize: 10 });

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/skills/posts', {
        params: { type: 'offer', category: '音乐', keyword: '钢琴', page: 1, pageSize: 10 },
      });
      expect(result.data.list[0]!.title).toBe('钢琴教学');
    });

    it('params 省略时应传 undefined', async () => {
      const mockPage: ApiResponse<PaginatedResponse<SkillPost>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getPosts();

      const config = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(config.params).toBeUndefined();
    });
  });

  describe('getPost - 获取单条技能帖', () => {
    it('应使用 GET /skills/posts/:id', async () => {
      const mockRes: ApiResponse<SkillPost> = { code: 0, message: 'ok', data: mockPost };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getPost('post-uuid-001');

      expect(client.get).toHaveBeenCalledWith('/skills/posts/post-uuid-001');
      expect(result.data.creditPrice).toBe(50);
    });
  });

  describe('createPost - 创建技能帖', () => {
    it('应使用 POST /skills/posts 且透传 body', async () => {
      const params: CreatePostParams = {
        type: 'offer', title: '钢琴教学', description: '专业教学',
        category: '音乐', creditPrice: 50, location: '线上',
      };
      const mockRes: ApiResponse<SkillPost> = { code: 0, message: '创建成功', data: mockPost };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createPost(params);

      expect(client.post).toHaveBeenCalledWith('/skills/posts', params);
      expect(result.data.id).toBe('post-uuid-001');
    });
  });

  describe('updatePost - 更新技能帖', () => {
    it('应使用 PUT /skills/posts/:id 且透传 body（含 id 字段）', async () => {
      // 设计原因：updatePost 通过 URL 路径参数定位帖，body 也含 id（后端冗余校验）
      const params: UpdatePostParams = { id: 'post-uuid-001', title: '钢琴教学（更新）' };
      const mockRes: ApiResponse<SkillPost> = { code: 0, message: 'ok', data: { ...mockPost, title: '钢琴教学（更新）' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updatePost(params);

      expect(client.put).toHaveBeenCalledWith('/skills/posts/post-uuid-001', params);
    });
  });

  describe('deletePost - 删除技能帖', () => {
    it('应使用 DELETE /skills/posts/:id', async () => {
      // 设计原因：deletePost 是软删除（后端将 status 改为 'closed'），不是物理删除
      const mockRes: ApiResponse<null> = { code: 0, message: '已删除', data: null };
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await deletePost('post-uuid-001');

      expect(client.delete).toHaveBeenCalledWith('/skills/posts/post-uuid-001');
      expect(result.data).toBeNull();
    });
  });

  describe('createOrder - 创建技能订单', () => {
    it('应使用 POST /skills/orders 且透传 postId', async () => {
      // 设计原因：createOrder 仅传 postId，后端从帖中获取 sellerId/creditPrice，
      // 并从 JWT 取 buyerId，避免前端伪造买家身份
      const mockRes: ApiResponse<SkillOrder> = { code: 0, message: '下单成功', data: mockOrder };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createOrder({ postId: 'post-uuid-001' });

      expect(client.post).toHaveBeenCalledWith('/skills/orders', { postId: 'post-uuid-001' });
      expect(result.data.status).toBe('pending');
    });
  });

  describe('getOrders - 获取技能订单列表', () => {
    it('应使用 GET /skills/orders 且透传分页 params', async () => {
      const mockPage: ApiResponse<PaginatedResponse<SkillOrder>> = {
        code: 0, message: 'ok',
        data: { list: [mockOrder], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getOrders({ page: 2, pageSize: 10 });

      expect(client.get).toHaveBeenCalledWith('/skills/orders', { params: { page: 2, pageSize: 10 } });
      expect(result.data.list[0]!.id).toBe('order-uuid-001');
    });
  });

  describe('updateOrderStatus - 更新订单状态', () => {
    it('应使用 PUT /skills/orders/:id/status 且透传 status', async () => {
      // 设计原因：updateOrderStatus 驱动状态机流转（pending→accepted→in_progress→completed），
      // 后端按 status 值校验业务规则（如 pending→accepted 需当前用户为 seller）
      const mockRes: ApiResponse<SkillOrder> = { code: 0, message: 'ok', data: { ...mockOrder, status: 'accepted' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await updateOrderStatus('order-uuid-001', 'accepted');

      expect(client.put).toHaveBeenCalledWith('/skills/orders/order-uuid-001/status', { status: 'accepted' });
      expect(result.data.status).toBe('accepted');
    });
  });

  describe('disputeOrder - 发起争议', () => {
    it('应使用 POST /skills/orders/:id/dispute 且透传 reason', async () => {
      // 设计原因：disputeOrder 在订单进行中发起争议，订单状态变为 'disputed'，
      // 后端校验当前状态允许争议（如 'accepted'/'in_progress' 才可发起）
      const mockRes: ApiResponse<SkillOrder> = { code: 0, message: 'ok', data: { ...mockOrder, status: 'disputed' } };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await disputeOrder('order-uuid-001', '卖家未按约定提供服务');

      expect(client.post).toHaveBeenCalledWith('/skills/orders/order-uuid-001/dispute', {
        reason: '卖家未按约定提供服务',
      });
      expect(result.data.status).toBe('disputed');
    });
  });

  describe('getOrder - 获取订单详情（含争议信息）', () => {
    it('应使用 GET /skills/orders/:id', async () => {
      // 设计原因：getOrder 返回订单详情，含 disputeReason/resolution 等争议字段，
      // 用于争议详情页展示
      const mockRes: ApiResponse<SkillOrder> = {
        code: 0, message: 'ok',
        data: { ...mockOrder, disputeReason: '卖家未履约', status: 'disputed' },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getOrder('order-uuid-001');

      expect(client.get).toHaveBeenCalledWith('/skills/orders/order-uuid-001');
      expect(result.data.disputeReason).toBe('卖家未履约');
    });
  });

  describe('resolveDispute - 管理员裁决争议', () => {
    it('应使用 PUT /skills/orders/:id/resolve 且透传 resolution/action', async () => {
      // 设计原因：resolveDispute 是管理员操作，action ∈ refund/continue/cancel，
      // 后端按 action 更新订单状态（refund→cancelled + 退款 / continue→in_progress / cancel→cancelled）
      const mockRes: ApiResponse<SkillOrder> = {
        code: 0, message: 'ok',
        data: { ...mockOrder, status: 'cancelled', resolution: '退款给买家', resolvedAt: '2026-07-28T11:00:00.000Z' },
      };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await resolveDispute('order-uuid-001', '退款给买家', 'refund');

      expect(client.put).toHaveBeenCalledWith('/skills/orders/order-uuid-001/resolve', {
        resolution: '退款给买家',
        action: 'refund',
      });
      expect(result.data.status).toBe('cancelled');
    });

    it('action 全部枚举值应可透传', async () => {
      // 设计原因：action 三种取值（refund/continue/cancel）需全部覆盖，避免后端 switch 漏 case
      const actions = ['refund', 'continue', 'cancel'] as const;
      const mockRes: ApiResponse<SkillOrder> = { code: 0, message: 'ok', data: mockOrder };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue(mockRes);

      for (const a of actions) {
        await resolveDispute('order-001', '裁决', a);
      }

      const calls = (client.put as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]![1].action).toBe('refund');
      expect(calls[1]![1].action).toBe('continue');
      expect(calls[2]![1].action).toBe('cancel');
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 4 种方法各 1 次，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockPost });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockOrder });
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockOrder });
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });

      await getPost('p1');
      await createOrder({ postId: 'p1' });
      await updateOrderStatus('o1', 'accepted');
      await deletePost('p1');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledTimes(1);
      expect(client.delete).toHaveBeenCalledTimes(1);
    });
  });
});
