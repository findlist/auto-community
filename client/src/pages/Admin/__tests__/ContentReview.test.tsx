import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContentReview from '../ContentReview';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖 active/inactive 两种状态，验证批量操作可见性与逻辑
const { mockContents, mockEmptyList } = vi.hoisted(() => ({
  // 内容列表：覆盖已上架/已下架两种状态，title 唯一避免 getAllByText 歧义
  // userId 必填：AdminContentItem 接口要求，避免 tsc 严格检查报错
  mockContents: [
    { id: 'c-1', title: '技能帖A', status: 'active', createdAt: '2024-01-01T10:00:00.000Z', userId: 'u-1' },
    { id: 'c-2', title: '技能帖B', status: 'inactive', createdAt: '2024-01-02T11:00:00.000Z', userId: 'u-2' },
    { id: 'c-3', title: '技能帖C', status: 'active', createdAt: '2024-01-03T12:00:00.000Z', userId: 'u-3' },
  ],
  mockEmptyList: [],
}));

// mock admin API：getContent 默认返回 mockContents 分页结构，batchUpdateContentStatus 默认成功
vi.mock('@/api/admin', () => ({
  getContent: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: {
      list: mockContents,
      total: mockContents.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  })),
  // batchUpdateContentStatus 返回 BatchResult，successfulIds 用于成功提示文案
  batchUpdateContentStatus: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { successfulIds: mockContents.map((c) => c.id), failedIds: [] },
  })),
  // 单条状态切换与详情/编辑接口提供默认 mock，避免未捕获调用报错
  updateContentStatus: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
  getContentDetail: vi.fn(async () => ({ code: 0, message: 'ok', data: {} })),
  updateContent: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
}));

