import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 从根本上消除"异步 state 更新未被 act 包裹"警告，相比 fireEvent + 同步 act 更可靠。
// fireEvent 仅触发单一 DOM 事件，userEvent 模拟真实用户交互序列（focus/mousedown/click 等）。
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FamilyBindingPage from '../FamilyBinding';
import type { FamilyBinding } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：mock 当前用户与三类绑定数据
const { mockUser, mockBindings } = vi.hoisted(() => ({
  // 当前用户：作为 parentId 出现在 incoming 绑定中，作为 userId 出现在 outgoing 绑定中
  mockUser: { id: 'user-self', nickname: '当前用户' },
  // 三类绑定：confirmed（解绑场景）、pending（确认/拒绝场景）、unbound（已解绑场景）
  mockBindings: [
    {
      id: 'bind-confirmed-1',
      userId: 'user-self',
      parentId: 'user-parent-1',
      relationship: 'father',
      status: 'confirmed' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      other: { id: 'user-parent-1', nickname: '父亲大人', avatar: undefined },
    },
    {
      id: 'bind-pending-incoming-1',
      // 对方绑我为家长：isParent 为 true，应显示确认/拒绝按钮
      userId: 'user-other-2',
      parentId: 'user-self',
      relationship: 'mother',
      status: 'pending' as const,
      createdAt: '2024-01-03T00:00:00.000Z',
      updatedAt: '2024-01-03T00:00:00.000Z',
      other: { id: 'user-other-2', nickname: '母亲大人', avatar: undefined },
    },
    {
      id: 'bind-unbound-1',
      userId: 'user-self',
      parentId: 'user-parent-3',
      relationship: 'spouse',
      status: 'unbound' as const,
      createdAt: '2024-01-04T00:00:00.000Z',
      updatedAt: '2024-01-05T00:00:00.000Z',
      other: { id: 'user-parent-3', nickname: '前任配偶', avatar: undefined },
    },
  ] as FamilyBinding[],
}));

// mock timeBank API：默认 getFamilyBindings 返回 mockBindings，unbindFamilyBinding 默认成功
vi.mock('@/api/timeBank', () => ({
  getFamilyBindings: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: mockBindings,
  })),
  // 测试数据确定存在第 0 项，使用非空断言避免 TS 严格模式下 undefined 报错
  createFamilyBinding: vi.fn(async () => ({ code: 0, message: 'ok', data: mockBindings[0]! })),
  confirmFamilyBinding: vi.fn(async () => ({ code: 0, message: 'ok', data: mockBindings[0]! })),
  rejectFamilyBinding: vi.fn(async () => ({ code: 0, message: 'ok', data: mockBindings[0]! })),
  unbindFamilyBinding: vi.fn(async () => ({ code: 0, message: 'ok', data: mockBindings[0]! })),
}));

// mock useAuth：默认返回已认证用户
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  })),
}));

// mock toast：捕获 success/error 调用便于断言
const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('@/components/Toast', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// 引入被 mock 的 API 以便在用例中配置返回值
import {
  getFamilyBindings,
  unbindFamilyBinding,
} from '@/api/timeBank';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderFamilyBinding() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <FamilyBindingPage />
    </MemoryRouter>
  );
}

