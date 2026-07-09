import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹交互，自动等待微任务 flush，
// 消除"异步 state 更新未被 act 包裹"警告，模拟真实用户点击序列
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MyOrders from '../MyOrders';
import type { TimeOrder, User } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：mock 当前用户与五状态订单
const { mockProvider, mockRequester, mockOrders } = vi.hoisted(() => {
  // 服务提供方：作为 providerId 出现在订单中
  const provider: User = {
    id: 'user-provider',
    phone: '13800000001',
    nickname: '提供方老王',
    creditBalance: 100,
    timeBalance: 50,
    reputationScore: 4.8,
    role: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
  // 服务需求方：作为 requesterId 出现在订单中
  const requester: User = {
    id: 'user-requester',
    phone: '13800000002',
    nickname: '需求方小李',
    creditBalance: 80,
    timeBalance: 30,
    reputationScore: 4.5,
    role: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
  // 五状态订单：覆盖 pending/accepted/in_progress/completed/cancelled 全状态分支
  const orders: TimeOrder[] = [
    {
      id: 'order-pending-1',
      serviceId: 'svc-1',
      service: { id: 'svc-1', userId: 'user-provider', type: 'provide', title: '陪老人聊天服务', durationMinutes: 60, creditCost: 1, status: 'active', createdAt: '2024-01-01T00:00:00.000Z' } as unknown as TimeOrder['service'],
      providerId: 'user-provider',
      requesterId: 'user-requester',
      durationMinutes: 60,
      status: 'pending',
      createdAt: '2024-01-10T10:00:00.000Z',
    },
    {
      id: 'order-accepted-1',
      serviceId: 'svc-2',
      service: { id: 'svc-2', userId: 'user-provider', type: 'provide', title: '代购跑腿服务', durationMinutes: 30, creditCost: 0.5, status: 'active', createdAt: '2024-01-01T00:00:00.000Z' } as unknown as TimeOrder['service'],
      providerId: 'user-provider',
      requesterId: 'user-requester',
      durationMinutes: 30,
      status: 'accepted',
      createdAt: '2024-01-11T10:00:00.000Z',
    },
    {
      id: 'order-in-progress-1',
      serviceId: 'svc-3',
      service: { id: 'svc-3', userId: 'user-provider', type: 'provide', title: '家电维修服务', durationMinutes: 90, creditCost: 1.5, status: 'active', createdAt: '2024-01-01T00:00:00.000Z' } as unknown as TimeOrder['service'],
      providerId: 'user-provider',
      requesterId: 'user-requester',
      durationMinutes: 90,
      status: 'in_progress',
      startedAt: '2024-01-12T09:00:00.000Z',
      createdAt: '2024-01-12T08:00:00.000Z',
    },
    {
      id: 'order-completed-1',
      serviceId: 'svc-4',
      service: { id: 'svc-4', userId: 'user-provider', type: 'provide', title: '宠物寄养服务', durationMinutes: 120, creditCost: 2, status: 'active', createdAt: '2024-01-01T00:00:00.000Z' } as unknown as TimeOrder['service'],
      providerId: 'user-provider',
      requesterId: 'user-requester',
      durationMinutes: 120,
      status: 'completed',
      startedAt: '2024-01-13T09:00:00.000Z',
      completedAt: '2024-01-13T11:00:00.000Z',
      createdAt: '2024-01-13T08:00:00.000Z',
    },
    {
      id: 'order-cancelled-1',
      serviceId: 'svc-5',
      service: { id: 'svc-5', userId: 'user-provider', type: 'provide', title: '家务清洁服务', durationMinutes: 45, creditCost: 0.75, status: 'active', createdAt: '2024-01-01T00:00:00.000Z' } as unknown as TimeOrder['service'],
      providerId: 'user-provider',
      requesterId: 'user-requester',
      durationMinutes: 45,
      status: 'cancelled',
      cancelledAt: '2024-01-14T10:00:00.000Z',
      createdAt: '2024-01-14T09:00:00.000Z',
    },
  ];
  return { mockProvider: provider, mockRequester: requester, mockOrders: orders };
});

// mock timeBank API：getOrders 默认返回 mockOrders，updateOrderStatus/createReview 默认成功
vi.mock('@/api/timeBank', () => ({
  // 注：组件代码 const { list, hasNext } = res.data，hasNext 字段需在 mock 中提供
  getOrders: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { list: mockOrders, total: mockOrders.length, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
  })),
  updateOrderStatus: vi.fn(async () => ({ code: 0, message: 'ok', data: mockOrders[0]! })),
  createReview: vi.fn(async () => ({ code: 0, message: 'ok', data: { id: 'review-1', orderId: 'order-completed-1', rating: 5, content: '好评', createdAt: '2024-01-15T00:00:00.000Z' } })),
}));

