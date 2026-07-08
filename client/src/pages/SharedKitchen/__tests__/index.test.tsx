/**
 * SharedKitchen/index 共享厨房列表页端到端测试
 *
 * 测试目标：覆盖三 Tab 切换（offer/need/group）、类别筛选、列表渲染、
 *           分页加载更多、空状态、点击跳转、骨架屏、错误兜底等核心交互
 * 测试策略：mock @/api/kitchen 的 getFoodShares/getGroupOrders 与 useNavigate，
 *           断言 API 调用参数与渲染结果，不依赖真实后端
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SharedKitchen from '../index';

// vi.hoisted 提升 mock 数据避免 TDZ：测试模块加载时 vi.mock 工厂会立即引用这些变量
const {
  mockPosts,
  mockGroupOrders,
  mockEmptyList,
  mockMorePosts,
  navigateMock,
  getFoodSharesMock,
  getGroupOrdersMock,
  consoleErrorSpy,
} = vi.hoisted(() => ({
  // 美食分享 mock 数据：覆盖 offer 类型 + 含图片 + 含过敏原 + 非零价格
  mockPosts: [
    {
      id: 'food-1',
      userId: 'user-1',
      user: { id: 'user-1', nickname: '张厨师', reputationScore: 95 },
      type: 'offer' as const,
      title: '红烧肉',
      description: '家常红烧肉，软糯入味',
      category: '家常菜',
      price: 30,
      quantity: 5,
      remaining: 3,
      pickupTime: '2024-03-15 18:00',
      pickupLocation: '3号楼1单元',
      pickupType: 'self_pickup' as const,
      images: ['https://example.com/food1.jpg'],
      allergens: ['花生'],
      healthCert: true,
      status: 'active' as const,
      createdAt: '2024-03-15T10:00:00Z',
      updatedAt: '2024-03-15T10:00:00Z',
    },
    {
      id: 'food-2',
      userId: 'user-2',
      user: { id: 'user-2', nickname: '李烘焙师', reputationScore: 88 },
      type: 'offer' as const,
      title: '巧克力蛋糕',
      description: '纯手工制作，浓郁巧克力',
      category: '烘焙',
      price: 0,
      quantity: 10,
      remaining: 8,
      pickupTime: '2024-03-16 14:00',
      pickupLocation: '5号楼2单元',
      pickupType: 'self_pickup' as const,
      // images 为空数组：触发 emoji 占位分支
      images: [],
      healthCert: false,
      status: 'active' as const,
      createdAt: '2024-03-16T11:00:00Z',
      updatedAt: '2024-03-16T11:00:00Z',
    },
  ],
  // 拼单 mock 数据：覆盖百分比/金额/人数渲染
  mockGroupOrders: [
    {
      id: 'group-1',
      initiatorId: 'user-3',
      initiator: { id: 'user-3', nickname: '王团长' },
      title: '拼单买菜分摊运费',
      description: '一起买蔬菜分摊配送费',
      targetAmount: 200,
      currentAmount: 100,
      minParticipants: 3,
      maxParticipants: 8,
      currentParticipants: 4,
      address: '小区南门',
      deadline: '2024-03-20T20:00:00Z',
      status: 'open' as const,
      createdAt: '2024-03-15T10:00:00Z',
      updatedAt: '2024-03-15T10:00:00Z',
    },
  ],
  mockEmptyList: { list: [], total: 0, page: 1, pageSize: 10, hasNext: false },
  // 加载更多第二页数据
  mockMorePosts: [
    {
      id: 'food-3',
      userId: 'user-4',
      user: { id: 'user-4', nickname: '赵大厨', reputationScore: 90 },
      type: 'offer' as const,
      title: '清蒸鱼',
      description: '新鲜清蒸鲈鱼',
      category: '海鲜',
      price: 40,
      quantity: 6,
      remaining: 5,
      pickupTime: '2024-03-17 12:00',
      pickupLocation: '2号楼',
      pickupType: 'self_pickup' as const,
      images: [],
      healthCert: true,
      status: 'active' as const,
      createdAt: '2024-03-17T09:00:00Z',
      updatedAt: '2024-03-17T09:00:00Z',
    },
  ],
  navigateMock: vi.fn(),
  getFoodSharesMock: vi.fn(),
  getGroupOrdersMock: vi.fn(),
  consoleErrorSpy: vi.fn(),
}));

// mock @/api/kitchen：默认成功返回 mockPosts，单测可通过 mockResolvedValueOnce 切换场景
vi.mock('@/api/kitchen', () => ({
  getFoodShares: getFoodSharesMock,
  getGroupOrders: getGroupOrdersMock,
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖，importActual 保留其他路由 API
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// mock Skeleton 组件为静态占位，避免依赖真实骨架屏实现
vi.mock('@/components/Skeleton', () => ({
  SkeletonCard: function MockSkeletonCard({ count, showImage }: { count: number; showImage?: boolean }) {
    return <div data-testid="skeleton-card" data-count={count} data-show-image={showImage ? 'true' : 'false'} />;
  },
  SkeletonListCard: function MockSkeletonListCard({ count }: { count: number }) {
    return <div data-testid="skeleton-list" data-count={count} />;
  },
}));

// mock LoadingButton 为简单 button，避免依赖真实组件样式
vi.mock('@/components/Button', () => ({
  LoadingButton: function MockLoadingButton({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) {
    return (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    );
  },
}));

// 渲染页面：注入 MemoryRouter 提供 useNavigate 上下文，启用 v7 future flag 消除警告
function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SharedKitchen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(consoleErrorSpy);
  // 默认返回 mockPosts + hasNext=true 便于测试加载更多
  getFoodSharesMock.mockResolvedValue({
    code: 0,
    message: 'ok',
    data: { list: mockPosts, total: 100, page: 1, pageSize: 10, hasNext: true },
  });
  getGroupOrdersMock.mockResolvedValue({
    code: 0,
    message: 'ok',
    data: { list: mockGroupOrders, total: 50, page: 1, pageSize: 10, hasNext: true },
  });
});

describe('SharedKitchen/index 共享厨房列表页', () => {
  it('渲染显示标题"今天，谁在开火"（默认 offer Tab）', async () => {
    renderPage();
    expect(screen.getByText('今天，谁在开火')).toBeInTheDocument();
    await waitFor(() => {
      expect(getFoodSharesMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer' }));
    });
  });

  it('点击"美食需求"Tab 切换标题为"邻居们想吃啥"并传 type=need', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('美食需求').click();
    });
    expect(screen.getByText('邻居们想吃点啥')).toBeInTheDocument();
    await waitFor(() => {
      expect(getFoodSharesMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'need' }));
    });
  });

  it('点击"拼单买菜"Tab 切换标题为"一起买，更便宜"并调用 getGroupOrders', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('拼单买菜').click();
    });
    expect(screen.getByText('一起买，更便宜')).toBeInTheDocument();
    await waitFor(() => {
      expect(getGroupOrdersMock).toHaveBeenCalled();
    });
  });

  it('拼单 Tab 不显示类别筛选按钮', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('拼单买菜').click();
    });
    await waitFor(() => {
      expect(screen.getByText('一起买，更便宜')).toBeInTheDocument();
    });
    // 拼单 Tab 不渲染类别筛选，"家常菜"按钮不应出现
    expect(screen.queryByText('家常菜')).not.toBeInTheDocument();
  });

  it('首次加载中显示骨架屏（offer Tab 用 SkeletonCard + showImage）', () => {
    // 用永不 resolve 的 Promise 锁定首次加载状态
    getFoodSharesMock.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    const skeleton = screen.getByTestId('skeleton-card');
    expect(skeleton).toHaveAttribute('data-count', '3');
    expect(skeleton).toHaveAttribute('data-show-image', 'true');
  });

  it('美食列表渲染数据（标题、价格、描述、用户昵称、剩余份数、过敏原）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
      // price=30 显示"30积分"
      expect(screen.getByText('30积分')).toBeInTheDocument();
      expect(screen.getByText('家常红烧肉，软糯入味')).toBeInTheDocument();
      expect(screen.getByText('张厨师')).toBeInTheDocument();
      // 剩余 3/5 份
      expect(screen.getByText(/剩余 3\/5 份/)).toBeInTheDocument();
      // 过敏原标签
      expect(screen.getByText(/花生/)).toBeInTheDocument();
    });
  });

  it('价格为 0 显示"免费"', async () => {
    renderPage();
    await waitFor(() => {
      // food-2 price=0 显示"免费"
      expect(screen.getByText('免费')).toBeInTheDocument();
    });
  });

  it('图片缺失时用 emoji 占位（offer Tab 显示 🍲）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    // food-2 images 为空数组，应渲染 🍲 emoji
    expect(screen.getByText('🍲')).toBeInTheDocument();
  });

  it('拼单列表渲染数据（标题、百分比、金额、人数）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('拼单买菜').click();
    });
    await waitFor(() => {
      expect(screen.getByText('拼单买菜分摊运费')).toBeInTheDocument();
      // 100/200=50%
      expect(screen.getByText('50%')).toBeInTheDocument();
      // ¥100 / 200
      expect(screen.getByText('¥100 / 200')).toBeInTheDocument();
      // 4/8 人
      expect(screen.getByText('4/8 人')).toBeInTheDocument();
    });
  });

  it('空列表显示"暂无美食"（offer Tab 空列表）', async () => {
    getFoodSharesMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockEmptyList });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('暂无美食')).toBeInTheDocument();
    });
  });

  it('拼单空列表显示"暂无拼单"', async () => {
    getGroupOrdersMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockEmptyList });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('拼单买菜').click();
    });
    await waitFor(() => {
      expect(screen.getByText('暂无拼单')).toBeInTheDocument();
    });
  });

  it('点击美食列表项跳转详情页 /kitchen/:id', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('红烧肉').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/kitchen/food-1');
  });

  it('点击拼单列表项跳转 /kitchen/group-orders/:id', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('拼单买菜').click();
    });
    await waitFor(() => {
      expect(screen.getByText('拼单买菜分摊运费')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('拼单买菜分摊运费').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/kitchen/group-orders/group-1');
  });

  it('点击"发布"按钮跳转创建页 /kitchen/create', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('发布').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/kitchen/create');
  });

  it('切换类别筛选重新加载列表（getFoodShares 传 category）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    // 点击"烘焙"类别按钮触发筛选
    act(() => {
      screen.getByText('烘焙').click();
    });
    await waitFor(() => {
      expect(getFoodSharesMock).toHaveBeenCalledWith(expect.objectContaining({ category: '烘焙' }));
    });
  });

  it('类别为"全部"时不传 category 参数', async () => {
    renderPage();
    await waitFor(() => {
      expect(getFoodSharesMock).toHaveBeenCalledWith(expect.objectContaining({ category: undefined }));
    });
  });

  it('加载更多按钮点击加载第二页（offer Tab）', async () => {
    // 第一次返回 mockPosts + hasNext=true，第二次返回 mockMorePosts + hasNext=false
    getFoodSharesMock.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: { list: mockPosts, total: 100, page: 1, pageSize: 10, hasNext: true },
    });
    getFoodSharesMock.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: { list: mockMorePosts, total: 100, page: 2, pageSize: 10, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('加载更多').click();
    });
    await waitFor(() => {
      expect(screen.getByText('清蒸鱼')).toBeInTheDocument();
      // 第二次调用应传 page=2
      expect(getFoodSharesMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
    });
  });

  it('hasMore=false 时不显示加载更多按钮', async () => {
    getFoodSharesMock.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: { list: mockPosts, total: 2, page: 1, pageSize: 10, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('红烧肉')).toBeInTheDocument();
    });
    expect(screen.queryByText('加载更多')).not.toBeInTheDocument();
  });

  it('加载失败调用 console.error 兜底', async () => {
    getFoodSharesMock.mockRejectedValueOnce(new Error('网络错误'));
    renderPage();
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});
