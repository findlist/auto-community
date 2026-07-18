import { describe, it, expect, beforeEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告，与项目其他测试风格一致
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Create from '../Create';

// vi.hoisted 提升 mock 数据避免 TDZ
const { createFoodShareMock, toastSuccessMock, toastErrorMock, navigateMock } = vi.hoisted(() => ({
  createFoodShareMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  navigateMock: vi.fn(),
}));

// mock createFoodShare：默认成功返回，单测可通过 mockRejectedValueOnce 切换失败场景
vi.mock('@/api/kitchen', () => ({
  createFoodShare: createFoodShareMock,
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

// 引入被 mock 的 API 类型（vi.mocked 需要 import 引用）
// 设计原因：createFoodShareMock 已在 vi.hoisted 中创建，此处无需 import createFoodShare

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
  fireEvent.change(screen.getByPlaceholderText('今天做了什么好吃的？'), { target: { value: '红烧肉盖饭' } });
  fireEvent.blur(screen.getByPlaceholderText('今天做了什么好吃的？'));
  fireEvent.change(screen.getByPlaceholderText('描述一下这道美食...'), { target: { value: '家常红烧肉，配米饭' } });
  // 分类按钮：点击"家常菜"
  fireEvent.click(screen.getByRole('button', { name: '家常菜' }));
  // 价格（默认0，需输入有效值）
  const priceInput = screen.getByDisplayValue('0');
  fireEvent.change(priceInput, { target: { value: '10' } });
  fireEvent.blur(priceInput);
  // 份数默认1，无需改
  fireEvent.change(screen.getByPlaceholderText('如：3号楼1单元102'), { target: { value: '3号楼1单元102' } });
  fireEvent.blur(screen.getByPlaceholderText('如：3号楼1单元102'));
  fireEvent.change(screen.getByPlaceholderText('如：今天17:00-19:00'), { target: { value: '今天17:00-19:00' } });
}

describe('SharedKitchen/Create 发布美食表单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFoodShareMock.mockResolvedValue({ code: 0, message: 'ok', data: {} });
  });

  it('渲染表单显示提交按钮"立即发布"', () => {
    renderCreatePage();
    expect(screen.getByRole('button', { name: '立即发布' })).toBeInTheDocument();
  });

  it('默认类型为"我要分享"，点击切换为"我有需求"', () => {
    renderCreatePage();
    const offerBtn = screen.getByRole('button', { name: '🍲 我要分享' });
    const needBtn = screen.getByRole('button', { name: '🍜 我有需求' });
    // 默认 offer 高亮（bg-orange-600，厨房模块橙）
    expect(offerBtn.className).toContain('bg-orange-600');
    act(() => { fireEvent.click(needBtn); });
    expect(needBtn.className).toContain('bg-orange-600');
    expect(offerBtn.className).not.toContain('bg-orange-600');
  });

  it('offer 类型显示领取地点/领取时间/领取方式/过敏原，切换到 need 类型隐藏', () => {
    renderCreatePage();
    // 默认 offer 显示
    expect(screen.getByPlaceholderText('如：3号楼1单元102')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('如：今天17:00-19:00')).toBeInTheDocument();
    expect(screen.getByText('自取')).toBeInTheDocument();
    expect(screen.getByText('可配送')).toBeInTheDocument();
    expect(screen.getByText('鸡蛋')).toBeInTheDocument();
    // 切换到 need
    act(() => { fireEvent.click(screen.getByRole('button', { name: '🍜 我有需求' })); });
    expect(screen.queryByPlaceholderText('如：3号楼1单元102')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('如：今天17:00-19:00')).not.toBeInTheDocument();
    expect(screen.queryByText('自取')).not.toBeInTheDocument();
    expect(screen.queryByText('鸡蛋')).not.toBeInTheDocument();
  });

  it('标题为空时校验失败显示"请填写标题"', () => {
    renderCreatePage();
    fireEvent.blur(screen.getByPlaceholderText('今天做了什么好吃的？'));
    expect(screen.getByText('请填写标题')).toBeInTheDocument();
  });

  it('标题少于2字符校验失败显示"标题至少需要2个字符"', () => {
    renderCreatePage();
    const titleInput = screen.getByPlaceholderText('今天做了什么好吃的？');
    fireEvent.change(titleInput, { target: { value: 'A' } });
    fireEvent.blur(titleInput);
    expect(screen.getByText('标题至少需要2个字符')).toBeInTheDocument();
  });

  it('offer 类型领取地点为空时校验失败显示"请填写领取地点"', () => {
    renderCreatePage();
    // 触发表单校验需要点击提交按钮
    fireEvent.change(screen.getByPlaceholderText('今天做了什么好吃的？'), { target: { value: '红烧肉' } });
    fireEvent.click(screen.getByRole('button', { name: '家常菜' }));
    act(() => { fireEvent.click(screen.getByRole('button', { name: '立即发布' })); });
    expect(screen.getByText('请填写领取地点')).toBeInTheDocument();
  });

  it('表单校验不通过时不调用 createFoodShare', async () => {
    renderCreatePage();
    act(() => { fireEvent.click(screen.getByRole('button', { name: '立即发布' })); });
    await waitFor(() => {
      expect(createFoodShareMock).not.toHaveBeenCalled();
    });
  });

  it('填写完整有效数据点击发布调用 createFoodShare 并跳转', async () => {
    renderCreatePage();
    fillValidOfferForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      expect(createFoodShareMock).toHaveBeenCalledTimes(1);
      expect(createFoodShareMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'offer',
        title: '红烧肉盖饭',
        category: '家常菜',
        price: 10,
        quantity: 1,
        pickupLocation: '3号楼1单元102',
        pickupTime: '今天17:00-19:00',
        pickupType: 'self_pickup',
      }));
      expect(toastSuccessMock).toHaveBeenCalledWith('发布成功');
      expect(navigateMock).toHaveBeenCalledWith('/kitchen');
    });
  });

  it('提交成功时 images 与 allergens 为空数组转 undefined', async () => {
    renderCreatePage();
    fillValidOfferForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      expect(createFoodShareMock).toHaveBeenCalledWith(expect.objectContaining({
        images: undefined,
        allergens: undefined,
      }));
    });
  });

  it('点击过敏原按钮选中并高亮，再次点击取消选中', () => {
    renderCreatePage();
    const allergenBtn = screen.getByRole('button', { name: '鸡蛋' });
    // 未选中为中性色
    expect(allergenBtn.className).toContain('bg-neutral-100');
    // 选中为橙色
    act(() => { fireEvent.click(allergenBtn); });
    expect(allergenBtn.className).toContain('bg-orange-100');
    expect(allergenBtn.className).toContain('text-orange-700');
    // 再次点击取消
    act(() => { fireEvent.click(allergenBtn); });
    expect(allergenBtn.className).toContain('bg-neutral-100');
    expect(allergenBtn.className).not.toContain('bg-orange-100');
  });

  it('选中过敏原后提交 allergens 数组传给后端', async () => {
    renderCreatePage();
    fillValidOfferForm();
    // 选两个过敏原："鸡蛋"仅过敏原区有，"海鲜"在分类区与过敏原区都有
    // 设计原因：getAllByRole 按渲染顺序返回，分类区"海鲜"在前(index 5)，过敏原区"海鲜"在后(index 12)，取最后一个
    act(() => { fireEvent.click(screen.getByRole('button', { name: '鸡蛋' })); });
    const seafoodBtns = screen.getAllByRole('button', { name: '海鲜' });
    act(() => { fireEvent.click(seafoodBtns[seafoodBtns.length - 1]!); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      expect(createFoodShareMock).toHaveBeenCalledWith(expect.objectContaining({
        allergens: ['鸡蛋', '海鲜'],
      }));
    });
  });

  it('点击领取方式"可配送"切换 pickupType 为 delivery', () => {
    renderCreatePage();
    const selfBtn = screen.getByRole('button', { name: '自取' });
    const deliveryBtn = screen.getByRole('button', { name: '可配送' });
    // 默认 self_pickup
    expect(selfBtn.className).toContain('border-orange-500');
    expect(selfBtn.className).toContain('bg-orange-50');
    act(() => { fireEvent.click(deliveryBtn); });
    expect(deliveryBtn.className).toContain('border-orange-500');
    expect(deliveryBtn.className).toContain('bg-orange-50');
    expect(selfBtn.className).not.toContain('border-orange-500');
  });

  it('need 类型不显示分享份数字段', () => {
    renderCreatePage();
    // offer 类型显示"分享份数"
    expect(screen.getByText('分享份数')).toBeInTheDocument();
    // 切换到 need
    act(() => { fireEvent.click(screen.getByRole('button', { name: '🍜 我有需求' })); });
    expect(screen.queryByText('分享份数')).not.toBeInTheDocument();
  });

  it('提交失败显示 toast.error 错误提示，不跳转', async () => {
    // 用原生 Error 模拟网络异常等非业务错误
    const err = new Error('网络错误');
    createFoodShareMock.mockRejectedValueOnce(err);
    renderCreatePage();
    fillValidOfferForm();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即发布' }));
    });
    await waitFor(() => {
      // 原生 Error 走 fallback，避免技术性 message 泄露给用户
      expect(toastErrorMock).toHaveBeenCalledWith('发布失败');
      expect(navigateMock).not.toHaveBeenCalled();
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });
  });

  it('提交中按钮显示"发布中..."', async () => {
    // 用永不 resolve 的 Promise 锁定 submitting 状态
    createFoodShareMock.mockImplementationOnce(() => new Promise(() => {}));
    renderCreatePage();
    fillValidOfferForm();
    act(() => { fireEvent.click(screen.getByRole('button', { name: '立即发布' })); });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发布中...' })).toBeInTheDocument();
    });
  });

  it('渲染 ImageUpload 图片上传组件', () => {
    renderCreatePage();
    expect(screen.getByTestId('mock-image-upload')).toBeInTheDocument();
  });

  it('点击分类按钮选中并高亮显示', () => {
    renderCreatePage();
    const categoryBtn = screen.getByRole('button', { name: '家常菜' });
    // 未选中为中性色
    expect(categoryBtn.className).toContain('bg-neutral-100');
    act(() => { fireEvent.click(categoryBtn); });
    // 选中为橙色高亮
    expect(categoryBtn.className).toContain('bg-orange-100');
    expect(categoryBtn.className).toContain('text-orange-700');
  });
});
