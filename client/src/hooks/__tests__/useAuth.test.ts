import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from '../useAuth';
import useAuthStore from '@/stores/authStore';
import type { User } from '@/types';

// 测试用的用户数据
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

describe('useAuth', () => {
  beforeEach(() => {
    // 重置 store 状态，避免用例间状态污染
    act(() => {
      useAuthStore.getState().logout();
    });
    localStorage.clear();
  });

  it('初始状态应返回未认证的认证状态', () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('调用 login 后应返回正确的认证状态', () => {
    const { result } = renderHook(() => useAuth());
    const token = 'test-token';

    act(() => {
      result.current.login(mockUser, token);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.token).toBe(token);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('调用 logout 后应清除认证状态', () => {
    const { result } = renderHook(() => useAuth());

    // 先登录再登出
    act(() => {
      result.current.login(mockUser, 'token');
    });
    act(() => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('login/logout 应为 store 中对应函数的引用', () => {
    const { result } = renderHook(() => useAuth());
    const storeState = useAuthStore.getState();

    // hook 返回的函数应与 store 中的函数一致（同一引用）
    expect(result.current.login).toBe(storeState.login);
    expect(result.current.logout).toBe(storeState.logout);
    expect(result.current.setUser).toBe(storeState.setUser);
  });

  it('setUser 应正确更新用户信息', () => {
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.login(mockUser, 'token');
    });

    const updatedUser: User = { ...mockUser, nickname: '更新后的昵称' };
    act(() => {
      result.current.setUser(updatedUser);
    });

    expect(result.current.user).toEqual(updatedUser);
    expect(result.current.user?.nickname).toBe('更新后的昵称');
  });
});
