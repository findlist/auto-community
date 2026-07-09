import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 消除"异步 state 更新未被 act 包裹"警告，比 fireEvent + 同步 act 更可靠
// 但 fake timers 下 userEvent 会卡死（vitest 4 兼容问题），需 fake timers 的用例改用 fireEvent
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from '../ForgotPassword';
import { ApiError } from '@/api/client';

// vi.hoisted 提升 mock 数据避免 TDZ：simpleResetPassword 与 navigate 需在 mock 工厂中引用
const {
  mockSimpleResetPassword,
  mockNavigate,
} = vi.hoisted(() => ({
  // simpleResetPassword API mock：默认返回成功响应，单测可覆盖为 reject
  mockSimpleResetPassword: vi.fn(),
  // useNavigate 返回的 mock 函数：捕获跳转目标（成功后 2 秒跳转 /login）
  mockNavigate: vi.fn(),
}));

// mock @/api/auth：simpleResetPassword 默认返回成功响应，单测可覆盖为 reject
// 设计原因：ForgotPassword 仅引入 simpleResetPassword，无需 mock 其他 auth API
vi.mock('@/api/auth', () => ({
  simpleResetPassword: mockSimpleResetPassword,
}));

// mock useNavigate：避免依赖真实路由跳转
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { simpleResetPassword } from '@/api/auth';

// 包装组件：注入 MemoryRouter 提供 useNavigate/Link 上下文
function renderForgotPassword() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

describe('Auth/ForgotPassword 忘记密码页（简化版无验证码）', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 设计原因：默认真实 timers，与 Login/Register 模式一致，避免 userEvent 在 fake timers 下卡死；
    // 仅"2秒跳转"用例在用例内部单独启用 fake timers 推进定时器
    vi.useRealTimers();
    // 默认重置成功响应：simpleResetPassword 返回 ApiResponse<null>
    mockSimpleResetPassword.mockResolvedValue({ code: 0, message: 'ok', data: null });
    user = userEvent.setup();
  });

  afterEach(() => {
    // 清理成功用例遗留的 pending setTimeout(navigate, 2000)，防止跨用例污染
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // 辅助函数：用 userEvent 填写完整有效表单（手机号/新密码/确认密码）
  // 设计原因：单字段校验用例只需让目标字段无效，其余字段保持有效，避免多重错误干扰断言
  async function fillValidForm() {
    await user.type(screen.getByPlaceholderText('请输入注册手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入新密码（至少6位）'), 'password123');
    await user.type(screen.getByPlaceholderText('请再次输入新密码'), 'password123');
  }

  it('渲染标题、副标题、表单字段与跳转链接', () => {
    renderForgotPassword();
    // 设计原因：h1 标题与提交按钮文本均为"重置密码"，用 heading 角色精确匹配标题
    expect(screen.getByRole('heading', { name: '重置密码' })).toBeInTheDocument();
    expect(screen.getByText('输入注册手机号和新密码即可重置')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入注册手机号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入新密码（至少6位）')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请再次输入新密码')).toBeInTheDocument();
    // 提交按钮 + 返回登录链接（底部带 ArrowLeft 图标）
    expect(screen.getByRole('button', { name: '重置密码' })).toBeInTheDocument();
    expect(screen.getByText('返回登录')).toBeInTheDocument();
  });

  it('手机号格式错误显示字段错误且不提交', async () => {
    renderForgotPassword();
    await user.type(screen.getByPlaceholderText('请输入注册手机号'), '12345');
    await user.type(screen.getByPlaceholderText('请输入新密码（至少6位）'), 'password123');
    await user.type(screen.getByPlaceholderText('请再次输入新密码'), 'password123');
    await user.click(screen.getByRole('button', { name: '重置密码' }));

    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument();
    expect(simpleResetPassword).not.toHaveBeenCalled();
  });

  it('密码不足6位显示字段错误且不提交', async () => {
    renderForgotPassword();
    await user.type(screen.getByPlaceholderText('请输入注册手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入新密码（至少6位）'), '12345');
    await user.type(screen.getByPlaceholderText('请再次输入新密码'), '12345');
    await user.click(screen.getByRole('button', { name: '重置密码' }));

    expect(screen.getByText('密码至少6位')).toBeInTheDocument();
    expect(simpleResetPassword).not.toHaveBeenCalled();
  });

  it('两次密码不一致显示字段错误', async () => {
    renderForgotPassword();
    await user.type(screen.getByPlaceholderText('请输入注册手机号'), '13800000000');
    await user.type(screen.getByPlaceholderText('请输入新密码（至少6位）'), 'password123');
    await user.type(screen.getByPlaceholderText('请再次输入新密码'), 'different456');
    await user.click(screen.getByRole('button', { name: '重置密码' }));

    expect(screen.getByText('两次密码不一致')).toBeInTheDocument();
    expect(simpleResetPassword).not.toHaveBeenCalled();
  });

  it('重置成功显示成功页"密码重置成功"', async () => {
    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: '重置密码' }));

    // simpleResetPassword 被调用，入参含 phone 与 password
    await waitFor(() => {
      expect(simpleResetPassword).toHaveBeenCalledWith({ phone: '13800000000', password: 'password123' });
    });
    // 成功页渲染：标题"密码重置成功" + 提示文案 + 立即登录链接
    expect(screen.getByText('密码重置成功')).toBeInTheDocument();
    expect(screen.getByText(/即将跳转到登录页面/)).toBeInTheDocument();
  });

  it('重置成功2秒后跳转到登录页', async () => {
    // 设计原因：该用例需推进 2 秒定时器验证 navigate('/login')，单独启用 fake timers；
    // fake timers 下 userEvent.type 会卡死（vitest 4 兼容问题），改用 fireEvent 同步填表
    vi.useFakeTimers();
    renderForgotPassword();
    fireEvent.change(screen.getByPlaceholderText('请输入注册手机号'), { target: { value: '13800000000' } });
    fireEvent.change(screen.getByPlaceholderText('请输入新密码（至少6位）'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByPlaceholderText('请再次输入新密码'), { target: { value: 'password123' } });

    // 提交后 simpleResetPassword resolve 触发 setSuccess(true)，act 刷新微任务确保成功页渲染
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重置密码' }));
    });
    expect(screen.getByText('密码重置成功')).toBeInTheDocument();

    // 推进 2 秒触发 setTimeout 回调，验证跳转
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('ApiError 失败显示错误消息', async () => {
    mockSimpleResetPassword.mockRejectedValueOnce(new ApiError('该手机号未注册', 404));

    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: '重置密码' }));

    // 错误消息显示在表单底部，且不渲染成功页
    await waitFor(() => {
      expect(screen.getByText('该手机号未注册')).toBeInTheDocument();
    });
    expect(screen.queryByText('密码重置成功')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('非 ApiError 失败显示兜底文案"重置密码失败"', async () => {
    mockSimpleResetPassword.mockRejectedValueOnce(new Error('随机错误'));

    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: '重置密码' }));

    await waitFor(() => {
      expect(screen.getByText('重置密码失败')).toBeInTheDocument();
    });
  });

  it('提交期间按钮禁用并显示"重置中..."', async () => {
    // 用未决 Promise 挂起 simpleResetPassword，使按钮停留在 loading 态便于断言
    mockSimpleResetPassword.mockReturnValueOnce(new Promise(() => {}));

    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: '重置密码' }));

    // loading 态按钮显示"重置中..."且禁用
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /重置中/ })).toBeDisabled();
    });
  });
});
