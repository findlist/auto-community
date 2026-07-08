import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ServiceDetail from '../ServiceDetail';
import type { TimeService } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：mock 当前用户与一条 active 服务数据
const {
  mockUser,
  mockService,
  mockInactiveService,
  mockOtherUserService,
  mockRequestService,
  mockServiceNoImages,
  mockServiceNoLocation,
  mockUnauthenticated,
  navigateMock,
} = vi.hoisted(() => ({
  // 当前用户：作为 service.userId 出现，验证发布者本人编辑入口可见
  // 设计原因：补全 User 必需字段，使 useAuth.mockReturnValue 类型匹配，避免 tsc 报错
  mockUser: { id: 'user-self', phone: '13800000000', nickname: '当前用户', creditBalance: 100, timeBalance: 50, reputationScore: 80, role: 'user' as const, createdAt: '2024-01-01T00:00:00.000Z' },
  // active 服务：用于编辑入口可见、预填、提交场景
  mockService: {
    id: 'svc-1',
    userId: 'user-self',
    type: 'provide' as const,
    category: '家政服务',
    title: '原服务标题',
    description: '原服务描述内容，长度足够通过校验',
    durationMinutes: 60,
    location: '原地址',
    address: '原地址',
    images: ['/uploads/img1.jpg'],
    status: 'active' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
    user: { id: 'user-self', nickname: '当前用户', avatar: undefined, reputationScore: 80 },
  } as TimeService,
  // inactive 服务：用于验证非 active 状态下编辑入口不可见
  mockInactiveService: {
    id: 'svc-2',
    userId: 'user-self',
    type: 'provide' as const,
    category: '家政服务',
    title: '已完成服务',
    description: '描述内容，长度足够通过校验',
    durationMinutes: 60,
    address: '某地址',
    status: 'completed' as const,
    createdAt: '2024-01-02T00:00:00.000Z',
    user: { id: 'user-self', nickname: '当前用户', avatar: undefined },
  } as TimeService,
  // 他人发布的服务：用于验证非发布者编辑入口不可见
  mockOtherUserService: {
    id: 'svc-3',
    userId: 'user-other',
    type: 'provide' as const,
    category: '家政服务',
    title: '他人服务',
    description: '描述内容，长度足够通过校验',
    durationMinutes: 60,
    address: '某地址',
    status: 'active' as const,
    createdAt: '2024-01-03T00:00:00.000Z',
    user: { id: 'user-other', nickname: '其他用户', avatar: undefined },
  } as TimeService,
  // request 类型服务：用于验证"需求服务"标签渲染
  mockRequestService: {
    id: 'svc-4',
    userId: 'user-other',
    type: 'request' as const,
    category: '电脑维修',
    title: '需求服务标题',
    description: '需要别人帮忙修电脑，描述长度足够通过校验',
    durationMinutes: 90,
    address: '请求地址',
    images: [],
    status: 'active' as const,
    createdAt: '2024-01-04T00:00:00.000Z',
    updatedAt: '2024-01-04T00:00:00.000Z',
    user: { id: 'user-other', nickname: '请求者', avatar: undefined, reputationScore: 90 },
  } as unknown as TimeService,
  // 无配图服务：用于验证 images 为空时不渲染"服务配图"区域
  mockServiceNoImages: {
    id: 'svc-5',
    userId: 'user-other',
    type: 'provide' as const,
    category: '家政服务',
    title: '无配图服务',
    description: '描述内容，长度足够通过校验',
    durationMinutes: 30,
    address: '某地址',
    images: [],
    status: 'active' as const,
    createdAt: '2024-01-05T00:00:00.000Z',
    updatedAt: '2024-01-05T00:00:00.000Z',
    user: { id: 'user-other', nickname: '发布者', avatar: undefined },
  } as unknown as TimeService,
  // 无地址服务：用于验证 location/address 均空时不渲染地址行
  mockServiceNoLocation: {
    id: 'svc-6',
    userId: 'user-other',
    type: 'provide' as const,
    category: '家政服务',
    title: '无地址服务',
    description: '描述内容，长度足够通过校验',
    durationMinutes: 60,
    location: undefined,
    address: undefined,
    images: [],
    status: 'active' as const,
    createdAt: '2024-01-06T00:00:00.000Z',
    updatedAt: '2024-01-06T00:00:00.000Z',
    user: { id: 'user-other', nickname: '发布者', avatar: undefined },
  } as unknown as TimeService,
  // 未认证用户状态：用于验证未登录时底部显示"请先登录"
  mockUnauthenticated: {
    user: null,
    isAuthenticated: false,
    token: null,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  },
  // navigate mock：提升为可控函数，便于断言返回按钮/返回列表的跳转行为
  navigateMock: vi.fn(),
}));

