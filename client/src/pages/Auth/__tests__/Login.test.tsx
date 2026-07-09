import { describe, it, expect, beforeEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 消除"异步 state 更新未被 act 包裹"警告，比 fireEvent + 同步 act 更可靠
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '../Login';
import { ApiError } from '@/api/client';
import type { User } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：登录响应、navigate、setAuth、toast 均需在 mock 工厂中引用
const {
  mockUser,
  mockLoginApi,
  mockNavigate,
  mockSetAuth,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  // 登录成功返回的用户对象：字段与 User 接口对齐
  mockUser: {
    id: 'user-1',
    phone: '13800000000',
    nickname: '测试用户',
    creditBalance: 100,
    timeBalance: 50,
    reputationScore: 4.5,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  } satisfies User,
  // login API mock：默认返回成功响应，单测可通过 mockResolvedValueOnce 覆盖为失败
  mockLoginApi: vi.fn(),
  // useNavigate 返回的 mock 函数：捕获跳转目标
  mockNavigate: vi.fn(),
  // useAuth().login：捕获登录成功后写入的 user 与 token
  mockSetAuth: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

// mock @/api/auth：login 默认返回成功响应，单测可覆盖为 reject
vi.mock('@/api/auth', () => ({
  login: mockLoginApi,
}));

// mock @/hooks/useAuth：暴露 login（页面解构为 setAuth）供断言
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: null,
    isAuthenticated: false,
    token: null,
    login: mockSetAuth,
    logout: vi.fn(),
    setUser: vi.fn(),
  })),
}));

// mock toast：捕获 success/error 调用便于断言
vi.mock('@/components/Toast', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// mock useNavigate：避免依赖真实路由跳转
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { login } from '@/api/auth';

// 包装组件：注入 MemoryRouter 提供 useNavigate/Link 上下文
function renderLogin() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('Auth/Login 登录页', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认登录成功响应：与 TokenData 结构对齐
    mockLoginApi.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { token: 'jwt-token', refreshToken: 'refresh-token', user: mockUser },
    });
    user = userEvent.setup();
  });

  it('渲染品牌标题、表单字段与跳转链接', () => {
    renderLogin();
    // 品牌字标与副标题
    expect(screen.getByText('邻里圈')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入手机号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    // 跳转链接
    expect(screen.getByText('忘记密码？')).toBeInTheDocument();
    expect(screen.getByText('立即注册 →')).toBeInTheDocument();
  });

  it('手机号格式错误时显示字段错误且不提交', async () => {
    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入手机号'), '12345');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('密码不足6位时显示字段错误且不提交', async () => {
    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入密码'), '12345');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByText('密码至少6位')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('点击眼睛图标切换密码显示状态', async () => {
    renderLogin();
    const passwordInput = screen.getByPlaceholderText('请输入密码');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // 切换为明文：aria-label 为"显示密码"时点击
    await user.click(screen.getByLabelText('显示密码'));
    expect(passwordInput).toHaveAttribute('type', 'text');

    // 再切换回密文：aria-label 为"隐藏密码"时点击
    await user.click(screen.getByLabelText('隐藏密码'));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('登录成功后写入 token、调用 setAuth、提示成功并跳转首页', async () => {
    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({ phone: '13800000000', password: 'password123' });
    });
    // setAuth 写入用户与 token
    expect(mockSetAuth).toHaveBeenCalledWith(mockUser, 'jwt-token');
    // localStorage 持久化 token
    expect(localStorage.getItem('token')).toBe('jwt-token');
    // 成功提示与跳转
    expect(mockToastSuccess).toHaveBeenCalledWith('欢迎回来！');
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('后端返回字段错误时映射到字段级提示', async () => {
    // 模拟 422 字段校验错误：ApiError 携带 fieldErrors
    mockLoginApi.mockRejectedValueOnce(
      new ApiError('手机号或密码错误', 422, [
        { field: 'password', message: '密码不正确' },
      ])
    );

    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    // 字段错误显示在密码输入框下方，且不触发 toast
    await waitFor(() => {
      expect(screen.getByText('密码不正确')).toBeInTheDocument();
    });
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('非字段错误时显示全局错误提示并 toast', async () => {
    // 模拟普通业务错误（如账号被封禁）
    mockLoginApi.mockRejectedValueOnce(new ApiError('账号已被封禁', 403));

    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => {
      expect(screen.getByText('账号已被封禁')).toBeInTheDocument();
    });
    expect(mockToastError).toHaveBeenCalledWith('账号已被封禁');
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('提交期间按钮禁用并显示登录中状态', async () => {
    // 用未决 Promise 挂起 login，使按钮停留在 loading 态便于断言
    mockLoginApi.mockReturnValueOnce(new Promise(() => {}));

    renderLogin();
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '登录' }));

    // loading 态按钮显示"登录中..."且禁用
    // 设计原因：页面存在密码切换按钮（aria-label="显示密码"）与提交按钮两个 role="button"，
    // 用 name 精确匹配提交按钮避免 getByRole 找到多个元素报错
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /登录中/ })).toBeDisabled();
    });
  });
});
