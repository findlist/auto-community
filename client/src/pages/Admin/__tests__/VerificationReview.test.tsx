/**
 * VerificationReview 端到端测试
 *
 * 测试目标：
 * - 列表加载成功/加载中/加载失败/空列表
 * - pending 状态显示通过/拒绝按钮，approved/rejected 不显示
 * - 通过/拒绝弹窗全流程：打开弹窗、显示申请人信息、输入拒绝原因、确认调用 API、取消不调用
 * - 状态筛选重新加载、分页加载
 *
 * 测试策略：vi.hoisted 提升 mock 数据避免 TDZ，mock @/api/admin 与 react-router-dom，
 *           桌面表格与移动卡片双布局用 getAllByText 配合 .length 断言。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { VerificationRequest } from '@/api/admin';
import VerificationReview from '../VerificationReview';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖 pending/approved/rejected 三种状态
// 设计原因：status 字段需 as const 标注为字面量类型，避免被推导为 string 导致与 VerificationRequest 类型不兼容
const { mockRequests, mockEmptyList } = vi.hoisted((): {
  mockRequests: VerificationRequest[];
  mockEmptyList: VerificationRequest[];
} => ({
  // id 短于 12 字符避免弹窗内 slice 截断导致文本不一致
  // reviewerNickname 覆盖有/无两种场景，rejectReason 覆盖有/无两种场景
  mockRequests: [
    {
      id: 'v-1',
      userId: 'u-1',
      userNickname: '张三',
      userPhone: '13800000001',
      realName: '张三真名',
      status: 'pending',
      createdAt: '2024-01-01T10:00:00.000Z',
      reviewerNickname: undefined,
      rejectReason: undefined,
    },
    {
      id: 'v-2',
      userId: 'u-2',
      userNickname: '李四',
      userPhone: '13800000002',
      realName: '李四真名',
      status: 'approved',
      createdAt: '2024-01-02T11:00:00.000Z',
      reviewerNickname: '管理员王五',
      rejectReason: undefined,
    },
    {
      id: 'v-3',
      userId: 'u-3',
      userNickname: '赵六',
      userPhone: '13800000003',
      realName: '赵六真名',
      status: 'rejected',
      createdAt: '2024-01-03T12:00:00.000Z',
      reviewerNickname: '管理员王五',
      rejectReason: '材料不完整',
    },
  ],
  mockEmptyList: [],
}));

// mock admin API：getVerificationRequests 默认返回 mockRequests 分页结构
vi.mock('@/api/admin', () => ({
  getVerificationRequests: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: {
      list: mockRequests,
      total: mockRequests.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  })),
  // reviewVerification 默认成功
  reviewVerification: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
}));

// mock react-router-dom：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import { getVerificationRequests, reviewVerification } from '@/api/admin';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderVerificationReview() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <VerificationReview />
    </MemoryRouter>
  );
}

describe('VerificationReview 实名认证审核', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 每个用例前重置 getVerificationRequests 默认返回值
    vi.mocked(getVerificationRequests).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockRequests,
        total: mockRequests.length,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    });
  });

  it('列表加载成功显示认证申请数据（申请人/手机号/真实姓名/状态）', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    // 桌面表格 + 移动卡片双布局渲染同一份数据，用 getAllByText + .length>0 断言
    await waitFor(() => {
      expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('13800000001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('张三真名').length).toBeGreaterThan(0);
    // 状态标签：pending 显示"待审核"
    expect(screen.getAllByText('待审核').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已通过').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已拒绝').length).toBeGreaterThan(0);
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 让 getVerificationRequests 永不 resolve，保持 loading 状态
    vi.mocked(getVerificationRequests).mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      renderVerificationReview();
    });
    // Loader2 是 svg.animate-spin，用 class 选择器定位
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('加载失败显示错误提示', async () => {
    vi.mocked(getVerificationRequests).mockRejectedValue(new Error('网络错误'));
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      // 非 ApiError 时走兜底分支，显示"加载失败"
      expect(screen.getByText('加载失败')).toBeInTheDocument();
    });
  });

  it('空列表显示"暂无认证申请"', async () => {
    vi.mocked(getVerificationRequests).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { list: mockEmptyList, total: 0, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
    });
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getByText('暂无认证申请')).toBeInTheDocument();
    });
  });

  it('pending 状态显示"通过"和"拒绝"按钮', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      // 桌面 + 移动双布局，pending 的 v-1 在两处都有"通过""拒绝"按钮
      expect(screen.getAllByText('通过').length).toBeGreaterThan(0);
      expect(screen.getAllByText('拒绝').length).toBeGreaterThan(0);
    });
  });

  it('approved/rejected 状态不显示操作按钮（仅 pending 显示）', async () => {
    // 仅保留 approved/rejected，过滤掉 pending
    vi.mocked(getVerificationRequests).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockRequests.filter((r) => r.status !== 'pending'),
        total: 2,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    });
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.queryByText('通过')).not.toBeInTheDocument();
      expect(screen.queryByText('拒绝')).not.toBeInTheDocument();
    });
  });

  it('点击"通过"打开弹窗显示申请人真实姓名', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getAllByText('通过').length).toBeGreaterThan(0);
    });
    // 取第一个"通过"按钮（桌面表格内）
    const approveButtons = screen.getAllByText('通过');
    await act(async () => {
      fireEvent.click(approveButtons[0]!);
    });
    // 弹窗标题"确认通过"用 heading 精确匹配，避免与按钮文本冲突
    expect(screen.getByRole('heading', { name: '确认通过' })).toBeInTheDocument();
    // 弹窗内显示申请人昵称与真实姓名
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
    expect(screen.getAllByText('张三真名').length).toBeGreaterThan(0);
  });

  it('点击"拒绝"打开弹窗显示拒绝原因输入框', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getAllByText('拒绝').length).toBeGreaterThan(0);
    });
    const rejectButtons = screen.getAllByText('拒绝');
    await act(async () => {
      fireEvent.click(rejectButtons[0]!);
    });
    expect(screen.getByRole('heading', { name: '确认拒绝' })).toBeInTheDocument();
    // 拒绝原因 textarea 通过 placeholder 定位
    expect(screen.getByPlaceholderText('请填写拒绝原因（2-200字符）')).toBeInTheDocument();
  });

  it('拒绝原因为空时点击"确认拒绝"显示错误提示', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getAllByText('拒绝').length).toBeGreaterThan(0);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByText('拒绝')[0]!);
    });
    // 弹窗内"确认拒绝"按钮（与弹窗标题同名，用 button role 精确取最后一个：弹窗内按钮渲染最晚）
    const confirmBtns = screen.getAllByRole('button', { name: '确认拒绝' });
    await act(async () => {
      fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
    });
    // 拒绝原因为空时显示错误
    await waitFor(() => {
      expect(screen.getByText('拒绝认证时必须填写原因')).toBeInTheDocument();
    });
    // 不应调用 reviewVerification
    expect(vi.mocked(reviewVerification)).not.toHaveBeenCalled();
  });

  it('输入拒绝原因后点击"确认拒绝"调用 reviewVerification 并刷新列表', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getAllByText('拒绝').length).toBeGreaterThan(0);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByText('拒绝')[0]!);
    });
    const textarea = screen.getByPlaceholderText('请填写拒绝原因（2-200字符）');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '材料不完整，请补充' } });
    });
    const confirmBtns = screen.getAllByRole('button', { name: '确认拒绝' });
    await act(async () => {
      fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
    });
    await waitFor(() => {
      expect(vi.mocked(reviewVerification)).toHaveBeenCalledWith('v-1', 'reject', '材料不完整，请补充');
    });
    // 弹窗关闭后应刷新列表（再次调用 getVerificationRequests）
    await waitFor(() => {
      expect(vi.mocked(getVerificationRequests).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('点击"确认通过"调用 reviewVerification(approve) 并刷新列表', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getAllByText('通过').length).toBeGreaterThan(0);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByText('通过')[0]!);
    });
    const confirmBtns = screen.getAllByRole('button', { name: '确认通过' });
    await act(async () => {
      fireEvent.click(confirmBtns[confirmBtns.length - 1]!);
    });
    await waitFor(() => {
      expect(vi.mocked(reviewVerification)).toHaveBeenCalledWith('v-1', 'approve', undefined);
    });
  });

  it('点击"取消"关闭弹窗不调用 API', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getAllByText('通过').length).toBeGreaterThan(0);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByText('通过')[0]!);
    });
    expect(screen.getByRole('heading', { name: '确认通过' })).toBeInTheDocument();
    // 弹窗内有"取消"按钮
    await act(async () => {
      fireEvent.click(screen.getByText('取消'));
    });
    // 弹窗关闭：标题消失
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '确认通过' })).not.toBeInTheDocument();
    });
    expect(vi.mocked(reviewVerification)).not.toHaveBeenCalled();
  });

  it('切换状态筛选重新加载列表', async () => {
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
    });
    const initialCallCount = vi.mocked(getVerificationRequests).mock.calls.length;
    // 点击"待审核"筛选按钮：状态徽章是 span，按钮是 button，用 role 精确匹配避免多元素冲突
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '待审核' }));
    });
    await waitFor(() => {
      expect(vi.mocked(getVerificationRequests).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
    // 最后一次调用应传 status='pending'
    const lastCall = vi.mocked(getVerificationRequests).mock.calls[vi.mocked(getVerificationRequests).mock.calls.length - 1]!;
    expect(lastCall[2]).toBe('pending');
  });

  it('点击下一页触发分页加载', async () => {
    // 模拟第 1 页，共 2 页
    vi.mocked(getVerificationRequests).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockRequests,
        total: 30,
        page: 1,
        pageSize: 20,
        totalPages: 2,
        hasNext: true,
      },
    });
    await act(async () => {
      renderVerificationReview();
    });
    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument();
    });
    const initialCallCount = vi.mocked(getVerificationRequests).mock.calls.length;
    // 下一页按钮（ChevronRight 图标按钮无 accessible name，用 class 定位）
    // 分页按钮容器内有两个 border 按钮，取第二个（下一页）
    // 选择器用 border-neutral-300：源码分页按钮 class 为 border-neutral-300（非 border-gray-300）
    const pageButtons = document.querySelectorAll('button.border-neutral-300');
    const nextBtn = pageButtons[pageButtons.length - 1]!;
    await act(async () => {
      fireEvent.click(nextBtn);
    });
    await waitFor(() => {
      expect(vi.mocked(getVerificationRequests).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
    // 最后一次调用应传 page=2
    const lastCall = vi.mocked(getVerificationRequests).mock.calls[vi.mocked(getVerificationRequests).mock.calls.length - 1]!;
    expect(lastCall[0]).toBe(2);
  });
});
