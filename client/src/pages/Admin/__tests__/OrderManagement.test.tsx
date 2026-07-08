import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrderManagement from '../OrderManagement';

// vi.hoisted 提升 mock 数据避免 TDZ：mock 三类订单数据覆盖关键状态分支
const { mockOrders } = vi.hoisted(() => ({
  // 订单列表：覆盖 pending/in_progress/completed/cancelled 四种状态，验证"强制取消"按钮可见性
  // 买方/卖方均带 nickname，验证昵称回显逻辑
  // 设计原因：订单 id 长度 ≤12 避免被截断为 "..."，确保弹窗内 getByText 精确匹配
  // buyerId/sellerId 为 AdminOrderItem 接口必填字段，对齐 client/src/api/admin.ts 类型定义
  mockOrders: [
    {
      id: 'order-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      buyer: { nickname: '买家张三' },
      seller: { nickname: '卖家李四' },
      creditsAmount: 100,
      status: 'pending',
      createdAt: '2024-01-01T10:00:00.000Z',
    },
    {
      id: 'order-2',
      buyerId: 'buyer-2',
      sellerId: 'seller-2',
      buyer: { nickname: '买家王五' },
      seller: { nickname: '卖家赵六' },
      creditsAmount: 200,
      status: 'in_progress',
      createdAt: '2024-01-02T11:00:00.000Z',
    },
    {
      // completed 状态：不应显示"强制取消"按钮
      id: 'order-3',
      buyerId: 'buyer-3',
      sellerId: 'seller-3',
      buyer: { nickname: '买家孙七' },
      seller: { nickname: '卖家周八' },
      creditsAmount: 300,
      status: 'completed',
      createdAt: '2024-01-03T12:00:00.000Z',
    },
    {
      // cancelled 状态：不应显示"强制取消"按钮
      id: 'order-4',
      buyerId: 'buyer-4',
      sellerId: 'seller-4',
      buyer: { nickname: '买家吴九' },
      seller: { nickname: '卖家郑十' },
      creditsAmount: 400,
      status: 'cancelled',
      createdAt: '2024-01-04T13:00:00.000Z',
    },
  ],
}));

// mock admin API：默认 getOrders 返回 mockOrders 分页结构，forceCancelOrder 默认成功
vi.mock('@/api/admin', () => ({
  // getOrders 返回 PaginatedResponse<AdminOrderItem> 结构，对齐 client/src/types/index.ts
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
  // forceCancelOrder 返回 ApiResponse<null>，对齐 admin.ts 接口签名
  forceCancelOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
}));

// mock ExportButton：避免依赖真实 exportData API 调用，简化为静态按钮
vi.mock('@/components/ExportButton', () => ({
  default: () => <button type="button">导出CSV</button>,
}));

// 引入被 mock 的 API 以便在用例中配置返回值
import { getOrders, forceCancelOrder } from '@/api/admin';
import { ApiError } from '@/api/client';

// 包装组件：OrderManagement 无路由参数依赖，MemoryRouter 即可提供上下文
function renderOrderManagement() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <OrderManagement />
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

// 等待列表加载完成的辅助函数：第一个买方昵称出现即代表渲染完成
// 设计原因：桌面表格 + 移动卡片双布局渲染同一份数据，用 getAllByText 避免多元素匹配异常
async function waitForListLoaded() {
  await waitFor(() => {
    expect(screen.getAllByText('买家张三').length).toBeGreaterThan(0);
  });
}

