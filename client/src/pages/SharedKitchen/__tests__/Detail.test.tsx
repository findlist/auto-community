import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹交互，自动等待微任务 flush，
// 消除"异步 state 更新未被 act 包裹"警告，模拟真实用户点击序列
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Detail from '../Detail';
import type { KitchenPost } from '@/types';
import { ApiError } from '@/api/client';

// vi.hoisted 提升 mock 数据避免 TDZ：mock 多种美食帖子数据
const { mockActivePost, mockFreePost, mockDeliveryPost, mockAllergenPost, mockNeedPost, mockNoImagePost, mockLowRemainingPost } = vi.hoisted(() => {
  // active 帖子：offer 类型，有图片，自取，有剩余
  const activePost: KitchenPost = {
    id: 'post-active-1',
    userId: 'user-owner',
    user: { id: 'user-owner', nickname: '美食家老王', avatar: undefined, reputationScore: 4.8 },
    type: 'offer',
    title: '家常红烧肉',
    description: '正宗家常红烧肉，肥而不腻，入口即化，每天现做。',
    category: '家常菜',
    price: 10,
    quantity: 5,
    remaining: 3,
    pickupTime: '2024-01-15 18:00-20:00',
    pickupLocation: '北京市朝阳区某小区',
    pickupType: 'self_pickup',
    images: ['/uploads/red-meat.jpg'],
    healthCert: true,
    status: 'active',
    createdAt: '2024-01-10T10:00:00.000Z',
    updatedAt: '2024-01-10T10:00:00.000Z',
  };
  // 免费帖子：price=0，验证"免费"文案
  const freePost: KitchenPost = { ...activePost, id: 'post-free-1', price: 0, title: '免费馒头' };
  // 配送帖子：pickupType=delivery，预约弹窗应显示"自取/配送"切换
  const deliveryPost: KitchenPost = { ...activePost, id: 'post-delivery-1', pickupType: 'delivery', title: '可配送的饺子' };
  // 过敏原帖子：allergens 非空，应渲染过敏原提醒
  const allergenPost: KitchenPost = { ...activePost, id: 'post-allergen-1', allergens: ['花生', '海鲜'], title: '花生酱面条' };
  // need 帖子：type=need，不应显示"立即预约"按钮
  const needPost: KitchenPost = { ...activePost, id: 'post-need-1', type: 'need', title: '求购家乡特产' };
  // 无图片帖子：images 为空，应渲染 emoji 占位符
  const noImagePost: KitchenPost = { ...activePost, id: 'post-no-img-1', images: [], title: '无图美食' };
  // 低剩余帖子：remaining=2，用于验证份数上限校验
  const lowRemainingPost: KitchenPost = { ...activePost, id: 'post-low-1', remaining: 2, title: '限量美食' };
  return {
    mockActivePost: activePost,
    mockFreePost: freePost,
    mockDeliveryPost: deliveryPost,
    mockAllergenPost: allergenPost,
    mockNeedPost: needPost,
    mockNoImagePost: noImagePost,
    mockLowRemainingPost: lowRemainingPost,
  };
});

// mock kitchen API：getFoodShareById 默认返回 mockActivePost，createFoodOrder 默认成功
vi.mock('@/api/kitchen', () => ({
  getFoodShareById: vi.fn(async () => ({ code: 0, message: 'ok', data: mockActivePost })),
  createFoodOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: { id: 'order-1' } })),
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

// mock useNavigate：捕获跳转调用便于断言
const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// 引入被 mock 的 API 以便在用例中配置返回值
import { getFoodShareById, createFoodOrder } from '@/api/kitchen';

