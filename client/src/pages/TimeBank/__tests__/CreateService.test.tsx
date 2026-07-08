import { describe, it, expect, beforeEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告，与 FamilyBinding 测试风格一致
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateService from '../CreateService';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖已登录/未登录两种鉴权状态
const { mockUser, mockUnauthenticated, createServiceMock, toastSuccessMock, toastErrorMock, navigateMock } = vi.hoisted(() => ({
  // 已登录用户：补全 User 接口必填字段，对齐 client/src/types/index.ts
  mockUser: {
    id: 'user-1',
    phone: '13800000001',
    nickname: '测试用户',
    creditBalance: 1000,
    timeBalance: 100,
    reputationScore: 90,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  // 未登录用户：用于验证 useEffect 跳转 /login 的鉴权分支
  mockUnauthenticated: {
    user: null,
    isAuthenticated: false,
    token: null,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  },
  createServiceMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  navigateMock: vi.fn(),
}));

// mock createService：默认成功返回，单测可通过 vi.mocked(createService).mockRejectedValueOnce 切换失败场景
vi.mock('@/api/timeBank', () => ({
  createService: createServiceMock,
}));

// mock useAuth：默认返回已登录用户，单测可通过 vi.mocked(useAuth).mockReturnValue 切换未登录
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
vi.mock('@/components/Toast', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// mock ImageUpload：简化为静态占位组件，避免依赖真实上传逻辑与文件 API
vi.mock('@/components/Upload/ImageUpload', () => ({
  default: function MockImageUpload() {
    return <div data-testid="mock-image-upload" />;
  },
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// 引入 useAuth 用于 vi.mocked 切换鉴权状态，ApiError 用于构造失败场景错误对象
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/api/client';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文，启用 v7 future flag 消除警告
function renderCreateServicePage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <CreateService />
    </MemoryRouter>
  );
}

// 辅助函数：填充完整有效表单数据，避免每个用例重复填写
function fillValidForm() {
  // 分类：直接输入文本（CreateService 用 input 而非按钮组）
  fireEvent.change(screen.getByPlaceholderText('如：家政服务、教育培训'), { target: { value: '家政服务' } });
  fireEvent.blur(screen.getByPlaceholderText('如：家政服务、教育培训'));
  fireEvent.change(screen.getByPlaceholderText('请输入服务标题'), { target: { value: '高质量家政服务' } });
  fireEvent.blur(screen.getByPlaceholderText('请输入服务标题'));
  fireEvent.change(screen.getByPlaceholderText('详细描述您提供的服务内容'), { target: { value: '提供专业保洁、收纳整理服务，五年经验' } });
  fireEvent.change(screen.getByPlaceholderText('60'), { target: { value: '120' } });
  fireEvent.blur(screen.getByPlaceholderText('60'));
  fireEvent.change(screen.getByPlaceholderText('请输入服务地址（选填）'), { target: { value: '3号楼1单元' } });
}

describe('TimeBank/CreateService 发布服务表单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认重置为已登录状态，避免上个用例的未登录状态污染
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
      token: 'test-token',
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });
    createServiceMock.mockResolvedValue({ code: 0, message: 'ok', data: {} });
  });

  it('已登录用户渲染表单显示标题与提交按钮', () => {
    renderCreateServicePage();
    expect(screen.getByRole('heading', { name: '发布服务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布服务' })).toBeInTheDocument();
  });

  it('未登录用户跳转 /login 不渲染表单', () => {
    vi.mocked(useAuth).mockReturnValue(mockUnauthenticated);
    renderCreateServicePage();
    expect(navigateMock).toHaveBeenCalledWith('/login');
  });

  it('默认服务类型为"提供服务"，点击切换为"需求服务"', () => {
    renderCreateServicePage();
    // 默认 provide 高亮（emerald 背景白字），点击 request 切换
    const provideBtn = screen.getByRole('button', { name: '提供服务' });
    const requestBtn = screen.getByRole('button', { name: '需求服务' });
    // 通过 class 判断当前激活状态（provide 激活时含 bg-emerald-600）
    expect(provideBtn.className).toContain('bg-emerald-600');
    act(() => { fireEvent.click(requestBtn); });
    expect(requestBtn.className).toContain('bg-emerald-600');
    expect(provideBtn.className).not.toContain('bg-emerald-600');
  });

  it('标题为空时校验失败显示"请填写标题"', () => {
    renderCreateServicePage();
    // 触发标题 blur 但不填值
    fireEvent.blur(screen.getByPlaceholderText('请输入服务标题'));
    expect(screen.getByText('请填写标题')).toBeInTheDocument();
  });

  it('标题少于2字符校验失败显示"标题至少需要2个字符"', () => {
    renderCreateServicePage();
    const titleInput = screen.getByPlaceholderText('请输入服务标题');
    fireEvent.change(titleInput, { target: { value: 'A' } });
    fireEvent.blur(titleInput);
    expect(screen.getByText('标题至少需要2个字符')).toBeInTheDocument();
  });

  it('分类为空时校验失败显示"请填写分类"', () => {
    renderCreateServicePage();
    fireEvent.blur(screen.getByPlaceholderText('如：家政服务、教育培训'));
    expect(screen.getByText('请填写分类')).toBeInTheDocument();
  });

  it('描述少于10字符校验失败显示"描述至少需要10个字符"', () => {
    renderCreateServicePage();
    const descTextarea = screen.getByPlaceholderText('详细描述您提供的服务内容');
    fireEvent.change(descTextarea, { target: { value: '太短了' } });
    fireEvent.blur(descTextarea);
    expect(screen.getByText('描述至少需要10个字符')).toBeInTheDocument();
  });

  it('服务时长为空时校验失败显示"请填写服务时长"', () => {
    renderCreateServicePage();
    fireEvent.blur(screen.getByPlaceholderText('60'));
    expect(screen.getByText('请填写服务时长')).toBeInTheDocument();
  });

  it('服务时长超出范围(>480)校验失败显示"服务时长必须在1到480之间"', () => {
    renderCreateServicePage();
    const durationInput = screen.getByPlaceholderText('60');
    fireEvent.change(durationInput, { target: { value: '500' } });
    fireEvent.blur(durationInput);
    // validateRange 输出格式为"服务时长必须在1到480之间"（无空格，对齐 formValidation.ts 实现）
    expect(screen.getByText('服务时长必须在1到480之间')).toBeInTheDocument();
  });

  it('表单校验不通过时不调用 createService', async () => {
    renderCreateServicePage();
    act(() => { fireEvent.click(screen.getByRole('button', { name: '发布服务' })); });
    await waitFor(() => {
      expect(createServiceMock).not.toHaveBeenCalled();
    });
  });

  it('填写完整有效数据点击发布调用 createService 并跳转', async () => {
    renderCreateServicePage();
    fillValidForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发布服务' }));
    });
    await waitFor(() => {
      expect(createServiceMock).toHaveBeenCalledTimes(1);
      expect(createServiceMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'provide',
        title: '高质量家政服务',
        category: '家政服务',
        durationMinutes: 120,
        location: '3号楼1单元',
      }));
      expect(toastSuccessMock).toHaveBeenCalledWith('服务发布成功');
      expect(navigateMock).toHaveBeenCalledWith('/time-bank');
    });
  });

  it('提交成功时 images 为空数组转 undefined 避免发送空数组', async () => {
    renderCreateServicePage();
    fillValidForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发布服务' }));
    });
    await waitFor(() => {
      // images 字段应为 undefined（空数组转 undefined，符合 CreateService 业务约定）
      expect(createServiceMock).toHaveBeenCalledWith(expect.objectContaining({
        images: undefined,
      }));
    });
  });

  it('提交失败显示红色背景错误提示，不跳转', async () => {
    // ApiError 第3参数 fieldErrors 可选，此处无需传递
    createServiceMock.mockRejectedValueOnce(new ApiError('网络错误，请重试', 500));
    renderCreateServicePage();
    fillValidForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发布服务' }));
    });
    await waitFor(() => {
      // formError 渲染为红色背景 + AlertCircle 图标的错误提示
      expect(screen.getByText('网络错误，请重试')).toBeInTheDocument();
      expect(navigateMock).not.toHaveBeenCalled();
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });
  });

  it('提交失败为非 ApiError 时显示兜底文案"发布失败，请重试"', async () => {
    createServiceMock.mockRejectedValueOnce(new Error('随机错误'));
    renderCreateServicePage();
    fillValidForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发布服务' }));
    });
    await waitFor(() => {
      expect(screen.getByText('发布失败，请重试')).toBeInTheDocument();
    });
  });

  it('提交中按钮禁用显示"提交中..."', async () => {
    // 用永不 resolve 的 Promise 锁定 submitting 状态，便于断言加载态
    createServiceMock.mockImplementationOnce(() => new Promise(() => {}));
    renderCreateServicePage();
    fillValidForm();
    act(() => { fireEvent.click(screen.getByRole('button', { name: '发布服务' })); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled();
    });
  });

  it('点击返回按钮调用 navigate(-1) 返回上一页', () => {
    renderCreateServicePage();
    // 返回按钮是顶部 ArrowLeft 图标按钮，无 accessible name，按 class 定位
    const backBtn = screen.getAllByRole('button').find(btn => btn.querySelector('svg.lucide-arrow-left'));
    expect(backBtn).toBeDefined();
    act(() => { fireEvent.click(backBtn!); });
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('渲染 ImageUpload 服务配图上传组件', () => {
    renderCreateServicePage();
    expect(screen.getByTestId('mock-image-upload')).toBeInTheDocument();
  });
});
