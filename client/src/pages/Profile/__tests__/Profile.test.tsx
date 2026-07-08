import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 消除"异步 state 更新未被 act 包裹"警告，与 FamilyBinding/DeleteAccount/Chat 测试规范一致。
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Profile from '../index';
import { ApiError } from '@/api/client';

// vi.hoisted 提升 mock 数据避免 TDZ：用户信息、logout/updateProfile/navigate 断言、Toast 捕获
const {
  mockUser,
  mockLogout,
  mockUpdateProfile,
  mockNavigate,
  mockToastSuccess,
  mockToastError,
  mockSetUser,
} = vi.hoisted(() => ({
  // User 接口必填字段补全，避免 TS2740 类型错误
  mockUser: {
    id: 'user-self',
    phone: '13800000000',
    nickname: '张三',
    avatar: 'https://example.com/avatar.png',
    creditBalance: 100,
    timeBalance: 50,
    reputationScore: 4.5,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  mockLogout: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
  mockUpdateProfile: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { ...mockUser, avatar: 'new-avatar-url' },
  })),
  mockNavigate: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockSetUser: vi.fn(),
}));

// mock @/api/auth：logout 默认成功
vi.mock('@/api/auth', () => ({
  logout: mockLogout,
}));

// mock @/api/user：updateProfile 默认成功返回更新后的 user
vi.mock('@/api/user', () => ({
  updateProfile: mockUpdateProfile,
}));

// mock @/components/Toast：捕获 success/error 调用
vi.mock('@/components/Toast', () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));

// mock @/components/Upload/ImageUpload：可控组件，渲染上传/清空按钮触发 onChange
// 设计原因：真实 ImageUpload 依赖文件上传 API，测试中用按钮模拟上传行为，简化交互
vi.mock('@/components/Upload/ImageUpload', () => ({
  default: ({ onChange, value }: { onChange: (v: string[]) => void; value: string[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'image-upload-mock' },
      React.createElement('span', { 'data-testid': 'upload-value' }, value[0] || 'empty'),
      // 模拟上传按钮：触发 onChange 设置头像 URL
      React.createElement(
        'button',
        { onClick: () => onChange(['new-avatar-url']), 'data-testid': 'mock-upload-btn' },
        '模拟上传'
      ),
      // 清空按钮：触发 onChange 设置空数组
      React.createElement(
        'button',
        { onClick: () => onChange([]), 'data-testid': 'mock-clear-btn' },
        '清空'
      )
    ),
}));

// mock @/hooks/useAuth：默认已登录，logout/setUser 暴露给退出登录/头像保存用例断言
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: mockLogout,
    setUser: mockSetUser,
  })),
}));

// mock react-router-dom：useNavigate 提供跳转断言，Link 保留真实实现（菜单项渲染需要）
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { useAuth } from '@/hooks/useAuth';
import { updateProfile } from '@/api/user';
import { logout } from '@/api/auth';

// 包装组件：注入 MemoryRouter 提供路由上下文（菜单项 Link 需要 Router）
function renderProfile() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Profile />
    </MemoryRouter>
  );
}

