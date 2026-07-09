import { describe, it, expect, beforeEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 消除"异步 state 更新未被 act 包裹"警告，比 fireEvent + 同步 act 更可靠
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import RegisterPage from '../Register';
import { ApiError } from '@/api/client';
import type { User } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：注册响应、navigate、setAuth、toast 均需在 mock 工厂中引用
const {
  mockUser,
  mockRegisterApi,
  mockNavigate,
  mockSetAuth,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  // 注册成功返回的用户对象：字段与 User 接口对齐
  mockUser: {
    id: 'user-new',
    phone: '13800000000',
    nickname: '新邻居',
    creditBalance: 100,
    timeBalance: 60,
    reputationScore: 5,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  } satisfies User,
  // register API mock：默认返回成功响应，单测可通过 mockRejectedValueOnce 覆盖为失败
  mockRegisterApi: vi.fn(),
  // useNavigate 返回的 mock 函数：捕获跳转目标
  mockNavigate: vi.fn(),
  // useAuth().login：捕获注册成功后写入的 user 与 token（页面解构为 setAuth）
  mockSetAuth: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

// mock @/api/auth：register 默认返回成功响应，单测可覆盖为 reject
vi.mock('@/api/auth', () => ({
  register: mockRegisterApi,
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

import { register } from '@/api/auth';

// 包装组件：注入 MemoryRouter 提供 useNavigate/Link 上下文
function renderRegister() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <RegisterPage />
    </MemoryRouter>
  );
}

describe('Auth/Register 注册页', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认注册成功响应：与 TokenData 结构对齐
    mockRegisterApi.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { token: 'jwt-token', refreshToken: 'refresh-token', user: mockUser },
    });
    user = userEvent.setup();
  });

  // 辅助函数：填写完整有效表单（昵称/手机号/密码/确认密码/勾选隐私同意），
  // 设计原因：单字段校验用例只需让目标字段无效，其余字段保持有效，避免多重错误干扰断言
  async function fillValidForm() {
    await user.type(screen.getByPlaceholderText('给自己取个名字'), '新邻居');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('至少6位'), 'password123');
    await user.type(screen.getByPlaceholderText('再次输入密码'), 'password123');
    // 隐私同意 checkbox：用 label 文本定位，确保与用户实际交互方式一致
    await user.click(screen.getByLabelText(/我已阅读并同意/));
  }

  it('渲染标题、表单字段与跳转链接', () => {
    renderRegister();
    expect(screen.getByText('加入邻里圈')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('给自己取个名字')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入手机号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('至少6位')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('再次输入密码')).toBeInTheDocument();
    // 提交按钮（含"立即注册"文本）
    expect(screen.getByRole('button', { name: /立即注册/ })).toBeInTheDocument();
    // 跳转链接（底部"已有账号？直接登录"整体在一个 Link 节点内）
    expect(screen.getByText('已有账号？直接登录')).toBeInTheDocument();
    expect(screen.getByText('《隐私政策》')).toBeInTheDocument();
    // 注册福利提示
    expect(screen.getByText(/注册即送 100 积分/)).toBeInTheDocument();
  });

  it('手机号格式错误显示字段错误且不提交', async () => {
    renderRegister();
    await user.type(screen.getByPlaceholderText('给自己取个名字'), '新邻居');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '12345');
    await user.type(screen.getByPlaceholderText('至少6位'), 'password123');
    await user.type(screen.getByPlaceholderText('再次输入密码'), 'password123');
    await user.click(screen.getByLabelText(/我已阅读并同意/));
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('密码不足6位显示字段错误且不提交', async () => {
    renderRegister();
    await user.type(screen.getByPlaceholderText('给自己取个名字'), '新邻居');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('至少6位'), '12345');
    await user.type(screen.getByPlaceholderText('再次输入密码'), '12345');
    await user.click(screen.getByLabelText(/我已阅读并同意/));
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    expect(screen.getByText('密码至少6位')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('两次密码不一致显示字段错误', async () => {
    renderRegister();
    await user.type(screen.getByPlaceholderText('给自己取个名字'), '新邻居');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('至少6位'), 'password123');
    await user.type(screen.getByPlaceholderText('再次输入密码'), 'different456');
    await user.click(screen.getByLabelText(/我已阅读并同意/));
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    expect(screen.getByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('昵称不足2字符显示字段错误', async () => {
    renderRegister();
    await user.type(screen.getByPlaceholderText('给自己取个名字'), 'A');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('至少6位'), 'password123');
    await user.type(screen.getByPlaceholderText('再次输入密码'), 'password123');
    await user.click(screen.getByLabelText(/我已阅读并同意/));
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    expect(screen.getByText('昵称至少2个字符')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('未勾选隐私政策显示字段错误', async () => {
    renderRegister();
    await user.type(screen.getByPlaceholderText('给自己取个名字'), '新邻居');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('至少6位'), 'password123');
    await user.type(screen.getByPlaceholderText('再次输入密码'), 'password123');
    // 故意不勾选隐私政策
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    expect(screen.getByText('请阅读并同意隐私政策')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('注册成功后写入 token、调用 setAuth、提示成功并跳转首页', async () => {
    renderRegister();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    await waitFor(() => {
      // register 入参含隐私政策版本号 v1.0（对齐 Register.tsx PRIVACY_POLICY_VERSION）
      expect(register).toHaveBeenCalledWith({
        phone: '13800000000',
        password: 'password123',
        nickname: '新邻居',
        privacyConsentVersion: 'v1.0',
      });
    });
    // setAuth 写入用户与 token
    expect(mockSetAuth).toHaveBeenCalledWith(mockUser, 'jwt-token');
    // localStorage 持久化 token
    expect(localStorage.getItem('token')).toBe('jwt-token');
    // 成功提示与跳转
    expect(mockToastSuccess).toHaveBeenCalledWith('注册成功，欢迎加入邻里圈！');
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('后端返回字段错误时映射到字段级提示', async () => {
    // 模拟 422 字段校验错误：ApiError 携带 fieldErrors（如手机号已注册）
    mockRegisterApi.mockRejectedValueOnce(
      new ApiError('手机号已注册', 422, [
        { field: 'phone', message: '该手机号已被注册' },
      ])
    );

    renderRegister();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    // 字段错误显示在手机号输入框下方，且不触发 toast
    await waitFor(() => {
      expect(screen.getByText('该手机号已被注册')).toBeInTheDocument();
    });
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('非字段错误时显示全局错误提示并 toast', async () => {
    // 模拟普通业务错误（如注册服务暂不可用）
    mockRegisterApi.mockRejectedValueOnce(new ApiError('注册服务暂不可用', 503));

    renderRegister();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    await waitFor(() => {
      expect(screen.getByText('注册服务暂不可用')).toBeInTheDocument();
    });
    expect(mockToastError).toHaveBeenCalledWith('注册服务暂不可用');
    expect(mockSetAuth).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('提交期间按钮禁用并显示注册中状态', async () => {
    // 用未决 Promise 挂起 register，使按钮停留在 loading 态便于断言
    mockRegisterApi.mockReturnValueOnce(new Promise(() => {}));

    renderRegister();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /立即注册/ }));

    // loading 态按钮显示"注册中..."且禁用
    // 设计原因：页面存在两个密码切换按钮（无 aria-label）+ 提交按钮共三个 role="button"，
    // 用 name 精确匹配提交按钮避免 getByRole 找到多个元素报错
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /注册中/ })).toBeDisabled();
    });
  });
});