describe('FamilyBinding 解绑流程', () => {
  // userEvent 实例：每个用例独立创建，避免事件队列串扰
  // 设计原因：userEvent.setup() 返回的 user 实例维护内部状态（如当前焦点元素），
  // 跨用例复用会导致状态污染，每个 beforeEach 重建保证隔离
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    // 每个用例前重置 mock 调用记录与默认返回值
    vi.clearAllMocks();
    vi.mocked(getFamilyBindings).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockBindings,
    });
    // 使用非空断言：测试数据确定存在第 0 项，避免 TS 严格模式下 undefined 报错
    vi.mocked(unbindFamilyBinding).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockBindings[0]!,
    });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirmed 状态显示"解除绑定"按钮', async () => {
    renderFamilyBinding();

    // findByText 等待列表加载完成，自动包裹 act 消除异步 state 更新警告
    await screen.findByText('父亲大人');

    // confirmed 绑定应显示"解除绑定"按钮
    expect(screen.getByRole('button', { name: /解除绑定/ })).toBeInTheDocument();
  });

  it('点击"解除绑定"打开确认弹窗', async () => {
    renderFamilyBinding();

    await screen.findByText('父亲大人');

    // 初始无弹窗
    expect(screen.queryByText('确认解除绑定')).toBeNull();

    // 点击解除绑定按钮：userEvent 自动包裹 async act，等待所有微任务 flush
    await user.click(screen.getByRole('button', { name: /解除绑定/ }));

    // findByText 等待弹窗渲染完成
    await screen.findByText('确认解除绑定');
    expect(screen.getByText(/此操作不可撤销/)).toBeInTheDocument();
    // 弹窗内应有两个按钮：取消、确认解绑
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认解绑' })).toBeInTheDocument();
  });

  it('弹窗中点击"确认解绑"调用 unbindFamilyBinding 并显示成功提示', async () => {
    renderFamilyBinding();

    await screen.findByText('父亲大人');

    // 打开弹窗
    await user.click(screen.getByRole('button', { name: /解除绑定/ }));
    await screen.findByText('确认解除绑定');

    // 点击确认解绑：userEvent 自动等待 click handler 完成
    // 设计原因：handleUnbindConfirm 是 async 函数，userEvent.click 只等待同步部分，
    // 异步 Promise resolve 后的 state 更新由下方 waitFor 等待
    await user.click(screen.getByRole('button', { name: '确认解绑' }));

    // 应调用 unbindFamilyBinding，参数为 bind-confirmed-1
    await waitFor(() => {
      expect(unbindFamilyBinding).toHaveBeenCalledWith('bind-confirmed-1');
    });

    // 应显示成功提示（waitFor 等待异步 resolve 后的 toast 调用）
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('已解除绑定');
    });

    // 应调用 getFamilyBindings 刷新列表（初始加载 + 解绑后刷新 = 至少2次）
    await waitFor(() => {
      expect(vi.mocked(getFamilyBindings).mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // 弹窗应关闭
    await waitFor(() => {
      expect(screen.queryByText('确认解除绑定')).toBeNull();
    });
  });

  it('弹窗中点击"取消"关闭弹窗，不调用 unbindFamilyBinding', async () => {
    renderFamilyBinding();

    await screen.findByText('父亲大人');

    // 打开弹窗
    await user.click(screen.getByRole('button', { name: /解除绑定/ }));
    await screen.findByText('确认解除绑定');

    // 点击取消：userEvent 自动包裹 act，等待所有 state 更新 flush
    await user.click(screen.getByRole('button', { name: '取消' }));

    // 弹窗应关闭
    expect(screen.queryByText('确认解除绑定')).toBeNull();

    // 不应调用 unbindFamilyBinding
    expect(unbindFamilyBinding).not.toHaveBeenCalled();
  });

  it('解绑失败显示 toast.error 错误提示', async () => {
    // mock unbindFamilyBinding 抛错
    vi.mocked(unbindFamilyBinding).mockRejectedValue(new Error('网络异常，解绑失败'));

    renderFamilyBinding();

    await screen.findByText('父亲大人');

    // 打开弹窗：userEvent 自动等待弹窗渲染
    await user.click(screen.getByRole('button', { name: /解除绑定/ }));
    // 等待弹窗内"确认解绑"按钮挂载完成
    await screen.findByRole('button', { name: '确认解绑' });
    await user.click(screen.getByRole('button', { name: '确认解绑' }));

    // 应显示错误提示（findByText 等待异步 reject 后的 toast 渲染）
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('网络异常，解绑失败');
    });
  });

  it('unbound 状态显示"已解绑"标签，无解除绑定按钮', async () => {
    renderFamilyBinding();

    await screen.findByText('前任配偶');

    // unbound 状态标签应显示"已解绑"
    // 注意：getByText 会匹配所有包含"已解绑"的元素，需用精确匹配
    const unboundBadge = screen.getAllByText('已解绑');
    expect(unboundBadge.length).toBeGreaterThan(0);

    // unbound 状态不应有解除绑定按钮（仅 confirmed 才有）
    // 由于已有一个 confirmed 绑定会渲染解除绑定按钮，此处验证 unbound 卡片本身不渲染该按钮
    // 通过查询所有解除绑定按钮的数量来间接验证（应为1，仅来自 confirmed 绑定）
    const unbindButtons = screen.getAllByRole('button', { name: /解除绑定/ });
    expect(unbindButtons.length).toBe(1);
  });

  it('解绑请求中弹窗按钮显示"解绑中..."且禁用', async () => {
    // 让 unbindFamilyBinding 永不 resolve，保持 loading 状态
    vi.mocked(unbindFamilyBinding).mockImplementation(() => new Promise(() => {}));

    renderFamilyBinding();

    await screen.findByText('父亲大人');

    // 打开弹窗
    await user.click(screen.getByRole('button', { name: /解除绑定/ }));
    await screen.findByRole('button', { name: '确认解绑' });

    // 点击确认解绑：userEvent.click 只等待同步部分，不阻塞于永不 resolve 的 Promise
    await user.click(screen.getByRole('button', { name: '确认解绑' }));

    // 按钮文案应变为"解绑中..."且禁用（findByText 等待异步 state 更新）
    await screen.findByText('解绑中...');
    // 取消按钮也应禁用（避免解绑中关闭弹窗）
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });
});

