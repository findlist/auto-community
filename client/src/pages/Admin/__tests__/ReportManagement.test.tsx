import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReportManagement from '../ReportManagement';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖 pending/resolved/rejected 三种状态
const { mockReports } = vi.hoisted(() => ({
  // 举报列表：覆盖三种状态，targetId 短于 12 字符避免被截断为 "..."
  // 设计原因：桌面表格中 targetId 长度 >12 会被 slice 截断，弹窗内显示完整 id，
  // 短 id 确保表格与弹窗中文本一致，简化 getByText 匹配
  mockReports: [
    {
      id: 'report-1',
      reporterId: 'user-1',
      targetType: 'skill_post',
      targetId: 'post-1',
      reason: '内容不实',
      status: 'pending',
      createdAt: '2024-01-01T10:00:00.000Z',
    },
    {
      id: 'report-2',
      reporterId: 'user-2',
      targetType: 'kitchen_post',
      targetId: 'post-2',
      reason: '过期食物',
      status: 'resolved',
      handleNote: '已下架处理',
      createdAt: '2024-01-02T11:00:00.000Z',
    },
    {
      // rejected 状态：不应显示"处理"按钮
      id: 'report-3',
      reporterId: 'user-3',
      targetType: 'user',
      targetId: 'user-9',
      reason: '恶意骚扰',
      status: 'rejected',
      handleNote: '证据不足',
      createdAt: '2024-01-03T12:00:00.000Z',
    },
  ],
}));

// mock admin API：getReports 默认返回 mockReports 分页结构，handleReport 默认成功
vi.mock('@/api/admin', () => ({
  getReports: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: {
      list: mockReports,
      total: mockReports.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  })),
  // handleReport 返回 ApiResponse<null>，对齐 admin.ts 接口签名
  handleReport: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
}));