// mock Toast：避免真实 DOM 渲染依赖，仅记录调用
vi.mock('@/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// mock ImageUpload：编辑弹窗中用到，简化为静态占位避免文件上传副作用
vi.mock('@/components/Upload/ImageUpload', () => ({
  default: () => <div data-testid="image-upload-mock" />,
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

import { getContent, batchUpdateContentStatus, updateContentStatus } from '@/api/admin';
import { toast } from '@/components/Toast';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderContentReview() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ContentReview />
    </MemoryRouter>
  );
}

describe('ContentReview 批量操作', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 每个用例前重置 getContent 默认返回值
    vi.mocked(getContent).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockContents,
        total: mockContents.length,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    });
    vi.mocked(batchUpdateContentStatus).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { successfulIds: mockContents.map((c) => c.id), failedIds: [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示内容数据（标题/状态）', async () => {
    renderContentReview();

    // 等待列表加载完成，三条内容标题均应渲染（桌面表格 + 移动卡片双布局，故用 getAllByText）
    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('技能帖B').length).toBeGreaterThan(0);
    expect(screen.getAllByText('技能帖C').length).toBeGreaterThan(0);
    // 共 3 条计数应出现
    expect(screen.getByText('共 3 条')).toBeInTheDocument();
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 让 getContent 永不 resolve，保持 loading 状态
    vi.mocked(getContent).mockImplementation(() => new Promise(() => {}));

    renderContentReview();

    // 加载中应显示 animate-spin 旋转图标
    await waitFor(() => {
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
    });
  });

  it('加载失败显示错误提示', async () => {
    // 抛出普通 Error，ContentReview 错误处理为 err instanceof ApiError ? err.message : "加载失败"
    vi.mocked(getContent).mockRejectedValue(new Error('网络异常'));

    renderContentReview();

    // 非 ApiError 时显示兜底文案"加载失败"
    // 设计原因：banner 与 Empty error 默认 title 均显示"加载失败"，使用 getAllByText 避免多元素匹配错误
    await waitFor(() => {
      expect(screen.getAllByText('加载失败').length).toBeGreaterThan(0);
    });
  });

  it('加载失败显示"重新加载"重试按钮，点击后重新触发请求', async () => {
    // 首次失败触发 Empty error + 重试按钮
    vi.mocked(getContent).mockRejectedValueOnce(new Error('网络异常'));
    // 重试成功返回数据
    vi.mocked(getContent).mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: {
        list: mockContents,
        total: mockContents.length,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    });

    renderContentReview();

    const retryBtn = await screen.findByRole('button', { name: '重新加载' });
    expect(retryBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    // 重试后请求计数应增加，且最终渲染列表数据
    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });
    expect(vi.mocked(getContent).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('空列表显示"暂无数据"', async () => {
    vi.mocked(getContent).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { list: mockEmptyList, total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
    });

    renderContentReview();

    await waitFor(() => {
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
    });
  });

  it('单选一条内容后显示批量操作工具栏与选中数量', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    // 初始无选中时不应显示工具栏
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();

    // 勾选第一条内容（桌面表格中的 checkbox）
    const checkboxes = screen.getAllByLabelText(/选择 技能帖A/);
    await act(async () => {
      fireEvent.click(checkboxes[0]!);
    });

    // 应显示"已选择 1 条内容"
    expect(screen.getByText('已选择 1 条内容')).toBeInTheDocument();
  });

  it('全选当前页内容', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    // 点击全选 checkbox（aria-label="全选当前页"）
    const selectAllCheckbox = screen.getByLabelText('全选当前页');
    await act(async () => {
      fireEvent.click(selectAllCheckbox);
    });

    // 应显示"已选择 3 条内容"
    expect(screen.getByText('已选择 3 条内容')).toBeInTheDocument();
  });

  it('点击"批量上架"打开确认弹窗显示选中数量', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    // 先选中一条
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/选择 技能帖A/)[0]!);
    });

    // 点击"批量上架"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量上架/ }));
    });

    // 弹窗应出现，标题为"批量上架"（用 heading role 精确匹配弹窗 h3，避免与工具栏按钮文本冲突）
    expect(screen.getByRole('heading', { name: '批量上架' })).toBeInTheDocument();
    // 选中数量应显示为 1 条内容
    expect(screen.getByText('1 条内容')).toBeInTheDocument();
    // 弹窗说明文案也应出现
    expect(screen.getByText('将所选内容批量上架，用户可见')).toBeInTheDocument();
  });

  it('点击"批量下架"打开确认弹窗显示选中数量', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/选择 技能帖B/)[0]!);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量下架/ }));
    });

    // 弹窗标题用 heading role 精确匹配，避免与工具栏按钮文本冲突
    expect(screen.getByRole('heading', { name: '批量下架' })).toBeInTheDocument();
    expect(screen.getByText('1 条内容')).toBeInTheDocument();
    expect(screen.getByText('将所选内容批量下架，用户不可见')).toBeInTheDocument();
  });

  it('点击"清除选择"清空选中并隐藏工具栏', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/选择 技能帖A/)[0]!);
    });
    expect(screen.getByText('已选择 1 条内容')).toBeInTheDocument();

    // 点击"清除选择"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    });

    // 工具栏应消失
    expect(screen.queryByText(/已选择/)).not.toBeInTheDocument();
  });

  it('确认弹窗点击"取消"关闭弹窗不调用 API', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/选择 技能帖A/)[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量上架/ }));
    });

    // 弹窗内点击"取消"按钮（弹窗底部，非工具栏）
    const cancelButtons = screen.getAllByRole('button', { name: '取消' });
    await act(async () => {
      fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    });

    // 弹窗应关闭：用弹窗专属说明文案判断（工具栏按钮也含"批量上架"文本，不能用作判断依据）
    await waitFor(() => {
      expect(screen.queryByText('将所选内容批量上架，用户可见')).not.toBeInTheDocument();
    });
    // 不应调用批量 API
    expect(batchUpdateContentStatus).not.toHaveBeenCalled();
  });

  it('确认弹窗点击"确认"调用 batchUpdateContentStatus 并刷新列表', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    // 选中两条
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/选择 技能帖A/)[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/选择 技能帖B/)[0]!);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量上架/ }));
    });

    // 弹窗内点击"确认"
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    // 应调用 batchUpdateContentStatus，参数包含 type=skill、ids 两条、status=active
    await waitFor(() => {
      expect(batchUpdateContentStatus).toHaveBeenCalledWith('skill', ['c-1', 'c-2'], 'active');
    });
    // 应显示成功提示
    expect(toast.success).toHaveBeenCalled();
    // 应刷新列表（getContent 被再次调用）
    expect(vi.mocked(getContent).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('批量操作失败显示错误提示', async () => {
    vi.mocked(batchUpdateContentStatus).mockRejectedValue(new Error('批量操作失败'));

    renderContentReview();

    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByLabelText(/选择 技能帖A/)[0]!);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /批量下架/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认' }));
    });

    // 应显示错误提示
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('批量操作失败');
    });
  });

  it('切换内容类型重新加载列表', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(vi.mocked(getContent).mock.calls.length).toBe(1);
    });
    // 初始调用 type=skill
    expect(vi.mocked(getContent)).toHaveBeenLastCalledWith('skill', 'active', 1, 20);

    // 切换到"厨房"类型
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '厨房' }));
    });

    await waitFor(() => {
      expect(vi.mocked(getContent).mock.calls.length).toBe(2);
    });
    // 应以 type=kitchen 重新加载
    expect(vi.mocked(getContent)).toHaveBeenLastCalledWith('kitchen', 'active', 1, 20);
  });

  it('切换状态筛选重新加载列表', async () => {
    renderContentReview();

    await waitFor(() => {
      expect(vi.mocked(getContent).mock.calls.length).toBe(1);
    });

    // 切换到"已下架"状态
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '已下架' }));
    });

    await waitFor(() => {
      expect(vi.mocked(getContent).mock.calls.length).toBe(2);
    });
    // 应以 status=inactive 重新加载
    expect(vi.mocked(getContent)).toHaveBeenLastCalledWith('skill', 'inactive', 1, 20);
  });
});