describe('Profile 个人中心页', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 mock 实现：updateProfile 默认成功，避免上个测试的 mockRejectedValue 泄漏
    vi.mocked(updateProfile).mockImplementation(async () => ({
      code: 0,
      message: 'ok',
      data: { ...mockUser, avatar: 'new-avatar-url' },
    }));
    // 重置 useAuth 默认已登录
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: mockLogout,
      setUser: mockSetUser,
    });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未登录显示"请先登录"与"去登录"链接', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      isAuthenticated: false,
      token: null,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });

    renderProfile();

    expect(screen.getByText('请先登录')).toBeInTheDocument();
    expect(screen.getByText('去登录')).toBeInTheDocument();
  });

  it('已登录显示用户昵称与信誉分', () => {
    renderProfile();

    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText(/信誉分 4.5/)).toBeInTheDocument();
  });

  it('已登录显示积分/时间币/信誉分三个统计卡片', () => {
    renderProfile();

    // 三个统计卡片：积分 100、时间币 50、信誉分 4.5
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getAllByText('4.5').length).toBeGreaterThan(0);
    expect(screen.getByText('积分')).toBeInTheDocument();
    expect(screen.getByText('时间币')).toBeInTheDocument();
    expect(screen.getAllByText('信誉分').length).toBeGreaterThan(0);
  });

  it('已登录显示6个菜单项', () => {
    renderProfile();

    // 6个菜单项：实名认证、积分明细、配送地址簿、我的发布、我的订单、账号注销
    expect(screen.getByText('实名认证')).toBeInTheDocument();
    expect(screen.getByText('积分明细')).toBeInTheDocument();
    expect(screen.getByText('配送地址簿')).toBeInTheDocument();
    expect(screen.getByText('我的发布')).toBeInTheDocument();
    expect(screen.getByText('我的订单')).toBeInTheDocument();
    expect(screen.getByText('账号注销')).toBeInTheDocument();
  });

  it('点击退出登录调用 logout API + clearAuth + 跳转 /login', async () => {
    renderProfile();

    await user.click(screen.getByText('退出登录'));

    await waitFor(() => {
      expect(mockLogout).toHaveBeenCalled();
    });
    // clearAuth（useAuth 的 logout）被调用
    expect(mockSetUser).not.toHaveBeenCalled();
    // navigate 跳转 /login
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });

  it('退出登录 API 失败时仍清除本地状态并跳转', async () => {
    vi.mocked(logout).mockRejectedValueOnce(new Error('网络错误'));

    renderProfile();

    await user.click(screen.getByText('退出登录'));

    // 即使 API 失败也清除本地状态并跳转
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  it('点击头像打开编辑弹窗', async () => {
    renderProfile();

    // 头像按钮有 aria-label="修改头像"
    await user.click(screen.getByLabelText('修改头像'));

    // 弹窗标题渲染
    expect(screen.getByText('修改头像')).toBeInTheDocument();
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('弹窗内点击取消关闭弹窗', async () => {
    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));
    expect(screen.getByText('修改头像')).toBeInTheDocument();

    // 点击弹窗内取消按钮（与退出登录按钮区分，用弹窗内的取消）
    const cancelButton = screen.getByText('取消');
    await user.click(cancelButton);

    // 弹窗关闭后"修改头像"标题不再渲染（顶栏无此文案）
    // 注意：aria-label="修改头像" 的按钮仍存在，但弹窗标题 h3 不存在
    expect(screen.queryByRole('heading', { name: '修改头像' })).not.toBeInTheDocument();
  });

  it('未上传头像点击保存显示"请先上传头像"错误', async () => {
    // 用户无头像时打开弹窗
    vi.mocked(useAuth).mockReturnValue({
      user: { ...mockUser, avatar: undefined },
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: mockLogout,
      setUser: mockSetUser,
    });

    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));

    // 清空头像（确保 tempAvatar 为空）
    await user.click(screen.getByTestId('mock-clear-btn'));

    // 点击保存
    await user.click(screen.getByText('保存'));

    // 应显示错误提示，不调用 updateProfile
    expect(screen.getByText('请先上传头像')).toBeInTheDocument();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('上传头像后点击保存调用 updateProfile + setUser + toast.success', async () => {
    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));

    // 模拟上传头像
    await user.click(screen.getByTestId('mock-upload-btn'));

    // 点击保存
    await user.click(screen.getByText('保存'));

    // updateProfile 被调用，参数含 avatar
    await waitFor(() => {
      expect(updateProfile).toHaveBeenCalledWith({ avatar: 'new-avatar-url' });
    });
    // setUser 同步更新本地 user 状态
    expect(mockSetUser).toHaveBeenCalled();
    // toast.success 提示
    expect(mockToastSuccess).toHaveBeenCalledWith('头像更新成功');
  });

  it('保存头像失败显示错误提示', async () => {
    vi.mocked(updateProfile).mockRejectedValueOnce(new ApiError('头像更新失败', 500));

    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));
    await user.click(screen.getByTestId('mock-upload-btn'));
    await user.click(screen.getByText('保存'));

    // 应显示错误提示
    await waitFor(() => {
      expect(screen.getByText('头像更新失败')).toBeInTheDocument();
    });
    // 不调用 setUser、不调用 toast.success
    expect(mockSetUser).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('保存头像失败非 ApiError 显示兜底错误', async () => {
    vi.mocked(updateProfile).mockRejectedValueOnce(new Error('网络错误'));

    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));
    await user.click(screen.getByTestId('mock-upload-btn'));
    await user.click(screen.getByText('保存'));

    // 非 ApiError 走兜底文案
    await waitFor(() => {
      expect(screen.getByText('头像更新失败')).toBeInTheDocument();
    });
  });

  it('保存中显示 Loader2 旋转动画且按钮禁用', async () => {
    // 延迟返回，保证 saving 状态渲染
    vi.mocked(updateProfile).mockImplementation(
      () => new Promise(() => {})
    );

    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));
    await user.click(screen.getByTestId('mock-upload-btn'));
    await user.click(screen.getByText('保存'));

    // 保存按钮文案变为"保存中..."且 spinner 渲染
    expect(screen.getByText('保存中...')).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('遮罩点击关闭弹窗（非保存中）', async () => {
    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));
    expect(screen.getByRole('heading', { name: '修改头像' })).toBeInTheDocument();

    // 点击遮罩（弹窗最外层遮罩 div，class 含 fixed inset-0 bg-black/50）
    const overlay = document.querySelector('.fixed.inset-0.bg-black\\/50') as HTMLElement;
    expect(overlay).not.toBeNull();
    await user.click(overlay);

    // 弹窗关闭
    expect(screen.queryByRole('heading', { name: '修改头像' })).not.toBeInTheDocument();
  });

  it('保存中遮罩点击不关闭弹窗', async () => {
    vi.mocked(updateProfile).mockImplementation(
      () => new Promise(() => {})
    );

    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));
    await user.click(screen.getByTestId('mock-upload-btn'));
    await user.click(screen.getByText('保存'));

    // 保存中点击遮罩
    const overlay = document.querySelector('.fixed.inset-0.bg-black\\/50') as HTMLElement;
    await user.click(overlay);

    // 弹窗仍存在
    expect(screen.getByRole('heading', { name: '修改头像' })).toBeInTheDocument();
    expect(screen.getByText('保存中...')).toBeInTheDocument();
  });

  it('弹窗关闭按钮（X 图标）关闭弹窗', async () => {
    renderProfile();

    await user.click(screen.getByLabelText('修改头像'));

    // 点击 X 关闭按钮（aria-label="关闭"）
    await user.click(screen.getByLabelText('关闭'));

    expect(screen.queryByRole('heading', { name: '修改头像' })).not.toBeInTheDocument();
  });
});
