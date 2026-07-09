import { describe, it, expect, beforeEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告，与项目其他测试风格一致
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Create from '../Create';

// vi.hoisted 提升 mock 数据避免 TDZ
const { createPostMock, toastSuccessMock, toastErrorMock, navigateMock } = vi.hoisted(() => ({
  createPostMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  navigateMock: vi.fn(),
}));

// mock createPost：默认成功返回，单测可通过 mockRejectedValueOnce 切换失败场景
vi.mock('@/api/skills', () => ({
  createPost: createPostMock,
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

// 引入 ApiError 用于构造失败场景的错误对象
import { ApiError } from '@/api/client';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文，启用 v7 future flag 消除警告
function renderCreatePage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Create />
    </MemoryRouter>
  );
}

// 辅助函数：填充 offer 类型完整有效表单数据
function fillValidOfferForm() {
  fireEvent.change(screen.getByPlaceholderText('例如：擅长电脑维修、系统安装'), { target: { value: '专业电脑维修服务' } });
  fireEvent.blur(screen.getByPlaceholderText('例如：擅长电脑维修、系统安装'));
  fireEvent.change(screen.getByPlaceholderText('详细描述你的技能或需求...'), { target: { value: '提供专业电脑维修、系统安装、数据恢复服务' } });
  // 分类按钮：点击"电脑维修"
  fireEvent.click(screen.getByRole('button', { name: '电脑维修' }));
  fireEvent.change(screen.getByPlaceholderText('设置每次服务的积分价格'), { target: { value: '50' } });
  fireEvent.blur(screen.getByPlaceholderText('设置每次服务的积分价格'));
  fireEvent.change(screen.getByPlaceholderText('如：3号楼1单元（选填）'), { target: { value: '3号楼1单元' } });
}

describe('SkillExchange/Create 发布技能表单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPostMock.mockResolvedValue({ code: 0, message: 'ok', data: {} });
  });

  it('渲染表单显示标题"发布技能"与提交按钮"立即发布"', () => {
    renderCreatePage();
    expect(screen.getByRole('heading', { name: '发布技能' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即发布' })).toBeInTheDocument();
  });

  it('默认类型为"提供技能"，点击切换为"需求技能"', () => {
    renderCreatePage();
    const offerBtn = screen.getByRole('button', { name: '提供技能' });
    const requestBtn = screen.getByRole('button', { name: '需求技能' });
    // 默认 offer 高亮（bg-emerald-600）
    expect(offerBtn.className).toContain('bg-emerald-600');
    act(() => { fireEvent.click(requestBtn); });
    expect(requestBtn.className).toContain('bg-emerald-600');
    expect(offerBtn.className).not.toContain('bg-emerald-600');
  });

  it('offer 类型显示积分价格输入框，切换到 request 类型隐藏', () => {
    renderCreatePage();
    // 默认 offer 显示积分价格
    expect(screen.getByPlaceholderText('设置每次服务的积分价格')).toBeInTheDocument();
    // 切换到 request
    act(() => { fireEvent.click(screen.getByRole('button', { name: '需求技能' })); });
    expect(screen.queryByPlaceholderText('设置每次服务的积分价格')).not.toBeInTheDocument();
  });

  it('request 类型不显示积分价格，提交时不传 creditsRequired 校验', async () => {
    renderCreatePage();
    act(() => { fireEvent.click(screen.getByRole('button', { name: '需求技能' })); });
    fireEvent.change(screen.getByPlaceholderText('例如：想学英语、需要家教'), { target: { value: '想学英语口语' } });
    fireEvent.blur(screen.getByPlaceholderText('例如：想学英语、需要家教'));
    fireEvent.change(screen.getByPlaceholderText('详细描述你的技能或需求...'), { target: { value: '希望找一位英语口语老师，每周两次课' } });
    fireEvent.click(screen.getByRole('button', { name: '电脑维修' }));
    fireEvent.change(screen.getByPlaceholderText('如：3号楼1单元（选填）'), { target: { value: '3号楼' } });
    // request 类型无积分价格校验，应能提交
    fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    // 设计原因：用 waitFor 替代 return act(async(){...})，避免异步 act 与 waitFor 嵌套触发 act 环境警告
    await waitFor(() => {
      expect(createPostMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'request',
        creditsRequired: 0,
      }));
    });
  });

  it('标题为空时校验失败显示"请填写标题"', () => {
    renderCreatePage();
    fireEvent.blur(screen.getByPlaceholderText('例如：擅长电脑维修、系统安装'));
    expect(screen.getByText('请填写标题')).toBeInTheDocument();
  });

  it('标题少于2字符校验失败显示"标题至少需要2个字符"', () => {
    renderCreatePage();
    const titleInput = screen.getByPlaceholderText('例如：擅长电脑维修、系统安装');
    fireEvent.change(titleInput, { target: { value: 'A' } });
    fireEvent.blur(titleInput);
    expect(screen.getByText('标题至少需要2个字符')).toBeInTheDocument();
  });

  it('描述少于10字符校验失败显示"详细描述至少需要10个字符"', () => {
    renderCreatePage();
    const descTextarea = screen.getByPlaceholderText('详细描述你的技能或需求...');
    fireEvent.change(descTextarea, { target: { value: '太短了' } });
    fireEvent.blur(descTextarea);
    expect(screen.getByText('详细描述至少需要10个字符')).toBeInTheDocument();
  });

  it('未选择分类时校验失败显示"请填写分类"', () => {
    renderCreatePage();
    // 触发表单校验需要点击提交按钮（分类无 blur 校验，只在 validateAll 时校验）
    act(() => { fireEvent.click(screen.getByRole('button', { name: '立即发布' })); });
    expect(screen.getByText('请填写分类')).toBeInTheDocument();
  });

  it('offer 类型积分为空时校验失败显示"请填写积分价格"', () => {
    renderCreatePage();
    // 填充其他必填字段，仅积分价格为空
    fireEvent.change(screen.getByPlaceholderText('例如：擅长电脑维修、系统安装'), { target: { value: '专业电脑维修' } });
    fireEvent.click(screen.getByRole('button', { name: '电脑维修' }));
    // 积分价格留空，点击提交触发校验
    act(() => { fireEvent.click(screen.getByRole('button', { name: '立即发布' })); });
    expect(screen.getByText('请填写积分价格')).toBeInTheDocument();
  });

  it('表单校验不通过时不调用 createPost', async () => {
    renderCreatePage();
    act(() => { fireEvent.click(screen.getByRole('button', { name: '立即发布' })); });
    await waitFor(() => {
      expect(createPostMock).not.toHaveBeenCalled();
    });
  });

  it('填写完整有效数据点击发布调用 createPost 并跳转', async () => {
    renderCreatePage();
    fillValidOfferForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      expect(createPostMock).toHaveBeenCalledTimes(1);
      expect(createPostMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'offer',
        title: '专业电脑维修服务',
        category: '电脑维修',
        creditsRequired: 50,
        location: '3号楼1单元',
      }));
      expect(toastSuccessMock).toHaveBeenCalledWith('发布成功');
      expect(navigateMock).toHaveBeenCalledWith('/skills');
    });
  });

  it('提交成功时 images 为空数组转 undefined 避免发送空数组', async () => {
    renderCreatePage();
    fillValidOfferForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      expect(createPostMock).toHaveBeenCalledWith(expect.objectContaining({
        images: undefined,
      }));
    });
  });

  it('提交失败(ApiError)显示 toast.error 错误提示，不跳转', async () => {
    // ApiError 第3参数 fieldErrors 可选，此处无需传递
    createPostMock.mockRejectedValueOnce(new ApiError('积分余额不足', 400));
    renderCreatePage();
    fillValidOfferForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('积分余额不足');
      expect(navigateMock).not.toHaveBeenCalled();
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });
  });

  it('提交失败(普通Error)显示兜底文案"发布失败"', async () => {
    createPostMock.mockRejectedValueOnce(new Error('网络错误'));
    renderCreatePage();
    fillValidOfferForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      // 原生 Error 走 fallback，避免技术性 message 泄露给用户
      expect(toastErrorMock).toHaveBeenCalledWith('发布失败');
    });
  });

  it('提交中按钮显示"发布中..."', async () => {
    // 用永不 resolve 的 Promise 锁定 submitting 状态
    createPostMock.mockImplementationOnce(() => new Promise(() => {}));
    renderCreatePage();
    fillValidOfferForm();
    act(() => { fireEvent.click(screen.getByRole('button', { name: '立即发布' })); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发布中...' })).toBeInTheDocument();
    });
  });

  it('点击返回按钮调用 navigate(-1) 返回上一页', () => {
    renderCreatePage();
    // 返回按钮是顶部 ArrowLeft 图标按钮
    const backBtn = screen.getAllByRole('button').find(btn => btn.querySelector('svg.lucide-arrow-left'));
    expect(backBtn).toBeDefined();
    act(() => { fireEvent.click(backBtn!); });
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('渲染 ImageUpload 图片上传组件', () => {
    renderCreatePage();
    expect(screen.getByTestId('mock-image-upload')).toBeInTheDocument();
  });

  it('点击分类按钮选中并高亮显示', () => {
    renderCreatePage();
    const categoryBtn = screen.getByRole('button', { name: '电脑维修' });
    // 未选中时为灰色背景
    expect(categoryBtn.className).toContain('bg-gray-100');
    act(() => { fireEvent.click(categoryBtn); });
    // 选中后为 emerald 高亮
    expect(categoryBtn.className).toContain('bg-emerald-100');
    expect(categoryBtn.className).toContain('text-emerald-700');
  });
});
