/**
 * api/timeBank 时间银行 API 层单元测试
 *
 * 测试目标：覆盖 18 个导出函数（getServices/getService/createService/updateService/
 *           createOrder/getOrders/updateOrderStatus/createDispute/getAccount/transferTime/
 *           donateTime/getTransactions/createFamilyBinding/confirmFamilyBinding/rejectFamilyBinding/
 *           unbindFamilyBinding/getFamilyBindings/createReview/getDisputes）
 *           验证 HTTP 方法、URL 路径、params/body 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post/put，断言调用参数与返回值
 *
 * 设计原因：timeBank API 是核心模块，涉及时间币流转（transfer/donate/earn）与状态机
 * （accept/start/complete/cancel），方法/URL 错误会导致时间币丢失或状态死锁，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  ApiResponse,
  PaginatedResponse,
  CursorPaginatedResponse,
  TimeService,
  TimeOrder,
  ServiceDispute,
  TimeAccount,
  TimeTransaction,
  FamilyBinding,
  Review,
} from '@/types';
import {
  getServices,
  getService,
  createService,
  updateService,
  createOrder,
  getOrders,
  updateOrderStatus,
  createDispute,
  getAccount,
  transferTime,
  donateTime,
  getTransactions,
  createFamilyBinding,
  confirmFamilyBinding,
  rejectFamilyBinding,
  unbindFamilyBinding,
  getFamilyBindings,
  createReview,
  getDisputes,
  type CreateServiceParams,
  type UpdateServiceParams,
  type CreateOrderParams,
  type CreateDisputeParams,
} from '../timeBank';

// mock client 模块，覆盖 get/post/put 3 种方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单条时间服务
const mockService: TimeService = {
  id: 'svc-uuid-001',
  userId: 'user-uuid-001',
  type: 'provide',
  title: '老人陪护',
  description: '专业陪护老人',
  category: '照护',
  durationMinutes: 120,
  images: [],
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

// 测试用 fixture：单条时间订单
const mockOrder: TimeOrder = {
  id: 'order-uuid-001',
  serviceId: 'svc-uuid-001',
  providerId: 'user-uuid-001',
  requesterId: 'user-uuid-002',
  durationMinutes: 120,
  status: 'pending',
  createdAt: '2026-07-28T10:00:00.000Z',
};

// 测试用 fixture：单条交易流水
const mockTransaction: TimeTransaction = {
  id: 'tx-uuid-001',
  fromUserId: 'user-uuid-001',
  toUserId: 'user-uuid-002',
  amount: 60,
  type: 'transfer',
  status: 'completed',
  createdAt: '2026-07-28T11:00:00.000Z',
};

// 测试用 fixture：单条亲情绑定
const mockFamily: FamilyBinding = {
  id: 'fam-uuid-001',
  userId: 'user-uuid-001',
  parentId: 'user-uuid-003',
  relationship: '父子',
  status: 'pending',
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
};

describe('api/timeBank - 时间银行 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('服务 CRUD', () => {
    it('getServices 应使用 GET /time-bank/services 且透传筛选 params', async () => {
      const mockPage: ApiResponse<PaginatedResponse<TimeService>> = {
        code: 0, message: 'ok',
        data: { list: [mockService], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getServices({ type: 'provide', category: '照护', page: 1, pageSize: 10 });

      expect(client.get).toHaveBeenCalledWith('/time-bank/services', {
        params: { type: 'provide', category: '照护', page: 1, pageSize: 10 },
      });
      expect(result.data.list[0]!.title).toBe('老人陪护');
    });

    it('getService 应使用 GET /time-bank/services/:id', async () => {
      const mockRes: ApiResponse<TimeService> = { code: 0, message: 'ok', data: mockService };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getService('svc-uuid-001');

      expect(client.get).toHaveBeenCalledWith('/time-bank/services/svc-uuid-001');
      expect(result.data.durationMinutes).toBe(120);
    });

    it('createService 应使用 POST /time-bank/services 且透传 body', async () => {
      const params: CreateServiceParams = {
        type: 'provide', title: '老人陪护', description: '专业陪护',
        category: '照护', durationMinutes: 120,
      };
      const mockRes: ApiResponse<TimeService> = { code: 0, message: '创建成功', data: mockService };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createService(params);

      expect(client.post).toHaveBeenCalledWith('/time-bank/services', params);
      expect(result.data.id).toBe('svc-uuid-001');
    });

    it('updateService 应使用 PUT /time-bank/services/:id 且透传 body（含 id）', async () => {
      const params: UpdateServiceParams = { id: 'svc-uuid-001', title: '老人陪护（更新）', address: '北京市' };
      const mockRes: ApiResponse<TimeService> = { code: 0, message: 'ok', data: { ...mockService, title: '老人陪护（更新）' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateService(params);

      expect(client.put).toHaveBeenCalledWith('/time-bank/services/svc-uuid-001', params);
    });
  });

  describe('订单 API', () => {
    it('createOrder 应使用 POST /time-bank/orders 且透传 serviceId', async () => {
      // 设计原因：createOrder 仅传 serviceId，后端从服务获取 providerId + durationMinutes，
      // 从 JWT 取 requesterId，避免前端伪造身份
      const params: CreateOrderParams = { serviceId: 'svc-uuid-001' };
      const mockRes: ApiResponse<TimeOrder> = { code: 0, message: '下单成功', data: mockOrder };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createOrder(params);

      expect(client.post).toHaveBeenCalledWith('/time-bank/orders', params);
      expect(result.data.status).toBe('pending');
    });

    it('getOrders 应使用 GET /time-bank/orders 且透传分页 params', async () => {
      const mockPage: ApiResponse<PaginatedResponse<TimeOrder>> = {
        code: 0, message: 'ok',
        data: { list: [mockOrder], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getOrders({ page: 2, pageSize: 10 });

      expect(client.get).toHaveBeenCalledWith('/time-bank/orders', { params: { page: 2, pageSize: 10 } });
      expect(result.data.list[0]!.id).toBe('order-uuid-001');
    });

    it('updateOrderStatus 应将状态名词转为 action 动词', async () => {
      // 设计原因：updateOrderStatus 内部有 STATUS_TO_ACTION 映射表，
      // 前端传状态名词（accepted/in_progress/completed/cancelled），后端期望 action 动词（accept/start/complete/cancel）
      const mockRes: ApiResponse<TimeOrder> = { code: 0, message: 'ok', data: { ...mockOrder, status: 'accepted' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateOrderStatus('order-uuid-001', 'accepted');

      expect(client.put).toHaveBeenCalledWith('/time-bank/orders/order-uuid-001/status', {
        action: 'accept',
        actualDuration: undefined,
      });
    });

    it('updateOrderStatus 完成时应透传 actualDuration', async () => {
      // 设计原因：completed 状态需附 actualDuration（实际服务时长），后端按此结算时间币
      const mockRes: ApiResponse<TimeOrder> = { code: 0, message: 'ok', data: { ...mockOrder, status: 'completed' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateOrderStatus('order-uuid-001', 'completed', 110);

      const [url, body] = (client.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/time-bank/orders/order-uuid-001/status');
      expect(body.action).toBe('complete');
      expect(body.actualDuration).toBe(110);
    });

    it('updateOrderStatus 全部状态名词应正确映射', async () => {
      // 设计原因：覆盖 STATUS_TO_ACTION 全部 4 个映射项，避免漏 case
      const cases = [
        { status: 'accepted', action: 'accept' },
        { status: 'in_progress', action: 'start' },
        { status: 'completed', action: 'complete' },
        { status: 'cancelled', action: 'cancel' },
      ];
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockOrder });

      for (const c of cases) {
        await updateOrderStatus('o1', c.status);
      }

      const calls = (client.put as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]![1].action).toBe('accept');
      expect(calls[1]![1].action).toBe('start');
      expect(calls[2]![1].action).toBe('complete');
      expect(calls[3]![1].action).toBe('cancel');
    });

    it('updateOrderStatus 未知状态应原样透传（不映射）', async () => {
      // 设计原因：STATUS_TO_ACTION[status] ?? status 的兜底逻辑，
      // 未知状态原样透传，由后端校验返回 422
      const mockRes: ApiResponse<TimeOrder> = { code: 0, message: 'ok', data: mockOrder };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateOrderStatus('order-uuid-001', 'unknown_status');

      const body = (client.put as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(body.action).toBe('unknown_status');
    });
  });

  describe('争议 API', () => {
    it('createDispute 应使用 POST /time-bank/disputes 且透传 orderId/reason/evidence', async () => {
      const params: CreateDisputeParams = {
        orderId: 'order-uuid-001', reason: '服务方未履约', evidence: ['/uploads/evidence1.png'],
      };
      const mockDispute: ServiceDispute = {
        id: 'disp-uuid-001', orderId: 'order-uuid-001', initiatorId: 'user-uuid-002',
        reason: '服务方未履约', evidence: ['/uploads/evidence1.png'], status: 'pending',
        createdAt: '2026-07-28T12:00:00.000Z', updatedAt: '2026-07-28T12:00:00.000Z',
      };
      const mockRes: ApiResponse<ServiceDispute> = { code: 0, message: '已提交', data: mockDispute };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createDispute(params);

      expect(client.post).toHaveBeenCalledWith('/time-bank/disputes', params);
      expect(result.data.status).toBe('pending');
    });

    it('getDisputes 应使用 GET /time-bank/disputes 且透传分页 params', async () => {
      const mockPage: ApiResponse<PaginatedResponse<ServiceDispute>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getDisputes({ page: 1, pageSize: 10 });

      expect(client.get).toHaveBeenCalledWith('/time-bank/disputes', { params: { page: 1, pageSize: 10 } });
    });
  });

  describe('账户与转账 API', () => {
    it('getAccount 应使用 GET /time-bank/account 返回账户余额', async () => {
      const mockAccount: TimeAccount = {
        id: 'acc-uuid-001', userId: 'user-uuid-001',
        balance: 100, totalEarned: 200, totalSpent: 100,
        updatedAt: '2026-07-28T10:00:00.000Z',
      };
      const mockRes: ApiResponse<TimeAccount> = { code: 0, message: 'ok', data: mockAccount };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getAccount();

      expect(client.get).toHaveBeenCalledWith('/time-bank/account');
      expect(result.data.balance).toBe(100);
    });

    it('transferTime 应使用 POST /time-bank/transfer 且透传 toUserId/amount/remark', async () => {
      const mockRes: ApiResponse<TimeTransaction> = { code: 0, message: '转赠成功', data: mockTransaction };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await transferTime('user-uuid-002', 60, '感谢帮助');

      expect(client.post).toHaveBeenCalledWith('/time-bank/transfer', {
        toUserId: 'user-uuid-002', amount: 60, remark: '感谢帮助',
      });
      expect(result.data.type).toBe('transfer');
    });

    it('donateTime 应使用 POST /time-bank/donate 且透传 toUserId/amount/remark', async () => {
      // 设计原因：donateTime 与 transferTime URL 不同（/donate vs /transfer），
      // 后端流水 type='donate'，不计入接收方 total_earned（避免污染日收益上限）
      const mockRes: ApiResponse<TimeTransaction> = {
        code: 0, message: '捐赠成功',
        data: { ...mockTransaction, type: 'donate' },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await donateTime('user-uuid-002', 30, '无偿捐赠');

      expect(client.post).toHaveBeenCalledWith('/time-bank/donate', {
        toUserId: 'user-uuid-002', amount: 30, remark: '无偿捐赠',
      });
      expect(result.data.type).toBe('donate');
    });

    it('getTransactions 应使用 GET /time-bank/transactions（游标分页）', async () => {
      // 设计原因：getTransactions 用游标分页（与 messages.ts 一致），cursor 为上一页最后一条 tx id
      const mockCursor: ApiResponse<CursorPaginatedResponse<TimeTransaction>> = {
        code: 0, message: 'ok',
        data: { list: [mockTransaction], nextCursor: 'tx-uuid-002', hasMore: true },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockCursor);

      const result = await getTransactions('tx-uuid-000', 30);

      expect(client.get).toHaveBeenCalledWith('/time-bank/transactions', {
        params: { cursor: 'tx-uuid-000', limit: 30 },
      });
      expect(result.data.nextCursor).toBe('tx-uuid-002');
    });

    it('getTransactions cursor 省略时应传 undefined（首页）', async () => {
      const mockCursor: ApiResponse<CursorPaginatedResponse<TimeTransaction>> = {
        code: 0, message: 'ok',
        data: { list: [], nextCursor: null, hasMore: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockCursor);

      await getTransactions();

      const config = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(config.params.cursor).toBeUndefined();
      expect(config.params.limit).toBe(20); // 默认值
    });
  });

  describe('亲情绑定 API', () => {
    it('createFamilyBinding 应使用 POST /time-bank/family 且透传 parentPhone/relationship', async () => {
      const mockRes: ApiResponse<FamilyBinding> = { code: 0, message: '已申请', data: mockFamily };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createFamilyBinding('13800138000', '父子');

      expect(client.post).toHaveBeenCalledWith('/time-bank/family', {
        parentPhone: '13800138000', relationship: '父子',
      });
      expect(result.data.status).toBe('pending');
    });

    it('confirmFamilyBinding 应使用 PUT /time-bank/family/:id/confirm', async () => {
      const mockRes: ApiResponse<FamilyBinding> = { code: 0, message: '已确认', data: { ...mockFamily, status: 'confirmed' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await confirmFamilyBinding('fam-uuid-001');

      expect(client.put).toHaveBeenCalledWith('/time-bank/family/fam-uuid-001/confirm');
      expect(result.data.status).toBe('confirmed');
    });

    it('rejectFamilyBinding 应使用 PUT /time-bank/family/:id/reject', async () => {
      const mockRes: ApiResponse<FamilyBinding> = { code: 0, message: '已拒绝', data: { ...mockFamily, status: 'rejected' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await rejectFamilyBinding('fam-uuid-001');

      expect(client.put).toHaveBeenCalledWith('/time-bank/family/fam-uuid-001/reject');
      expect(result.data.status).toBe('rejected');
    });

    it('unbindFamilyBinding 应使用 PUT /time-bank/family/:id/unbind', async () => {
      const mockRes: ApiResponse<FamilyBinding> = { code: 0, message: '已解绑', data: { ...mockFamily, status: 'unbound' } };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await unbindFamilyBinding('fam-uuid-001');

      expect(client.put).toHaveBeenCalledWith('/time-bank/family/fam-uuid-001/unbind');
      expect(result.data.status).toBe('unbound');
    });

    it('getFamilyBindings 应使用 GET /time-bank/family 返回数组', async () => {
      // 设计原因：getFamilyBindings 返回 FamilyBinding[]（非分页），后端按 JWT 取当前用户的全部绑定
      const mockRes: ApiResponse<FamilyBinding[]> = { code: 0, message: 'ok', data: [mockFamily] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getFamilyBindings();

      expect(client.get).toHaveBeenCalledWith('/time-bank/family');
      expect(result.data).toHaveLength(1);
    });
  });

  describe('评价 API', () => {
    it('createReview 应使用 POST /time-bank/reviews 且透传 orderId/rating/content', async () => {
      // 设计原因：createReview body 含 orderId + rating（1-5）+ 可选 content，
      // 后端校验当前用户为订单的 provider 或 requester 才可评价
      const mockReview: Review = {
        id: 'review-uuid-001', orderId: 'order-uuid-001',
        reviewerId: 'user-uuid-001', revieweeId: 'user-uuid-002',
        rating: 5, content: '服务很好',
        createdAt: '2026-07-28T15:00:00.000Z',
      };
      const mockRes: ApiResponse<Review> = { code: 0, message: '评价成功', data: mockReview };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createReview('order-uuid-001', 5, '服务很好');

      expect(client.post).toHaveBeenCalledWith('/time-bank/reviews', {
        orderId: 'order-uuid-001', rating: 5, content: '服务很好',
      });
      expect(result.data.rating).toBe(5);
    });

    it('createReview content 省略时应传 undefined', async () => {
      const mockReview: Review = {
        id: 'r2', orderId: 'o2', reviewerId: 'u1', revieweeId: 'u2',
        rating: 4, content: '',
        createdAt: '2026-07-28T15:00:00.000Z',
      };
      const mockRes: ApiResponse<Review> = { code: 0, message: 'ok', data: mockReview };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await createReview('order-uuid-002', 4);

      const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(body.content).toBeUndefined();
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 get/post/put 各 1 次，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockService });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockOrder });
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockOrder });

      await getService('s1');
      await createOrder({ serviceId: 's1' });
      await updateOrderStatus('o1', 'accepted');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledTimes(1);
    });
  });
});
