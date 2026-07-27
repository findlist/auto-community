/**
 * api/kitchen 共享厨房 API 层单元测试
 *
 * 测试目标：覆盖 14 个导出函数（getFoodShares/getFoodShareById/createFoodShare/
 *           updateFoodShare/deleteFoodShare/getFoodOrders/createFoodOrder/confirmFoodOrder/
 *           completeFoodOrder/cancelFoodOrder/getGroupOrders/getGroupOrderById/
 *           createGroupOrder/joinGroupOrder/getFoodReviews）
 *           验证 HTTP 方法、URL 路径、params/body 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post/put/delete，断言调用参数与返回值
 *
 * 设计原因：kitchen API 跨 4 类资源（美食帖/订单/拼单/评价），方法/URL 错误会导致
 * 帖子误删、订单状态错乱、拼单数据丢失或评价错位，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  ApiResponse,
  PaginatedResponse,
  KitchenPost,
  KitchenOrder,
  GroupOrder,
  FoodReview,
} from '@/types';
import {
  getFoodShares,
  getFoodShareById,
  createFoodShare,
  updateFoodShare,
  deleteFoodShare,
  getFoodOrders,
  createFoodOrder,
  confirmFoodOrder,
  completeFoodOrder,
  cancelFoodOrder,
  getGroupOrders,
  getGroupOrderById,
  createGroupOrder,
  joinGroupOrder,
  getFoodReviews,
  type CreateFoodShareParams,
  type UpdateFoodShareParams,
  type CreateFoodOrderParams,
  type CompleteFoodOrderParams,
  type CreateGroupOrderParams,
} from '../kitchen';

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

// 测试用 fixture：单条美食帖
const mockPost: KitchenPost = {
  id: 'post-uuid-001',
  userId: 'user-uuid-001',
  type: 'offer',
  title: '自制蛋糕',
  description: '新鲜出炉的巧克力蛋糕',
  category: '烘焙',
  price: 20,
  quantity: 5,
  remaining: 5,
  pickupTime: '2026-07-28T18:00:00.000Z',
  pickupLocation: '小区门口',
  pickupType: 'self_pickup',
  images: [],
  healthCert: true,
  status: 'active',
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
};

// 测试用 fixture：单条订单
const mockOrder: KitchenOrder = {
  id: 'order-uuid-001',
  postId: 'post-uuid-001',
  buyerId: 'user-uuid-002',
  sellerId: 'user-uuid-001',
  quantity: 1,
  totalPrice: 20,
  pickupType: 'self_pickup',
  status: 'pending',
  createdAt: '2026-07-28T11:00:00.000Z',
};

// 测试用 fixture：单条拼单
const mockGroupOrder: GroupOrder = {
  id: 'group-uuid-001',
  initiatorId: 'user-uuid-001',
  title: '拼单采购蔬菜',
  description: '团购新鲜蔬菜',
  targetAmount: 100,
  currentAmount: 50,
  minParticipants: 3,
  maxParticipants: 10,
  currentParticipants: 2,
  address: '小区物业中心',
  deadline: '2026-07-29T18:00:00.000Z',
  status: 'open',
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
};

// 测试用 fixture：单条评价
const mockReview: FoodReview = {
  id: 'review-uuid-001',
  reviewerId: 'user-uuid-002',
  reviewedId: 'user-uuid-001',
  orderId: 'order-uuid-001',
  rating: 5,
  content: '蛋糕很新鲜',
  createdAt: '2026-07-28T20:00:00.000Z',
};

describe('api/kitchen - 共享厨房 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('美食分享 API', () => {
    it('getFoodShares 应使用 GET kitchen/posts 且透传筛选 params', async () => {
      // 设计原因：getFoodShares 支持按 type/category/keyword/page/pageSize 筛选
      const mockPage: ApiResponse<PaginatedResponse<KitchenPost>> = {
        code: 0, message: 'ok',
        data: { list: [mockPost], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getFoodShares({ type: 'offer', category: '烘焙', page: 1, pageSize: 10 });

      expect(client.get).toHaveBeenCalledWith('kitchen/posts', {
        params: { type: 'offer', category: '烘焙', page: 1, pageSize: 10 },
      });
      expect(result.data.list[0]!.title).toBe('自制蛋糕');
    });

    it('getFoodShareById 应使用 GET kitchen/posts/:id', async () => {
      const mockRes: ApiResponse<KitchenPost> = { code: 0, message: 'ok', data: mockPost };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getFoodShareById('post-uuid-001');

      expect(client.get).toHaveBeenCalledWith('kitchen/posts/post-uuid-001');
      expect(result.data.healthCert).toBe(true);
    });

    it('createFoodShare 应使用 POST kitchen/posts 且透传 body', async () => {
      const params: CreateFoodShareParams = {
        type: 'offer', title: '自制蛋糕', description: '巧克力味',
        category: '烘焙', price: 20, quantity: 5, healthCert: true,
      };
      const mockRes: ApiResponse<KitchenPost> = { code: 0, message: '创建成功', data: mockPost };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createFoodShare(params);

      expect(client.post).toHaveBeenCalledWith('kitchen/posts', params);
      expect(result.data.id).toBe('post-uuid-001');
    });

    it('updateFoodShare 应使用 PUT kitchen/posts/:id 且透传 body（含 id）', async () => {
      const params: UpdateFoodShareParams = { id: 'post-uuid-001', price: 25 };
      const mockRes: ApiResponse<KitchenPost> = { code: 0, message: 'ok', data: { ...mockPost, price: 25 } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateFoodShare(params);

      expect(client.put).toHaveBeenCalledWith('kitchen/posts/post-uuid-001', params);
    });

    it('deleteFoodShare 应使用 DELETE kitchen/posts/:id', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: '已删除', data: null };
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await deleteFoodShare('post-uuid-001');

      expect(client.delete).toHaveBeenCalledWith('kitchen/posts/post-uuid-001');
      expect(result.data).toBeNull();
    });
  });

  describe('订单 API', () => {
    it('getFoodOrders 应使用 GET kitchen/orders 且透传 role/status/page', async () => {
      // 设计原因：getFoodOrders 支持 role（buyer/seller）与 status 双重筛选
      const mockPage: ApiResponse<PaginatedResponse<KitchenOrder>> = {
        code: 0, message: 'ok',
        data: { list: [mockOrder], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getFoodOrders({ role: 'buyer', status: 'pending', page: 1, pageSize: 20 });

      expect(client.get).toHaveBeenCalledWith('kitchen/orders', {
        params: { role: 'buyer', status: 'pending', page: 1, pageSize: 20 },
      });
      expect(result.data.list[0]!.id).toBe('order-uuid-001');
    });

    it('createFoodOrder 应使用 POST kitchen/orders 且透传 body', async () => {
      const params: CreateFoodOrderParams = {
        postId: 'post-uuid-001', quantity: 2, pickupType: 'self_pickup',
      };
      const mockRes: ApiResponse<KitchenOrder> = { code: 0, message: '下单成功', data: mockOrder };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createFoodOrder(params);

      expect(client.post).toHaveBeenCalledWith('kitchen/orders', params);
      expect(result.data.status).toBe('pending');
    });

    it('confirmFoodOrder 应使用 PUT kitchen/orders/:id/confirm 且无 body', async () => {
      // 设计原因：confirmFoodOrder 是 seller 操作，无 body，后端从 JWT 取 sellerId 校验
      const mockRes: ApiResponse<KitchenOrder> = { code: 0, message: 'ok', data: { ...mockOrder, status: 'confirmed' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await confirmFoodOrder('order-uuid-001');

      expect(client.put).toHaveBeenCalledWith('kitchen/orders/order-uuid-001/confirm');
      expect(result.data.status).toBe('confirmed');
    });

    it('completeFoodOrder 应使用 PUT kitchen/orders/:id/complete 且透传 rating/content', async () => {
      // 设计原因：completeFoodOrder 是 buyer 操作，body 含评价信息，
      // 后端校验 rating 范围（1-5），写入 food_reviews 表
      const params: CompleteFoodOrderParams = { rating: 5, content: '很新鲜' };
      const mockRes: ApiResponse<KitchenOrder> = { code: 0, message: 'ok', data: { ...mockOrder, status: 'completed' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await completeFoodOrder('order-uuid-001', params);

      expect(client.put).toHaveBeenCalledWith('kitchen/orders/order-uuid-001/complete', params);
      expect(result.data.status).toBe('completed');
    });

    it('cancelFoodOrder 应使用 PUT kitchen/orders/:id/cancel 且无 body', async () => {
      const mockRes: ApiResponse<KitchenOrder> = { code: 0, message: 'ok', data: { ...mockOrder, status: 'cancelled' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await cancelFoodOrder('order-uuid-001');

      expect(client.put).toHaveBeenCalledWith('kitchen/orders/order-uuid-001/cancel');
      expect(result.data.status).toBe('cancelled');
    });
  });

  describe('拼单 API', () => {
    it('getGroupOrders 应使用 GET kitchen/group-orders 且透传筛选 params', async () => {
      const mockPage: ApiResponse<PaginatedResponse<GroupOrder>> = {
        code: 0, message: 'ok',
        data: { list: [mockGroupOrder], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getGroupOrders({ status: 'open', page: 1, pageSize: 10 });

      expect(client.get).toHaveBeenCalledWith('kitchen/group-orders', {
        params: { status: 'open', page: 1, pageSize: 10 },
      });
      expect(result.data.list[0]!.title).toBe('拼单采购蔬菜');
    });

    it('getGroupOrderById 应使用 GET kitchen/group-orders/:id', async () => {
      const mockRes: ApiResponse<GroupOrder> = { code: 0, message: 'ok', data: mockGroupOrder };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getGroupOrderById('group-uuid-001');

      expect(client.get).toHaveBeenCalledWith('kitchen/group-orders/group-uuid-001');
      expect(result.data.currentAmount).toBe(50);
    });

    it('createGroupOrder 应使用 POST kitchen/group-orders 且透传 body', async () => {
      const params: CreateGroupOrderParams = {
        title: '拼单采购蔬菜', description: '团购新鲜蔬菜',
        targetAmount: 100, minParticipants: 3, maxParticipants: 10,
        address: '小区物业中心', deadline: '2026-07-29T18:00:00.000Z',
      };
      const mockRes: ApiResponse<GroupOrder> = { code: 0, message: '创建成功', data: mockGroupOrder };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createGroupOrder(params);

      expect(client.post).toHaveBeenCalledWith('kitchen/group-orders', params);
      expect(result.data.id).toBe('group-uuid-001');
    });

    it('joinGroupOrder 应使用 POST kitchen/group-orders/:id/join 且透传 amount', async () => {
      // 设计原因：joinGroupOrder 仅传 amount，后端从 JWT 取 userId 自动创建参与者记录，
      // 返回更新后的拼单状态（currentAmount/currentParticipants/status）
      const mockRes: ApiResponse<{ id: string; currentAmount: number; currentParticipants: number; status: string }> = {
        code: 0, message: '加入成功',
        data: { id: 'group-uuid-001', currentAmount: 70, currentParticipants: 3, status: 'open' },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await joinGroupOrder('group-uuid-001', 20);

      expect(client.post).toHaveBeenCalledWith('kitchen/group-orders/group-uuid-001/join', { amount: 20 });
      expect(result.data.currentAmount).toBe(70);
      expect(result.data.currentParticipants).toBe(3);
    });
  });

  describe('评价 API', () => {
    it('getFoodReviews 应使用 GET kitchen/reviews 且透传筛选 params', async () => {
      // 设计原因：getFoodReviews 支持 userId 筛选（查询某用户的评价），用于用户主页展示
      const mockPage: ApiResponse<PaginatedResponse<FoodReview>> = {
        code: 0, message: 'ok',
        data: { list: [mockReview], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getFoodReviews({ userId: 'user-uuid-001', page: 1, pageSize: 10 });

      expect(client.get).toHaveBeenCalledWith('kitchen/reviews', {
        params: { userId: 'user-uuid-001', page: 1, pageSize: 10 },
      });
      expect(result.data.list[0]!.rating).toBe(5);
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 4 种方法各 1 次，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockPost });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockOrder });
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockOrder });
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });

      await getFoodShareById('p1');
      await createFoodOrder({ postId: 'p1', quantity: 1 });
      await confirmFoodOrder('o1');
      await deleteFoodShare('p1');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledTimes(1);
      expect(client.delete).toHaveBeenCalledTimes(1);
    });
  });
});
