import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹交互，自动等待微任务 flush，
// 消除"异步 state 更新未被 act 包裹"警告，模拟真实用户点击序列
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Dispute from '../Dispute';
import type { SkillOrder } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖未争议/争议中/已裁决三种订单状态
const {
  mockPendingOrder,
  mockDisputedOrder,
  mockResolvedOrder,
  navigateMock,
} = vi.hoisted(() => {
  // 未争议订单：status=in_progress，无 disputeReason/resolution，触发"发起争议"表单
  const pending: SkillOrder = {
    id: 'order-pending-1',
    postId: 'post-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: 'in_progress',
    creditsAmount: 50,
    createdAt: '2024-01-10T10:00:00.000Z',
    post: { id: 'post-1', title: '吉他教学服务' },
    seller: { id: 'seller-1', nickname: '李老师' },
  } as unknown as SkillOrder;
  // 争议中订单：status=disputed，有 disputeReason，触发"争议处理中"卡片
  const disputed: SkillOrder = {
    ...pending,
    id: 'order-disputed-1',
    status: 'disputed',
    disputeReason: '对方未按时提供服务',
    disputeTime: '2024-01-11T10:00:00.000Z',
  } as unknown as SkillOrder;
  // 已裁决订单：有 resolution，触发"裁决结果"卡片（订单状态为 cancelled）
  const resolved: SkillOrder = {
    ...pending,
    id: 'order-resolved-1',
    status: 'cancelled',
    resolution: '已退款并取消订单',
    resolvedAt: '2024-01-12T10:00:00.000Z',
  } as unknown as SkillOrder;
  return {
    mockPendingOrder: pending,
    mockDisputedOrder: disputed,
    mockResolvedOrder: resolved,
    navigateMock: vi.fn(),
  };
});

// mock skills API：getOrder/disputeOrder 默认返回未争议订单
vi.mock('@/api/skills', () => ({
  getOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: mockPendingOrder })),
  disputeOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: mockDisputedOrder })),
}));

// mock useNavigate：捕获跳转调用便于断言
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// 引入被 mock 的 API 以便在用例中配置返回值
import { getOrder, disputeOrder } from '@/api/skills';
import { ApiError } from '@/api/client';

