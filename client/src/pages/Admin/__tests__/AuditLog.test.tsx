import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditLogPage from '../AuditLog';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖 success/failed 状态、不同操作类型
// 设计原因：每条日志触发不同操作类型中文标签映射，便于精确验证 actionLabels 字典
const { mockLogs } = vi.hoisted(() => ({
  mockLogs: [
    {
      // 登录成功日志：覆盖 success 状态、LOGIN 操作类型
      id: 1,
      userId: 'user-1',
      nickname: '张三',
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: 'user-1',
      ip: '192.168.1.1',
      status: 'success',
      errorMessage: null,
      createdAt: '2024-01-01T10:00:00.000Z',
    },
    {
      // 封禁用户失败日志：覆盖 failed 状态、BAN_USER 操作类型、errorMessage 非空
      id: 2,
      userId: 'user-2',
      nickname: '李四',
      action: 'BAN_USER',
      resourceType: 'user',
      resourceId: 'user-3',
      ip: '192.168.1.2',
      status: 'failed',
      errorMessage: '权限不足',
      createdAt: '2024-01-02T11:00:00.000Z',
    },
    {
      // 系统操作日志：覆盖 userId 缺失场景（nickname 兜底为"系统"）
      id: 3,
      action: 'REGISTER',
      ip: '192.168.1.3',
      status: 'success',
      createdAt: '2024-01-03T12:00:00.000Z',
    },
  ],
}));

// mock admin API：getAuditLogs 默认返回 mockLogs 分页结构
vi.mock('@/api/admin', () => ({
  getAuditLogs: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: {
      list: mockLogs,
      total: mockLogs.length,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasNext: false,
    },
  })),
}));

// mock ExportButton：避免依赖真实 exportData API 调用
vi.mock('@/components/ExportButton', () => ({
  default: () => <button type="button">导出CSV</button>,
}));

import { getAuditLogs } from '@/api/admin';
import { ApiError } from '@/api/client';

// 包装组件：AuditLogPage 无路由参数依赖，MemoryRouter 提供上下文
function renderAuditLogPage() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuditLogPage />
    </MemoryRouter>
  );
}

// 构造分页响应：复用 mockLogs 数据避免重复构造
function buildPageResponse(logs = mockLogs, page = 1, totalPages = 1) {
  return {
    code: 0,
    message: 'ok',
    data: {
      list: logs,
      total: logs.length,
      page,
      pageSize: 20,
      totalPages,
      hasNext: page < totalPages,
    },
  };
}

// 等待列表加载完成：第一条日志的昵称出现即代表渲染完成
// 设计原因：桌面表格 + 移动卡片双布局渲染同一份数据，用 getAllByText 避免多元素匹配异常
async function waitForListLoaded() {
  await waitFor(() => {
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
  });
}

