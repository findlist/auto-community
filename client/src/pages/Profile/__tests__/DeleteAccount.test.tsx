import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 从根本上消除"异步 state 更新未被 act 包裹"警告，比 fireEvent + 同步 act 更可靠。
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DeleteAccountPage from '../DeleteAccount';
import { ApiError } from '@/api/client';
import type { DeletionRequestStatus } from '@/api/user';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖注销申请 5 种状态分支
const {
  mockEmptyStatus,
  mockPendingStatus,
  mockApprovedStatus,
  mockRejectedStatus,
  mockCompletedStatus,
  mockLogout,
  mockNavigate,
} = vi.hoisted(() => ({
  // 无申请：getDeletionRequestStatus 返回 null
  mockEmptyStatus: null as DeletionRequestStatus | null,
  // 审核中：含提交时间与原因
  mockPendingStatus: {
    id: 'del-1',
    userId: 'user-self',
    status: 'pending' as const,
    reason: '不再使用',
    createdAt: '2024-01-01T10:00:00.000Z',
    reviewedAt: null,
    reviewedBy: null,
    reviewerNickname: null,
    completedAt: null,
  },
  // 已通过：触发 clearAuth + 跳转 /login
  mockApprovedStatus: {
    id: 'del-2',
    userId: 'user-self',
    status: 'approved' as const,
    reason: null,
    createdAt: '2024-01-01T10:00:00.000Z',
    reviewedAt: '2024-01-02T12:00:00.000Z',
    reviewedBy: 'admin-1',
    reviewerNickname: '管理员',
    completedAt: null,
  },
  // 已拒绝：可重新申请
  mockRejectedStatus: {
    id: 'del-3',
    userId: 'user-self',
    status: 'rejected' as const,
    reason: null,
    createdAt: '2024-01-01T10:00:00.000Z',
    reviewedAt: '2024-01-02T12:00:00.000Z',
    reviewedBy: 'admin-1',
    reviewerNickname: '管理员',
    completedAt: null,
  },
  // 已完成：触发 clearAuth + 跳转 /login（最终态）
  mockCompletedStatus: {
    id: 'del-4',
    userId: 'user-self',
    status: 'completed' as const,
    reason: null,
    createdAt: '2024-01-01T10:00:00.000Z',
    reviewedAt: '2024-01-02T12:00:00.000Z',
    reviewedBy: 'admin-1',
    reviewerNickname: '管理员',
    completedAt: '2024-01-03T12:00:00.000Z',
  },
  // logout 函数：捕获调用以便断言 completed 状态会清除本地认证
  mockLogout: vi.fn(),
  // useNavigate 返回的 mock 函数：捕获跳转目标
  mockNavigate: vi.fn(),
}));

// mock @/api/user：默认无注销申请，submitDeletionRequest 默认成功
vi.mock('@/api/user', () => ({
  getDeletionRequestStatus: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: mockEmptyStatus,
  })),
  submitDeletionRequest: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { id: 'del-new', status: 'pending', message: '已提交' },
  })),
  cancelDeletionRequest: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: null,
  })),
}));

// mock useAuth：默认已登录，logout 暴露给 completed 状态用例断言
// 设计原因：User 接口字段较多且与注销流程无关，用 hoisted 工厂集中维护避免重复
const { mockUser } = vi.hoisted(() => ({
  mockUser: {
    id: 'user-self',
    phone: '13800000000',
    nickname: '当前用户',
    creditBalance: 100,
    timeBalance: 50,
    reputationScore: 4.5,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: mockLogout,
    setUser: vi.fn(),
  })),
}));

// mock useNavigate：避免依赖真实路由跳转
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import {
  getDeletionRequestStatus,
  submitDeletionRequest,
  cancelDeletionRequest,
} from '@/api/user';
import { useAuth } from '@/hooks/useAuth';

// 包装组件：注入 MemoryRouter 提供 useNavigate/useSearchParams 上下文
function renderDeleteAccount() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DeleteAccountPage />
    </MemoryRouter>
  );
}