// mock ExportButton：避免依赖真实 exportData API 调用，简化为静态按钮
vi.mock('@/components/ExportButton', () => ({
  default: () => <button type="button">导出CSV</button>,
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import { getReports, handleReport } from '@/api/admin';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderReportManagement() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ReportManagement />
    </MemoryRouter>
  );
}

describe('ReportManagement 处理弹窗', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReports).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockReports,
        total: mockReports.length,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    });
    vi.mocked(handleReport).mockResolvedValue({ code: 0, message: 'ok', data: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示举报数据（类型/原因/状态）', async () => {
    renderReportManagement();

    // 等待列表加载完成，举报原因应渲染（桌面表格 + 移动卡片双布局，故用 getAllByText）
    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('过期食物').length).toBeGreaterThan(0);
    expect(screen.getAllByText('恶意骚扰').length).toBeGreaterThan(0);
    // 共 3 条计数应出现
    expect(screen.getByText('共 3 条')).toBeInTheDocument();
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    vi.mocked(getReports).mockImplementation(() => new Promise(() => {}));

    renderReportManagement();

    await waitFor(() => {
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
    });
  });

  it('加载失败显示错误提示', async () => {
    // 抛出普通 Error，ReportManagement 错误处理为 err instanceof ApiError ? err.message : "加载失败"
    vi.mocked(getReports).mockRejectedValue(new Error('网络异常'));

    renderReportManagement();

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument();
    });
  });

  it('空列表显示"暂无数据"', async () => {
    vi.mocked(getReports).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
    });

    renderReportManagement();

    await waitFor(() => {
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
    });
  });

  it('pending 状态显示"处理"按钮', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    // report-1 为 pending 状态，应显示"处理"按钮（桌面表格 + 移动卡片各一个）
    expect(screen.getAllByRole('button', { name: '处理' }).length).toBeGreaterThan(0);
  });

  it('resolved/rejected 状态不显示"处理"按钮', async () => {
    // 仅保留 resolved/rejected 状态的举报
    vi.mocked(getReports).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockReports.filter((r) => r.status === 'resolved' || r.status === 'rejected'),
        total: 2,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    });

    renderReportManagement();

    await waitFor(() => {
      expect(screen.getByText('过期食物')).toBeInTheDocument();
    });

    // 无 pending 状态举报时不应显示"处理"按钮
    expect(screen.queryByRole('button', { name: '处理' })).not.toBeInTheDocument();
  });

  it('点击"处理"打开弹窗显示举报 ID', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    // 点击第一个"处理"按钮（桌面表格中的）
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '处理' })[0]!);
    });

    // 弹窗应出现，标题为"处理举报"
    expect(screen.getByRole('heading', { name: '处理举报' })).toBeInTheDocument();
    // 举报 ID 应显示（report-1）
    expect(screen.getByText('report-1')).toBeInTheDocument();
  });

  it('处理备注为空时"确认处理"按钮禁用', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '处理' })[0]!);
    });

    // 弹窗打开后，备注为空，"确认处理"按钮应禁用
    const confirmBtn = screen.getByRole('button', { name: '确认处理' });
    expect(confirmBtn).toBeDisabled();
  });

  it('输入备注后"确认处理"按钮启用', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '处理' })[0]!);
    });

    // 输入处理备注
    const textarea = screen.getByPlaceholderText('请输入处理备注');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '已核实并处理' } });
    });

    // 按钮应启用
    const confirmBtn = screen.getByRole('button', { name: '确认处理' });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('切换处理结果（已解决/已驳回）', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '处理' })[0]!);
    });

    // 默认选中"已解决"，点击切换到"已驳回"
    // 设计原因：状态筛选栏也有"已驳回"按钮，弹窗内的"已驳回"按钮渲染顺序晚于筛选栏，取最后一个
    const rejectedBtns = screen.getAllByRole('button', { name: '已驳回' });
    const rejectedBtn = rejectedBtns[rejectedBtns.length - 1]!;
    await act(async () => {
      fireEvent.click(rejectedBtn);
    });

    // 输入备注并确认
    const textarea = screen.getByPlaceholderText('请输入处理备注');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '证据不足驳回' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认处理' }));
    });

    // 应以 status='rejected' 调用 handleReport
    await waitFor(() => {
      expect(handleReport).toHaveBeenCalledWith('report-1', 'rejected', '证据不足驳回');
    });
  });

  it('点击"确认处理"调用 handleReport 并刷新列表', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '处理' })[0]!);
    });

    // 输入处理备注
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('请输入处理备注'), {
        target: { value: '已核实并下架' },
      });
    });

    // 点击"确认处理"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认处理' }));
    });

    // 应调用 handleReport，参数包含 id=report-1、status=resolved、备注
    await waitFor(() => {
      expect(handleReport).toHaveBeenCalledWith('report-1', 'resolved', '已核实并下架');
    });
    // 应刷新列表（getReports 被再次调用）
    expect(vi.mocked(getReports).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('点击"取消"关闭弹窗不调用 API', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '处理' })[0]!);
    });

    // 弹窗内点击"取消"按钮
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    // 弹窗应关闭：用弹窗专属文案"处理结果"判断（外层无此文本）
    await waitFor(() => {
      expect(screen.queryByText('处理结果')).not.toBeInTheDocument();
    });
    // 不应调用 handleReport
    expect(handleReport).not.toHaveBeenCalled();
  });

  it('处理失败显示错误提示', async () => {
    vi.mocked(handleReport).mockRejectedValue(new Error('操作失败'));

    renderReportManagement();

    await waitFor(() => {
      expect(screen.getAllByText('内容不实').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '处理' })[0]!);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('请输入处理备注'), {
        target: { value: '测试备注' },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认处理' }));
    });

    // 应显示兜底错误文案"操作失败"
    await waitFor(() => {
      expect(screen.getByText('操作失败')).toBeInTheDocument();
    });
  });

  it('切换状态筛选重新加载列表', async () => {
    renderReportManagement();

    await waitFor(() => {
      expect(vi.mocked(getReports).mock.calls.length).toBe(1);
    });
    // 初始默认 status=pending
    expect(vi.mocked(getReports)).toHaveBeenLastCalledWith(1, 20, 'pending');

    // 切换到"已解决"状态
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '已解决' }));
    });

    await waitFor(() => {
      expect(vi.mocked(getReports).mock.calls.length).toBe(2);
    });
    // 应以 status=resolved 重新加载
    expect(vi.mocked(getReports)).toHaveBeenLastCalledWith(1, 20, 'resolved');
  });
});
