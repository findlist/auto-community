/**
 * TimeBank/index 时间银行列表页端到端测试
 *
 * 测试目标：覆盖双 Tab 切换（provide/request）、二级功能入口跳转、
 *           服务列表渲染、空状态、错误兜底、发布跳转等核心交互
 * 测试策略：mock @/api/timeBank 的 getServices 与 useNavigate，mock ServiceCard
 *           为可点击占位组件，断言 API 调用参数与 navigate 跳转路径
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TimeBank from '../index';

// vi.hoisted 提升 mock 数据避免 TDZ：测试模块加载时 vi.mock 工厂会立即引用这些变量
const {
  mockServices,
  mockEmptyList,
  navigateMock,
  getServicesMock,
} = vi.hoisted(() => ({
  // 服务 mock 数据：覆盖 provide 类型 + 含位置 + 含用户信息
  mockServices: [
    {
      id: 'service-1',
      userId: 'user-1',
      user: {
        id: 'user-1',
        nickname: '张师傅',
        reputationScore: 95,
        phone: '13800138000',
        creditBalance: 500,
        timeBalance: 200,
        role: 'user',
        createdAt: '2024-01-01T00:00:00Z',
      },
      type: 'provide' as const,
      title: '家电维修',
      description: '提供各类家电维修服务',
      category: '维修',
      durationMinutes: 60,
      location: '3号楼1单元',
      status: 'active' as const,
      createdAt: '2024-03-15T10:00:00Z',
      updatedAt: '2024-03-15T10:00:00Z',
    },
    {
      id: 'service-2',
      userId: 'user-2',
      user: {
        id: 'user-2',
        nickname: '李老师',
        reputationScore: 88,
        phone: '13900139000',
        creditBalance: 300,
        timeBalance: 100,
        role: 'user',
        createdAt: '2024-01-02T00:00:00Z',
      },
      type: 'provide' as const,
      title: '英语家教',
      description: '专业英语口语教学',
      category: '教育',
      durationMinutes: 90,
      location: '5号楼2单元',
      status: 'active' as const,
      createdAt: '2024-03-16T11:00:00Z',
      updatedAt: '2024-03-16T11:00:00Z',
    },
  ],
  mockEmptyList: { list: [], total: 0, page: 1, pageSize: 10, hasNext: false },
  navigateMock: vi.fn(),
  getServicesMock: vi.fn(),
}));

// mock @/api/timeBank：默认成功返回 mockServices，单测可通过 mockResolvedValueOnce 切换场景
vi.mock('@/api/timeBank', () => ({
  getServices: getServicesMock,
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖，importActual 保留其他路由 API
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// mock SkeletonCompactList 为静态占位，避免依赖真实骨架屏实现
vi.mock('@/components/Skeleton', () => ({
  SkeletonCompactList: function MockSkeleton({ count }: { count: number }) {
    return <div data-testid="skeleton-compact-list" data-count={count} />;
  },
}));

// mock LoadingButton 为简单 button，隔离分页按钮测试与真实按钮实现
vi.mock('@/components/Button', () => ({
  LoadingButton: function MockLoadingButton({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) {
    return (
      <button onClick={onClick} disabled={disabled || loading}>
        {children}
      </button>
    );
  },
}));

// mock ServiceCard 为可点击占位组件：暴露 service.id 与 title 便于断言，触发 onClick 模拟跳转
// 设计原因：ServiceCard 内部渲染逻辑由其自身测试覆盖，列表页测试只需验证 service 传递与点击回调
vi.mock('../ServiceCard', () => ({
  default: function MockServiceCard({
    service,
    onClick,
  }: {
    service: { id: string; title: string };
    onClick?: () => void;
  }) {
    return (
      <div
        data-testid={`service-card-${service.id}`}
        onClick={onClick}
      >
        {service.title}
      </div>
    );
  },
}));

// 渲染页面：注入 MemoryRouter 提供 useNavigate 上下文，启用 v7 future flag 消除警告
function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TimeBank />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认返回 mockServices 便于多数测试共享
  getServicesMock.mockResolvedValue({
    code: 0,
    message: 'ok',
    data: { list: mockServices, total: 100, page: 1, pageSize: 10, hasNext: true },
  });
});

describe('TimeBank/index 时间银行列表页', () => {
  it('渲染显示标题"邻居愿意花时间帮你"（默认 provide Tab）', async () => {
    renderPage();
    expect(screen.getByText('邻居愿意花时间帮你')).toBeInTheDocument();
    await waitFor(() => {
      expect(getServicesMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'provide' }));
    });
  });

  it('点击"请求服务"Tab 切换标题为"邻居需要你的一小时"并传 type=request', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('家电维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('请求服务').click();
    });
    expect(screen.getByText('邻居需要你的一小时')).toBeInTheDocument();
    await waitFor(() => {
      expect(getServicesMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'request' }));
    });
  });

  it('首次加载中显示骨架屏 SkeletonCompactList', () => {
    // 用永不 resolve 的 Promise 锁定首次加载状态
    getServicesMock.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    const skeleton = screen.getByTestId('skeleton-compact-list');
    expect(skeleton).toHaveAttribute('data-count', '3');
  });

  it('列表渲染服务数据（通过 ServiceCard mock 验证 service 传递）', async () => {
    renderPage();
    await waitFor(() => {
      // 两个 ServiceCard 均渲染，title 来自 mockServices
      expect(screen.getByTestId('service-card-service-1')).toHaveTextContent('家电维修');
      expect(screen.getByTestId('service-card-service-2')).toHaveTextContent('英语家教');
    });
  });

  it('空列表显示"暂无服务"', async () => {
    getServicesMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockEmptyList });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('暂无服务')).toBeInTheDocument();
    });
  });

  it('加载失败显示"加载失败，请稍后重试"', async () => {
    getServicesMock.mockRejectedValueOnce(new Error('网络错误'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('加载失败，请稍后重试')).toBeInTheDocument();
    });
  });

  it('点击服务项跳转详情页 /time-bank/:id', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('service-card-service-1')).toBeInTheDocument();
    });
    act(() => {
      screen.getByTestId('service-card-service-1').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/time-bank/service-1');
  });

  it('点击"发布"按钮跳转创建页 /time-bank/create', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('家电维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('发布').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/time-bank/create');
  });

  it('点击"时间账户"入口跳转 /time-bank/account', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('家电维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('时间账户').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/time-bank/account');
  });

  it('点击"我的订单"入口跳转 /time-bank/orders', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('家电维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('我的订单').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/time-bank/orders');
  });

  it('点击"亲情绑定"入口跳转 /time-bank/family', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('家电维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('亲情绑定').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/time-bank/family');
  });

  it('二级功能入口渲染3个按钮（时间账户/我的订单/亲情绑定）', async () => {
    renderPage();
    // 等待加载完成避免 useEffect 异步 setState 触发 act 警告
    await waitFor(() => {
      expect(screen.getByText('家电维修')).toBeInTheDocument();
    });
    expect(screen.getByText('时间账户')).toBeInTheDocument();
    expect(screen.getByText('我的订单')).toBeInTheDocument();
    expect(screen.getByText('亲情绑定')).toBeInTheDocument();
  });

  it('Tab 切换后 getServices 被调用2次（provide + request）', async () => {
    renderPage();
    await waitFor(() => {
      expect(getServicesMock).toHaveBeenCalledTimes(1);
    });
    act(() => {
      screen.getByText('请求服务').click();
    });
    await waitFor(() => {
      expect(getServicesMock).toHaveBeenCalledTimes(2);
      // 第2次调用应传 type=request
      expect(getServicesMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'request' }));
    });
  });

  it('点击"加载更多"按钮触发下一页请求并追加数据', async () => {
    // 验证分页能力：首次加载 hasNext=true 显示加载更多按钮，点击后请求 page=2 并追加新数据
    const secondPageService = {
      id: 'service-3',
      userId: 'user-3',
      user: { id: 'user-3', nickname: '王师傅', reputationScore: 90, phone: '13700137000', creditBalance: 200, timeBalance: 80, role: 'user', createdAt: '2024-01-03' },
      type: 'provide' as const,
      title: '管道疏通',
      description: '专业管道疏通服务',
      category: '维修',
      durationMinutes: 45,
      location: '7号楼3单元',
      status: 'active' as const,
      createdAt: '2024-03-17T10:00:00Z',
      updatedAt: '2024-03-17T10:00:00Z',
    };
    // 第一次请求返回 mockServices + hasNext=true（beforeEach 默认）
    // 第二次请求返回 secondPageService + hasNext=false
    getServicesMock.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: { list: mockServices, total: 100, page: 1, pageSize: 20, hasNext: true },
    });
    getServicesMock.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: { list: [secondPageService], total: 100, page: 2, pageSize: 20, hasNext: false },
    });

    renderPage();
    // 等待首屏列表渲染
    await waitFor(() => {
      expect(screen.getByTestId('service-card-service-1')).toBeInTheDocument();
    });
    // "加载更多"按钮显示
    expect(screen.getByText('加载更多')).toBeInTheDocument();

    // 点击"加载更多"
    act(() => {
      screen.getByText('加载更多').click();
    });
    // 第二页请求参数应为 page=2 + type=provide
    await waitFor(() => {
      expect(getServicesMock).toHaveBeenCalledWith({ type: 'provide', page: 2, pageSize: 20 });
    });
    // 第二页数据被追加到列表
    await waitFor(() => {
      expect(screen.getByTestId('service-card-service-3')).toHaveTextContent('管道疏通');
    });
    // hasNext=false 后"加载更多"按钮消失
    expect(screen.queryByText('加载更多')).not.toBeInTheDocument();
  });

  it('加载中不渲染服务列表', () => {
    // 用永不 resolve 的 Promise 锁定加载状态
    getServicesMock.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    // 加载中 ServiceCard 不应渲染
    expect(screen.queryByTestId('service-card-service-1')).not.toBeInTheDocument();
  });

  it('错误状态下不渲染服务列表', async () => {
    getServicesMock.mockRejectedValueOnce(new Error('网络错误'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('加载失败，请稍后重试')).toBeInTheDocument();
    });
    // 错误状态下 ServiceCard 不应渲染
    expect(screen.queryByTestId('service-card-service-1')).not.toBeInTheDocument();
  });
});