describe('DeleteAccount 账号注销流程', () => {
  // 每个用例独立 userEvent 实例，避免事件队列串扰
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认已登录状态：复用 hoisted mockUser，保持 User 接口完整
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: mockLogout,
      setUser: vi.fn(),
    });
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockEmptyStatus,
    });
    vi.mocked(submitDeletionRequest).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { id: 'del-new', status: 'pending', message: '已提交' },
    });
    vi.mocked(cancelDeletionRequest).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: null,
    });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未登录跳转 /login', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      token: null,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });

    renderDeleteAccount();

    // useNavigate 在 useEffect 中被调用跳转 /login
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 故意延迟返回，保证 loading 状态渲染
    vi.mocked(getDeletionRequestStatus).mockImplementation(
      () => new Promise(() => {}),
    );

    renderDeleteAccount();

    // Loader2 旋转动画 class 检测
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('加载失败显示错误提示', async () => {
    vi.mocked(getDeletionRequestStatus).mockRejectedValue(
      new ApiError('加载注销状态失败', 500),
    );

    renderDeleteAccount();

    // 等待错误提示渲染
    await screen.findByText('加载注销状态失败');
    expect(screen.getByText('加载注销状态失败')).toBeInTheDocument();
  });

  it('无注销申请时显示申请表单与"提交注销申请"按钮', async () => {
    renderDeleteAccount();

    // 等待表单标题渲染
    await screen.findByText('账号注销');
    expect(screen.getByText('注销须知')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /提交注销申请/ })).toBeInTheDocument();
    // 注销原因输入框
    expect(screen.getByPlaceholderText(/请填写注销原因/)).toBeInTheDocument();
  });

  it('输入注销原因后可点击"提交注销申请"打开确认弹窗', async () => {
    renderDeleteAccount();

    await screen.findByText('账号注销');

    // 输入注销原因
    await user.type(screen.getByPlaceholderText(/请填写注销原因/), '不再使用');

    // 点击提交按钮
    await user.click(screen.getByRole('button', { name: /提交注销申请/ }));

    // 弹窗应渲染
    await screen.findByText('确认注销账号？');
    expect(screen.getByText(/此操作不可撤销/)).toBeInTheDocument();
    // 弹窗内应有取消与确认注销两个按钮
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认注销' })).toBeInTheDocument();
  });

  it('弹窗点击"取消"关闭弹窗不调用 API', async () => {
    renderDeleteAccount();

    await screen.findByText('账号注销');

    // 打开弹窗
    await user.click(screen.getByRole('button', { name: /提交注销申请/ }));
    await screen.findByText('确认注销账号？');

    // 点击取消
    await user.click(screen.getByRole('button', { name: '取消' }));

    // 弹窗应消失
    await waitFor(() => {
      expect(screen.queryByText('确认注销账号？')).toBeNull();
    });
    // 不应调用 API
    expect(submitDeletionRequest).not.toHaveBeenCalled();
  });

  it('弹窗点击"确认注销"调用 submitDeletionRequest 并切换到审核中状态', async () => {
    renderDeleteAccount();

    await screen.findByText('账号注销');

    // 打开弹窗
    await user.click(screen.getByRole('button', { name: /提交注销申请/ }));
    await screen.findByText('确认注销账号？');

    // 点击确认注销
    await user.click(screen.getByRole('button', { name: '确认注销' }));

    // 应调用 submitDeletionRequest
    await waitFor(() => {
      expect(submitDeletionRequest).toHaveBeenCalled();
    });
    // 提交后应切换到 pending 状态
    await screen.findByText('注销申请审核中');
  });

  it('提交失败显示错误提示', async () => {
    vi.mocked(submitDeletionRequest).mockRejectedValue(
      new ApiError('提交失败，请稍后重试', 500),
    );

    renderDeleteAccount();

    await screen.findByText('账号注销');

    // 打开弹窗并确认
    await user.click(screen.getByRole('button', { name: /提交注销申请/ }));
    await screen.findByText('确认注销账号？');
    await user.click(screen.getByRole('button', { name: '确认注销' }));

    // 应显示错误提示
    await screen.findByText('提交失败，请稍后重试');
  });

  it('pending 状态显示"注销申请审核中"与"取消注销申请"按钮', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockPendingStatus,
    });

    renderDeleteAccount();

    await screen.findByText('注销申请审核中');
    expect(screen.getByText('不再使用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /取消注销申请/ })).toBeInTheDocument();
  });

  it('pending 状态点击"取消注销申请"调用 cancelDeletionRequest 并切换到表单', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockPendingStatus,
    });

    renderDeleteAccount();

    await screen.findByText('注销申请审核中');

    // 点击取消注销申请
    await user.click(screen.getByRole('button', { name: /取消注销申请/ }));

    // 应调用 cancelDeletionRequest
    await waitFor(() => {
      expect(cancelDeletionRequest).toHaveBeenCalled();
    });
    // 取消后应回到表单状态
    await screen.findByText('账号注销');
  });

  it('取消注销失败显示错误提示', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockPendingStatus,
    });
    vi.mocked(cancelDeletionRequest).mockRejectedValue(
      new ApiError('取消失败，请稍后重试', 500),
    );

    renderDeleteAccount();

    await screen.findByText('注销申请审核中');

    await user.click(screen.getByRole('button', { name: /取消注销申请/ }));

    // 应显示错误提示
    await screen.findByText('取消失败，请稍后重试');
  });

  it('approved 状态显示"注销申请已通过"提示', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockApprovedStatus,
    });

    renderDeleteAccount();

    await screen.findByText('注销申请已通过');
    expect(screen.getByText(/账号数据已匿名化处理/)).toBeInTheDocument();
  });

  it('rejected 状态显示"注销申请被拒绝"与"重新申请注销"按钮', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockRejectedStatus,
    });

    renderDeleteAccount();

    await screen.findByText('注销申请被拒绝');
    expect(screen.getByText('管理员')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重新申请注销/ })).toBeInTheDocument();
  });

  it('rejected 状态点击"重新申请注销"回到申请表单', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockRejectedStatus,
    });

    renderDeleteAccount();

    await screen.findByText('注销申请被拒绝');

    await user.click(screen.getByRole('button', { name: /重新申请注销/ }));

    // 应回到表单状态
    await screen.findByText('账号注销');
    expect(screen.getByRole('button', { name: /提交注销申请/ })).toBeInTheDocument();
  });

  it('completed 状态调用 logout 清除本地状态并跳转 /login', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockCompletedStatus,
    });

    renderDeleteAccount();

    // completed 状态应触发 logout 与跳转
    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  it('点击"返回"按钮调用 navigate 跳转 /profile', async () => {
    renderDeleteAccount();

    await screen.findByText('账号注销');

    // 点击返回按钮（顶部"返回"链接）
    await user.click(screen.getByText('返回'));

    expect(mockNavigate).toHaveBeenCalledWith('/profile');
  });

  it('提交中按钮禁用并显示 Loader2', async () => {
    // 故意延迟 submitDeletionRequest 返回，保证 submitting 状态可见
    vi.mocked(submitDeletionRequest).mockImplementation(
      () => new Promise(() => {}),
    );

    renderDeleteAccount();

    await screen.findByText('账号注销');

    // 打开弹窗
    await user.click(screen.getByRole('button', { name: /提交注销申请/ }));
    await screen.findByText('确认注销账号？');

    // 点击确认注销
    await user.click(screen.getByRole('button', { name: '确认注销' }));

    // 应显示"提交中..."与禁用状态
    // 设计原因：handleSubmit 先 setShowConfirmModal(false) 关闭弹窗再 setSubmitting(true)，
    // 所以提交中状态由表单按钮文案"提交中..."反映，而非弹窗按钮"确认中..."
    await waitFor(() => {
      expect(screen.getByText('提交中...')).toBeInTheDocument();
    });
  });

  it('取消注销申请中按钮显示 Loader2 并禁用', async () => {
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockPendingStatus,
    });
    // 延迟返回保证 canceling 状态可见
    vi.mocked(cancelDeletionRequest).mockImplementation(
      () => new Promise(() => {}),
    );

    renderDeleteAccount();

    await screen.findByText('注销申请审核中');

    await user.click(screen.getByRole('button', { name: /取消注销申请/ }));

    // 应显示"取消中..."文案
    await waitFor(() => {
      expect(screen.getByText('取消中...')).toBeInTheDocument();
    });
  });
});