// mock useAuth：默认返回 provider 视角
const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: useAuthMock,
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

// mock useNavigate：返回稳定引用（真实 useNavigate 在组件生命周期内引用不变）
// 若每次渲染返回新 vi.fn()，会导致将 navigate 纳入 useEffect 依赖的组件无限重渲染
const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// 引入被 mock 的 API 以便在用例中配置返回值
import { getOrders, updateOrderStatus, createReview } from '@/api/timeBank';
import { ApiError } from '@/api/client';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderMyOrders() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <MyOrders />
    </MemoryRouter>
  );
}

// 切换当前用户视角：provider 视角看接受/开始服务按钮，requester 视角看完成服务/评价按钮
function switchUser(user: User) {
  useAuthMock.mockReturnValue({
    user,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  });
}

describe('TimeBank/MyOrders 订单列表', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 provider 视角
    switchUser(mockProvider);
    vi.mocked(getOrders).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { list: mockOrders, total: mockOrders.length, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
    });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示订单数据（服务标题/状态徽章）', async () => {
    renderMyOrders();

    // findByText 等待列表加载完成，自动包裹 act
    await screen.findByText('陪老人聊天服务');
    // 五状态订单标题均应可见
    expect(screen.getByText('代购跑腿服务')).toBeInTheDocument();
    expect(screen.getByText('家电维修服务')).toBeInTheDocument();
    expect(screen.getByText('宠物寄养服务')).toBeInTheDocument();
    expect(screen.getByText('家务清洁服务')).toBeInTheDocument();
    // 状态徽章：用 getAllByText 应对多个相同状态
    expect(screen.getAllByText('待接受').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已接受').length).toBeGreaterThan(0);
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0);
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 让 getOrders 永不 resolve，保持 loading 状态
    vi.mocked(getOrders).mockImplementation(() => new Promise(() => {}));

    renderMyOrders();

    // 加载中应显示"加载中..."文案
    expect(await screen.findByText('加载中...')).toBeInTheDocument();
  });

  it('加载失败显示错误提示与重试按钮', async () => {
    // mock getOrders 抛 ApiError，验证错误消息提取
    vi.mocked(getOrders).mockRejectedValue(new ApiError('服务不可用', 500));

    renderMyOrders();

    // findByText 等待错误状态出现
    await screen.findByText('服务不可用');
    // 重试按钮应可见
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('加载失败显示通用错误提示（非 ApiError 场景）', async () => {
    // mock getOrders 抛普通 Error，验证兜底文案
    vi.mocked(getOrders).mockRejectedValue(new Error('网络断开'));

    renderMyOrders();

    // 应显示兜底文案"加载订单失败"，而非 Error.message
    await screen.findByText('加载订单失败');
  });

  it('空列表显示"暂无订单"空状态', async () => {
    vi.mocked(getOrders).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
    });

    renderMyOrders();

    await screen.findByText('暂无订单');
  });

  it('pending + provider 视角显示"接受/取消"按钮', async () => {
    renderMyOrders();

    await screen.findByText('陪老人聊天服务');
    // provider 视角 + pending 状态应显示"接受"和"取消"按钮
    // 设计原因：用精确字符串 '接受' 而非正则 /接受/，避免匹配状态筛选 Tab 的"待接受"
    expect(screen.getByRole('button', { name: '接受' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '取消' }).length).toBeGreaterThan(0);
  });

  it('accepted + provider 视角显示"开始服务"按钮', async () => {
    renderMyOrders();

    await screen.findByText('代购跑腿服务');
    // provider 视角 + accepted 状态应显示"开始服务"按钮
    expect(screen.getByRole('button', { name: '开始服务' })).toBeInTheDocument();
  });

  it('in_progress + requester 视角显示"完成服务"按钮', async () => {
    // 切换到 requester 视角
    switchUser(mockRequester);

    renderMyOrders();

    await screen.findByText('家电维修服务');
    // requester 视角 + in_progress 状态应显示"完成服务"按钮
    expect(screen.getByRole('button', { name: '完成服务' })).toBeInTheDocument();
  });

  it('completed + requester 视角显示"评价"按钮', async () => {
    // 切换到 requester 视角
    switchUser(mockRequester);

    renderMyOrders();

    await screen.findByText('宠物寄养服务');
    // requester 视角 + completed 状态应显示"评价"按钮
    expect(screen.getByRole('button', { name: '评价' })).toBeInTheDocument();
  });

  it('cancelled 状态无操作按钮', async () => {
    renderMyOrders();

    await screen.findByText('家务清洁服务');
    // cancelled 状态卡片内不应有"接受/开始服务/完成服务/评价"按钮
    // 注：其他状态的卡片会渲染按钮，此处仅验证 cancelled 卡片本身无操作
    // 设计原因：button.textContent 含 SVG 图标的换行符，用 includes 模糊匹配更稳健
    // 预期总数：pending 1接受 + accepted 1开始服务 + in_progress 1完成服务 + completed 1评价 = 4个
    const allButtons = screen.getAllByRole('button');
    const actionButtons = allButtons.filter(btn => {
      const text = btn.textContent || '';
      return text.includes('接受') || text.includes('开始服务') ||
             text.includes('完成服务') || text.includes('评价');
    });
    expect(actionButtons.length).toBe(4);
  });

  it('点击"接受"调用 updateOrderStatus 并显示成功提示', async () => {
    renderMyOrders();

    await screen.findByText('陪老人聊天服务');

    // 点击"接受"按钮：精确匹配避免与状态筛选 Tab"待接受"冲突
    await user.click(screen.getByRole('button', { name: '接受' }));

    // 应调用 updateOrderStatus，参数为 (orderId, 'accepted')
    await waitFor(() => {
      expect(updateOrderStatus).toHaveBeenCalledWith('order-pending-1', 'accepted');
    });
    // 应显示成功提示
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('操作成功');
    });
  });

  it('点击"开始服务"调用 updateOrderStatus', async () => {
    renderMyOrders();

    await screen.findByText('代购跑腿服务');

    await user.click(screen.getByRole('button', { name: '开始服务' }));

    await waitFor(() => {
      expect(updateOrderStatus).toHaveBeenCalledWith('order-accepted-1', 'in_progress');
    });
  });

  it('点击"完成服务"调用 updateOrderStatus', async () => {
    switchUser(mockRequester);

    renderMyOrders();

    await screen.findByText('家电维修服务');

    await user.click(screen.getByRole('button', { name: '完成服务' }));

    await waitFor(() => {
      expect(updateOrderStatus).toHaveBeenCalledWith('order-in-progress-1', 'completed');
    });
  });

  it('点击"取消"调用 updateOrderStatus', async () => {
    renderMyOrders();

    await screen.findByText('陪老人聊天服务');

    // 点击 pending 订单的"取消"按钮：精确匹配 '取消' 避免与状态筛选 Tab"已取消"冲突
    // pending + accepted 状态都有取消按钮，取第一个（pending 的）
    const cancelButtons = screen.getAllByRole('button', { name: '取消' });
    await user.click(cancelButtons[0]!);

    await waitFor(() => {
      expect(updateOrderStatus).toHaveBeenCalledWith('order-pending-1', 'cancelled');
    });
  });

  it('操作失败显示 toast.error 错误提示', async () => {
    vi.mocked(updateOrderStatus).mockRejectedValue(new ApiError('权限不足', 403));

    renderMyOrders();

    await screen.findByText('陪老人聊天服务');

    await user.click(screen.getByRole('button', { name: '接受' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('权限不足');
    });
  });

  it('点击"评价"打开评价表单', async () => {
    switchUser(mockRequester);

    renderMyOrders();

    await screen.findByText('宠物寄养服务');

    // 初始无评价表单
    expect(screen.queryByPlaceholderText('写下您的评价...')).toBeNull();

    // 点击"评价"按钮
    await user.click(screen.getByRole('button', { name: '评价' }));

    // 评价表单应出现：星级按钮 + 文本框 + 提交按钮
    expect(screen.getByPlaceholderText('写下您的评价...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交评价' })).toBeInTheDocument();
  });

  it('评价表单点击"提交评价"调用 createReview', async () => {
    switchUser(mockRequester);

    renderMyOrders();

    await screen.findByText('宠物寄养服务');
    await user.click(screen.getByRole('button', { name: '评价' }));

    // 点击"提交评价"（默认 5 星 + 空内容，createReview 会传 undefined）
    await user.click(screen.getByRole('button', { name: '提交评价' }));

    await waitFor(() => {
      expect(createReview).toHaveBeenCalledWith('order-completed-1', 5, undefined);
    });
    // 应显示成功提示
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('评价提交成功');
    });
  });

  it('评价表单点击"取消"关闭表单不调用 createReview', async () => {
    switchUser(mockRequester);

    renderMyOrders();

    await screen.findByText('宠物寄养服务');
    await user.click(screen.getByRole('button', { name: '评价' }));

    // 评价表单的"取消"按钮：用 DOM 查询定位，避免与卡片中的"取消"按钮冲突
    // 设计原因：评价表单的取消按钮是"提交评价"按钮的兄弟节点，且是最后一个 button
    const submitBtn = screen.getByRole('button', { name: '提交评价' });
    const reviewCancelBtn = submitBtn.parentElement?.querySelector('button:last-child');
    expect(reviewCancelBtn).toBeTruthy();
    await user.click(reviewCancelBtn!);

    // 评价表单应关闭
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('写下您的评价...')).toBeNull();
    });
    // 不应调用 createReview
    expect(createReview).not.toHaveBeenCalled();
  });

  it('切换状态筛选 Tab 重新过滤列表', async () => {
    renderMyOrders();

    await screen.findByText('陪老人聊天服务');

    // 默认"全部"Tab：应能看到所有5条订单标题
    expect(screen.getByText('代购跑腿服务')).toBeInTheDocument();
    expect(screen.getByText('家电维修服务')).toBeInTheDocument();

    // 点击"待接受"Tab：仅 pending 状态订单可见
    await user.click(screen.getByRole('button', { name: '待接受' }));

    // 其他状态订单应被过滤掉
    await waitFor(() => {
      expect(screen.queryByText('代购跑腿服务')).toBeNull();
      expect(screen.queryByText('家电维修服务')).toBeNull();
    });
    // pending 订单仍可见
    expect(screen.getByText('陪老人聊天服务')).toBeInTheDocument();
  });

  it('点击"加载更多"触发分页加载', async () => {
    // 第一次返回5条 + hasNext=true，第二次返回2条 + hasNext=false
    const firstPageOrders = mockOrders.slice(0, 5);
    const secondPageOrders: TimeOrder[] = [
      {
        id: 'order-page2-1',
        serviceId: 'svc-p2-1',
        service: { id: 'svc-p2-1', userId: 'user-provider', type: 'provide', title: '第二页订单1', durationMinutes: 30, creditCost: 0.5, status: 'active', createdAt: '2024-01-01T00:00:00.000Z' } as unknown as TimeOrder['service'],
        providerId: 'user-provider',
        requesterId: 'user-requester',
        durationMinutes: 30,
        status: 'pending',
        createdAt: '2024-01-16T10:00:00.000Z',
      },
    ];
    vi.mocked(getOrders)
      .mockResolvedValueOnce({
        code: 0, message: 'ok',
        data: { list: firstPageOrders, total: 6, page: 1, pageSize: 20, totalPages: 2, hasNext: true },
      })
      .mockResolvedValueOnce({
        code: 0, message: 'ok',
        data: { list: secondPageOrders, total: 6, page: 2, pageSize: 20, totalPages: 2, hasNext: false },
      });

    renderMyOrders();

    // 等待第一页加载
    await screen.findByText('陪老人聊天服务');
    // "加载更多"按钮应可见
    const loadMoreBtn = await screen.findByRole('button', { name: '加载更多' });
    await user.click(loadMoreBtn);

    // 第二页订单应出现
    await waitFor(() => {
      expect(screen.getByText('第二页订单1')).toBeInTheDocument();
    });
    // getOrders 应被调用2次
    expect(vi.mocked(getOrders)).toHaveBeenCalledTimes(2);
  });
});
