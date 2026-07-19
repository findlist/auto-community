import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SkillExchange from '../index';

// vi.hoisted 提升 mock 数据避免 TDZ
const { mockPosts, mockEmptyList, mockMorePosts, navigateMock, getPostsMock, consoleErrorSpy } = vi.hoisted(() => ({
  mockPosts: [
    {
      id: 'post-1',
      userId: 'user-1',
      user: { id: 'user-1', nickname: '张师傅', reputationScore: 95, phone: '13800138000', creditBalance: 500, timeBalance: 200, role: 'user', createdAt: '2024-01-01T00:00:00Z' },
      type: 'offer' as const,
      title: '专业电脑维修',
      description: '提供电脑维修、系统安装、数据恢复服务',
      category: '电脑维修',
      creditPrice: 50,
      location: '3号楼1单元',
      images: [],
      status: 'active' as const,
      createdAt: '2024-03-15T10:00:00Z',
      updatedAt: '2024-03-15T10:00:00Z',
    },
    {
      id: 'post-2',
      userId: 'user-2',
      user: { id: 'user-2', nickname: '李老师', reputationScore: 88, phone: '13900139000', creditBalance: 300, timeBalance: 100, role: 'user', createdAt: '2024-01-02T00:00:00Z' },
      type: 'offer' as const,
      title: '英语家教',
      description: '专业英语口语教学',
      category: '教育培训',
      creditPrice: 80,
      location: '5号楼2单元',
      images: [],
      status: 'active' as const,
      createdAt: '2024-03-16T11:00:00Z',
      updatedAt: '2024-03-16T11:00:00Z',
    },
  ],
  mockEmptyList: { list: [], total: 0, page: 1, pageSize: 20, hasNext: false },
  mockMorePosts: [
    {
      id: 'post-3',
      userId: 'user-3',
      user: { id: 'user-3', nickname: '王教练', reputationScore: 90, phone: '13700137000', creditBalance: 400, timeBalance: 150, role: 'user', createdAt: '2024-01-03T00:00:00Z' },
      type: 'offer' as const,
      title: '健身教练',
      description: '专业健身指导',
      category: '运动健身',
      creditPrice: 60,
      location: '健身房',
      images: [],
      status: 'active' as const,
      createdAt: '2024-03-17T09:00:00Z',
      updatedAt: '2024-03-17T09:00:00Z',
    },
  ],
  navigateMock: vi.fn(),
  getPostsMock: vi.fn(),
  consoleErrorSpy: vi.fn(),
}));

