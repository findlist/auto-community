import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import useAuthStore from '../authStore';
import type { User } from '@/types';

// 构造一个通用的测试用户数据，避免在每个用例中重复定义
const mockUser: User = {
  id: 'user-1',
  phone: '13800000000',
  nickname: '测试用户',
  creditBalance: 100,
  timeBalance: 50,
  reputationScore: 4.5,
  role: 'user',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('authStore', () => {
  beforeEach(() => {
    // 每个测试前重置 store 状态并清空 localStorage，避免用例间状态污染
    act(() => {
      useAuthStore.getState().logout();
    });
    localStorage.clear();
  });

  describe('login action', () => {
    it('应正确设置 token 和 user', () => {
      const token = 'test-token-abc123';

      act(() => {
        useAuthStore.getState().login(mockUser, token);
      });

      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.token).toBe(token);
    });

    it('登录后 isAuthenticated 应为 true', () => {
      act(() => {
        useAuthStore.getState().login(mockUser, 'token');
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });
  });

  describe('logout action', () => {
    it('应正确清除 token 和 user', () => {
      // 先登录，再登出，验证状态被清空
      act(() => {
        useAuthStore.getState().login(mockUser, 'token-to-be-cleared');
        useAuthStore.getState().logout();
      });

      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.token).toBeNull();
    });

    it('登出后 isAuthenticated 应为 false', () => {
      act(() => {
        useAuthStore.getState().login(mockUser, 'token');
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('isAuthenticated getter', () => {
    it('有 token 时（登录后）应返回 true', () => {
      act(() => {
        useAuthStore.getState().login(mockUser, 'valid-token');
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('无 token 时（初始状态）应返回 false', () => {
      // 初始状态未登录
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
