/**
 * Profile/Verify 实名认证页单元测试
 *
 * 测试目标：覆盖 4 种认证状态分支（approved/pending/rejected/未认证）、
 *           表单校验（真实姓名/身份证号）、提交流程（成功/失败/loading）、
 *           未登录跳转、加载失败兜底
 * 测试策略：mock @/api/user 的 submitVerification/getVerificationStatus、
 *           mock @/hooks/useAuth 的 isAuthenticated、mock useNavigate 捕获跳转
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Verify from '../Verify';
import { ApiError } from '@/api/client';
import type { VerificationStatus } from '@/api/user';

// vi.hoisted 提升 mock 数据避免 TDZ：vi.mock 工厂在模块加载时立即引用这些变量
const {
  mockNavigate,
  mockIsAuthenticated,
  mockGetVerificationStatus,
  mockSubmitVerification,
} = vi.hoisted(() => ({
  // useNavigate mock：捕获跳转目标（/login 未登录跳转、/profile 返回个人中心）
  mockNavigate: vi.fn(),
  // useAuth().isAuthenticated：控制未登录跳转分支
  mockIsAuthenticated: vi.fn(),
  // getVerificationStatus mock：默认返回未认证状态，单测可覆盖为 approved/pending/rejected
  mockGetVerificationStatus: vi.fn(),
  // submitVerification mock：默认返回成功，单测可覆盖为 reject
  mockSubmitVerification: vi.fn(),
}));

// mock @/hooks/useAuth：仅暴露 isAuthenticated，控制未登录跳转分支
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: mockIsAuthenticated(),
    user: null,
    token: null,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  })),
}));

// mock @/api/user：拦截 submitVerification 与 getVerificationStatus
vi.mock('@/api/user', async () => {
  const actual = await vi.importActual<typeof import('@/api/user')>('@/api/user');
  return {
    ...actual,
    submitVerification: mockSubmitVerification,
    getVerificationStatus: mockGetVerificationStatus,
  };
});

// mock useNavigate：避免依赖真实路由历史
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// 默认未认证状态：verifyStatus=null 触发申请表单分支
const notVerifiedStatus: VerificationStatus = {
  verifyStatus: null,
  submittedAt: null,
  request: null,
};

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
// future flag 消除 v7 警告，与项目其他测试保持一致
function renderVerify() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Verify />
    </MemoryRouter>
  );
}

describe('Profile/Verify 实名认证页', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认已登录 + 未认证状态 + 提交成功
    mockIsAuthenticated.mockReturnValue(true);
    mockGetVerificationStatus.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: notVerifiedStatus,
    });
    mockSubmitVerification.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { status: 'pending', message: '提交成功' },
    });
    // 默认真实 timers：userEvent 内部 async act 与 fake timers 不兼容
    vi.useRealTimers();
    user = userEvent.setup();
  });

  it('未登录时跳转 /login', async () => {
    mockIsAuthenticated.mockReturnValue(false);
    renderVerify();
    // useEffect 检测未登录立即跳转
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
    // 未登录不调用 getVerificationStatus
    expect(mockGetVerificationStatus).not.toHaveBeenCalled();
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 用未决 Promise 挂起 getVerificationStatus，让组件停留在 loading 态
    mockGetVerificationStatus.mockReturnValue(new Promise(() => {}));
    renderVerify();
    // loading 态显示旋转图标（Loader2 animate-spin）
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('加载认证状态失败显示错误提示', async () => {
    mockGetVerificationStatus.mockRejectedValue(new ApiError('网络异常', 500));
    renderVerify();
    await waitFor(() => {
      expect(screen.getByText('网络异常')).toBeInTheDocument();
    });
  });

  it('verifyStatus=approved 显示已认证通过与真实姓名', async () => {
    const approvedStatus: VerificationStatus = {
      verifyStatus: 'approved',
      submittedAt: '2024-03-15T10:00:00Z',
      request: {
        id: 'req-1',
        realName: '张三',
        status: 'approved',
        rejectReason: null,
        createdAt: '2024-03-15T10:00:00Z',
        reviewedAt: '2024-03-15T11:00:00Z',
      },
    };
    mockGetVerificationStatus.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: approvedStatus,
    });

    renderVerify();

    await waitFor(() => {
      expect(screen.getByText('实名认证已通过')).toBeInTheDocument();
    });
    // 显示真实姓名
    expect(screen.getByText(/张三/)).toBeInTheDocument();
    // 返回个人中心按钮
    expect(screen.getByRole('button', { name: '返回个人中心' })).toBeInTheDocument();
  });

  it('verifyStatus=pending 显示认证审核中', async () => {
    const pendingStatus: VerificationStatus = {
      verifyStatus: 'pending',
      submittedAt: '2024-03-15T10:00:00Z',
      request: {
        id: 'req-1',
        realName: '李四',
        status: 'pending',
        rejectReason: null,
        createdAt: '2024-03-15T10:00:00Z',
        reviewedAt: null,
      },
    };
    mockGetVerificationStatus.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: pendingStatus,
    });

    renderVerify();

    await waitFor(() => {
      expect(screen.getByText('认证审核中')).toBeInTheDocument();
    });
    // 返回个人中心按钮
    expect(screen.getByRole('button', { name: '返回个人中心' })).toBeInTheDocument();
  });

  it('verifyStatus=rejected 显示拒绝原因与重新提交表单', async () => {
    const rejectedStatus: VerificationStatus = {
      verifyStatus: 'rejected',
      submittedAt: '2024-03-15T10:00:00Z',
      request: {
        id: 'req-1',
        realName: '王五',
        status: 'rejected',
        rejectReason: '身份证号模糊不清',
        createdAt: '2024-03-15T10:00:00Z',
        reviewedAt: '2024-03-15T11:00:00Z',
      },
    };
    mockGetVerificationStatus.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: rejectedStatus,
    });

    renderVerify();

    await waitFor(() => {
      expect(screen.getByText('认证被拒绝')).toBeInTheDocument();
    });
    // 显示拒绝原因
    expect(screen.getByText(/身份证号模糊不清/)).toBeInTheDocument();
    // 重新提交表单的提交按钮文案为"重新提交认证"
    expect(screen.getByRole('button', { name: /重新提交认证/ })).toBeInTheDocument();
  });

  it('未认证状态显示申请表单与提交按钮', async () => {
    renderVerify();

    await waitFor(() => {
      expect(screen.getByText('实名认证')).toBeInTheDocument();
    });
    // 真实姓名与身份证号输入框
    expect(screen.getByPlaceholderText('请输入真实姓名（2-100字符）')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入18位身份证号')).toBeInTheDocument();
    // 提交按钮文案为"提交认证申请"
    expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
  });

  it('真实姓名为空时提交显示"请填写完整信息"', async () => {
    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });
    // 仅填身份证号，不填真实姓名
    await user.type(
      screen.getByPlaceholderText('请输入18位身份证号'),
      '110101199001011234'
    );
    await user.click(screen.getByRole('button', { name: /提交认证申请/ }));

    expect(screen.getByText('请填写完整信息')).toBeInTheDocument();
    expect(mockSubmitVerification).not.toHaveBeenCalled();
  });

  it('真实姓名不足2字符时显示长度错误', async () => {
    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });
    // 姓名仅 1 字符
    await user.type(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), '张');
    await user.type(
      screen.getByPlaceholderText('请输入18位身份证号'),
      '110101199001011234'
    );
    await user.click(screen.getByRole('button', { name: /提交认证申请/ }));

    expect(screen.getByText('真实姓名长度需在2-100字符之间')).toBeInTheDocument();
    expect(mockSubmitVerification).not.toHaveBeenCalled();
  });

  it('身份证号格式错误时显示"身份证号格式不正确"', async () => {
    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });
    await user.type(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), '张三');
    // 身份证号格式错误（位数不足）
    await user.type(screen.getByPlaceholderText('请输入18位身份证号'), '12345');
    await user.click(screen.getByRole('button', { name: /提交认证申请/ }));

    expect(screen.getByText('身份证号格式不正确')).toBeInTheDocument();
    expect(mockSubmitVerification).not.toHaveBeenCalled();
  });

  it('提交成功后调用 submitVerification 并重新加载状态', async () => {
    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), '张三');
    await user.type(
      screen.getByPlaceholderText('请输入18位身份证号'),
      '110101199001011234'
    );
    await user.click(screen.getByRole('button', { name: /提交认证申请/ }));

    // 验证 submitVerification 入参：realName 与 idCard 均已 trim
    await waitFor(() => {
      expect(mockSubmitVerification).toHaveBeenCalledWith({
        realName: '张三',
        idCard: '110101199001011234',
      });
    });
    // 提交后重新加载状态：getVerificationStatus 被调用 2 次（初次 + 提交后）
    await waitFor(() => {
      expect(mockGetVerificationStatus).toHaveBeenCalledTimes(2);
    });
  });

  it('submitVerification 失败时显示错误提示', async () => {
    mockSubmitVerification.mockRejectedValue(new ApiError('身份证号已被使用', 409));
    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), '张三');
    await user.type(
      screen.getByPlaceholderText('请输入18位身份证号'),
      '110101199001011234'
    );
    await user.click(screen.getByRole('button', { name: /提交认证申请/ }));

    await waitFor(() => {
      expect(screen.getByText('身份证号已被使用')).toBeInTheDocument();
    });
  });

  it('非 ApiError 错误兜底显示"提交失败"', async () => {
    mockSubmitVerification.mockRejectedValue(new Error('network error'));
    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), '张三');
    await user.type(
      screen.getByPlaceholderText('请输入18位身份证号'),
      '110101199001011234'
    );
    await user.click(screen.getByRole('button', { name: /提交认证申请/ }));

    await waitFor(() => {
      expect(screen.getByText('提交失败')).toBeInTheDocument();
    });
  });

  it('提交中按钮禁用并显示"提交中..."', async () => {
    // 用未决 Promise 挂起 submitVerification，使按钮停留在 loading 态
    mockSubmitVerification.mockReturnValue(new Promise(() => {}));
    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), '张三');
    await user.type(
      screen.getByPlaceholderText('请输入18位身份证号'),
      '110101199001011234'
    );
    await user.click(screen.getByRole('button', { name: /提交认证申请/ }));

    // loading 态按钮显示"提交中..."且禁用
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交中/ })).toBeDisabled();
    });
  });
});

describe('Profile/Verify 实名认证入口守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated.mockReturnValue(true);
    mockGetVerificationStatus.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: notVerifiedStatus,
    });
  });

  it('弱网连点不产生多次认证申请：入口 if 守卫阻断第二次 onClick', async () => {
    // submitVerification 永不 resolve，锁定 submitting 状态模拟弱网
    mockSubmitVerification.mockReturnValue(new Promise(() => {}));

    renderVerify();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });

    // 填写有效表单通过字段校验
    fireEvent.change(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), {
      target: { value: '张三' },
    });
    fireEvent.change(screen.getByPlaceholderText('请输入18位身份证号'), {
      target: { value: '110101199001011234' },
    });

    // 第一次点击：触发 setSubmitting(true)，按钮文案变为"提交中..."
    fireEvent.click(screen.getByRole('button', { name: /提交认证申请/ }));
    // 等待 submitting 状态生效：按钮文案变为"提交中..."
    await waitFor(() => {
      expect(screen.getByText('提交中...')).toBeInTheDocument();
    });

    // 第二次点击：fireEvent 绕过 disabled 检查直接触发 onClick
    // 入口 if (submitting) return 守卫作为第二道防线，阻断重复调用
    fireEvent.click(screen.getByText('提交中...'));

    // 不变式：submitVerification 仅被调用 1 次，第二次点击被入口守卫拦截
    expect(mockSubmitVerification).toHaveBeenCalledTimes(1);
  });
});

describe('Profile/Verify 卸载防御', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated.mockReturnValue(true);
    mockGetVerificationStatus.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: notVerifiedStatus,
    });
  });

  it('卸载后 loadStatus resolve 不触发 setState（mountedRef 防御）', async () => {
    // 用 deferred Promise 控制慢请求 resolve 时机，模拟弱网下用户切页导致组件卸载
    let resolveGetStatus!: (value: { code: number; message: string; data: VerificationStatus }) => void;
    mockGetVerificationStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveGetStatus = resolve;
      }),
    );

    // 监听 console.error，捕获 React 的 "Can't perform a state update on an unmounted component" 警告
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderVerify();

    // 等待 useEffect 触发 loadStatus，进入 await getVerificationStatus()
    await waitFor(() => {
      expect(mockGetVerificationStatus).toHaveBeenCalled();
    });

    // 卸载组件：触发 useEffect cleanup，mountedRef.current 置为 false
    unmount();

    // 此时再 resolve 慢请求，loadStatus 内 await 后的 setState 应被 mountedRef 守卫阻断
    await act(async () => {
      resolveGetStatus({
        code: 0,
        message: 'ok',
        data: notVerifiedStatus,
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
    // 用 deferred Promise 控制 submitVerification 慢请求 resolve 时机
    // 场景：用户点击提交后网络请求进行中，用户切页导致组件卸载，请求 resolve 后不应触发 setState
    let resolveSubmit!: (value: { code: number; message: string; data: { status: string; message: string } }) => void;
    mockSubmitVerification.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderVerify();

    // 等待表单渲染完成
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /提交认证申请/ })).toBeInTheDocument();
    });

    // 填写有效表单通过字段校验
    fireEvent.change(screen.getByPlaceholderText('请输入真实姓名（2-100字符）'), {
      target: { value: '张三' },
    });
    fireEvent.change(screen.getByPlaceholderText('请输入18位身份证号'), {
      target: { value: '110101199001011234' },
    });

    // 触发 handleSubmit：进入 await submitVerification
    fireEvent.click(screen.getByRole('button', { name: /提交认证申请/ }));
    await waitFor(() => {
      expect(mockSubmitVerification).toHaveBeenCalled();
    });

    // 卸载组件：触发 useEffect cleanup，mountedRef.current 置为 false
    unmount();

    // 此时再 resolve 慢请求，handleSubmit 内 await 后的 loadStatus 链式调用与 setSubmitting 应被 mountedRef 守卫阻断
    await act(async () => {
      resolveSubmit({
        code: 0,
        message: 'ok',
        data: { status: 'pending', message: '提交成功' },
      });
      // 让微任务队列推进，使 await 后的代码执行（包括 finally 块）
      await Promise.resolve();
    });

    // 不变式：handleSubmit 内 try/catch/finally 全部受 mountedRef 守卫，卸载后不触发 setState
    const reactUnmountWarnings = consoleErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('unmounted'),
    );
    expect(reactUnmountWarnings).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });
});