describe('ContentReview 单条上下架入口守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getContent).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockContents,
        total: mockContents.length,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        hasNext: false,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('弱网连点不产生多次上下架切换：入口 if 守卫阻断第二次 onClick', async () => {
    // updateContentStatus 永不 resolve，锁定 actioningId 状态模拟弱网
    vi.mocked(updateContentStatus).mockReturnValue(new Promise(() => {}));

    renderContentReview();
    // 等待列表加载完成
    await waitFor(() => {
      expect(screen.getAllByText('技能帖A').length).toBeGreaterThan(0);
    });

    // 第一次点击：触发 setActioningId('c-1')，按钮文案变为"处理中..."
    // 列表中 c-1 与 c-3 均为 active 状态显示"下架"按钮，桌面+移动双布局共 4 个，取第一个即 c-1 桌面
    fireEvent.click(screen.getAllByRole('button', { name: '下架' })[0]!);
    // 等待 actioningId 状态生效：按钮文案变为"处理中..."（桌面+移动双布局渲染 2 个）
    await waitFor(() => {
      expect(screen.getAllByText('处理中...').length).toBeGreaterThan(0);
    });

    // 第二次点击：fireEvent 绕过 disabled 检查直接触发 onClick
    // 入口 if (actioningId === item.id) return 守卫作为第二道防线，阻断重复调用
    // 取第一个"处理中..."按钮（c-1 桌面布局），与第一次点击同一个按钮
    fireEvent.click(screen.getAllByText('处理中...')[0]!);

    // 不变式：updateContentStatus 仅被调用 1 次，第二次点击被入口守卫拦截
    expect(updateContentStatus).toHaveBeenCalledTimes(1);
  });
});
