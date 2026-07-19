import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PointsDetail from '../PointsDetail';

// vi.hoisted 提升 mock 数据避免 TDZ
const { mockUser, mockNavigate, getCreditHistoryMock } = vi.hoisted(() => ({
  // 补全 User 接口必填字段，避免 TS2740 类型错误
  mockUser: {
    id: 'user-1',
    nickname: '测试用户',
    phone: '13800138000',
    creditBalance: 500,
    timeBalance: 200,
    reputationScore: 90,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00Z',
  },
  mockNavigate: vi.fn(),
  getCreditHistoryMock: vi.fn(),
}));

// mock getCreditHistory：默认成功返回，单测可通过 mockResolvedValueOnce 切换场景
vi.mock('@/api/user', () => ({
  getCreditHistory: getCreditHistoryMock,
}));

// mock useAuth：默认已登录，单测可通过 mockReturnValueOnce 切换未登录场景
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ user: mockUser, isAuthenticated: true })),
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { useAuth } from '@/hooks/useAuth';

// 构造完整的 useAuth 返回值，补全 mock 未提供的 token/login/logout/setUser 字段
// 设计原因：useAuth 返回类型要求所有字段，mockReturnValue 必须提供完整对象，
// 用 as any 绕过类型检查会违反 no-explicit-any 规则，故用工厂函数集中补全默认值
function makeAuthValue(overrides: Partial<ReturnType<typeof useAuth>>): ReturnType<typeof useAuth> {
  return {
    user: null,
    token: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
    ...overrides,
  };
}

// 工厂函数：构造交易记录，默认 earn 类型
function makeTx(overrides: Partial<{
  id: string;
  type: 'earn' | 'spend' | 'freeze' | 'unfreeze' | 'refund' | 'time_earn' | 'time_spend';
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}> = {}) {
  return {
    id: overrides.id ?? 'tx-1',
    userId: 'user-1',
    amount: overrides.amount ?? 100,
    type: overrides.type ?? 'earn' as const,
    balanceAfter: overrides.balanceAfter ?? 600,
    referenceId: 'ref-1',
    referenceType: 'skill_order',
    description: overrides.description ?? '技能订单收入',
    createdAt: overrides.createdAt ?? '2024-03-15T10:30:00Z',
  };
}

// 渲染页面：注入 MemoryRouter 提供 useNavigate 上下文，启用 v7 future flag 消除警告
function renderPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PointsDetail />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认已登录，单测可通过 mockReturnValueOnce 覆盖
  vi.mocked(useAuth).mockReturnValue(makeAuthValue({ user: mockUser, isAuthenticated: true }));
});