describe('AuditLog 筛选查询', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuditLogs).mockResolvedValue(buildPageResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('列表加载成功显示日志数据（操作者/操作/状态/IP/时间）', async () => {
    renderAuditLogPage();
    await waitForListLoaded();

    // 验证操作者昵称、IP、操作类型中文标签均正确渲染
    expect(screen.getAllByText('张三').length).toBeGreaterThan(0);
    expect(screen.getAllByText('192.168.1.1').length).toBeGreaterThan(0);
    // LOGIN 操作映射为"登录"
    expect(screen.getAllByText('登录').length).toBeGreaterThan(0);
    // BAN_USER 操作映射为"封禁用户"
    expect(screen.getAllByText('封禁用户').length).toBeGreaterThan(0);
    // REGISTER 操作映射为"注册"
    expect(screen.getAllByText('注册').length).toBeGreaterThan(0);
    // 成功状态文案
    expect(screen.getAllByText('成功').length).toBeGreaterThan(0);
    // 失败状态文案
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0);
  });

  it('userId 缺失时操作者显示"系统"兜底文案', async () => {
    renderAuditLogPage();
    await waitForListLoaded();

    // 第三条日志无 userId/nickname，移动卡片应显示"系统"
    expect(screen.getAllByText('系统').length).toBeGreaterThan(0);
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 让 getAuditLogs 永不 resolve，保持 loading 状态
    vi.mocked(getAuditLogs).mockImplementation(() => new Promise(() => {}));

    renderAuditLogPage();

    await waitFor(() => {
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  it('加载失败显示错误提示', async () => {
    vi.mocked(getAuditLogs).mockRejectedValue(new ApiError('网络错误', 500));

    renderAuditLogPage();

    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
  });

  it('空列表显示"暂无日志记录"', async () => {
    vi.mocked(getAuditLogs).mockResolvedValue(buildPageResponse([]));

    renderAuditLogPage();

    await waitFor(() => {
      expect(screen.getByText('暂无日志记录')).toBeInTheDocument();
    });
  });

  it('切换操作类型筛选重新加载列表', async () => {
    renderAuditLogPage();
    await waitForListLoaded();

    // 初始加载一次
    expect(vi.mocked(getAuditLogs).mock.calls.length).toBe(1);

    // 操作类型下拉框含 LOGIN 选项；与状态下拉框区分（状态下拉框仅有 success/failed）
    // 设计原因：getByDisplayValue('全部') 会匹配多个下拉框，改用选项特征定位
    const actionSelect = Array.from(document.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => o.value === 'LOGIN')
    );
    expect(actionSelect).toBeDefined();

    await act(async () => {
      fireEvent.change(actionSelect!, { target: { value: 'LOGIN' } });
    });

    // 切换 action 后 useEffect 依赖变化触发重新加载，action 参数为 'LOGIN'
    await waitFor(() => {
      const lastCall = vi.mocked(getAuditLogs).mock.calls[vi.mocked(getAuditLogs).mock.calls.length - 1]!;
      expect(lastCall[0]?.action).toBe('LOGIN');
    });
  });

  it('切换状态筛选重新加载列表', async () => {
    renderAuditLogPage();
    await waitForListLoaded();

    // 状态筛选下拉框有"全部/成功/失败"三个选项，使用 select 选择"失败"
    // 设计原因：getAllByDisplayValue('全部') 可能匹配多个下拉框，用 select 元素筛选
    const statusSelects = document.querySelectorAll('select');
    // 找到包含"成功"选项的下拉框即为状态筛选框
    const statusSelect = Array.from(statusSelects).find(s =>
      Array.from(s.options).some(o => o.value === 'failed')
    );
    expect(statusSelect).toBeDefined();

    await act(async () => {
      fireEvent.change(statusSelect!, { target: { value: 'failed' } });
    });

    await waitFor(() => {
      const lastCall = vi.mocked(getAuditLogs).mock.calls[vi.mocked(getAuditLogs).mock.calls.length - 1]!;
      expect(lastCall[0]?.status).toBe('failed');
    });
  });

  it('设置开始日期重新加载列表', async () => {
    renderAuditLogPage();
    await waitForListLoaded();

    // 找到开始日期输入框（type=date）
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      fireEvent.change(dateInputs[0]!, { target: { value: '2024-01-01' } });
    });

    await waitFor(() => {
      const lastCall = vi.mocked(getAuditLogs).mock.calls[vi.mocked(getAuditLogs).mock.calls.length - 1]!;
      expect(lastCall[0]?.startDate).toBe('2024-01-01');
    });
  });

  it('点击"查询"按钮触发加载', async () => {
    renderAuditLogPage();
    await waitForListLoaded();

    const initialCallCount = vi.mocked(getAuditLogs).mock.calls.length;

    // 点击"查询"按钮（filter 区域唯一的提交按钮）
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '查询' }));
    });

    // 应触发新的加载
    await waitFor(() => {
      expect(vi.mocked(getAuditLogs).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('点击下一页触发分页加载', async () => {
    // 模拟多页数据
    vi.mocked(getAuditLogs).mockResolvedValue(buildPageResponse(mockLogs, 1, 3));

    renderAuditLogPage();
    await waitForListLoaded();

    const initialCallCount = vi.mocked(getAuditLogs).mock.calls.length;

    // 模拟第二页返回
    vi.mocked(getAuditLogs).mockResolvedValue(buildPageResponse([mockLogs[0]!], 2, 3));

    // 分页按钮无 accessible name，用 querySelectorAll 定位 disabled:opacity-40 类的按钮
    // 设计原因：上一页/下一页按钮均无文字内容，只能通过 class 特征定位
    const paginationBtns = document.querySelectorAll('button.disabled\\:opacity-40');
    expect(paginationBtns.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      fireEvent.click(paginationBtns[1]!);
    });

    await waitFor(() => {
      expect(vi.mocked(getAuditLogs).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('首页时上一页按钮禁用', async () => {
    vi.mocked(getAuditLogs).mockResolvedValue(buildPageResponse(mockLogs, 1, 3));

    renderAuditLogPage();
    await waitForListLoaded();

    // 第一个分页按钮（上一页）应处于禁用状态
    const paginationBtns = document.querySelectorAll('button.disabled\\:opacity-40');
    expect(paginationBtns.length).toBeGreaterThanOrEqual(2);
    expect(paginationBtns[0]).toBeDisabled();
    // 第二个分页按钮（下一页）应可点击
    expect(paginationBtns[1]).not.toBeDisabled();
  });

  it('末页时下一页按钮禁用', async () => {
    // 当前在第 3 页（共 3 页），下一页应禁用
    vi.mocked(getAuditLogs).mockResolvedValue(buildPageResponse(mockLogs, 3, 3));

    renderAuditLogPage();
    await waitForListLoaded();

    const paginationBtns = document.querySelectorAll('button.disabled\\:opacity-40');
    expect(paginationBtns.length).toBeGreaterThanOrEqual(2);
    // 上一页可点击
    expect(paginationBtns[0]).not.toBeDisabled();
    // 下一页禁用
    expect(paginationBtns[1]).toBeDisabled();
  });
});
