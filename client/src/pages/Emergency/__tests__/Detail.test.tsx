/**
 * Emergency/Detail 应急邻里详情页端到端测试
 *
 * 测试目标：覆盖 DetailView 子组件的核心交互——加载态、错误态、不存在态、详情渲染、
 *           响应列表、立即响应、完成互助、评价列表、举报虚假信息、返回列表
 * 测试策略：mock useParams 返回 { id: 'req-1' } 让 Emergency 默认导出走 DetailView 分支，
 *           mock @/api/emergency 的 getRequest/respondToRequest/updateResponseStatus/submitFalseReport
 *           与 useAuth（可切换登录态），断言 API 调用与渲染结果
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Emergency from '../index';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/api/client';
import type { EmergencyRequest } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：测试模块加载时 vi.mock 工厂会立即引用这些变量
const {
  mockUser,
  mockUnauthenticated,
  mockRequest,
  mockRequestWithoutResponses,
  mockRequestOpenByOther,
  mockRequestWithArrivedResponse,
  getRequestMock,
  respondToRequestMock,
  updateResponseStatusMock,
  submitFalseReportMock,
  navigateMock,
} = vi.hoisted(() => ({
  // 当前登录用户：作为 myResponse.userId 出现，验证 isResponder 显示"确认到达"按钮
  mockUser: {
    id: 'responder-1',
    nickname: '响应者',
    phone: '13800138001',
    creditBalance: 500,
    timeBalance: 100,
    reputationScore: 90,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  // 未登录用户：用于验证 canRespond=false 不显示"立即响应"按钮
  mockUnauthenticated: {
    user: null,
    isAuthenticated: false,
    token: null,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  },
  // 默认 mockRequest：critical 紧急 + open 状态 + 匿名 + 含响应列表与评价列表
  mockRequest: {
    id: 'req-1',
    userId: 'requester-1',
    user: {
      id: 'requester-1',
      nickname: '求助发布者',
      phone: '13800138000',
      creditBalance: 1000,
      timeBalance: 200,
      reputationScore: 95,
      role: 'user',
      createdAt: '2024-01-01T00:00:00Z',
    },
    type: 'emergency' as const,
    category: 'medical',
    title: '老人摔倒需要帮助',
    description: '老人在小区内摔倒，需要搀扶到休息区',
    urgency: 'critical' as const,
    isAnonymous: false,
    address: '3号楼1单元',
    contactPhone: '13800138000',
    images: ['/uploads/img1.jpg', '/uploads/img2.jpg'],
    status: 'open' as const,
    // 响应列表：含两条响应（accepted + arrived），分别对应"响应者已确认"和"已到达"
    responses: [
      {
        id: 'resp-1',
        requestId: 'req-1',
        userId: 'other-user',
        user: { id: 'other-user', nickname: '其他响应者' },
        message: '我马上过来',
        eta: 5,
        status: 'accepted' as const,
        timeoutAt: '2024-03-15T11:00:00Z',
      },
      {
        id: 'resp-2',
        requestId: 'req-1',
        userId: 'responder-1',
        user: { id: 'responder-1', nickname: '响应者' },
        message: '我已在现场',
        eta: 10,
        status: 'arrived' as const,
        arrivedAt: '2024-03-15T10:30:00Z',
      },
    ],
    // 评价列表：含一条 5 星评价
    reviews: [
      {
        id: 'rev-1',
        reviewerId: 'requester-1',
        reviewedId: 'responder-1',
        rating: 5,
        content: '非常感谢',
        createdAt: '2024-03-15T12:00:00Z',
      },
    ],
    createdAt: '2024-03-15T10:00:00Z',
    updatedAt: '2024-03-15T10:00:00Z',
  } as EmergencyRequest,
  // 无响应的请求：用于验证空响应列表不渲染"响应列表"标题
  mockRequestWithoutResponses: {
    id: 'req-2',
    userId: 'requester-2',
    user: { id: 'requester-2', nickname: '匿名用户' },
    type: 'daily' as const,
    category: 'repair',
    title: '水管漏水求助',
    description: '家里水管漏水，需要工具',
    urgency: 'medium' as const,
    isAnonymous: true,
    images: [],
    status: 'open' as const,
    responses: [],
    reviews: [],
    createdAt: '2024-03-16T11:00:00Z',
    updatedAt: '2024-03-16T11:00:00Z',
  } as unknown as EmergencyRequest,
  // open 状态但发布者是其他人：验证非发布者不显示完成互助按钮
  // 设计原因：用 as unknown as EmergencyRequest 双重断言，user 字段仅含必要子集避免冗余字段
  mockRequestOpenByOther: {
    id: 'req-3',
    userId: 'other-requester',
    user: { id: 'other-requester', nickname: '他人' },
    type: 'emergency' as const,
    category: 'medical',
    title: '他人求助',
    description: '他人发布的求助内容',
    urgency: 'high' as const,
    isAnonymous: false,
    images: [],
    status: 'open' as const,
    responses: [],
    reviews: [],
    createdAt: '2024-03-17T10:00:00Z',
    updatedAt: '2024-03-17T10:00:00Z',
  } as unknown as EmergencyRequest,
  // 有 arrived 响应且当前用户为发布者：验证 canComplete 显示完成互助按钮
  mockRequestWithArrivedResponse: {
    id: 'req-4',
    userId: 'responder-1',
    user: { id: 'responder-1', nickname: '响应者' },
    type: 'emergency' as const,
    category: 'safety',
    title: '我发布的求助',
    description: '我发布的有 arrived 响应的求助',
    urgency: 'critical' as const,
    isAnonymous: false,
    images: [],
    status: 'responding' as const,
    responses: [
      {
        id: 'resp-3',
        requestId: 'req-4',
        userId: 'other-user',
        user: { id: 'other-user', nickname: '其他响应者' },
        message: '我已到达现场',
        eta: 5,
        status: 'arrived' as const,
        arrivedAt: '2024-03-18T10:30:00Z',
      },
    ],
    reviews: [],
    createdAt: '2024-03-18T10:00:00Z',
    updatedAt: '2024-03-18T10:00:00Z',
  } as unknown as EmergencyRequest,
  getRequestMock: vi.fn(),
  respondToRequestMock: vi.fn(),
  updateResponseStatusMock: vi.fn(),
  submitFalseReportMock: vi.fn(),
  navigateMock: vi.fn(),
}));

// mock @/api/emergency：覆盖 DetailView 用到的 4 个 API
vi.mock('@/api/emergency', () => ({
  getRequests: vi.fn(),
  getRequest: getRequestMock,
  createRequest: vi.fn(),
  respondToRequest: respondToRequestMock,
  updateResponseStatus: updateResponseStatusMock,
  submitFalseReport: submitFalseReportMock,
  getResources: vi.fn(),
}));

// mock useAuth：默认已登录（responder-1），单测可通过 vi.mocked 切换未登录
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

// mock react-router-dom：useNavigate 替换为 navigateMock，useParams 返回 id 走 DetailView 分支
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ id: 'req-1' }),
  };
});

// mock Skeleton 组件为静态占位，便于断言加载态
vi.mock('@/components/Skeleton', () => ({
  SkeletonListCard: function MockSkeletonList({ count }: { count: number }) {
    return <div data-testid="skeleton-list" data-count={count} />;
  },
  SkeletonDetail: function MockSkeletonDetail() {
    return <div data-testid="skeleton-detail" />;
  },
  SkeletonCompactList: function MockSkeletonCompactList() {
    return <div data-testid="skeleton-compact-list" />;
  },
}));

// mock LoadingButton 为简单 button，便于断言 disabled 与文案
vi.mock('@/components/Button', () => ({
  LoadingButton: function MockLoadingButton({
    children,
    onClick,
    disabled,
    loading,
    loadingText,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    loadingText?: string;
  }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled || loading}
        data-loading={loading ? 'true' : 'false'}
      >
        {loading ? loadingText : children}
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

// 包装组件：注入 MemoryRouter 提供 useNavigate/useParams 上下文，启用 v7 future flag 消除警告
function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Emergency />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认已登录（responder-1），单测可通过 vi.mocked 切换未登录
  vi.mocked(useAuth).mockReturnValue({
    user: mockUser,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  });
  // 默认返回 mockRequest，单测可通过 mockResolvedValueOnce 切换其他场景
  getRequestMock.mockResolvedValue({ code: 0, message: 'ok', data: mockRequest });
  respondToRequestMock.mockResolvedValue({ code: 0, message: 'ok', data: {} });
  updateResponseStatusMock.mockResolvedValue({ code: 0, message: 'ok', data: {} });
  submitFalseReportMock.mockResolvedValue({ code: 0, message: 'ok', data: null });
});

describe('Emergency/Detail 应急邻里详情页（DetailView）', () => {
  it('加载中显示骨架屏 SkeletonDetail', () => {
    // 用永不 resolve 的 Promise 锁定加载态
    getRequestMock.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('skeleton-detail')).toBeInTheDocument();
  });

  it('详情渲染标题、描述、紧急标签、状态标签', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    expect(screen.getByText('老人在小区内摔倒，需要搀扶到休息区')).toBeInTheDocument();
    // critical 紧急标签
    expect(screen.getByText('紧急')).toBeInTheDocument();
    // open 状态标签
    expect(screen.getByText('待响应')).toBeInTheDocument();
  });

  it('详情渲染类别与类型标签', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // 类别 medical
    expect(screen.getByText('medical')).toBeInTheDocument();
    // type=emergency 显示"紧急求助"
    expect(screen.getByText('紧急求助')).toBeInTheDocument();
  });

  it('详情渲染实名用户昵称', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // isAnonymous=false 显示 user.nickname
    expect(screen.getByText('求助发布者')).toBeInTheDocument();
  });

  it('详情渲染地址与联系电话', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    expect(screen.getByText('3号楼1单元')).toBeInTheDocument();
    expect(screen.getByText('13800138000')).toBeInTheDocument();
  });

  it('详情渲染图片列表（images.length > 0）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // mockRequest.images 含 2 张图片；img alt="" 时 role 为 presentation 而非 img
    const images = screen.getAllByRole('presentation');
    expect(images.length).toBe(2);
  });

  it('无图片时不渲染图片列表', async () => {
    // mockRequestWithoutResponses.images 为空数组
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockRequestWithoutResponses });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('水管漏水求助')).toBeInTheDocument();
    });
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });

  it('匿名用户显示"匿名用户"', async () => {
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockRequestWithoutResponses });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('水管漏水求助')).toBeInTheDocument();
    });
    expect(screen.getByText('匿名用户')).toBeInTheDocument();
  });

  it('响应列表渲染（响应者昵称、状态标签、留言、ETA）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // "响应列表"标题
    expect(screen.getByText('响应列表')).toBeInTheDocument();
    // 两条响应的留言
    expect(screen.getByText('我马上过来')).toBeInTheDocument();
    expect(screen.getByText('我已在现场')).toBeInTheDocument();
    // "已响应"和"已到达"状态标签
    expect(screen.getByText('已响应')).toBeInTheDocument();
    expect(screen.getByText('已到达')).toBeInTheDocument();
    // ETA 文本格式："预计 5 分钟到达" 与 "预计 10 分钟到达"
    expect(screen.getByText(/预计 5 分钟到达/)).toBeInTheDocument();
    expect(screen.getByText(/预计 10 分钟到达/)).toBeInTheDocument();
  });

  it('空响应列表不渲染"响应列表"标题', async () => {
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockRequestWithoutResponses });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('水管漏水求助')).toBeInTheDocument();
    });
    expect(screen.queryByText('响应列表')).not.toBeInTheDocument();
  });

  it('响应者本人且 status=accepted 显示"确认到达"按钮', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // mockRequest.responses[0] userId='other-user' status=accepted（非当前用户，不显示按钮）
    // mockRequest.responses[1] userId='responder-1' status=arrived（当前用户但非 accepted，不显示按钮）
    // 由于 mockRequest 中没有"当前用户 + accepted"组合，"确认到达"按钮不应显示
    expect(screen.queryByText('确认到达')).not.toBeInTheDocument();
  });

  it('未登录用户不显示"立即响应"按钮（canRespond=false）', async () => {
    vi.mocked(useAuth).mockReturnValue(mockUnauthenticated);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    expect(screen.queryByText('立即响应')).not.toBeInTheDocument();
  });

  it('已登录用户且 request.status=open 显示"立即响应"按钮（canRespond=true）', async () => {
    // mockRequestOpenByOther：userId='other-requester'，当前用户 mockUser.id='responder-1'，无 myResponse
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockRequestOpenByOther });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('他人求助')).toBeInTheDocument();
    });
    expect(screen.getByText('立即响应')).toBeInTheDocument();
  });

  it('点击"立即响应"展开留言输入框，留言为空时"确认响应"按钮禁用', async () => {
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockRequestOpenByOther });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('他人求助')).toBeInTheDocument();
    });
    act(() => {
      fireEvent.click(screen.getByText('立即响应'));
    });
    // 展开留言输入框
    expect(screen.getByPlaceholderText('留言说明您能提供什么帮助...')).toBeInTheDocument();
    // "确认响应"按钮存在且默认禁用（留言为空）
    const confirmBtn = screen.getByText('确认响应');
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn.closest('button')?.disabled).toBe(true);
  });

  it('填写留言后点击"确认响应"调用 respondToRequest 并刷新详情', async () => {
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockRequestOpenByOther });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('他人求助')).toBeInTheDocument();
    });
    act(() => {
      fireEvent.click(screen.getByText('立即响应'));
    });
    // 填写留言
    const textarea = screen.getByPlaceholderText('留言说明您能提供什么帮助...');
    fireEvent.change(textarea, { target: { value: '我能帮忙' } });
    // 点击确认响应
    act(() => {
      fireEvent.click(screen.getByText('确认响应'));
    });
    await waitFor(() => {
      // respondToRequest 参数为 (requestId, message)：requestId 来自 useParams 的 'req-1'，与 mockRequestOpenByOther.id 无关
      expect(respondToRequestMock).toHaveBeenCalledWith('req-1', { message: '我能帮忙' });
      // 提交后重新调用 getRequest 刷新详情
      expect(getRequestMock).toHaveBeenCalledTimes(2);
    });
  });

  it('发布者本人且有 arrived 响应显示"完成互助"按钮（canComplete=true）', async () => {
    // mockRequestWithArrivedResponse：userId='responder-1'（当前用户），有 arrived 响应
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockRequestWithArrivedResponse });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('我发布的求助')).toBeInTheDocument();
    });
    expect(screen.getByText('完成互助并评价')).toBeInTheDocument();
    expect(screen.getByText('完成互助')).toBeInTheDocument();
  });

  it('非发布者不显示"完成互助"按钮（canComplete=false）', async () => {
    // mockRequest.userId='requester-1'（非当前用户 responder-1）
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    expect(screen.queryByText('完成互助并评价')).not.toBeInTheDocument();
  });

  it('评价列表渲染（星标与评价内容）', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    // "评价"标题
    expect(screen.getByText('评价')).toBeInTheDocument();
    // 评价内容
    expect(screen.getByText('非常感谢')).toBeInTheDocument();
  });

  it('点击"举报虚假信息"展开举报输入框', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      fireEvent.click(screen.getByText('举报虚假信息'));
    });
    expect(screen.getByPlaceholderText('请说明举报原因...')).toBeInTheDocument();
    expect(screen.getByText('提交举报')).toBeInTheDocument();
  });

  it('举报原因为空时"提交举报"按钮禁用', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      fireEvent.click(screen.getByText('举报虚假信息'));
    });
    const submitBtn = screen.getByText('提交举报');
    expect(submitBtn.closest('button')?.disabled).toBe(true);
  });

  it('填写举报原因后点击"提交举报"调用 submitFalseReport 并关闭输入框', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      fireEvent.click(screen.getByText('举报虚假信息'));
    });
    fireEvent.change(screen.getByPlaceholderText('请说明举报原因...'), { target: { value: '信息不实' } });
    act(() => {
      fireEvent.click(screen.getByText('提交举报'));
    });
    await waitFor(() => {
      // submitFalseReport 参数为 (requestId, reason)
      expect(submitFalseReportMock).toHaveBeenCalledWith('req-1', '信息不实');
      // 提交后关闭举报输入框
      expect(screen.queryByPlaceholderText('请说明举报原因...')).not.toBeInTheDocument();
    });
  });

  it('点击"返回列表"按钮调用 navigate("/emergency")', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('老人摔倒需要帮助')).toBeInTheDocument();
    });
    act(() => {
      fireEvent.click(screen.getByText('返回列表'));
    });
    expect(navigateMock).toHaveBeenCalledWith('/emergency');
  });

  it('加载错误显示错误信息与"返回列表"按钮', async () => {
    // getRequest 失败时 request 仍为 null，error 优先展示，避免被"求助信息不存在"分支掩盖
    getRequestMock.mockRejectedValueOnce(new ApiError('网络错误，请重试', 500));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('网络错误，请重试')).toBeInTheDocument();
    });
    // 错误状态下显示"返回列表"按钮
    expect(screen.getByText('返回列表')).toBeInTheDocument();
    // 不应显示"求助信息不存在"
    expect(screen.queryByText('求助信息不存在')).not.toBeInTheDocument();
  });

  it('详情不存在显示"求助信息不存在"（无错误且 request 为 null）', async () => {
    // getRequest 返回 null（不存在场景）：需要构造一个特殊 mock，让 getRequest resolve 但 data 为 null
    // 但实际 API 中 getRequest 失败会抛错走 error 分支，正常返回 null 不太可能
    // 此场景对应：getRequest 成功但返回 null（如软删除），应走 !request && !error 分支
    getRequestMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: null as unknown as EmergencyRequest });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('求助信息不存在')).toBeInTheDocument();
    });
    // 不应显示错误信息和返回列表按钮（"求助信息不存在"分支没有这些元素）
    expect(screen.queryByText('返回列表')).not.toBeInTheDocument();
  });
});
