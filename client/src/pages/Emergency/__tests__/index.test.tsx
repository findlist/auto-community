/**
 * Emergency/index 应急邻里列表页端到端测试
 *
 * 测试目标：覆盖三 Tab 切换（紧急/日常/全部）、求助列表渲染、紧急程度与状态标签、
 *           空状态、点击跳转、资源地图跳转、求助/资源弹窗打开等核心交互
 * 测试策略：mock @/api/emergency 的 getRequests/createRequest/getResources 与 useNavigate/useParams，
 *           让 useParams 返回空 id 走 ListView 分支，断言 API 调用与渲染结果
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Emergency from '../index';

// vi.hoisted 提升 mock 数据避免 TDZ：测试模块加载时 vi.mock 工厂会立即引用这些变量
const {
  mockRequests,
  mockEmptyList,
  navigateMock,
  getRequestsMock,
  createRequestMock,
  getResourcesMock,
} = vi.hoisted(() => ({
  // 求助 mock 数据：覆盖 emergency/daily 类型 + critical/high 紧急程度 + 匿名/实名
  mockRequests: [
    {
      id: 'req-1',
      userId: 'user-1',
      user: {
        id: 'user-1',
        nickname: '张三',
        phone: '13800138000',
        creditBalance: 500,
        timeBalance: 200,
        reputationScore: 95,
        role: 'user',
        createdAt: '2024-01-01T00:00:00Z',
      },
      type: 'emergency' as const,
      category: 'medical',
      title: '老人摔倒需要帮助',
      description: '老人在小区内摔倒，需要搀扶',
      urgency: 'critical' as const,
      isAnonymous: false,
      images: [],
      status: 'open' as const,
      responses: [],
      reviews: [],
      createdAt: '2024-03-15T10:00:00Z',
      updatedAt: '2024-03-15T10:00:00Z',
    },
    {
      id: 'req-2',
      userId: 'user-2',
      // isAnonymous=true：触发"匿名用户"显示分支
      type: 'daily' as const,
      category: 'repair',
      title: '水管漏水求助',
      description: '家里水管漏水，需要工具',
      urgency: 'high' as const,
      isAnonymous: true,
      images: [],
      status: 'responding' as const,
      responses: [],
      reviews: [],
      createdAt: '2024-03-16T11:00:00Z',
      updatedAt: '2024-03-16T11:00:00Z',
    },
  ],
  mockEmptyList: { list: [], total: 0, page: 1, pageSize: 10, hasNext: false },
  navigateMock: vi.fn(),
  getRequestsMock: vi.fn(),
  createRequestMock: vi.fn(),
  getResourcesMock: vi.fn(),
}));

// mock @/api/emergency：默认成功返回 mockRequests
vi.mock('@/api/emergency', () => ({
  getRequests: getRequestsMock,
  createRequest: createRequestMock,
  getResources: getResourcesMock,
}));

// mock react-router-dom：useNavigate 替换为 navigateMock，useParams 返回空对象走 ListView 分支
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock, useParams: () => ({}) };
});

// mock useAuth：返回未登录用户，避免 DetailView 相关鉴权逻辑干扰 ListView 测试
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));

// mock Skeleton 组件为静态占位
vi.mock('@/components/Skeleton', () => ({
  SkeletonListCard: function MockSkeleton({ count }: { count: number }) {
    return <div data-testid="skeleton-list" data-count={count} />;
  },
  SkeletonDetail: function MockSkeletonDetail() {
    return <div data-testid="skeleton-detail" />;
  },
  SkeletonCompactList: function MockSkeletonCompactList() {
    return <div data-testid="skeleton-compact-list" />;
  },
}));

// mock LoadingButton 为简单 button
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

// mock LocationPicker 为简单占位，避免依赖高德地图 SDK
vi.mock('@/components/Map/LocationPicker', () => ({
  default: function MockLocationPicker() {
    return <div data-testid="location-picker" />;
  },
}));

// mock useFormValidation：返回可控的校验工具函数
vi.mock('@/hooks/useFormValidation', () => ({
  useFormValidation: () => ({
    setTouched: vi.fn(),
    getFieldError: () => null,
    validateAll: () => true,
  }),
}));

// mock 表单校验工具函数为透传，避免依赖真实实现
vi.mock('@/utils/formValidation', () => ({
  validateRequired: () => null,
  validateMinLength: () => null,
  validateMaxLength: () => null,
  validatePhone: () => null,
}));

// 渲染页面：注入 MemoryRouter 提供 useNavigate/useParams 上下文，启用 v7 future flag 消除警告
function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Emergency />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认返回 mockRequests 便于多数测试共享
  getRequestsMock.mockResolvedValue({
    code: 0,
    message: 'ok',
    data: { list: mockRequests, total: 100, page: 1, pageSize: 10, hasNext: true },
  });
  // ResourceModal 打开时 getResources 默认返回空列表
  getResourcesMock.mockResolvedValue({
    code: 0,
    message: 'ok',
    data: { list: [], total: 0, page: 1, pageSize: 10, hasNext: false },
  });
});

describe('Emergency/index 应急邻里列表页（ListView）', () => {
  it('渲染显示标题"全部求助"（默认空 Tab）', async () => {
    renderPage();
    expect(screen.getByText('全部求助')).toBeInTheDocument();
    await waitFor(() => {
      expect(getRequestsMock).toHaveBeenCalled();
    });
  });

  it('点击"紧急"Tab 切换标题为"紧急求助"并传 type=emergency', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // 用 role 精确定位 Tab 按钮，避免与紧急程度标签"紧急"文本冲突
    act(() => {
      screen.getByRole('button', { name: '紧急' }).click();
    });
    expect(screen.getByText('紧急求助')).toBeInTheDocument();
    await waitFor(() => {
      expect(getRequestsMock).toHaveBeenCalledWith({ type: 'emergency' });
    });
  });

  it('点击"日常"Tab 切换标题为"日常互助"并传 type=daily', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('日常').click();
    });
    expect(screen.getByText('日常互助')).toBeInTheDocument();
    await waitFor(() => {
      expect(getRequestsMock).toHaveBeenCalledWith({ type: 'daily' });
    });
  });

  it('首次加载中显示骨架屏 SkeletonListCard', () => {
    // 用永不 resolve 的 Promise 锁定首次加载状态
    getRequestsMock.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    const skeleton = screen.getByTestId('skeleton-list');
    expect(skeleton).toHaveAttribute('data-count', '3');
  });

  it('列表渲染求助数据（标题、描述、用户名、类别）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
      expect(screen.getByText('老人在小区内摔倒，需要搀扶')).toBeInTheDocument();
      // 实名用户显示昵称
      expect(screen.getByText('张三')).toBeInTheDocument();
    });
  });

  it('紧急程度标签渲染（high 显示"较高"）', async () => {
    renderPage();
    await waitFor(() => {
      // req-2 urgency=high → "较高"标签，"较高"只在紧急标签出现不与 Tab 冲突
      expect(screen.getByText('较高')).toBeInTheDocument();
    });
  });

  it('状态标签渲染（open 显示"待响应"，responding 显示"处理中"）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('待响应')).toBeInTheDocument();
      expect(screen.getByText('处理中')).toBeInTheDocument();
    });
  });

  it('匿名用户显示"匿名用户"', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // req-2 isAnonymous=true，应显示"匿名用户"
    expect(screen.getByText('匿名用户')).toBeInTheDocument();
  });

  it('空列表显示"暂无求助信息"', async () => {
    getRequestsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockEmptyList });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('暂无求助信息')).toBeInTheDocument();
    });
  });

  it('点击求助列表项跳转详情页 /emergency/:id', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('老人摔倒需要帮助').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/emergency/req-1');
  });

  it('点击"资源地图"按钮跳转 /emergency/resources/map', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('资源地图').click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/emergency/resources/map');
  });

  it('点击"求助"按钮打开 CreateModal（显示"发布求助"标题）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('求助').click();
    });
    // CreateModal 打开后应显示标题"发布求助"
    expect(screen.getByText('发布求助')).toBeInTheDocument();
  });

  it('点击"资源"按钮打开 ResourceModal（显示"应急资源"标题）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      screen.getByText('资源').click();
    });
    // ResourceModal 打开后应显示标题"应急资源"
    await waitFor(() => {
      expect(screen.getByText('应急资源')).toBeInTheDocument();
    });
  });

  it('Tab 切换后 getRequests 被调用2次（全部 + emergency）', async () => {
    renderPage();
    await waitFor(() => {
      expect(getRequestsMock).toHaveBeenCalledTimes(1);
    });
    // 用 role 精确定位 Tab 按钮，避免与紧急程度标签"紧急"文本冲突
    act(() => {
      screen.getByRole('button', { name: '紧急' }).click();
    });
    await waitFor(() => {
      expect(getRequestsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('加载完成后不显示骨架屏', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // 加载完成后骨架屏应消失
    expect(screen.queryByTestId('skeleton-list')).not.toBeInTheDocument();
  });

  it('重复提交守卫：弱网下连点"提交"只触发一次 createRequest', async () => {
    // 设计原因：紧急场景下用户更易焦虑连点，disabled 单一防御不足以阻断异步批处理窗口内的连点
    // 让 createRequest 永不 resolve 锁定 submitting 状态，模拟弱网场景
    createRequestMock.mockImplementation(() => new Promise(() => {}));

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });

    // 打开 CreateModal
    act(() => {
      screen.getByText('求助').click();
    });
    expect(screen.getByText('发布求助')).toBeInTheDocument();

    // 输入标题（必填，validateAll 已 mock 为 true 但仍触发受控组件更新）
    fireEvent.change(screen.getByPlaceholderText('简要描述您的求助'), { target: { value: '测试求助' } });

    // 第一次点击：进入 submitting=true，按钮文案变为"提交中..."
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交中...' })).toBeInTheDocument();
    });

    // 第二次点击：fireEvent 绕过 disabled 触发 onClick，但入口 if(submitting) return 应阻断
    fireEvent.click(screen.getByRole('button', { name: '提交中...' }));

    // createRequest 应只被调用一次（入口 if 守卫作为第二道防线）
    expect(createRequestMock).toHaveBeenCalledTimes(1);
  });
});