// mock getPosts：默认成功返回 mockPosts，单测可通过 mockResolvedValueOnce 切换场景
vi.mock('@/api/skills', () => ({
  getPosts: getPostsMock,
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// mock SkeletonListCard 为静态占位，避免依赖真实骨架屏实现
vi.mock('@/components/Skeleton', () => ({
  SkeletonListCard: function MockSkeleton({ count }: { count: number }) {
    return <div data-testid="skeleton-list" data-count={count} />;
  },
}));

// mock LoadingButton 为简单 button，避免依赖真实组件样式
vi.mock('@/components/Button', () => ({
  LoadingButton: function MockLoadingButton({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
    return <button onClick={onClick} disabled={disabled}>{children}</button>;
  },
}));

// 渲染页面：注入 MemoryRouter 提供 useNavigate 上下文，启用 v7 future flag 消除警告
function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SkillExchange />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(consoleErrorSpy);
  // 默认返回 mockPosts + hasNext=true 便于测试加载更多
  getPostsMock.mockResolvedValue({ code: 0, message: 'ok', data: { list: mockPosts, total: 100, page: 1, pageSize: 20, hasNext: true } });
});

describe('SkillExchange/index 技能交换列表页', () => {
  it('渲染显示标题"邻居能提供什么"（默认 offer Tab）', async () => {
    renderPage();
    expect(screen.getByText('邻居能提供什么')).toBeInTheDocument();
    await waitFor(() => {
      expect(getPostsMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'offer' }));
    });
  });

  it('点击"需求技能"Tab 切换标题为"邻居需要什么"', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('需求技能').click();
    });
    expect(screen.getByText('邻居需要什么')).toBeInTheDocument();
    await waitFor(() => {
      expect(getPostsMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'request' }));
    });
  });

  it('首次加载中显示骨架屏', () => {
    // 用永不 resolve 的 Promise 锁定首次加载状态
    getPostsMock.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('skeleton-list')).toHaveAttribute('data-count', '5');
  });

  it('列表渲染帖子数据（标题、价格、描述、分类、位置、用户昵称、信誉分）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
      expect(screen.getByText('50')).toBeInTheDocument();
      expect(screen.getByText('提供电脑维修、系统安装、数据恢复服务')).toBeInTheDocument();
      // 设计原因：分类"电脑维修"与标题"专业电脑维修"都含"电脑维修"，用 getAllByText 断言
      expect(screen.getAllByText('电脑维修').length).toBeGreaterThan(0);
      expect(screen.getByText('3号楼1单元')).toBeInTheDocument();
      expect(screen.getByText('张师傅')).toBeInTheDocument();
      expect(screen.getByText('95')).toBeInTheDocument();
    });
  });

  it('空列表显示"暂无相关技能"', async () => {
    getPostsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockEmptyList });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('暂无相关技能')).toBeInTheDocument();
    });
  });

  it('点击列表项跳转详情页', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('专业电脑维修').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/skills/post-1');
  });

  it('点击"发布"按钮跳转创建页', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('发布').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/skills/create');
  });

  it('切换分类筛选重新加载列表', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    // 切换分类为"教育培训"；用 fireEvent.change 触发 React 合成事件
    const select = screen.getByDisplayValue('全部') as HTMLSelectElement;
    act(() => {
      fireEvent.change(select, { target: { value: '教育培训' } });
    });
    await waitFor(() => {
      expect(getPostsMock).toHaveBeenCalledWith(expect.objectContaining({ category: '教育培训' }));
    });
  });

  it('搜索框输入触发防抖加载', async () => {
    // 初始返回空列表便于后续断言搜索结果
    getPostsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockEmptyList });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('暂无相关技能')).toBeInTheDocument();
    });
    // 设计原因：用 fireEvent.change 触发 React 合成事件，原生 dispatchEvent 不触发 onChange
    const input = screen.getByPlaceholderText('搜索技能...');
    act(() => {
      fireEvent.change(input, { target: { value: '电脑' } });
    });
    // 防抖 300ms 后应触发搜索
    await waitFor(() => {
      expect(getPostsMock).toHaveBeenCalledWith(expect.objectContaining({ keyword: '电脑' }));
    }, { timeout: 1000 });
  });

  it('搜索框 X 清除按钮清空搜索', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText('搜索技能...') as HTMLInputElement;
    // 先输入文本触发 X 按钮渲染
    act(() => {
      fireEvent.change(input, { target: { value: '电脑' } });
    });
    // X 清除按钮（X 图标），输入后才会渲染；SVG 元素无 click 方法，用 fireEvent
    const clearBtn = document.querySelector('.lucide-x') as SVGElement;
    expect(clearBtn).toBeTruthy();
    act(() => {
      fireEvent.click(clearBtn);
    });
    expect(input.value).toBe('');
  });

  it('加载更多按钮点击加载第二页', async () => {
    // 第一次返回 mockPosts + hasNext=true，第二次返回 mockMorePosts + hasNext=false
    getPostsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: { list: mockPosts, total: 100, page: 1, pageSize: 20, hasNext: true } });
    getPostsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: { list: mockMorePosts, total: 100, page: 2, pageSize: 20, hasNext: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('加载更多').click();
    });
    await waitFor(() => {
      expect(screen.getByText('健身教练')).toBeInTheDocument();
      // 第二次调用应传 page=2
      expect(getPostsMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ page: 2 }));
    });
  });

  it('hasMore=false 时不显示加载更多按钮', async () => {
    getPostsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: { list: mockPosts, total: 2, page: 1, pageSize: 20, hasNext: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    expect(screen.queryByText('加载更多')).not.toBeInTheDocument();
  });

  it('加载失败调用 console.error 兜底', async () => {
    getPostsMock.mockRejectedValueOnce(new Error('网络错误'));
    renderPage();
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  it('首次加载失败显示 Empty error 与重新加载按钮，点击后重新触发请求', async () => {
    // 首次加载失败触发 Empty error 占位
    getPostsMock.mockRejectedValueOnce(new Error('网络错误'));
    renderPage();
    // Empty error 默认 title="加载失败"
    await screen.findByText('加载失败');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
    // 重新 mock 第二次成功返回
    getPostsMock.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: { list: mockPosts, total: 100, page: 1, pageSize: 20, hasNext: true },
    });
    // 点击重新加载触发二次请求
    act(() => {
      screen.getByRole('button', { name: '重新加载' }).click();
    });
    // 第二次应成功渲染列表（用第一个帖子标题作为标志）
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
  });

  it('位置不存在时不渲染位置', async () => {
    const noLocationPost = { ...mockPosts[0]!, id: 'post-no-loc', location: undefined };
    getPostsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: { list: [noLocationPost], total: 1, page: 1, pageSize: 20, hasNext: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    // 3号楼1单元不应出现
    expect(screen.queryByText('3号楼1单元')).not.toBeInTheDocument();
  });

  it('信誉分不存在时不渲染', async () => {
    const noReputationPost = {
      ...mockPosts[0]!,
      id: 'post-no-rep',
      user: { ...mockPosts[0]!.user!, reputationScore: undefined },
    };
    getPostsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: { list: [noReputationPost], total: 1, page: 1, pageSize: 20, hasNext: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('专业电脑维修')).toBeInTheDocument();
    });
    // 信誉分 95 不应出现
    expect(screen.queryByText('95')).not.toBeInTheDocument();
  });
});