// 包装组件：注入 MemoryRouter + Route 提供 useParams 上下文
// 设计原因：useParams 依赖路由匹配，必须用 Route path="/kitchen/:id" 才能正确解析 id
function renderDetail(postId = 'post-active-1') {
  return render(
    <MemoryRouter initialEntries={[`/kitchen/${postId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/kitchen/:id" element={<Detail />} />
      </Routes>
    </MemoryRouter>
  );
}

// 定位预约弹窗 +/- 按钮：按钮无 accessible name，通过 className + 文本内容双重判断
function findPlusMinusButtons() {
  const buttons = document.querySelectorAll('button.rounded-full');
  const plusBtn = Array.from(buttons).find(b => b.textContent === '+');
  const minusBtn = Array.from(buttons).find(b => b.textContent === '-');
  return { plusBtn: plusBtn as HTMLButtonElement, minusBtn: minusBtn as HTMLButtonElement };
}

describe('SharedKitchen/Detail 美食详情', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockActivePost });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中显示骨架屏 animate-pulse', async () => {
    // 让 getFoodShareById 永不 resolve，保持 loading 状态
    vi.mocked(getFoodShareById).mockImplementation(() => new Promise(() => {}));

    renderDetail();

    // 骨架屏应可见（animate-pulse 是 className）
    const skeletonBlocks = document.querySelectorAll('.animate-pulse');
    expect(skeletonBlocks.length).toBeGreaterThan(0);
  });

  it('加载完成显示美食详情（标题/分类/价格/描述/位置）', async () => {
    renderDetail();

    // 用分类"家常菜"作为加载完成标志（页面唯一）
    await screen.findByText('家常菜');
    expect(screen.getByText('家常红烧肉')).toBeInTheDocument();
    expect(screen.getByText('10积分')).toBeInTheDocument();
    expect(screen.getByText('剩余 3/5 份')).toBeInTheDocument();
    expect(screen.getByText('正宗家常红烧肉，肥而不腻，入口即化，每天现做。')).toBeInTheDocument();
    expect(screen.getByText('北京市朝阳区某小区')).toBeInTheDocument();
    expect(screen.getByText('2024-01-15 18:00-20:00')).toBeInTheDocument();
    expect(screen.getByText('仅自取')).toBeInTheDocument();
    expect(screen.getByText('美食家老王')).toBeInTheDocument();
  });

  it('price=0 显示"免费"文案', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockFreePost });

    renderDetail();

    await screen.findByText('免费馒头');
    expect(screen.getByText('免费')).toBeInTheDocument();
  });

  it('有图片时渲染 img 元素', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    const img = screen.getByAltText('家常红烧肉');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/uploads/red-meat.jpg');
  });

  it('无图片时渲染 emoji 占位符', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockNoImagePost });

    renderDetail();

    await screen.findByText('无图美食');
    // offer 类型无图应渲染 🍲 emoji
    expect(screen.getByText('🍲')).toBeInTheDocument();
  });

  it('need 类型无图渲染 🍜 emoji', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({
      code: 0, message: 'ok',
      data: { ...mockNoImagePost, type: 'need' } as KitchenPost,
    });

    renderDetail();

    await screen.findByText('无图美食');
    expect(screen.getByText('🍜')).toBeInTheDocument();
  });

  it('有过敏原时渲染过敏原提醒', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockAllergenPost });

    renderDetail();

    // 用过敏原标签作为加载完成标志
    await screen.findByText('花生');
    expect(screen.getByText('过敏原信息')).toBeInTheDocument();
    expect(screen.getByText('花生')).toBeInTheDocument();
    expect(screen.getByText('海鲜')).toBeInTheDocument();
  });

  it('无过敏原时不渲染过敏原提醒', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    expect(screen.queryByText('过敏原信息')).toBeNull();
  });

  it('healthCert=true 显示"已认证"标识', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    expect(screen.getByText('✓ 已认证')).toBeInTheDocument();
  });

  it('healthCert=false 不显示"已认证"标识', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({
      code: 0, message: 'ok',
      data: { ...mockActivePost, healthCert: false } as KitchenPost,
    });

    renderDetail();

    await screen.findByText('家常红烧肉');
    expect(screen.queryByText('✓ 已认证')).toBeNull();
  });

  it('offer + remaining>0 显示"立即预约"按钮', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    expect(screen.getByRole('button', { name: '立即预约' })).toBeInTheDocument();
  });

  it('need 类型不显示"立即预约"按钮', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockNeedPost });

    renderDetail();

    await screen.findByText('求购家乡特产');
    expect(screen.queryByRole('button', { name: '立即预约' })).toBeNull();
  });

  it('remaining=0 不显示"立即预约"按钮', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({
      code: 0, message: 'ok',
      data: { ...mockActivePost, remaining: 0 } as KitchenPost,
    });

    renderDetail();

    await screen.findByText('家常红烧肉');
    expect(screen.queryByRole('button', { name: '立即预约' })).toBeNull();
  });

  it('点击"查看评价"跳转到评价页', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');

    await user.click(screen.getByRole('button', { name: '查看评价' }));

    expect(navigateMock).toHaveBeenCalledWith('/kitchen/post-active-1/reviews');
  });

  it('点击"立即预约"打开预约弹窗', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');

    // 初始无弹窗
    expect(screen.queryByText('预约领取')).toBeNull();

    await user.click(screen.getByRole('button', { name: '立即预约' }));

    expect(screen.getByText('预约领取')).toBeInTheDocument();
    expect(screen.getByText('领取份数')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认预约' })).toBeInTheDocument();
  });

  it('预约弹窗点击"+/-"调整份数并更新总价', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    // 初始份数为1，总价应为 price*1=10
    expect(screen.getByText('共 10 积分')).toBeInTheDocument();

    const { plusBtn, minusBtn } = findPlusMinusButtons();

    await user.click(plusBtn);
    // 份数应为2，总价应为 price*2=20
    expect(screen.getByText('共 20 积分')).toBeInTheDocument();

    await user.click(minusBtn);
    // 份数应回到1，总价应为 10
    expect(screen.getByText('共 10 积分')).toBeInTheDocument();
  });

  it('预约弹窗份数不能超过剩余份数', async () => {
    // remaining=2：点击"+"两次后应被限制在 2
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockLowRemainingPost });

    renderDetail();

    await screen.findByText('限量美食');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    const { plusBtn } = findPlusMinusButtons();

    // 第一次点击：1 -> 2，总价 20
    await user.click(plusBtn);
    expect(screen.getByText('共 20 积分')).toBeInTheDocument();

    // 第二次点击：应被 Math.min(remaining=2, 3) 限制为 2，总价仍是 20
    await user.click(plusBtn);
    expect(screen.getByText('共 20 积分')).toBeInTheDocument();
  });

  it('预约弹窗份数不能小于 1', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    const { minusBtn } = findPlusMinusButtons();

    // 初始份数已是 1，点击"-"应被 Math.max(1, 0) 限制为 1，总价仍是 10
    await user.click(minusBtn);
    expect(screen.getByText('共 10 积分')).toBeInTheDocument();
  });

  it('delivery 类型显示"自取/配送"切换按钮', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockDeliveryPost });

    renderDetail();

    await screen.findByText('可配送的饺子');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    // 应显示"自取"和"配送"切换按钮
    expect(screen.getByText('领取方式')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自取' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '配送' })).toBeInTheDocument();
  });

  it('self_pickup 类型不显示"自取/配送"切换', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    // 不应渲染领取方式区域
    expect(screen.queryByText('领取方式')).toBeNull();
    expect(screen.queryByRole('button', { name: '自取' })).toBeNull();
    expect(screen.queryByRole('button', { name: '配送' })).toBeNull();
  });

  it('点击"自取/配送"切换 pickupType', async () => {
    vi.mocked(getFoodShareById).mockResolvedValue({ code: 0, message: 'ok', data: mockDeliveryPost });

    renderDetail();

    await screen.findByText('可配送的饺子');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    // 默认 self_pickup，"自取"按钮应有 emerald 边框样式
    const selfPickupBtn = screen.getByRole('button', { name: '自取' });
    expect(selfPickupBtn.className).toContain('border-emerald-500');

    // 切换到 delivery
    await user.click(screen.getByRole('button', { name: '配送' }));
    expect(selfPickupBtn.className).not.toContain('border-emerald-500');
    expect(screen.getByRole('button', { name: '配送' }).className).toContain('border-emerald-500');
  });

  it('备注 textarea 输入文本', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    const textarea = screen.getByPlaceholderText('有什么需要特别说明的吗？') as HTMLTextAreaElement;
    await user.type(textarea, '少放辣');

    expect(textarea.value).toBe('少放辣');
  });

  it('点击"确认预约"调用 createFoodOrder', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    await user.click(screen.getByRole('button', { name: '确认预约' }));

    // 应以默认参数调用 createFoodOrder
    await waitFor(() => {
      expect(createFoodOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: 'post-active-1',
          quantity: 1,
          pickupType: 'self_pickup',
        })
      );
    });
  });

  it('预约成功显示 toast.success 并跳转订单页', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    await user.click(screen.getByRole('button', { name: '确认预约' }));

    // 应显示成功提示
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('预约成功');
    });

    // 应跳转到订单列表页
    expect(navigateMock).toHaveBeenCalledWith('/kitchen/orders');
  });

  it('预约失败显示 toast.error 错误提示', async () => {
    // 实际运行时拦截器已将 HTTP 错误转为 ApiError，mock 需对齐该结构
    vi.mocked(createFoodOrder).mockRejectedValue(new ApiError('库存不足，预约失败', 400));

    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    await user.click(screen.getByRole('button', { name: '确认预约' }));

    // 应显示后端返回的错误消息
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('库存不足，预约失败');
    });

    // 不应跳转
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('点击"取消"关闭弹窗不调用 API', async () => {
    renderDetail();

    await screen.findByText('家常红烧肉');
    await user.click(screen.getByRole('button', { name: '立即预约' }));

    expect(screen.getByText('预约领取')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消' }));

    // 弹窗应关闭
    await waitFor(() => {
      expect(screen.queryByText('预约领取')).toBeNull();
    });

    // 不应调用 createFoodOrder
    expect(createFoodOrder).not.toHaveBeenCalled();
  });

  it('加载失败显示错误提示与"返回列表"按钮', async () => {
    // 模拟接口抛错，组件 catch 后记录 error，post 保持 null，走加载错误分支
    vi.mocked(getFoodShareById).mockRejectedValue(new Error('not found'));

    renderDetail();

    // 等待 loading 结束，应渲染错误提示（非 ApiError 走"加载失败"兜底文案）
    await screen.findByText('加载失败');
    // "返回列表"按钮应可见
    expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument();
  });
});