// mock timeBank API：默认 getService 返回 mockService，updateService 默认成功
vi.mock('@/api/timeBank', () => ({
  getService: vi.fn(async () => ({ code: 0, message: 'ok', data: mockService })),
  createOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: { id: 'order-1' } })),
  updateService: vi.fn(async () => ({ code: 0, message: 'ok', data: mockService })),
}));

// mock useAuth：默认返回已认证用户（service.userId === mockUser.id）
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

// mock AIRecommend：避免依赖 matchSkill/matchTimeService 真实 API 调用
vi.mock('@/components/AIRecommend', () => ({
  default: () => <div data-testid="ai-recommend-mock">AI推荐</div>,
}));

// mock useNavigate：返回可控的 navigateMock，便于断言跳转行为
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// 引入被 mock 的 API 以便在用例中配置返回值
// createOrder 用于断言订单创建参数，useAuth 用于动态切换认证状态
import { getService, updateService, createOrder } from '@/api/timeBank';
import { useAuth } from '@/hooks/useAuth';

// 包装组件：注入 MemoryRouter + 路由参数，提供 useNavigate/useParams 上下文
function renderServiceDetail(serviceId = 'svc-1') {
  return render(
    <MemoryRouter initialEntries={[`/time-bank/services/${serviceId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/time-bank/services/:id" element={<ServiceDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ServiceDetail 编辑弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockService });
    vi.mocked(updateService).mockResolvedValue({ code: 0, message: 'ok', data: mockService });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('发布者本人且 active 状态显示"编辑"按钮', async () => {
    renderServiceDetail();

    // 等待"编辑"按钮出现即代表 service 已加载完成且发布者本人可编辑
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });
  });

  it('非发布者不显示"编辑"按钮', async () => {
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockOtherUserService });

    renderServiceDetail();

    // 等待页面标题渲染完成（h1 仅顶部一处），确认 service 已加载
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings.some(h => h.textContent === '他人服务')).toBe(true);
    });

    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull();
  });

  it('发布者本人但状态非 active 不显示"编辑"按钮', async () => {
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockInactiveService });

    renderServiceDetail();

    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings.some(h => h.textContent === '已完成服务')).toBe(true);
    });

    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull();
  });

  it('点击"编辑"打开弹窗，预填当前服务数据', async () => {
    renderServiceDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });

    // 初始无弹窗
    expect(screen.queryByText('编辑服务')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    });

    // 弹窗应出现，标题为"编辑服务"
    expect(screen.getByText('编辑服务')).toBeInTheDocument();

    // 预填数据：标题、分类、时长、地址均应预填
    // 注：input 用 getByDisplayValue 取值，避免与页面展示文本冲突
    const titleInput = screen.getByDisplayValue('原服务标题') as HTMLInputElement;
    expect(titleInput).toBeInTheDocument();

    const categoryInput = screen.getByDisplayValue('家政服务') as HTMLInputElement;
    expect(categoryInput).toBeInTheDocument();

    const durationInput = screen.getByDisplayValue('60') as HTMLInputElement;
    expect(durationInput).toBeInTheDocument();

    const addressInput = screen.getByDisplayValue('原地址') as HTMLInputElement;
    expect(addressInput).toBeInTheDocument();
  });

  it('修改标题并点击"保存"，调用 updateService 并显示成功提示', async () => {
    renderServiceDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });

    // 打开弹窗
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    });

    // 修改标题
    const titleInput = screen.getByDisplayValue('原服务标题') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: '新服务标题' } });
    });

    // 点击保存
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });

    // 应调用 updateService，参数包含新标题与原其他字段
    await waitFor(() => {
      expect(updateService).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'svc-1',
          title: '新服务标题',
          category: '家政服务',
          durationMinutes: 60,
        })
      );
    });

    // 应显示成功提示
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('服务已更新');
    });

    // 弹窗应关闭
    await waitFor(() => {
      expect(screen.queryByText('编辑服务')).toBeNull();
    });
  });

  it('清空标题后显示"标题不能为空"错误提示', async () => {
    renderServiceDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    });

    // 清空标题
    const titleInput = screen.getByDisplayValue('原服务标题') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: '' } });
    });

    // 应显示校验错误：标题不能为空
    expect(screen.getByText('标题不能为空')).toBeInTheDocument();

    // 保存按钮应禁用（disabled 属性）
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeDisabled();
  });

  it('时长超出范围显示错误提示', async () => {
    renderServiceDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    });

    // 修改时长为超出范围值（>480）
    const durationInput = screen.getByDisplayValue('60') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(durationInput, { target: { value: '999' } });
    });

    // 应显示时长范围错误
    expect(screen.getByText(/服务时长需在 1-480 分钟之间/)).toBeInTheDocument();

    // 保存按钮应禁用
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toBeDisabled();
  });

  it('提交失败显示 toast.error 错误提示', async () => {
    vi.mocked(updateService).mockRejectedValue(new Error('网络异常，更新失败'));

    renderServiceDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    });

    // 修改标题避免触发校验错误
    const titleInput = screen.getByDisplayValue('原服务标题') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: '新服务标题' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });

    // 应显示错误提示
    // 注：handleEditSubmit catch err 用 `err instanceof ApiError ? err.message : "更新失败，请重试"`
    // 普通 Error 不属于 ApiError，会走 fallback 文案"更新失败，请重试"
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('更新失败，请重试');
    });

    // 弹窗应保持打开（提交失败不关闭）
    expect(screen.getByText('编辑服务')).toBeInTheDocument();
  });

  it('点击"取消"关闭弹窗，不调用 updateService', async () => {
    renderServiceDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    });

    expect(screen.getByText('编辑服务')).toBeInTheDocument();

    // 点击取消
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    // 弹窗应关闭
    await waitFor(() => {
      expect(screen.queryByText('编辑服务')).toBeNull();
    });

    // 不应调用 updateService
    expect(updateService).not.toHaveBeenCalled();
  });

  it('保存中按钮禁用并显示"保存中..."', async () => {
    // 让 updateService 永不 resolve，保持 loading 状态
    vi.mocked(updateService).mockImplementation(() => new Promise(() => {}));

    renderServiceDetail();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    });

    // 修改标题避免触发校验错误
    const titleInput = screen.getByDisplayValue('原服务标题') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(titleInput, { target: { value: '新服务标题' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });

    // 按钮文案应变为"保存中..."
    await waitFor(() => {
      expect(screen.getByText('保存中...')).toBeInTheDocument();
    });

    // 取消按钮也应禁用（避免保存中关闭弹窗）
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });
});

// ==================== 详情渲染与加载状态测试 ====================
// 设计原因：原 10 个测试全部聚焦编辑弹窗，详情页基础渲染、加载状态、订单创建场景未覆盖
// 本块补全详情渲染、骨架屏、加载失败、返回按钮等场景
describe('ServiceDetail 详情渲染与加载状态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认返回他人发布的 active 服务，避免编辑按钮干扰渲染断言
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockOtherUserService });
    // 默认已认证用户（非发布者），便于测试订单创建按钮
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中显示骨架屏', () => {
    // 让 getService 永不 resolve，保持 loading 状态
    vi.mocked(getService).mockImplementation(() => new Promise(() => {}));
    renderServiceDetail();
    // 骨架屏包含 animate-pulse 类名，通过该类名识别加载状态
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('加载失败显示"服务不存在"与返回列表按钮', async () => {
    vi.mocked(getService).mockRejectedValue(new Error('网络错误'));
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByText('服务不存在')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument();
  });

  it('服务数据为 null 时显示"服务不存在"', async () => {
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: null as unknown as typeof mockOtherUserService });
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByText('服务不存在')).toBeInTheDocument();
    });
  });

  it('渲染 provide 类型服务的标题、标签、分类、时长、描述', async () => {
    renderServiceDetail();
    // service.title 在 h1 和 h2 中渲染两次，用 getAllByText 避免多元素匹配错误
    await waitFor(() => {
      expect(screen.getAllByText('他人服务').length).toBeGreaterThan(0);
    });
    // provide 类型显示"提供服务"标签
    expect(screen.getByText('提供服务')).toBeInTheDocument();
    // 分类标签
    expect(screen.getByText('家政服务')).toBeInTheDocument();
    // 时长 60 分钟 → formatTime(60) = "1小时"
    expect(screen.getByText('1小时')).toBeInTheDocument();
    // 描述
    expect(screen.getByText('描述内容，长度足够通过校验')).toBeInTheDocument();
  });

  it('渲染 request 类型服务的"需要服务"标签', async () => {
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockRequestService });
    renderServiceDetail();
    // service.title 在 h1 和 h2 中渲染两次，用 getAllByText 避免多元素匹配错误
    await waitFor(() => {
      expect(screen.getAllByText('需求服务标题').length).toBeGreaterThan(0);
    });
    // request 类型显示"需要服务"标签（与编辑弹窗内按钮文案"需求服务"区分）
    expect(screen.getByText('需要服务')).toBeInTheDocument();
    // 时长 90 分钟 → formatTime(90) = "1小时30分钟"
    expect(screen.getByText('1小时30分钟')).toBeInTheDocument();
  });

  it('有配图时渲染"服务配图"区域与图片', async () => {
    // mockService 含 1 张配图
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockService });
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByText('服务配图')).toBeInTheDocument();
    });
    // 配图 img 元素
    const images = screen.getAllByRole('img');
    // 至少 1 张配图（可能还有发布者头像，但头像 alt="" role 为 presentation）
    expect(images.length).toBeGreaterThanOrEqual(1);
  });

  it('无配图时不渲染"服务配图"区域', async () => {
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockServiceNoImages });
    renderServiceDetail();
    // service.title 在 h1 和 h2 中渲染两次，用 getAllByText 避免多元素匹配错误
    await waitFor(() => {
      expect(screen.getAllByText('无配图服务').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('服务配图')).toBeNull();
  });

  it('有地址时渲染地址行', async () => {
    renderServiceDetail();
    // service.title 在 h1 和 h2 中渲染两次，用 getAllByText 避免多元素匹配错误
    await waitFor(() => {
      expect(screen.getAllByText('他人服务').length).toBeGreaterThan(0);
    });
    // mockOtherUserService.address = '某地址'
    expect(screen.getByText('某地址')).toBeInTheDocument();
  });

  it('无地址时不渲染地址行', async () => {
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockServiceNoLocation });
    renderServiceDetail();
    // service.title 在 h1 和 h2 中渲染两次，用 getAllByText 避免多元素匹配错误
    await waitFor(() => {
      expect(screen.getAllByText('无地址服务').length).toBeGreaterThan(0);
    });
    // mockServiceNoLocation.location 和 address 均为 undefined，不应渲染地址
    expect(screen.queryByText('某地址')).toBeNull();
  });

  it('渲染发布者信息（昵称与信誉分）', async () => {
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockRequestService });
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByText('请求者')).toBeInTheDocument();
    });
    // mockRequestService.user.reputationScore = 90
    expect(screen.getByText('信誉分 90')).toBeInTheDocument();
  });

  it('点击返回按钮调用 navigate(-1)', async () => {
    renderServiceDetail();
    // service.title 在 h1 和 h2 中渲染两次，用 getAllByText 避免多元素匹配错误
    await waitFor(() => {
      expect(screen.getAllByText('他人服务').length).toBeGreaterThan(0);
    });
    // 返回按钮是顶部第一个按钮，className 含 p-1
    const backButton = document.querySelector('button.p-1');
    expect(backButton).toBeTruthy();
    await act(async () => {
      fireEvent.click(backButton!);
    });
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('加载失败时点击"返回列表"跳转到 /time-bank', async () => {
    vi.mocked(getService).mockRejectedValue(new Error('网络错误'));
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByRole('button', { name: '返回列表' }).click();
    });
    expect(navigateMock).toHaveBeenCalledWith('/time-bank');
  });
});

// ==================== 订单创建测试 ====================
// 设计原因：补全 createOrder 全链路测试，覆盖未登录、按钮禁用、提交中、成功、失败场景
describe('ServiceDetail 订单创建', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认返回他人发布的 active 服务，已认证用户可发起请求
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockOtherUserService });
    vi.mocked(createOrder).mockResolvedValue({ code: 0, message: 'ok', data: { id: 'order-1', serviceId: 'svc-3', providerId: 'user-other', requesterId: 'user-self', durationMinutes: 60, status: 'pending' as const, createdAt: '2024-01-01T00:00:00.000Z' } });
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('未登录时底部显示"请先登录后再发起请求"', async () => {
    vi.mocked(useAuth).mockReturnValue(mockUnauthenticated);
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByText('请先登录后再发起请求')).toBeInTheDocument();
    });
    // 不应显示发起请求按钮
    expect(screen.queryByRole('button', { name: '发起请求' })).toBeNull();
  });

  it('已登录且服务 active 时显示"发起请求"按钮', async () => {
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起请求' })).toBeInTheDocument();
    });
  });

  it('服务非 active 状态时"发起请求"按钮禁用', async () => {
    // mockInactiveService.status='completed'，但 userId='user-self'（发布者本人）
    // 这里验证非 active 状态按钮禁用，与是否发布者无关
    vi.mocked(getService).mockResolvedValue({ code: 0, message: 'ok', data: mockInactiveService });
    renderServiceDetail();
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: '发起请求' });
      expect(btn).toBeDisabled();
    });
  });

  it('点击"发起请求"调用 createOrder 且参数包含 serviceId', async () => {
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起请求' })).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByRole('button', { name: '发起请求' }).click();
    });
    // serviceId 来自 useParams，默认为 'svc-1'
    expect(createOrder).toHaveBeenCalledWith({ serviceId: 'svc-1' });
  });

  it('提交中按钮显示"提交中..."并禁用', async () => {
    // 让 createOrder 永不 resolve，保持 submitting 状态
    vi.mocked(createOrder).mockImplementation(() => new Promise(() => {}));
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起请求' })).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByRole('button', { name: '发起请求' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText('提交中...')).toBeInTheDocument();
    });
  });

  it('提交成功显示"请求已发起成功！"', async () => {
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起请求' })).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByRole('button', { name: '发起请求' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText('请求已发起成功！')).toBeInTheDocument();
    });
    // 成功提示 toast
    expect(toastSuccessMock).toHaveBeenCalledWith('需求已发布，等待响应');
  });

  it('提交失败显示 toast.error 错误信息', async () => {
    vi.mocked(createOrder).mockRejectedValue(new Error('创建订单失败'));
    renderServiceDetail();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起请求' })).toBeInTheDocument();
    });
    await act(async () => {
      screen.getByRole('button', { name: '发起请求' }).click();
    });
    // 组件 catch 取 err.message 作为 toast.error 参数
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('创建订单失败');
    });
  });
});
