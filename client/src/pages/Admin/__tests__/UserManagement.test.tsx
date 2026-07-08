import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserManagement from '../UserManagement';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖 active/banned × user/admin 四种组合
// 设计原因：每种组合触发不同的操作按钮（封禁/解封 + 设为管理员/取消管理员），便于精确验证按钮可见性
const { mockUsers } = vi.hoisted(() => ({
  mockUsers: [
    {
      // active + user：触发"封禁"+"设为管理员"按钮
      id: 'user-1',
      phone: '13800000001',
      nickname: '张三',
      role: 'user',
      status: 'active',
      reputationScore: 90,
      creditBalance: 100,
      createdAt: '2024-01-01T10:00:00.000Z',
    },
    {
      // banned + admin：触发"解封"+"取消管理员"按钮
      id: 'user-2',
      phone: '13800000002',
      nickname: '李四',
      role: 'admin',
      status: 'banned',
      reputationScore: 60,
      creditBalance: 50,
      createdAt: '2024-01-02T11:00:00.000Z',
    },
    {
      // active + admin：触发"封禁"+"取消管理员"按钮
      id: 'user-3',
      phone: '13800000003',
      nickname: '王五',
      role: 'admin',
      status: 'active',
      reputationScore: 95,
      creditBalance: 200,
      createdAt: '2024-01-03T12:00:00.000Z',
    },
  ],
}));

// mock admin API：getUsers 返回分页结构，banUser/unbanUser 默认成功
vi.mock('@/api/admin', () => ({
  getUsers: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: {
      list: mockUsers,
      total: mockUsers.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  })),
  banUser: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
  unbanUser: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
  updateUserRole: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
  batchBanUsers: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { successfulIds: ['user-1'], skippedAdminIds: [], skippedSelfId: [], failedIds: [] },
  })),
  batchUnbanUsers: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { successfulIds: ['user-2'], failedIds: [] },
  })),
}));

// mock Toast：避免依赖真实 DOM 容器，简化为静态函数
vi.mock('@/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// mock ExportButton：避免依赖真实 exportData API 调用
vi.mock('@/components/ExportButton', () => ({
  default: () => <button type="button">导出CSV</button>,
}));

import { getUsers, banUser, unbanUser } from '@/api/admin';
import { ApiError } from '@/api/client';

// 包装组件：UserManagement 无路由参数依赖，MemoryRouter 提供上下文
function renderUserManagement() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <UserManagement />
    </MemoryRouter>
  );
}

