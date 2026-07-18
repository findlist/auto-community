import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Orders from '../Orders';
import type { KitchenOrder } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖 pending/confirmed/completed/cancelled 四种状态
const { mockOrders } = vi.hoisted(() => ({
  // 订单列表：覆盖 pending/confirmed/completed/cancelled 四种状态分支
  // 设计原因：buyer/seller 均带 nickname，验证昵称回显逻辑
  mockOrders: [
    {
      // pending 状态：seller 视角显示"确认"按钮，buyer/seller 均显示"取消"
      id: 'order-pending',
      postId: 'post-1',
      post: { id: 'post-1', title: '待确认订单', images: [] },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方小张' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方老李' },
      quantity: 2,
      totalPrice: 100,
      pickupType: 'self_pickup' as const,
      status: 'pending' as const,
      createdAt: '2024-01-01T10:00:00.000Z',
    },
    {
      // confirmed 状态：buyer 视角显示"完成"按钮，buyer/seller 均显示"取消"
      id: 'order-confirmed',
      postId: 'post-2',
      post: { id: 'post-2', title: '已确认订单', images: [] },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方小张' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方老李' },
      quantity: 3,
      totalPrice: 150,
      pickupType: 'self_pickup' as const,
      status: 'confirmed' as const,
      createdAt: '2024-01-02T11:00:00.000Z',
    },
    {
      // completed 状态：无操作按钮
      id: 'order-completed',
      postId: 'post-3',
      post: { id: 'post-3', title: '已完成订单', images: [] },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方小张' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方老李' },
      quantity: 1,
      totalPrice: 50,
      pickupType: 'self_pickup' as const,
      status: 'completed' as const,
      createdAt: '2024-01-03T12:00:00.000Z',
    },
    {
      // cancelled 状态：无操作按钮
      id: 'order-cancelled',
      postId: 'post-4',
      post: { id: 'post-4', title: '已取消订单', images: [] },
      buyerId: 'buyer-1',
      buyer: { id: 'buyer-1', nickname: '买方小张' },
      sellerId: 'seller-1',
      seller: { id: 'seller-1', nickname: '卖方老李' },
      quantity: 1,
      totalPrice: 30,
      pickupType: 'self_pickup' as const,
      status: 'cancelled' as const,
      createdAt: '2024-01-04T13:00:00.000Z',
    },
  ] as KitchenOrder[],
}));

// mock kitchen API：默认 getFoodOrders 返回 mockOrders 分页结构
vi.mock('@/api/kitchen', () => ({
  // getFoodOrders 返回 PaginatedResponse<KitchenOrder> 结构，对齐 client/src/types/index.ts
  getFoodOrders: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: {
      list: mockOrders,
      total: mockOrders.length,
      page: 1,
      pageSize: 10,
      totalPages: 1,
      hasNext: false,
    },
  })),
  // confirmFoodOrder/cancelFoodOrder 返回 ApiResponse<KitchenOrder>
  confirmFoodOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: mockOrders[0] })),
  cancelFoodOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: mockOrders[0] })),
}));

// mock ReviewSubmitModal：避免依赖真实 completeFoodOrder API，简化为静态占位组件
// 设计原因：评价弹窗内部调用 completeFoodOrder，与本测试关注的订单列表逻辑解耦
vi.mock('@/pages/SharedKitchen/FoodReview', () => ({
  ReviewSubmitModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="review-modal">评价弹窗</div> : null,
}));