describe('Profile/PointsDetail 积分明细页', () => {
  it('未登录显示"请先登录"与"去登录"链接', () => {
    vi.mocked(useAuth).mockReturnValueOnce(makeAuthValue({ user: null, isAuthenticated: false }));
    renderPage();
    expect(screen.getByText('请先登录')).toBeInTheDocument();
    expect(screen.getByText('去登录')).toBeInTheDocument();
  });

  it('加载中显示 spinner 旋转动画', () => {
    // 用永不 resolve 的 Promise 锁定 loading 状态
    getCreditHistoryMock.mockImplementationOnce(() => new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('加载完成显示积分余额', async () => {
    getCreditHistoryMock.mockResolvedValue({ code: 0, message: 'ok', data: { list: [], total: 0, page: 1, pageSize: 20, hasNext: false } });
    renderPage();
    await waitFor(() => {
      // 余额卡片渲染 user.creditBalance
      expect(screen.getByText('500')).toBeInTheDocument();
    });
  });

  it('空列表显示"暂无交易记录"', async () => {
    getCreditHistoryMock.mockResolvedValue({ code: 0, message: 'ok', data: { list: [], total: 0, page: 1, pageSize: 20, hasNext: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('暂无交易记录')).toBeInTheDocument();
    });
  });

  it('列表渲染交易数据（描述、时间、金额、余额）', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ description: '技能订单完成收入' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('技能订单完成收入')).toBeInTheDocument();
      // 收入类型显示 +100
      expect(screen.getByText('+100')).toBeInTheDocument();
      // 余额显示
      expect(screen.getByText('余额 600')).toBeInTheDocument();
    });
  });

  it('收入类型（earn）显示 + 前缀', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ type: 'earn', amount: 50 })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('+50')).toBeInTheDocument();
    });
  });

  it('支出类型（spend）显示 - 前缀', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ type: 'spend', amount: 30, description: '兑换商品' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('-30')).toBeInTheDocument();
    });
  });

  it('冻结类型（freeze）显示 - 前缀', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ type: 'freeze', amount: 20, description: '订单冻结' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('-20')).toBeInTheDocument();
    });
  });

  it('解冻类型（unfreeze）显示 + 前缀', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ type: 'unfreeze', amount: 20, description: '订单解冻' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('+20')).toBeInTheDocument();
    });
  });

  it('退款类型（refund）显示 + 前缀', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ type: 'refund', amount: 40, description: '订单退款' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('+40')).toBeInTheDocument();
    });
  });

  it('时间收入（time_earn）显示 + 前缀', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ type: 'time_earn', amount: 60, description: '时间银行收入' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('+60')).toBeInTheDocument();
    });
  });

  it('时间支出（time_spend）显示 - 前缀', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ type: 'time_spend', amount: 30, description: '时间银行支出' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('-30')).toBeInTheDocument();
    });
  });

  it('描述为空时显示类型中文标签', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx({ description: '', type: 'earn' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });
    renderPage();
    await waitFor(() => {
      // 描述为空时回退到 typeLabel['earn'] = "收入"
      expect(screen.getByText('收入')).toBeInTheDocument();
    });
  });

  it('总数显示"共 N 条"', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx()], total: 42, page: 1, pageSize: 20, hasNext: true },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/共 42 条/)).toBeInTheDocument();
    });
  });

  it('totalPages > 1 显示分页控件与页码', async () => {
    // 42 条 / 20 每页 = 3 页
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx()], total: 42, page: 1, pageSize: 20, hasNext: true },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('1 / 3')).toBeInTheDocument();
      expect(screen.getByText('上一页')).toBeInTheDocument();
      expect(screen.getByText('下一页')).toBeInTheDocument();
    });
  });

  it('首页时上一页按钮禁用', async () => {
    getCreditHistoryMock.mockResolvedValue({
      code: 0, message: 'ok',
      data: { list: [makeTx()], total: 42, page: 1, pageSize: 20, hasNext: true },
    });
    renderPage();
    await waitFor(() => {
      const prevBtn = screen.getByText('上一页').closest('button')!;
      expect(prevBtn.disabled).toBe(true);
    });
  });

  it('点击下一页加载第二页数据', async () => {
    // 42 条 / 20 每页 = 3 页，首页加载后点击下一页应请求 page=2
    getCreditHistoryMock.mockResolvedValueOnce({
      code: 0, message: 'ok',
      data: { list: [makeTx({ id: 'tx-page1', description: '第一页记录' })], total: 42, page: 1, pageSize: 20, hasNext: true },
    });
    getCreditHistoryMock.mockResolvedValueOnce({
      code: 0, message: 'ok',
      data: { list: [makeTx({ id: 'tx-page2', description: '第二页记录' })], total: 42, page: 2, pageSize: 20, hasNext: true },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('第一页记录')).toBeInTheDocument();
    });
    // 点击下一页：用 act 包裹同步事件避免 state 更新未包裹警告
    const nextBtn = screen.getByText('下一页').closest('button')!;
    act(() => { nextBtn.click(); });
    await waitFor(() => {
      // 第二页加载后应显示第二页记录，且 getCreditHistory 第二次调用传 page=2
      expect(screen.getByText('第二页记录')).toBeInTheDocument();
      expect(getCreditHistoryMock).toHaveBeenNthCalledWith(2, 2, 20);
    });
  });

  it('点击返回按钮调用 navigate(-1)', async () => {
    getCreditHistoryMock.mockResolvedValue({ code: 0, message: 'ok', data: { list: [], total: 0, page: 1, pageSize: 20, hasNext: false } });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('积分明细')).toBeInTheDocument();
    });
    // 返回按钮含 ArrowLeft 图标 + "返回"文案；用 act 包裹同步事件避免 state 更新未包裹警告
    const backBtn = screen.getByRole('button', { name: /返回/ });
    act(() => { backBtn.click(); });
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('加载失败显示 Empty error 与重新加载按钮，点击后重新触发请求', async () => {
    // 加载失败触发 Empty error 占位（替代原 toast.error 即时提示）
    // 设计原因：与 SharedKitchen/SkillExchange/Notifications 列表页 Empty variant="error" + 重新加载按钮模式统一
    getCreditHistoryMock.mockRejectedValueOnce(new Error('网络错误'));

    renderPage();

    // Empty error 默认 title="加载失败"
    await screen.findByText('加载失败');
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();

    // 重新 mock 第二次成功返回
    getCreditHistoryMock.mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: { list: [makeTx({ description: '技能订单完成收入' })], total: 1, page: 1, pageSize: 20, hasNext: false },
    });

    // 点击重新加载触发二次请求
    act(() => {
      screen.getByRole('button', { name: '重新加载' }).click();
    });

    // 第二次应成功渲染列表（用交易描述作为标志）
    await waitFor(() => {
      expect(screen.getByText('技能订单完成收入')).toBeInTheDocument();
    });
  });
});