// 构造分页响应：复用 mockUsers 数据避免重复构造
function buildPageResponse(users = mockUsers) {
  return {
    code: 0,
    message: 'ok',
    data: {
      list: users,
      total: users.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  };
}

// 等待列表加载完成：第一个用户昵称出现即代表渲染完成
// 设计原因：桌面表格 + 移动卡片双布局渲染同一份数据，用 getAllByText 避免多元素匹配异常
async function waitForListLoaded() {
  await waitFor(() => {
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
  });
}

describe('UserManagement 封禁/解封弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse());
    vi.mocked(banUser).mockResolvedValue({ code: 0, message: 'ok', data: null });
    vi.mocked(unbanUser).mockResolvedValue({ code: 0, message: 'ok', data: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示用户数据（昵称/手机号/角色/状态）', async () => {
    renderUserManagement();
    await waitForListLoaded();

    // 验证昵称、手机号、角色文案、状态文案均正确渲染
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
    expect(screen.getAllByText('13800000001').length).toBeGreaterThan(0);
    // 普通用户角色文案
    expect(screen.getAllByText('普通用户').length).toBeGreaterThan(0);
    // 管理员角色文案
    expect(screen.getAllByText('管理员').length).toBeGreaterThan(0);
    // 正常状态文案
    expect(screen.getAllByText('正常').length).toBeGreaterThan(0);
    // 已封禁状态文案
    expect(screen.getAllByText('已封禁').length).toBeGreaterThan(0);
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 让 getUsers 永不 resolve，保持 loading 状态
    vi.mocked(getUsers).mockImplementation(() => new Promise(() => {}));

    renderUserManagement();

    await waitFor(() => {
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  it('加载失败显示错误提示', async () => {
    vi.mocked(getUsers).mockRejectedValue(new ApiError('网络错误', 500));

    renderUserManagement();

    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
  });

  it('空列表显示"暂无数据"', async () => {
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse([]));

    renderUserManagement();

    await waitFor(() => {
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
    });
  });

  it('active 状态用户显示"封禁"按钮', async () => {
    // 仅保留 active 状态用户，避免 banned 用户的"解封"按钮干扰
    const activeUsers = mockUsers.filter(u => u.status === 'active');
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(activeUsers));

    renderUserManagement();
    await waitForListLoaded();

    // 桌面+移动双布局渲染多个"封禁"按钮
    expect(screen.getAllByRole('button', { name: '封禁' }).length).toBeGreaterThan(0);
    // 不应出现"解封"按钮
    expect(screen.queryAllByRole('button', { name: '解封' })).toHaveLength(0);
  });

  it('banned 状态用户显示"解封"按钮', async () => {
    // 仅保留 banned 状态用户
    const bannedUsers = mockUsers.filter(u => u.status === 'banned');
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(bannedUsers));

    renderUserManagement();

    await waitFor(() => {
      expect(screen.getAllByText('李四').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByRole('button', { name: '解封' }).length).toBeGreaterThan(0);
    // 不应出现"封禁"按钮
    expect(screen.queryAllByRole('button', { name: '封禁' })).toHaveLength(0);
  });

  it('普通用户显示"设为管理员"按钮', async () => {
    // 仅保留 user 角色
    const normalUsers = mockUsers.filter(u => u.role === 'user');
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(normalUsers));

    renderUserManagement();
    await waitForListLoaded();

    expect(screen.getAllByRole('button', { name: '设为管理员' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: '取消管理员' })).toHaveLength(0);
  });

  it('admin 角色显示"取消管理员"按钮', async () => {
    // 仅保留 admin 角色
    const adminUsers = mockUsers.filter(u => u.role === 'admin');
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(adminUsers));

    renderUserManagement();

    await waitFor(() => {
      expect(screen.getAllByText('李四').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByRole('button', { name: '取消管理员' }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: '设为管理员' })).toHaveLength(0);
  });

  it('点击"封禁"打开弹窗，显示用户昵称', async () => {
    // 仅保留一条 active 用户，简化按钮定位
    const singleUser = [mockUsers[0]!];
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(singleUser));

    renderUserManagement();
    await waitForListLoaded();

    // 初始无弹窗：用 heading 角色精确匹配弹窗标题，避免与按钮文本同名导致多元素匹配
    expect(screen.queryByRole('heading', { name: '确认封禁' })).toBeNull();

    // 桌面+移动双布局有多个"封禁"按钮，取第一个点击
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '封禁' })[0]!);
    });

    // 弹窗标题与用户昵称应出现
    expect(screen.getByRole('heading', { name: '确认封禁' })).toBeInTheDocument();
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
  });

  it('点击"确认封禁"调用 banUser 并刷新列表', async () => {
    const singleUser = [mockUsers[0]!];
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(singleUser));

    renderUserManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '封禁' })[0]!);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认封禁' }));
    });

    // 验证 banUser 被调用，参数为用户 ID
    await waitFor(() => {
      expect(banUser).toHaveBeenCalledWith('user-1');
    });

    // 封禁成功后应重新加载列表（getUsers 调用次数 ≥2：初始加载 + 操作后刷新）
    await waitFor(() => {
      expect(vi.mocked(getUsers).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('点击"取消"按钮关闭弹窗，不调用 banUser', async () => {
    const singleUser = [mockUsers[0]!];
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(singleUser));

    renderUserManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '封禁' })[0]!);
    });

    // 弹窗应已出现：用 heading 角色精确匹配弹窗标题
    expect(screen.getByRole('heading', { name: '确认封禁' })).toBeInTheDocument();

    // 点击弹窗内"取消"按钮
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    // 弹窗应关闭
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '确认封禁' })).toBeNull();
    });

    // banUser 不应被调用
    expect(banUser).not.toHaveBeenCalled();
  });

  it('封禁失败显示错误提示', async () => {
    const singleUser = [mockUsers[0]!];
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(singleUser));
    // 模拟封禁失败
    vi.mocked(banUser).mockRejectedValue(new ApiError('无法封禁管理员', 400));

    renderUserManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '封禁' })[0]!);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认封禁' }));
    });

    // 错误提示应显示
    await waitFor(() => {
      expect(screen.getByText('无法封禁管理员')).toBeInTheDocument();
    });
  });

  it('解封流程：点击"解禁"调用 unbanUser 并刷新列表', async () => {
    // 仅保留一条 banned 用户
    const bannedUser = [mockUsers[1]!];
    vi.mocked(getUsers).mockResolvedValue(buildPageResponse(bannedUser));

    renderUserManagement();

    await waitFor(() => {
      expect(screen.getAllByText('李四').length).toBeGreaterThan(0);
    });

    // 点击"解封"按钮打开弹窗
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '解封' })[0]!);
    });

    expect(screen.getByRole('heading', { name: '确认解封' })).toBeInTheDocument();

    // 点击"确认解封"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认解封' }));
    });

    await waitFor(() => {
      expect(unbanUser).toHaveBeenCalledWith('user-2');
    });

    await waitFor(() => {
      expect(vi.mocked(getUsers).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('搜索框输入并回车触发查询', async () => {
    renderUserManagement();
    await waitForListLoaded();

    // 初始加载一次
    expect(vi.mocked(getUsers).mock.calls.length).toBe(1);

    // 在搜索框输入文本并按下回车
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('按手机号/昵称搜索'), {
        target: { value: '张三' },
      });
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText('按手机号/昵称搜索'), {
        key: 'Enter',
      });
    });

    // 应触发第二次加载，search 参数为 '张三'
    await waitFor(() => {
      expect(getUsers).toHaveBeenLastCalledWith(1, 20, '张三');
    });
  });
});