// mock toast：捕获 success/error 调用便于断言
const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}));
vi.mock('@/components/Toast', () => ({
  toast: {
    success: vi.fn(),
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// 引入被 mock 的 API 以便在用例中配置返回值
import { getFoodOrders, confirmFoodOrder, cancelFoodOrder } from '@/api/kitchen';
import { ApiError } from '@/api/client';

// 包装组件：注入 MemoryRouter 提供上下文（页面未使用路由 hook，但保持一致性）
function renderOrdersPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Orders />
    </MemoryRouter>
  );
}

// 构造分页响应：复用 mockOrders 数据避免重复构造
function buildPageResponse(orders = mockOrders, hasNext = false) {
  return {
    code: 0,
    message: 'ok',
    data: {
      list: orders,
      total: orders.length,
      page: 1,
      pageSize: 10,
      totalPages: hasNext ? 2 : 1,
      hasNext,
    },
  };
}

// 等待列表加载完成的辅助函数：第一条订单标题出现即代表渲染完成
async function waitForListLoaded(title: string = '待确认订单') {
  await waitFor(() => {
    expect(screen.getByText(title)).toBeInTheDocument();
  });
}

describe('SharedKitchen 订单列表与状态操作', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse());
    vi.mocked(confirmFoodOrder).mockResolvedValue({ code: 0, message: 'ok', data: mockOrders[0]! });
    vi.mocked(cancelFoodOrder).mockResolvedValue({ code: 0, message: 'ok', data: mockOrders[0]! });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示订单数据（标题/买家昵称/份数/总价/状态徽章）', async () => {
    renderOrdersPage();
    await waitForListLoaded();

    // 验证订单标题、份数、总价、状态徽章文案均正确渲染
    expect(screen.getByText('待确认订单')).toBeInTheDocument();
    expect(screen.getByText('已确认订单')).toBeInTheDocument();
    // 份数显示
    expect(screen.getByText('份数: 2')).toBeInTheDocument();
    // 总价显示（包含"积分"后缀）
    expect(screen.getByText('100积分')).toBeInTheDocument();
    // pending 状态文案映射为"待确认"：状态徽章 + 筛选按钮同名，用 getAllByText 避免多元素匹配
    expect(screen.getAllByText('待确认').length).toBeGreaterThan(0);
  });

  it('默认 buyer Tab 显示买家视角（卖家: xxx）', async () => {
    renderOrdersPage();
    await waitForListLoaded();

    // buyer 视角应显示"卖家: xxx"：4 条订单均渲染同一文本，用 getAllByText 避免多元素匹配
    expect(screen.getAllByText('卖家: 卖方老李').length).toBeGreaterThan(0);
  });

  it('加载中显示 animate-spin 旋转动画', async () => {
    // 让 getFoodOrders 永不 resolve，保持 loading 状态
    vi.mocked(getFoodOrders).mockImplementation(() => new Promise(() => {}));

    renderOrdersPage();

    // 加载中应显示旋转动画 + "加载中..."文案
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('空列表显示"暂无订单"空状态', async () => {
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([]));

    renderOrdersPage();

    await waitFor(() => {
      expect(screen.getByText('暂无订单')).toBeInTheDocument();
    });
  });

  it('切换至 seller Tab 显示卖家视角（买家: xxx）并重新加载', async () => {
    renderOrdersPage();
    await waitForListLoaded();

    // 切换到 seller Tab
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '我分享的' }));
    });

    // seller 视角应显示"买家: xxx"：4 条订单均渲染同一文本，用 getAllByText 避免多元素匹配
    await waitFor(() => {
      expect(screen.getAllByText('买家: 买方小张').length).toBeGreaterThan(0);
    });
    // 验证 getFoodOrders 被再次调用，且 role 参数为 seller
    expect(vi.mocked(getFoodOrders).mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCall = vi.mocked(getFoodOrders).mock.calls.at(-1);
    expect(lastCall?.[0]?.role).toBe('seller');
  });

  it('seller Tab + pending 状态显示"确认"按钮', async () => {
    // 切换到 seller Tab：mock 一次返回仅含 pending 订单
    vi.mocked(getFoodOrders).mockImplementation(async (params) => {
      if (params?.role === 'seller') {
        return buildPageResponse([mockOrders[0]!]);
      }
      return buildPageResponse([mockOrders[0]!]);
    });

    renderOrdersPage();
    await waitForListLoaded();

    // 切换到 seller Tab
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '我分享的' }));
    });

    // 等待 seller 视角渲染完成
    await waitFor(() => {
      expect(screen.getByText('买家: 买方小张')).toBeInTheDocument();
    });

    // seller + pending 应显示"确认"按钮
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
  });

  it('buyer Tab + confirmed 状态显示"完成"按钮', async () => {
    // mock 返回仅含 confirmed 订单
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([mockOrders[1]!]));

    renderOrdersPage();
    await waitFor(() => {
      expect(screen.getByText('已确认订单')).toBeInTheDocument();
    });

    // buyer + confirmed 应显示"完成"按钮
    expect(screen.getByRole('button', { name: '完成' })).toBeInTheDocument();
  });

  it('pending/confirmed 状态显示"取消"按钮', async () => {
    // mock 返回 pending + confirmed 两条订单
    const activeOrders = [mockOrders[0]!, mockOrders[1]!];
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse(activeOrders));

    renderOrdersPage();
    await waitForListLoaded();

    // 两条 active 订单均应显示"取消"按钮
    expect(screen.getAllByRole('button', { name: '取消' }).length).toBe(2);
  });

  it('completed/cancelled 状态不显示操作按钮', async () => {
    // mock 返回 completed + cancelled 两条订单
    const inactiveOrders = [mockOrders[2]!, mockOrders[3]!];
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse(inactiveOrders));

    renderOrdersPage();

    await waitFor(() => {
      expect(screen.getByText('已完成订单')).toBeInTheDocument();
    });

    // completed/cancelled 状态无操作按钮
    expect(screen.queryByRole('button', { name: '确认' })).toBeNull();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
  });

  it('点击"确认"触发 confirm 对话框，确认后调用 confirmFoodOrder', async () => {
    // 切换到 seller Tab，mock 返回 pending 订单
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([mockOrders[0]!]));

    renderOrdersPage();
    await waitForListLoaded();

    // 切换到 seller Tab（pending + seller 显示"确认"按钮）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '我分享的' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    // 弹窗出现后，用 within 精确定位弹窗内的"确定"按钮并点击确认
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    });

    // 验证调用 confirmFoodOrder 传入 orderId
    expect(vi.mocked(confirmFoodOrder)).toHaveBeenCalledWith('order-pending');
  });

  it('点击"取消"打开弹窗，确认后调用 cancelFoodOrder', async () => {
    // mock 返回 pending 订单（buyer 视角也显示"取消"按钮）
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([mockOrders[0]!]));

    renderOrdersPage();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    // 弹窗出现后点击"确定"
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    });

    // 验证调用 cancelFoodOrder 传入 orderId
    expect(vi.mocked(cancelFoodOrder)).toHaveBeenCalledWith('order-pending');
  });

  it('弹窗取消时不调用 confirmFoodOrder', async () => {
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([mockOrders[0]!]));

    renderOrdersPage();
    await waitForListLoaded();

    // 切换到 seller Tab
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '我分享的' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    // 弹窗出现后点击"取消"放弃操作
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    });

    // 验证未调用 confirmFoodOrder
    expect(vi.mocked(confirmFoodOrder)).not.toHaveBeenCalled();
  });

  it('切换状态筛选重新加载列表', async () => {
    renderOrdersPage();
    await waitForListLoaded();

    // 点击"已完成"筛选按钮
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '已完成' }));
    });

    // 验证 getFoodOrders 被再次调用，且 status 参数为 completed
    const lastCall = vi.mocked(getFoodOrders).mock.calls.at(-1);
    expect(lastCall?.[0]?.status).toBe('completed');
  });

  it('hasMore 为 true 时显示"加载更多"按钮，点击触发分页加载', async () => {
    // 第一次调用（挂载 useEffect 触发）返回 mockOrders 且 hasNext=true，让"加载更多"按钮出现
    vi.mocked(getFoodOrders).mockResolvedValueOnce(buildPageResponse(mockOrders, true));
    // 第二次调用（点击"加载更多"触发）返回空列表且 hasNext=false
    // 设计原因：避免第二页返回与第一页相同 id 的订单导致 React 重复 key 警告噪音
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([], false));

    renderOrdersPage();
    await waitForListLoaded();

    // 应显示"加载更多"按钮
    const loadMoreBtn = screen.getByRole('button', { name: '加载更多' });
    expect(loadMoreBtn).toBeInTheDocument();

    // 记录当前调用次数
    const callsBefore = vi.mocked(getFoodOrders).mock.calls.length;

    await act(async () => {
      fireEvent.click(loadMoreBtn);
    });

    // 验证 getFoodOrders 被再次调用（分页加载）
    expect(vi.mocked(getFoodOrders).mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('操作失败显示 toast.error 错误提示', async () => {
    // 实际运行时拦截器已将 HTTP 错误转为 ApiError，mock 需对齐该结构
    vi.mocked(confirmFoodOrder).mockRejectedValue(new ApiError('确认失败', 500));

    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([mockOrders[0]!]));

    renderOrdersPage();
    await waitForListLoaded();

    // 切换到 seller Tab
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '我分享的' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    // 弹窗出现后点击"确定"触发 confirmFoodOrder 失败
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    });

    // 验证 toast.error 提示（getErrorMessage 从 ApiError 提取后端返回的 message）
    expect(toastErrorMock).toHaveBeenCalledWith('确认失败');
  });

  it('重复提交守卫：状态变更进行中按钮显示"处理中..."且禁用所有操作', async () => {
    // 不变式：confirmFoodOrder 进行中时 actioningId 非空，所有操作按钮应禁用并显示加载文案
    // 设计原因：confirmFoodOrder/cancelFoodOrder 非幂等，弱网下连点会触发多次状态变更导致订单状态不一致
    // 让 confirmFoodOrder 永不 resolve，保持 actioningId 不被释放
    vi.mocked(confirmFoodOrder).mockImplementation(() => new Promise(() => {}));
    vi.mocked(getFoodOrders).mockResolvedValue(buildPageResponse([mockOrders[0]!]));

    renderOrdersPage();
    await waitForListLoaded();

    // 切换到 seller Tab
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '我分享的' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    });

    // 点击"确认"按钮打开弹窗
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    // 弹窗出现后点击"确定"触发 confirmFoodOrder（不会 resolve，actioningId 保持非空）
    const dialog = await screen.findByRole('dialog', { name: '操作确认' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    });

    // 等待"处理中..."文案出现，证明 actioningId 守卫已激活
    // pending + seller 视角同时渲染"确认"+"取消"两个按钮，actioningId 非空时均变为"处理中..."
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '处理中...' }).length).toBeGreaterThan(0);
    });

    // 所有"处理中..."按钮应被禁用（HTML disabled 属性）
    const processingButtons = screen.getAllByRole('button', { name: '处理中...' });
    processingButtons.forEach((btn) => expect(btn).toBeDisabled());

    // 再次点击任意"处理中..."按钮不应触发第二次调用：验证 mock 调用次数仍为 1
    await act(async () => {
      fireEvent.click(processingButtons[0]!);
    });
    expect(vi.mocked(confirmFoodOrder).mock.calls.length).toBe(1);
  });
});
