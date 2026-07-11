import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 消除"异步 state 更新未被 act 包裹"警告，比 fireEvent + 同步 act 更可靠
// 但 fake timers 下 userEvent 会卡死（vitest 4 兼容问题），需 fake timers 的用例改用 fireEvent
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ForgotPasswordPage from '../ForgotPassword';
import { ApiError } from '@/api/client';

// vi.hoisted 提升 mock 数据避免 TDZ：forgotPassword 与 navigate 需在 mock 工厂中引用
const {
  mockForgotPassword,
  mockNavigate,
} = vi.hoisted(() => ({
  // forgotPassword API mock：默认返回成功响应，单测可覆盖为 reject
  mockForgotPassword: vi.fn(),
  // useNavigate 返回的 mock 函数：捕获跳转目标（成功后 2 秒跳转 /reset-password?phone=xxx）
  mockNavigate: vi.fn(),
}));

// mock @/api/auth：forgotPassword 默认返回成功响应，单测可覆盖为 reject
// 设计原因：ForgotPassword 仅引入 forgotPassword，无需 mock 其他 auth API
vi.mock('@/api/auth', () => ({
  forgotPassword: mockForgotPassword,
}));

// mock useNavigate：避免依赖真实路由跳转
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { forgotPassword } from '@/api/auth';

// 包装组件：注入 MemoryRouter 提供 useNavigate/Link 上下文
function renderForgotPassword() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ForgotPasswordPage />
    </MemoryRouter>
  );
}

describe('Auth/ForgotPassword 忘记密码页（发送验证码）', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 设计原因：默认真实 timers，与 Login/Register 模式一致，避免 userEvent 在 fake timers 下卡死；
    // 仅"2秒跳转"用例在用例内部单独启用 fake timers 推进定时器
    vi.useRealTimers();
    // 默认重置成功响应：forgotPassword 返回 ApiResponse<null>
    mockForgotPassword.mockResolvedValue({ code: 0, message: 'ok', data: null });
    user = userEvent.setup();
  });

  afterEach(() => {
    // 清理成功用例遗留的 pending setTimeout(navigate, 2000)，防止跨用例污染
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // 辅助函数：用 userEvent 填写完整有效表单（仅手机号字段）
  async function fillValidForm() {
    await user.type(screen.getByPlaceholderText('请输入注册手机号'), '13800000000');
  }

  it('渲染标题、副标题、表单字段与跳转链接', () => {
    renderForgotPassword();
    // 设计原因：h1 标题"忘记密码"与提交按钮"发送验证码"文本不同，可直接用 getByRole 精确匹配
    expect(screen.getByRole('heading', { name: '忘记密码' })).toBeInTheDocument();
    expect(screen.getByText('输入注册手机号获取验证码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入注册手机号')).toBeInTheDocument();
    // 提交按钮 + 返回登录链接（底部带 ArrowLeft 图标）
    expect(screen.getByRole('button', { name: /发送验证码/ })).toBeInTheDocument();
    expect(screen.getByText('返回登录')).toBeInTheDocument();
  });

  it('手机号格式错误显示字段错误且不提交', async () => {
    renderForgotPassword();
    await user.type(screen.getByPlaceholderText('请输入注册手机号'), '12345');
    await user.click(screen.getByRole('button', { name: /发送验证码/ }));

    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument();
    expect(forgotPassword).not.toHaveBeenCalled();
  });

  it('发送成功显示成功页"验证码已发送"', async () => {
    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /发送验证码/ }));

    // forgotPassword 被调用，入参为 { phone }
    await waitFor(() => {
      expect(forgotPassword).toHaveBeenCalledWith({ phone: '13800000000' });
    });
    // 成功页渲染：标题"验证码已发送" + 手机号回显 + 跳转链接
    expect(screen.getByText('验证码已发送')).toBeInTheDocument();
    expect(screen.getByText(/验证码已发送至 13800000000/)).toBeInTheDocument();
  });

  it('发送成功2秒后带 phone 参数跳转到重置密码页', async () => {
    // 设计原因：该用例需推进 2 秒定时器验证 navigate('/reset-password?phone=xxx')，单独启用 fake timers；
    // fake timers 下 userEvent.type 会卡死（vitest 4 兼容问题），改用 fireEvent 同步填表
    vi.useFakeTimers();
    renderForgotPassword();
    fireEvent.change(screen.getByPlaceholderText('请输入注册手机号'), { target: { value: '13800000000' } });

    // 提交后 forgotPassword resolve 触发 setSuccess(true)，act 刷新微任务确保成功页渲染
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /发送验证码/ }));
    });
    expect(screen.getByText('验证码已发送')).toBeInTheDocument();

    // 推进 2 秒触发 setTimeout 回调，验证带 phone 查询参数跳转
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/reset-password?phone=13800000000');
  });

  it('ApiError 失败显示错误消息', async () => {
    mockForgotPassword.mockRejectedValueOnce(new ApiError('该手机号未注册', 404));

    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /发送验证码/ }));

    // 错误消息显示在表单底部，且不渲染成功页
    await waitFor(() => {
      expect(screen.getByText('该手机号未注册')).toBeInTheDocument();
    });
    expect(screen.queryByText('验证码已发送')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('非 ApiError 失败显示兜底文案"验证码发送失败"', async () => {
    mockForgotPassword.mockRejectedValueOnce(new Error('随机错误'));

    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /发送验证码/ }));

    await waitFor(() => {
      expect(screen.getByText('验证码发送失败')).toBeInTheDocument();
    });
  });

  it('提交期间按钮禁用并显示"发送中..."', async () => {
    // 用未决 Promise 挂起 forgotPassword，使按钮停留在 loading 态便于断言
    mockForgotPassword.mockReturnValueOnce(new Promise(() => {}));

    renderForgotPassword();
    await fillValidForm();
    await user.click(screen.getByRole('button', { name: /发送验证码/ }));

    // loading 态按钮显示"发送中..."且禁用
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /发送中/ })).toBeDisabled();
    });
  });
});