describe('DeleteAccount 注销申请入口守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: mockLogout,
      setUser: vi.fn(),
    });
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockEmptyStatus,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('弱网连点不产生多次注销申请：入口 if 守卫阻断第二次 onClick', async () => {
    // submitDeletionRequest 永不 resolve，锁定 submitting 状态模拟弱网
    vi.mocked(submitDeletionRequest).mockReturnValue(new Promise(() => {}));

    renderDeleteAccount();
    await screen.findByText('账号注销');

    // 点击"提交注销申请"打开弹窗
    fireEvent.click(screen.getByRole('button', { name: /提交注销申请/ }));
    // 等待弹窗渲染完成
    await waitFor(() => {
      expect(screen.getByText('确认注销账号？')).toBeInTheDocument();
    });

    // 第一次点击：触发 handleSubmit → setShowConfirmModal(false) + setSubmitting(true)
    fireEvent.click(screen.getByRole('button', { name: '确认注销' }));
    // 等待 submitting 状态生效：弹窗关闭 + 表单按钮文案变为"提交中..."
    await waitFor(() => {
      expect(screen.getByText('提交中...')).toBeInTheDocument();
    });

    // 第二次点击：fireEvent 绕过 disabled 检查直接触发 onClick
    // 入口 if (submitting) return 守卫作为第二道防线，阻断重复调用
    fireEvent.click(screen.getByText('提交中...'));

    // 不变式：submitDeletionRequest 仅被调用 1 次，第二次点击被入口守卫拦截
    expect(submitDeletionRequest).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteAccount 卸载防御', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: mockLogout,
      setUser: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('卸载后 loadStatus resolve 不触发 setState（mountedRef 防御）', async () => {
    // 用 deferred Promise 控制慢请求 resolve 时机，模拟弱网下用户切页导致组件卸载
    let resolveGetStatus!: (value: { code: number; message: string; data: DeletionRequestStatus | null }) => void;
    vi.mocked(getDeletionRequestStatus).mockReturnValue(
      new Promise((resolve) => {
        resolveGetStatus = resolve;
      }),
    );

    // 监听 console.error，捕获 React 的 "Can't perform a state update on an unmounted component" 警告
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderDeleteAccount();

    // 等待 useEffect 触发 loadStatus，进入 await getDeletionRequestStatus()
    await waitFor(() => {
      expect(getDeletionRequestStatus).toHaveBeenCalled();
    });

    // 卸载组件：触发 useEffect cleanup，mountedRef.current 置为 false
    unmount();

    // 此时再 resolve 慢请求，loadStatus 内 await 后的 setState 应被 mountedRef 守卫阻断
    await act(async () => {
      resolveGetStatus({
        code: 0,
        message: 'ok',
        data: mockEmptyStatus,
      });
      // 让微任务队列推进，使 await 后的代码执行
      await Promise.resolve();
    });

    // 不变式：mountedRef 防御下，卸载后不触发 setState，无 React 警告
    // 设计原因：React 内部对卸载后 setState 会打印 "Can't perform a state update on an unmounted component" 警告
    const reactUnmountWarnings = consoleErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('unmounted'),
    );
    expect(reactUnmountWarnings).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });

  it('卸载后 handleSubmit resolve 不触发 setState（mountedRef 防御）', async () => {
    // 场景：用户点击"确认注销"后网络请求进行中，用户切页导致组件卸载
    // 请求 resolve 后 handleSubmit 内 setStatus/setReason/setSubmitting 应被 mountedRef 守卫阻断
    let resolveSubmit!: (value: { code: number; message: string; data: { id: string; status: string; message: string } }) => void;
    vi.mocked(submitDeletionRequest).mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderDeleteAccount();

    // 等待表单渲染
    await screen.findByText('账号注销');

    // 打开确认弹窗
    fireEvent.click(screen.getByRole('button', { name: /提交注销申请/ }));
    await waitFor(() => {
      expect(screen.getByText('确认注销账号？')).toBeInTheDocument();
    });

    // 点击"确认注销"触发 handleSubmit：进入 await submitDeletionRequest
    fireEvent.click(screen.getByRole('button', { name: '确认注销' }));
    await waitFor(() => {
      expect(submitDeletionRequest).toHaveBeenCalled();
    });

    // 卸载组件：触发 useEffect cleanup，mountedRef.current 置为 false
    unmount();

    // 此时再 resolve 慢请求，handleSubmit 内 try/catch/finally 全部 setState 应被守卫阻断
    await act(async () => {
      resolveSubmit({
        code: 0,
        message: 'ok',
        data: { id: 'del-new', status: 'pending', message: '已提交' },
      });
      // 让微任务队列推进，使 await 后的代码执行（包括 finally 块）
      await Promise.resolve();
    });

    // 不变式：handleSubmit 卸载后不触发 setState
    const reactUnmountWarnings = consoleErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('unmounted'),
    );
    expect(reactUnmountWarnings).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });

  it('卸载后 handleCancel resolve 不触发 setState（mountedRef 防御）', async () => {
    // 场景：pending 状态下用户点击"取消注销申请"后网络请求进行中，用户切页导致组件卸载
    // 请求 resolve 后 handleCancel 内 setStatus/setCanceling 应被 mountedRef 守卫阻断
    let resolveCancel!: (value: { code: number; message: string; data: null }) => void;
    vi.mocked(getDeletionRequestStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockPendingStatus,
    });
    vi.mocked(cancelDeletionRequest).mockReturnValue(
      new Promise((resolve) => {
        resolveCancel = resolve;
      }),
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderDeleteAccount();

    // 等待 pending 状态渲染
    await screen.findByText('注销申请审核中');

    // 点击"取消注销申请"触发 handleCancel：进入 await cancelDeletionRequest
    fireEvent.click(screen.getByRole('button', { name: /取消注销申请/ }));
    await waitFor(() => {
      expect(cancelDeletionRequest).toHaveBeenCalled();
    });

    // 卸载组件：触发 useEffect cleanup，mountedRef.current 置为 false
    unmount();

    // 此时再 resolve 慢请求，handleCancel 内 try/catch/finally 全部 setState 应被守卫阻断
    await act(async () => {
      resolveCancel({
        code: 0,
        message: 'ok',
        data: null,
      });
      // 让微任务队列推进，使 await 后的代码执行（包括 finally 块）
      await Promise.resolve();
    });

    // 不变式：handleCancel 卸载后不触发 setState
    const reactUnmountWarnings = consoleErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('unmounted'),
    );
    expect(reactUnmountWarnings).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });
});
