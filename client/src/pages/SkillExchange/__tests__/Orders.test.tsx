import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告
// within 用于在 role=dialog 弹窗内精确定位按钮，避免与列表同名按钮冲突
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SkillExchangeOrders from '../Orders';
import type { SkillOrder, User } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖 6 种状态 + 买卖方双向视角
const { mockOrders, mockSeller, mockBuyer } = vi.hoisted(() => ({
  // 卖方用户：覆盖 pending/accepted/in_progress 三种卖方操作场景
  // 设计原因：补全 User 接口必填字段，对齐 client/src/types/index.ts 类型定义
  mockSeller: {
    id: 'seller-1',
    phone: '13800000001',
    nickname: '卖方本人',
    creditBalance: 1000,
    timeBalance: 100,
    reputationScore: 90,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  } as User,
  // 买方用户：覆盖 pending 买方取消场景
  mockBuyer: {
    id: 'buyer-1',
    phone: '13800000002',
    nickname: '买方本人',
    creditBalance: 500,
    timeBalance: 50,
    reputationScore: 80,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  } as User,
  // 订单列表：覆盖 pending/accepted/in_progress/disputed/completed 五种状态分支
  // 设计原因：每条订单 buyerId/sellerId 与 mockSeller/mockBuyer 配对，验证 isBuyer/isSeller 视角分支
  mockOrders: [
    {
      id: 'order-pending',
      postId: 'post-1',
      post: { id: 'post-1', title: '待接受订单-卖方视角' },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方本人' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方本人' },
      creditsAmount: 100,
      status: 'pending' as const,
      createdAt: '2024-01-01T10:00:00.000Z',
    },
    {
      // accepted 状态：卖方显示"开始服务/取消/发起争议"
      id: 'order-accepted',
      postId: 'post-2',
      post: { id: 'post-2', title: '已接受订单' },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方本人' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方本人' },
      creditsAmount: 200,
      status: 'accepted' as const,
      createdAt: '2024-01-02T11:00:00.000Z',
    },
    {
      // in_progress 状态：卖方显示"完成/发起争议"
      id: 'order-in-progress',
      postId: 'post-3',
      post: { id: 'post-3', title: '进行中订单' },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方本人' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方本人' },
      creditsAmount: 300,
      status: 'in_progress' as const,
      createdAt: '2024-01-03T12:00:00.000Z',
    },
    {
      // disputed 状态：显示"查看争议"
      id: 'order-disputed',
      postId: 'post-4',
      post: { id: 'post-4', title: '争议中订单' },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方本人' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方本人' },
      creditsAmount: 400,
      status: 'disputed' as const,
      createdAt: '2024-01-04T13:00:00.000Z',
    },
    {
      // completed 状态：显示"去聊天"
      id: 'order-completed',
      postId: 'post-5',
      post: { id: 'post-5', title: '已完成订单' },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方本人' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方本人' },
      creditsAmount: 500,
      status: 'completed' as const,
      createdAt: '2024-01-05T14:00:00.000Z',
    },
  ] as SkillOrder[],
}));

// mock skills API：默认 getOrders 返回 mockOrders 分页结构，updateOrderStatus 默认成功
vi.mock('@/api/skills', () => ({
  // getOrders 返回 PaginatedResponse<SkillOrder> 结构，对齐 client/src/types/index.ts
  getOrders: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: {
      list: mockOrders,
      total: mockOrders.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  })),
  // updateOrderStatus 返回 ApiResponse<SkillOrder>，对齐 skills.ts 接口签名
  updateOrderStatus: vi.fn(async () => ({ code: 0, message: 'ok', data: mockOrders[0] })),
}));

// mock useAuth：默认返回卖方用户，单测可通过 vi.mocked(useAuth).mockReturnValue 切换为买方
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: mockSeller,
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
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// 引入被 mock 的 API 以便在用例中配置返回值
import { getOrders, updateOrderStatus } from '@/api/skills';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/api/client';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderOrdersPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SkillExchangeOrders />
    </MemoryRouter>
  );
}

