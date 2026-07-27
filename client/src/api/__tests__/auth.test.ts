/**
 * api/auth 认证 API 层单元测试
 *
 * 测试目标：覆盖 6 个导出函数（login/register/refreshToken/logout/forgotPassword/resetPassword）
 *           验证 HTTP 方法、URL 路径、传入 data 与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.post，断言调用参数与返回值，避免真实网络请求
 *
 * 设计原因：auth API 是登录/注册等核心认证流程的请求层，无测试时改 URL 或参数名会
 * 静默破坏前后端契约；本测试作为契约守护，确保 URL/方法/参数名变更能被测试感知
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse, User } from '@/types';
import {
  login,
  register,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  type TokenData,
} from '../auth';

// mock client 模块，拦截所有 post 请求
// 设计原因：API 层测试应聚焦于「调用契约」而非「网络层行为」，
// client.ts 的拦截器、重试、错误转换由 client.test.ts 独立覆盖，避免重复
vi.mock('../client', () => ({
  default: {
    post: vi.fn(),
  },
}));

// 动态导入 client 获取 mock 引用，确保 vi.mock 提升后能拿到 mock 实例
// 设计原因：vi.mock 会被 vitest 提升到文件顶部，静态 import 可保证 mock 已就绪
import client from '../client';

// 测试用 fixture：符合 User 与 TokenData 类型，避免重复构造
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

const mockTokenData: TokenData = {
  token: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  user: mockUser,
};

describe('api/auth - 认证 API 层', () => {
  beforeEach(() => {
    // 每个用例前清空 mock 调用记录，避免用例间相互干扰
    vi.clearAllMocks();
  });

  describe('login - 用户登录', () => {
    it('应使用 POST /auth/login 且透传 phone/password', async () => {
      const mockResponse: ApiResponse<TokenData> = {
        code: 0,
        message: '登录成功',
        data: mockTokenData,
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const params = { phone: '13800138000', password: 'Pass1234' };
      const result = await login(params);

      // 验证 URL 与方法
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/auth/login', params);
      // 验证返回值原样透传（响应拦截器的 case 转换由 client.test.ts 覆盖）
      expect(result).toBe(mockResponse);
      expect(result.data.token).toBe('access-token-abc');
      expect(result.data.user.nickname).toBe('测试用户');
    });

    it('登录失败时 ApiError 应由 client 拦截器抛出，login 函数不捕获', async () => {
      // 设计原因：login/register 等函数未 try/catch，错误透传给调用方处理；
      // 此处验证 reject 透传行为，确保 login 不会吞错导致前端误判登录成功
      const apiError = new Error('手机号或密码错误');
      (client.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(apiError);

      await expect(login({ phone: '13800138000', password: 'wrong' })).rejects.toThrow(
        '手机号或密码错误'
      );
    });
  });

  describe('register - 用户注册', () => {
    it('应使用 POST /auth/register 且透传 phone/password/nickname/privacyConsentVersion', async () => {
      const mockResponse: ApiResponse<TokenData> = {
        code: 0,
        message: '注册成功',
        data: mockTokenData,
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const params = {
        phone: '13800138001',
        password: 'Pass1234',
        nickname: '新用户',
        privacyConsentVersion: 'v1.0',
      };
      const result = await register(params);

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/auth/register', params);
      expect(result.code).toBe(0);
      expect(result.data.user.id).toBe('user-uuid-001');
    });
  });

  describe('refreshToken - 刷新访问令牌', () => {
    it('应使用 POST /auth/refresh-token 且传入 { refreshToken }', async () => {
      // 设计原因：refreshToken 字段名为 camelCase，由 client 拦截器转为 snake_case；
      // API 层只负责透传，不应自行做命名转换（避免与拦截器职责重叠）
      const newTokens: ApiResponse<{ token: string; refreshToken: string }> = {
        code: 0,
        message: '刷新成功',
        data: { token: 'new-access', refreshToken: 'new-refresh' },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(newTokens);

      const result = await refreshToken('old-refresh-token');

      expect(client.post).toHaveBeenCalledTimes(1);
      // 验证传入的是 { refreshToken } 对象（非裸字符串）
      expect(client.post).toHaveBeenCalledWith('/auth/refresh-token', {
        refreshToken: 'old-refresh-token',
      });
      expect(result.data.token).toBe('new-access');
      expect(result.data.refreshToken).toBe('new-refresh');
    });
  });

  describe('logout - 退出登录', () => {
    it('应使用 POST /auth/logout 且无请求体', async () => {
      // 设计原因：logout 不需要参数，client.post 仅传 URL，第二个参数为 undefined
      const mockResponse: ApiResponse<null> = {
        code: 0,
        message: '退出成功',
        data: null,
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await logout();

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/auth/logout');
      expect(result.data).toBeNull();
    });
  });

  describe('forgotPassword - 忘记密码（发送验证码）', () => {
    it('应使用 POST /auth/forgot-password 且透传 phone', async () => {
      const mockResponse: ApiResponse<null> = {
        code: 0,
        message: '验证码已发送',
        data: null,
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const result = await forgotPassword({ phone: '13800138000' });

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/auth/forgot-password', {
        phone: '13800138000',
      });
      expect(result.message).toBe('验证码已发送');
    });
  });

  describe('resetPassword - 重置密码', () => {
    it('应使用 POST /auth/reset-password 且透传 phone/code/password', async () => {
      const mockResponse: ApiResponse<null> = {
        code: 0,
        message: '密码重置成功',
        data: null,
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResponse);

      const params = {
        phone: '13800138000',
        code: '123456',
        password: 'NewPass1234',
      };
      const result = await resetPassword(params);

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/auth/reset-password', params);
      expect(result.code).toBe(0);
    });
  });

  describe('函数间 mock 隔离', () => {
    it('多次调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：vi.clearAllMocks 在 beforeEach 调用，确保用例间调用记录隔离；
      // 此用例显式验证：连续调用 login 与 logout，post 调用次数应分别为 1，不累积
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: 0,
        message: 'ok',
        data: null,
      });

      await login({ phone: '13800138000', password: 'Pass1234' });
      await logout();

      expect(client.post).toHaveBeenCalledTimes(2);
      // 验证两次调用的 URL 顺序（noUncheckedIndexedAccess 严格模式下，需显式断言 mock.calls 元素非空）
      const calls = (client.post as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]![0]).toBe('/auth/login');
      expect(calls[1]![0]).toBe('/auth/logout');
    });
  });
});