// 包装组件：注入 MemoryRouter + Route 提供 useParams 上下文
// 设计原因：useParams 依赖路由匹配，必须用 Route path="/skill-exchange/orders/:orderId/dispute" 才能正确解析 orderId
function renderDispute(orderId = 'order-pending-1') {
  return render(
    <MemoryRouter initialEntries={[`/skill-exchange/orders/${orderId}/dispute`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/skill-exchange/orders/:orderId/dispute" element={<Dispute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SkillExchange/Dispute 订单争议', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认返回未争议订单
    vi.mocked(getOrder).mockResolvedValue({ code: 0, message: 'ok', data: mockPendingOrder });
    vi.mocked(disputeOrder).mockResolvedValue({ code: 0, message: 'ok', data: mockDisputedOrder });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中显示 Loader2 旋转动画', () => {
    // 让 getOrder 永不 resolve，保持 loading 状态
    vi.mocked(getOrder).mockImplementation(() => new Promise(() => {}));

    renderDispute();

    // Loader2 的 animate-spin class 是加载态标志
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('getOrder 失败显示 ApiError 错误提示条', async () => {
    vi.mocked(getOrder).mockRejectedValue(new ApiError('订单已被删除', 404));

    renderDispute();

    // 等待错误提示条出现（红色背景 + AlertCircle 图标 + 错误文案）
    await screen.findByText('订单已被删除');
    expect(screen.getByText('订单已被删除')).toBeInTheDocument();
  });

  it('getOrder 失败且非 ApiError 时显示"加载订单失败"兜底文案', async () => {
    vi.mocked(getOrder).mockRejectedValue(new Error('网络错误'));

    renderDispute();

    await screen.findByText('加载订单失败');
    expect(screen.getByText('加载订单失败')).toBeInTheDocument();
  });

  it('订单不存在显示"订单不存在"与"返回订单列表"按钮，点击调用 navigate', async () => {
    // getOrder 返回成功但 data 为 null（订单不存在场景）
    vi.mocked(getOrder).mockResolvedValue({ code: 0, message: 'ok', data: null as unknown as SkillOrder });

    renderDispute();

    await screen.findByText('订单不存在');
    expect(screen.getByText('订单不存在')).toBeInTheDocument();

    const backButton = screen.getByRole('button', { name: '返回订单列表' });
    await user.click(backButton);

    expect(navigateMock).toHaveBeenCalledWith('/skill-exchange/orders');
  });

  it('顶部返回按钮点击调用 navigate("/skill-exchange/orders")', async () => {
    renderDispute();

    // 等待订单信息卡片加载完成
    await screen.findByText('吉他教学服务');

    // 顶部返回按钮是 ArrowLeft 图标按钮（无 accessible name，用 className 定位）
    const backButton = document.querySelector('button.p-1.hover\\:bg-gray-100.rounded') as HTMLButtonElement;
    expect(backButton).toBeTruthy();
    await user.click(backButton);

    expect(navigateMock).toHaveBeenCalledWith('/skill-exchange/orders');
  });

  it('订单信息卡片渲染标题、状态徽章、对方昵称、积分', async () => {
    renderDispute();

    // 等待订单标题加载完成
    await screen.findByText('吉他教学服务');
    // 状态徽章（in_progress → "进行中"）
    expect(screen.getByText('进行中')).toBeInTheDocument();
    // 对方昵称（seller.nickname）
    expect(screen.getByText(/李老师/)).toBeInTheDocument();
    // 积分
    expect(screen.getByText('50 积分')).toBeInTheDocument();
  });

  it('status=disputed 显示"争议处理中"卡片，含 disputeReason 与提示文案', async () => {
    vi.mocked(getOrder).mockResolvedValue({ code: 0, message: 'ok', data: mockDisputedOrder });

    renderDispute();

    await screen.findByText('争议处理中');
    expect(screen.getByText('争议处理中')).toBeInTheDocument();
    // 争议原因
    expect(screen.getByText('对方未按时提供服务')).toBeInTheDocument();
    // 提示文案
    expect(screen.getByText('管理员正在处理中，请耐心等待裁决结果。')).toBeInTheDocument();
  });

  it('有 resolution 时显示"裁决结果"卡片，含处理结果与订单状态徽章', async () => {
    vi.mocked(getOrder).mockResolvedValue({ code: 0, message: 'ok', data: mockResolvedOrder });

    renderDispute();

    await screen.findByText('裁决结果');
    expect(screen.getByText('裁决结果')).toBeInTheDocument();
    // 处理结果
    expect(screen.getByText('已退款并取消订单')).toBeInTheDocument();
    // cancelled 状态徽章（订单信息卡片 + 裁决结果卡片均显示"已取消"，故用 getAllByText）
    // 设计原因：mockResolvedOrder.status=cancelled，两处状态徽章文本相同，单元素查询会报多元素匹配
    expect(screen.getAllByText('已取消').length).toBeGreaterThanOrEqual(1);
  });

  it('未争议未裁决时显示"发起争议"表单，含 4 个预设原因 + textarea + 提交按钮', async () => {
    renderDispute();

    await screen.findByText('发起争议');
    expect(screen.getByText('发起争议')).toBeInTheDocument();
    // 4 个预设原因
    expect(screen.getByText('对方未按时提供服务')).toBeInTheDocument();
    expect(screen.getByText('服务质量与描述不符')).toBeInTheDocument();
    expect(screen.getByText('对方无法联系')).toBeInTheDocument();
    expect(screen.getByText('其他原因')).toBeInTheDocument();
    // textarea placeholder
    expect(screen.getByPlaceholderText('请详细描述争议原因...')).toBeInTheDocument();
    // 提交按钮
    expect(screen.getByRole('button', { name: '确认发起争议' })).toBeInTheDocument();
  });

  it('选择某个预设原因后 textarea 被清空，提交按钮启用', async () => {
    renderDispute();

    await screen.findByText('发起争议');

    // 先在 textarea 输入文本
    const textarea = screen.getByPlaceholderText('请详细描述争议原因...') as HTMLTextAreaElement;
    await user.type(textarea, '测试文本');
    expect(textarea.value).toBe('测试文本');

    // 选择第一个预设原因（radio）
    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);

    // textarea 应被清空（radio 与 textarea 互斥）
    expect(textarea.value).toBe('');
    // 提交按钮应启用（disabled 属性消失）
    const submitBtn = screen.getByRole('button', { name: '确认发起争议' });
    expect(submitBtn).not.toBeDisabled();
  });

  it('在 textarea 输入文本后 radio 取消选中，提交按钮启用', async () => {
    renderDispute();

    await screen.findByText('发起争议');

    // 先选择一个 radio
    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);
    expect(radio).toBeChecked();

    // 在 textarea 输入文本
    const textarea = screen.getByPlaceholderText('请详细描述争议原因...');
    await user.type(textarea, '自定义原因');

    // radio 应取消选中（textarea 与 radio 互斥）
    expect(radio).not.toBeChecked();
    // 提交按钮应启用
    const submitBtn = screen.getByRole('button', { name: '确认发起争议' });
    expect(submitBtn).not.toBeDisabled();
  });

  it('reason 与 selectedReason 均为空时提交按钮禁用', async () => {
    renderDispute();

    await screen.findByText('发起争议');

    const submitBtn = screen.getByRole('button', { name: '确认发起争议' });
    expect(submitBtn).toBeDisabled();
  });

  it('点击提交调用 disputeOrder，提交中按钮显示"提交中..."且禁用', async () => {
    // 让 disputeOrder 永不 resolve，保持 submitting 状态
    vi.mocked(disputeOrder).mockImplementation(() => new Promise(() => {}));

    renderDispute();

    await screen.findByText('发起争议');

    // 选择预设原因使提交按钮启用
    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);

    const submitBtn = screen.getByRole('button', { name: '确认发起争议' });
    await user.click(submitBtn);

    // 提交中按钮文案变为"提交中..."且禁用
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled();
    });

    // disputeOrder 应被调用，参数为 orderId 与选中的原因
    expect(disputeOrder).toHaveBeenCalledWith('order-pending-1', '对方未按时提供服务');
  });

  it('提交成功显示"争议已提交"成功卡片，含"返回订单列表"和"查看详情"按钮', async () => {
    renderDispute();

    await screen.findByText('发起争议');

    // 选择预设原因并提交
    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);
    await user.click(screen.getByRole('button', { name: '确认发起争议' }));

    // 成功卡片应出现
    await screen.findByText('争议已提交');
    expect(screen.getByText('争议已提交')).toBeInTheDocument();
    expect(screen.getByText('管理员将尽快处理您的争议申请')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回订单列表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看详情' })).toBeInTheDocument();

    // 提交成功后应重新调用 loadOrder 刷新订单状态（getOrder 被调用 2 次：初始 + 提交后）
    expect(vi.mocked(getOrder)).toHaveBeenCalledTimes(2);
  });

  it('成功卡片点击"返回订单列表"调用 navigate("/skill-exchange/orders")', async () => {
    renderDispute();

    await screen.findByText('发起争议');

    // 选择预设原因并提交
    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);
    await user.click(screen.getByRole('button', { name: '确认发起争议' }));

    await screen.findByText('争议已提交');
    await user.click(screen.getByRole('button', { name: '返回订单列表' }));

    expect(navigateMock).toHaveBeenCalledWith('/skill-exchange/orders');
  });

  it('成功卡片点击"查看详情"回到详情视图（setSuccess(false)）', async () => {
    // 链式配置 getOrder 返回值：
    // 设计原因：beforeEach 的 mockResolvedValue 默认返回 mockPendingOrder，
    // 提交成功后组件会再次调用 loadOrder 刷新订单状态，需让第二次调用返回 disputed 订单，
    // 才能验证"查看详情"点击后显示"争议处理中"卡片而非"发起争议"表单
    // mockResolvedValueOnce 优先于 mockResolvedValue 消费，消费完后回退到默认值
    vi.mocked(getOrder)
      .mockResolvedValueOnce({ code: 0, message: 'ok', data: mockPendingOrder })
      .mockResolvedValueOnce({ code: 0, message: 'ok', data: mockDisputedOrder });

    renderDispute();

    await screen.findByText('发起争议');

    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);
    await user.click(screen.getByRole('button', { name: '确认发起争议' }));

    await screen.findByText('争议已提交');
    // 点击"查看详情"回到详情视图
    await user.click(screen.getByRole('button', { name: '查看详情' }));

    // 应显示 disputed 订单的"争议处理中"卡片（loadOrder 刷新后订单为 disputed 状态）
    await screen.findByText('争议处理中');
    expect(screen.getByText('争议处理中')).toBeInTheDocument();
  });

  it('disputeOrder 失败显示错误提示条，submitting 复位', async () => {
    vi.mocked(disputeOrder).mockRejectedValue(new ApiError('请勿重复发起争议', 400));

    renderDispute();

    await screen.findByText('发起争议');

    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);
    await user.click(screen.getByRole('button', { name: '确认发起争议' }));

    // 错误提示条应出现
    await screen.findByText('请勿重复发起争议');
    expect(screen.getByText('请勿重复发起争议')).toBeInTheDocument();

    // submitting 复位，提交按钮恢复可点击
    expect(screen.getByRole('button', { name: '确认发起争议' })).not.toBeDisabled();
  });

  it('disputeOrder 失败且非 ApiError 时显示"发起争议失败"兜底文案', async () => {
    vi.mocked(disputeOrder).mockRejectedValue(new Error('网络错误'));

    renderDispute();

    await screen.findByText('发起争议');

    const radio = screen.getByRole('radio', { name: /对方未按时提供服务/ });
    await user.click(radio);
    await user.click(screen.getByRole('button', { name: '确认发起争议' }));

    await screen.findByText('发起争议失败');
    expect(screen.getByText('发起争议失败')).toBeInTheDocument();
  });
});
