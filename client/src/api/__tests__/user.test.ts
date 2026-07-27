/**
 * api/user 用户信息 API 层单元测试
 *
 * 测试目标：覆盖 7 个导出函数（updateProfile/submitVerification/getVerificationStatus/
 *           submitDeletionRequest/getDeletionRequestStatus/cancelDeletionRequest/getCreditHistory）
 *           验证 HTTP 方法、URL 路径、传入 data 与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client 的 put/post/get/delete 方法，断言调用参数与返回值
 *
 * 设计原因：user API 涉及实名认证、注销申请等敏感操作，URL/方法/参数错误可能导致
 * 用户数据被错误修改（如 PUT 误用为 POST 导致绕过校验），本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse, User, CreditTransaction, PaginatedResponse } from '@/types';
import {
  updateProfile,
  submitVerification,
  getVerificationStatus,
  submitDeletionRequest,
  getDeletionRequestStatus,
  cancelDeletionRequest,
  getCreditHistory,
  type VerificationStatus,
  type DeletionRequestStatus,
} from '../user';

// mock client 模块，拦截所有 HTTP 方法
// 设计原因：user API 横跨 put/post/get/delete 4 种方法，需全部 mock 以覆盖
vi.mock('../client', () => ({
  default: {
    put: vi.fn(),
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：符合 User 类型
const mockUser: User = {
  id: 'user-uuid-001',
  phone: '13800138000',
  nickname: '测试用户',
  creditBalance: 100,
  timeBalance: 60,
  reputationScore: 80,
  role: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('api/user - 用户信息 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateProfile - 更新用户资料', () => {
    it('应使用 PUT /users/profile 且透传 nickname/avatar', async () => {
      // 设计原因：updateProfile 用 PUT 而非 PATCH，全量更新语义；
      // 后端会校验至少传一项（nickname 或 avatar），API 层不重复校验
      const mockResponse: ApiResponse<User> = {
        code: 0,
        message: '更新成功',
        data: { ...mockUser, nickname: '新昵称' },
      };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await updateProfile({ nickname: '新昵称', avatar: '/uploads/avatar.png' });

      expect(client.put).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledWith('/users/profile', {
        nickname: '新昵称',
        avatar: '/uploads/avatar.png',
      });
      expect(result.data.nickname).toBe('新昵称');
    });

    it('仅传 avatar 时应正常透传（部分更新场景）', async () => {
      // 设计原因：UpdateProfileParams 两个字段均可选，允许仅更新一项
      const mockResponse: ApiResponse<User> = {
        code: 0,
        message: '更新成功',
        data: mockUser,
      };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      await updateProfile({ avatar: '/uploads/new.png' });

      expect(client.put).toHaveBeenCalledWith('/users/profile', { avatar: '/uploads/new.png' });
    });
  });

  describe('submitVerification - 提交实名认证', () => {
    it('应使用 POST /users/verify 且透传 realName/idCard', async () => {
      const mockResponse: ApiResponse<{ status: string; message: string }> = {
        code: 0,
        message: '提交成功',
        data: { status: 'pending', message: '认证申请已提交' },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await submitVerification({
        realName: '张三',
        idCard: '110101199001011234',
      });

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/users/verify', {
        realName: '张三',
        idCard: '110101199001011234',
      });
      expect(result.data.status).toBe('pending');
    });
  });

  describe('getVerificationStatus - 获取认证状态', () => {
    it('应使用 GET /users/verify/status 且无参数', async () => {
      const mockStatus: VerificationStatus = {
        verifyStatus: 'approved',
        submittedAt: '2026-01-01T00:00:00.000Z',
        request: {
          id: 'req-1',
          realName: '张三',
          status: 'approved',
          rejectReason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          reviewedAt: '2026-01-02T00:00:00.000Z',
        },
      };
      const mockResponse: ApiResponse<VerificationStatus> = {
        code: 0,
        message: 'ok',
        data: mockStatus,
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getVerificationStatus();

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/users/verify/status');
      expect(result.data.verifyStatus).toBe('approved');
      expect(result.data.request?.realName).toBe('张三');
    });

    it('未提交认证时应返回 verifyStatus=null 且 request=null', async () => {
      // 设计原因：未提交认证时后端返回 null 状态，API 层应原样透传
      const mockResponse: ApiResponse<VerificationStatus> = {
        code: 0,
        message: 'ok',
        data: { verifyStatus: null, submittedAt: null, request: null },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getVerificationStatus();

      expect(result.data.verifyStatus).toBeNull();
      expect(result.data.request).toBeNull();
    });
  });

  describe('submitDeletionRequest - 提交注销申请', () => {
    it('应使用 POST /users/deletion 且透传 reason', async () => {
      const mockResponse: ApiResponse<{ id: string; status: string; message: string }> = {
        code: 0,
        message: '提交成功',
        data: { id: 'del-1', status: 'pending', message: '注销申请已提交' },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await submitDeletionRequest({ reason: '不再使用' });

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/users/deletion', { reason: '不再使用' });
      expect(result.data.id).toBe('del-1');
    });

    it('不传 reason 时应正常调用（reason 可选）', async () => {
      // 设计原因：SubmitDeletionParams.reason 可选，允许无理由注销
      const mockResponse: ApiResponse<{ id: string; status: string; message: string }> = {
        code: 0,
        message: 'ok',
        data: { id: 'del-2', status: 'pending', message: 'ok' },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      await submitDeletionRequest({});

      expect(client.post).toHaveBeenCalledWith('/users/deletion', {});
    });
  });

  describe('getDeletionRequestStatus - 获取注销申请状态', () => {
    it('应使用 GET /users/deletion/status', async () => {
      const mockStatus: DeletionRequestStatus = {
        id: 'del-1',
        userId: 'user-uuid-001',
        status: 'pending',
        reason: '不再使用',
        createdAt: '2026-01-01T00:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        reviewerNickname: null,
        completedAt: null,
      };
      const mockResponse: ApiResponse<DeletionRequestStatus | null> = {
        code: 0,
        message: 'ok',
        data: mockStatus,
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getDeletionRequestStatus();

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/users/deletion/status');
      expect(result.data?.status).toBe('pending');
    });

    it('无注销申请时应返回 null', async () => {
      // 设计原因：用户从未提交注销申请时，后端返回 data: null
      const mockResponse: ApiResponse<DeletionRequestStatus | null> = {
        code: 0,
        message: 'ok',
        data: null,
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getDeletionRequestStatus();

      expect(result.data).toBeNull();
    });
  });

  describe('cancelDeletionRequest - 取消注销申请', () => {
    it('应使用 DELETE /users/deletion 且无请求体', async () => {
      // 设计原因：取消注销用 DELETE 方法，语义为「删除注销申请记录」
      const mockResponse: ApiResponse<null> = {
        code: 0,
        message: '已取消',
        data: null,
      };
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await cancelDeletionRequest();

      expect(client.delete).toHaveBeenCalledTimes(1);
      expect(client.delete).toHaveBeenCalledWith('/users/deletion');
      expect(result.message).toBe('已取消');
    });
  });

  describe('getCreditHistory - 获取积分明细（分页）', () => {
    it('应使用 GET /users/credit-history 且默认 page=1/pageSize=20', async () => {
      // 设计原因：getCreditHistory 参数有默认值，未传时应使用默认值
      const mockTransaction: CreditTransaction = {
        id: 'tx-1',
        userId: 'user-uuid-001',
        amount: 50,
        type: 'earn',
        balanceAfter: 150,
        description: '注册赠送',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const mockResponse: ApiResponse<PaginatedResponse<CreditTransaction>> = {
        code: 0,
        message: 'ok',
        data: {
          list: [mockTransaction],
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
          hasNext: false,
        },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getCreditHistory();

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/users/credit-history', {
        params: { page: 1, pageSize: 20 },
      });
      expect(result.data.list[0]!.amount).toBe(50);
      expect(result.data.hasNext).toBe(false);
    });

    it('自定义 page/pageSize 时应透传到 params', async () => {
      // 设计原因：分页参数应支持自定义，由调用方决定查询哪一页
      const mockResponse: ApiResponse<PaginatedResponse<CreditTransaction>> = {
        code: 0,
        message: 'ok',
        data: {
          list: [],
          total: 50,
          page: 3,
          pageSize: 10,
          totalPages: 5,
          hasNext: true,
        },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await getCreditHistory(3, 10);

      expect(client.get).toHaveBeenCalledWith('/users/credit-history', {
        params: { page: 3, pageSize: 10 },
      });
      expect(result.data.page).toBe(3);
      expect(result.data.hasNext).toBe(true);
    });
  });

  describe('函数间 mock 隔离', () => {
    it('跨方法调用不应相互污染', async () => {
      // 设计原因：验证 4 种 HTTP 方法的 mock 互不干扰，clearAllMocks 生效
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockUser });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });

      await updateProfile({ nickname: 'X' });
      await submitVerification({ realName: 'X', idCard: 'X' });
      await getVerificationStatus();
      await cancelDeletionRequest();

      expect(client.put).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.delete).toHaveBeenCalledTimes(1);
    });
  });
});