// 构造分页响应：复用 mockOrders 数据避免重复构造
function buildPageResponse(orders = mockOrders) {
  return {
    code: 0,
    message: 'ok',
    data: {
      list: orders,
      total: orders.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  };
}

// 等待列表加载完成的辅助函数：第一条订单标题出现即代表渲染完成
async function waitForListLoaded(title: string = '待接受订单-卖方视角') {
  await waitFor(() => {
    expect(screen.getByText(title)).toBeInTheDocument();
  });
}

// 切换当前用户视角：卖方/买方
// 设计原因：参数类型为 User，对齐 useAuth 返回类型，避免 TS 类型不匹配
function switchCurrentUser(user: User) {
  vi.mocked(useAuth).mockReturnValue({
    user,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  });
}

describe('SkillExchange 订单列表与状态操作', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse());
    vi.mocked(updateOrderStatus).mockResolvedValue({ code: 0, message: 'ok', data: mockOrders[0]! });
    // 默认卖方视角
    switchCurrentUser(mockSeller);
    // 原 window.confirm 已替换为自定义 Modal，不再需要 mock confirm
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示订单数据（标题/买方昵称/积分/状态徽章）', async () => {
    renderOrdersPage();
    await waitForListLoaded();

    // 验证订单标题、积分、状态徽章文案均正确渲染
    expect(screen.getByText('待接受订单-卖方视角')).toBeInTheDocument();
    expect(screen.getByText('已接受订单')).toBeInTheDocument();
    expect(screen.getByText('进行中订单')).toBeInTheDocument();
    // 积分显示
    expect(screen.getByText('100')).toBeInTheDocument();
    // pending 状态文案映射为"待接受"：状态徽章 + 筛选按钮同名，用 getAllByText 避免多元素匹配异常
    expect(screen.getAllByText('待接受').length).toBeGreaterThan(0);
  });

  it('加载中显示 animate-spin 旋转动画', async () => {
    // 让 getOrders 永不 resolve，保持 loading 状态
    vi.mocked(getOrders).mockImplementation(() => new Promise(() => {}));

    renderOrdersPage();

    // 加载中应显示旋转动画 + "加载中..."文案
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('加载失败显示 toast.error 错误提示', async () => {
    // 模拟 API 抛出 ApiError
    vi.mocked(getOrders).mockRejectedValue(new ApiError('加载订单失败', 500));

    renderOrdersPage();

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('加载订单失败');
    });
  });

  it('空列表显示"暂无订单"空状态', async () => {
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse([]));

    renderOrdersPage();

    await waitFor(() => {
      expect(screen.getByText('暂无订单')).toBeInTheDocument();
    });
  });

  it('pending 状态 + 卖方视角 显示"接受/拒绝"按钮', async () => {
    // 仅保留 pending 订单，确保按钮定位清晰
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    expect(screen.getByRole('button', { name: '接受' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
  });

  it('pending 状态 + 买方视角 显示"取消"按钮', async () => {
    // 切换为买方视角
    switchCurrentUser(mockBuyer);
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    // 买方视角不应显示"接受/拒绝"按钮
    expect(screen.queryByRole('button', { name: '接受' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it('accepted 状态 显示"开始服务/取消/发起争议"按钮', async () => {
    const acceptedOrders = [mockOrders[1]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(acceptedOrders));

    renderOrdersPage();
    await waitFor(() => {
      expect(screen.getByText('已接受订单')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '开始服务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起争议' })).toBeInTheDocument();
  });

  it('in_progress 状态 显示"完成/发起争议"按钮', async () => {
    const inProgressOrders = [mockOrders[2]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(inProgressOrders));

    renderOrdersPage();
    await waitFor(() => {
      expect(screen.getByText('进行中订单')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起争议' })).toBeInTheDocument();
  });

  it('disputed 状态 显示"查看争议"按钮', async () => {
    const disputedOrders = [mockOrders[3]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(disputedOrders));

    renderOrdersPage();
    await waitFor(() => {
      expect(screen.getByText('争议中订单')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '查看争议' })).toBeInTheDocument();
  });

  it('completed 状态 显示"去聊天"按钮', async () => {
    const completedOrders = [mockOrders[4]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(completedOrders));

    renderOrdersPage();
    await waitFor(() => {
      expect(screen.getByText('已完成订单')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '去聊天' })).toBeInTheDocument();
  });

  it('点击"接受"调用 updateOrderStatus 并刷新列表', async () => {
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接受' }));
    });

    // 验证调用 updateOrderStatus 传入 orderId 与 accepted 状态
    expect(vi.mocked(updateOrderStatus)).toHaveBeenCalledWith('order-pending', 'accepted');
    // 验证 toast.success 提示
    expect(toastSuccessMock).toHaveBeenCalledWith('操作成功');
    // 验证刷新列表：getOrders 被再次调用
    expect(vi.mocked(getOrders).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('点击"取消"打开确认弹窗，确认后调用 updateOrderStatus', async () => {
    // 切换为买方视角（pending + buyer 显示"取消"按钮）
    switchCurrentUser(mockBuyer);
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    // 点击列表"取消"按钮，应弹出确认弹窗（role=dialog）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    // 在弹窗内点击"确定"按钮触发实际状态更新
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    });

    // 验证调用 updateOrderStatus 传入 cancelled 状态
    expect(vi.mocked(updateOrderStatus)).toHaveBeenCalledWith('order-pending', 'cancelled');
  });

  it('点击"拒绝"打开确认弹窗，确认后调用 updateOrderStatus', async () => {
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    });
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    });

    // 验证调用 updateOrderStatus 传入 rejected 状态
    expect(vi.mocked(updateOrderStatus)).toHaveBeenCalledWith('order-pending', 'rejected');
  });

  it('弹窗点击"取消"按钮不调用 updateOrderStatus', async () => {
    // 用户在自定义弹窗中点击"取消"按钮关闭弹窗
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    });
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    // 在弹窗内点击"取消"按钮关闭弹窗，不应触发状态更新
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    });

    // 验证未调用 updateOrderStatus
    expect(vi.mocked(updateOrderStatus)).not.toHaveBeenCalled();
  });

  it('切换状态筛选重新过滤列表显示对应订单', async () => {
    renderOrdersPage();
    await waitForListLoaded();

    // 初始显示全部订单标题
    expect(screen.getByText('待接受订单-卖方视角')).toBeInTheDocument();
    expect(screen.getByText('已完成订单')).toBeInTheDocument();

    // 点击"已完成"筛选按钮
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '已完成' }));
    });

    // 已完成订单仍显示，待接受订单标题被过滤掉
    expect(screen.getByText('已完成订单')).toBeInTheDocument();
    expect(screen.queryByText('待接受订单-卖方视角')).toBeNull();
  });

  it('操作失败显示 toast.error 错误提示', async () => {
    // 模拟 updateOrderStatus 抛出 ApiError
    vi.mocked(updateOrderStatus).mockRejectedValue(new ApiError('操作失败', 500));
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接受' }));
    });

    // 验证 toast.error 提示
    expect(toastErrorMock).toHaveBeenCalledWith('操作失败');
  });

  it('重复提交守卫：状态变更进行中按钮显示"处理中..."且禁用所有操作', async () => {
    // 不变式：updateOrderStatus 进行中时 actioningId 非空，所有操作按钮应禁用并显示加载文案
    // 设计原因：updateOrderStatus 非幂等（订单状态机严格递进），弱网下连点会跳过中间状态
    // 让 updateOrderStatus 永不 resolve，保持 actioningId 不被释放
    vi.mocked(updateOrderStatus).mockImplementation(() => new Promise(() => {}));
    const pendingOrders = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(pendingOrders));

    renderOrdersPage();
    await waitForListLoaded();

    // 点击"接受"按钮触发状态变更（不会 resolve，actioningId 保持非空）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '接受' }));
    });

    // 等待"处理中..."文案出现，证明 actioningId 守卫已激活
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '处理中...' })).toBeInTheDocument();
    });

    // "拒绝"按钮应被禁用（HTML disabled 属性）
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled();

    // 再次点击"处理中..."按钮不应触发第二次调用：验证 mock 调用次数仍为 1
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '处理中...' }));
    });
    expect(vi.mocked(updateOrderStatus).mock.calls.length).toBe(1);
  });
});