describe('FamilyBinding 状态展示与操作', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFamilyBindings).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockBindings,
    });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pending + isParent 状态显示"确认/拒绝"按钮', async () => {
    renderFamilyBinding();

    await screen.findByText('母亲大人');

    // pending + isParent 应显示"确认"和"拒绝"按钮
    // 注：用精确字符串匹配，避免与"待我确认"Tab按钮的"确认"二字混淆
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
  });

  it('列表为空显示空状态', async () => {
    vi.mocked(getFamilyBindings).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: [],
    });

    renderFamilyBinding();

    // findByText 等待空状态出现，自动包裹 act
    await screen.findByText('暂无绑定记录');
    // 引导文案也应出现
    expect(screen.getByText('发起亲情绑定后，可与家人共享时间账户')).toBeInTheDocument();
  });

  it('加载失败显示错误状态与重新加载按钮', async () => {
    vi.mocked(getFamilyBindings).mockRejectedValue(new Error('服务不可用'));

    renderFamilyBinding();

    // findByText 等待错误状态出现，自动包裹 act
    await screen.findByText('加载失败');
    // 错误详情应可见
    expect(screen.getByText('服务不可用')).toBeInTheDocument();
    // 重新加载按钮应可见
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });

  it('点击"全部/已绑定"Tab 切换筛选', async () => {
    renderFamilyBinding();

    await screen.findByText('父亲大人');

    // 默认"全部"Tab：应能看到所有3条绑定的对方昵称
    expect(screen.getByText('父亲大人')).toBeInTheDocument();
    expect(screen.getByText('母亲大人')).toBeInTheDocument();
    expect(screen.getByText('前任配偶')).toBeInTheDocument();

    // 点击"已绑定"Tab：仅 confirmed 状态的绑定可见
    await user.click(screen.getByRole('button', { name: /已绑定/ }));
    // findByText 等待 Tab 切换后的列表渲染完成
    await screen.findByText('父亲大人');
    // pending 与 unbound 绑定应被过滤掉
    expect(screen.queryByText('母亲大人')).toBeNull();
    expect(screen.queryByText('前任配偶')).toBeNull();
  });
});