describe('OrderManagement 强制取消订单弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse());
    vi.mocked(forceCancelOrder).mockResolvedValue({ code: 0, message: 'ok', data: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示订单数据（买方/卖方昵称/金额/状态）', async () => {
    renderOrderManagement();
    await waitForListLoaded();

    // 验证买方/卖方昵称、金额、状态文案均正确渲染（桌面+移动双布局，用 getAllByText）
    expect(screen.getAllByText('买家张三').length).toBeGreaterThan(0);
    expect(screen.getAllByText('卖家李四').length).toBeGreaterThan(0);
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    // pending 状态文案映射为"待处理"
    expect(screen.getAllByText('待处理').length).toBeGreaterThan(0);
  });

  it('completed 与 cancelled 状态不显示"强制取消"按钮', async () => {
    // 仅保留 completed 与 cancelled 状态订单，确保无可点击的"强制取消"按钮
    const inactiveOrders = mockOrders.filter(o => o.status === 'completed' || o.status === 'cancelled');
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(inactiveOrders));

    renderOrderManagement();

    // 等待列表加载完成（completed 订单买方昵称出现即代表渲染完成）
    await waitFor(() => {
      expect(screen.getAllByText('买家孙七').length).toBeGreaterThan(0);
    });

    // completed 与 cancelled 状态行操作列应为"-"，无"强制取消"按钮
    expect(screen.queryAllByRole('button', { name: '强制取消' })).toHaveLength(0);
  });

  it('pending/in_progress 状态显示"强制取消"按钮', async () => {
    // 仅保留 pending 与 in_progress 两条订单，确保按钮可见性判定清晰
    const activeOrders = mockOrders.filter(o => o.status === 'pending' || o.status === 'in_progress');
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(activeOrders));

    renderOrderManagement();
    await waitForListLoaded();

    // 两条 active 订单均应显示"强制取消"按钮（桌面+移动双布局共 4 个按钮）
    expect(screen.getAllByRole('button', { name: '强制取消' }).length).toBeGreaterThan(0);
  });

  it('点击"强制取消"打开弹窗，显示订单 ID', async () => {
    // 仅保留一条 pending 订单，简化按钮定位
    const singleOrder = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(singleOrder));

    renderOrderManagement();
    await waitForListLoaded();

    // 初始无弹窗
    expect(screen.queryByText('强制取消订单')).toBeNull();

    // 桌面+移动双布局有多个"强制取消"按钮，取第一个点击
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '强制取消' })[0]!);
    });

    // 弹窗应出现，标题为"强制取消订单"，且显示订单 ID
    expect(screen.getByText('强制取消订单')).toBeInTheDocument();
    // 订单 ID 在桌面表格 td + 移动卡片 div + 弹窗 span 三处出现，用 getAllByText 避免多元素匹配异常
    expect(screen.getAllByText('order-1').length).toBeGreaterThan(0);
  });

  it('取消原因为空时"确认取消"按钮禁用', async () => {
    const singleOrder = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(singleOrder));

    renderOrderManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '强制取消' })[0]!);
    });

    // 弹窗中"确认取消"按钮应处于禁用状态（cancelReason 为空）
    const confirmBtn = screen.getByRole('button', { name: '确认取消' });
    expect(confirmBtn).toBeDisabled();
  });

  it('输入取消原因后"确认取消"按钮启用', async () => {
    const singleOrder = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(singleOrder));

    renderOrderManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '强制取消' })[0]!);
    });

    // 输入取消原因
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('请输入取消原因'), {
        target: { value: '违规操作' },
      });
    });

    // 按钮应启用
    expect(screen.getByRole('button', { name: '确认取消' })).not.toBeDisabled();
  });

  it('点击"确认取消"调用 forceCancelOrder 并刷新列表', async () => {
    const singleOrder = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(singleOrder));

    renderOrderManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '强制取消' })[0]!);
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('请输入取消原因'), {
        target: { value: '违规操作' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认取消' }));
    });

    // 验证 forceCancelOrder 被调用，参数：type=skill, id=order-1, reason=违规操作
    await waitFor(() => {
      expect(forceCancelOrder).toHaveBeenCalledWith('skill', 'order-1', '违规操作');
    });

    // 取消成功后应重新加载列表（getOrders 调用次数 ≥2：初始加载 + 取消后刷新）
    await waitFor(() => {
      expect(vi.mocked(getOrders).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('点击"取消"按钮关闭弹窗，不调用 forceCancelOrder', async () => {
    const singleOrder = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(singleOrder));

    renderOrderManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '强制取消' })[0]!);
    });

    // 弹窗应已出现
    expect(screen.getByText('强制取消订单')).toBeInTheDocument();

    // 点击弹窗内"取消"按钮（弹窗内仅一个 name='取消' 的按钮）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    // 弹窗应关闭
    await waitFor(() => {
      expect(screen.queryByText('强制取消订单')).toBeNull();
    });

    // forceCancelOrder 不应被调用
    expect(forceCancelOrder).not.toHaveBeenCalled();
  });

  it('取消失败显示错误提示', async () => {
    const singleOrder = [mockOrders[0]!];
    vi.mocked(getOrders).mockResolvedValue(buildPageResponse(singleOrder));
    // 模拟取消失败：抛出 ApiError
    vi.mocked(forceCancelOrder).mockRejectedValue(new ApiError('订单状态不允许取消', 400));

    renderOrderManagement();
    await waitForListLoaded();

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '强制取消' })[0]!);
    });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('请输入取消原因'), {
        target: { value: '违规操作' },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认取消' }));
    });

    // 错误提示应显示（OrderManagement 用 setError 而非 toast）
    await waitFor(() => {
      expect(screen.getByText('订单状态不允许取消')).toBeInTheDocument();
    });
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 让 getOrders 永不 resolve，保持 loading 状态
    vi.mocked(getOrders).mockImplementation(() => new Promise(() => {}));

    renderOrderManagement();

    // 加载中应显示旋转动画（Loader2 animate-spin class）
    await waitFor(() => {
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  it('加载失败显示错误提示', async () => {
    // 模拟加载失败
    vi.mocked(getOrders).mockRejectedValue(new ApiError('网络错误', 500));

    renderOrderManagement();

    // 错误提示应显示
    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
  });

  it('切换订单类型重新加载列表', async () => {
    renderOrderManagement();
    await waitForListLoaded();

    // 初始加载一次
    expect(vi.mocked(getOrders).mock.calls.length).toBe(1);

    // 点击"厨房"Tab 切换类型
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '厨房' }));
    });

    // 应触发第二次加载，type 参数为 'kitchen'
    await waitFor(() => {
      expect(getOrders).toHaveBeenLastCalledWith('kitchen', 'completed', 1, 20);
    });
  });

  it('切换状态筛选重新加载列表', async () => {
    renderOrderManagement();
    await waitForListLoaded();

    expect(vi.mocked(getOrders).mock.calls.length).toBe(1);

    // 点击"进行中"状态筛选
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '进行中' }));
    });

    // 应触发第二次加载，status 参数为 'in_progress'
    await waitFor(() => {
      expect(getOrders).toHaveBeenLastCalledWith('skill', 'in_progress', 1, 20);
    });
  });
});
