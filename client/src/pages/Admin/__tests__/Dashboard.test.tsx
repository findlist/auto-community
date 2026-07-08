import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// 提升 mock 数据与 spy，避免 TDZ（Temporal Dead Zone）问题
const {
  mockDashboardData,
  mockRegTrend,
  mockOrderTrend,
  mockReputation,
  mockModules,
  mockSystem,
  getDashboardMock,
  getDashboardTrendMock,
  getDashboardReputationMock,
  getDashboardModulesMock,
  getDashboardSystemMock,
} = vi.hoisted(() => {
  const mockDashboardData = {
    totalUsers: 1200,
    todayNewUsers: 35,
    skillOrders: 88,
    kitchenOrders: 64,
    timeBankOrders: 42,
    emergencyRequests: 12,
    pendingReports: 5,
  };
  const mockRegTrend = [
    { date: "2026-07-01", count: 10 },
    { date: "2026-07-02", count: 15 },
  ];
  const mockOrderTrend = [
    { date: "2026-07-01", count: 20 },
    { date: "2026-07-02", count: 25 },
  ];
  const mockReputation = [{ label: "优秀", count: 80 }];
  const mockModules = [{ name: "技能交换", posts: 50, orders: 30 }];
  const mockSystem = {
    pendingReports: 5,
    todayActiveUsers: 200,
    totalMutualAids: 1000,
    monthNewUsers: 300,
  };
  return {
    mockDashboardData,
    mockRegTrend,
    mockOrderTrend,
    mockReputation,
    mockModules,
    mockSystem,
    getDashboardMock: vi.fn(),
    getDashboardTrendMock: vi.fn(),
    getDashboardReputationMock: vi.fn(),
    getDashboardModulesMock: vi.fn(),
    getDashboardSystemMock: vi.fn(),
  };
});

// mock @/api/admin：仅 Dashboard 用到的 5 个接口，避免真实网络请求
vi.mock("@/api/admin", () => ({
  getDashboard: getDashboardMock,
  getDashboardTrend: getDashboardTrendMock,
  getDashboardReputation: getDashboardReputationMock,
  getDashboardModules: getDashboardModulesMock,
  getDashboardSystem: getDashboardSystemMock,
  // 类型导出不影响运行时，但需要存在以避免 import 报错
  __esModule: true,
}));

// mock 图表组件为静态占位，隔离 Dashboard 测试与图表内部实现
vi.mock("@/components/Charts", () => ({
  LineChart: () => <div data-testid="line-chart" />,
  PieChart: () => <div data-testid="pie-chart" />,
  BarChart: () => <div data-testid="bar-chart" />,
  ChartCard: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid={`chart-card-${title}`}>
      <h3>{title}</h3>
      {children}
    </div>
  ),
}));

import Dashboard from "../Dashboard";

// 渲染 Dashboard：用 MemoryRouter 包裹避免 react-router 报错
// future flag 提前适配 React Router v7，消除 future flag 警告（对齐项目其他测试文件）
function renderDashboard() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Dashboard />
    </MemoryRouter>
  );
}

// 配置图表接口全部成功：5 个接口按 Dashboard 调用顺序设置返回值
function setupChartsSuccess() {
  getDashboardTrendMock
    .mockResolvedValueOnce({ data: mockRegTrend })
    .mockResolvedValueOnce({ data: mockOrderTrend });
  getDashboardReputationMock.mockResolvedValue({ data: mockReputation });
  getDashboardModulesMock.mockResolvedValue({ data: mockModules });
  getDashboardSystemMock.mockResolvedValue({ data: mockSystem });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 统计卡片接口默认成功
  getDashboardMock.mockResolvedValue({ data: mockDashboardData });
});

describe("Dashboard 页面", () => {
  it("统计卡片加载中显示 loading", async () => {
    // 不 resolve getDashboard，让其处于 pending
    getDashboardMock.mockReturnValue(new Promise(() => {}));
    // 图表接口也 pending，避免返回 undefined 触发 catch 块 setState 产生 act 警告
    getDashboardTrendMock.mockReturnValue(new Promise(() => {}));
    getDashboardReputationMock.mockReturnValue(new Promise(() => {}));
    getDashboardModulesMock.mockReturnValue(new Promise(() => {}));
    getDashboardSystemMock.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  it("统计卡片加载成功显示数据", async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("1200")).toBeInTheDocument();
      expect(screen.getByText("用户总数")).toBeInTheDocument();
      expect(screen.getByText("35")).toBeInTheDocument();
      expect(screen.getByText("今日新增")).toBeInTheDocument();
    });
  });

  it("统计卡片加载失败显示页面错误状态", async () => {
    // 非 ApiError 走 fallback "加载失败"，与 Empty 默认 title 重复，用 getAllByText 避免多元素匹配错误
    getDashboardMock.mockRejectedValue(new Error("网络错误"));
    renderDashboard();
    await waitFor(() => {
      const errorTexts = screen.getAllByText("加载失败");
      expect(errorTexts.length).toBeGreaterThan(0);
    });
  });

  it("图表加载成功显示图表组件", async () => {
    setupChartsSuccess();
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
      expect(screen.getByTestId("pie-chart")).toBeInTheDocument();
      expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
    });
  });

  it("图表加载失败显示错误提示与重试按钮", async () => {
    // 任一图表接口失败触发 Promise.all 整体 catch
    getDashboardTrendMock.mockRejectedValueOnce(new Error("图表加载失败"));
    getDashboardReputationMock.mockResolvedValue({ data: mockReputation });
    getDashboardModulesMock.mockResolvedValue({ data: mockModules });
    getDashboardSystemMock.mockResolvedValue({ data: mockSystem });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("图表加载失败")).toBeInTheDocument();
      expect(screen.getByText("重新加载图表")).toBeInTheDocument();
    });
    // 失败时不渲染图表
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("点击重试按钮重新调用图表接口", async () => {
    // mock 队列按调用顺序消费：首次加载调用2次（reg+order）都失败，重试调用2次都成功
    // 设计原因：Promise.all 中 getDashboardTrend 被调用2次，mockRejectedValueOnce 只影响下一次调用，
    // 必须连续设置2次 reject 确保首次整体失败，再设置2次 resolve 确保重试整体成功
    getDashboardTrendMock
      .mockRejectedValueOnce(new Error("首次失败"))
      .mockRejectedValueOnce(new Error("首次失败"))
      .mockResolvedValueOnce({ data: mockRegTrend })
      .mockResolvedValueOnce({ data: mockOrderTrend });
    getDashboardReputationMock.mockResolvedValue({ data: mockReputation });
    getDashboardModulesMock.mockResolvedValue({ data: mockModules });
    getDashboardSystemMock.mockResolvedValue({ data: mockSystem });
    renderDashboard();
    // 等待错误提示出现
    await waitFor(() => {
      expect(screen.getByText("重新加载图表")).toBeInTheDocument();
    });
    // 点击重试
    fireEvent.click(screen.getByText("重新加载图表"));
    // 重试后图表加载成功
    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });
    // 验证 trend 接口被调用了 4 次（首次 2 次 + 重试 2 次）
    expect(getDashboardTrendMock).toHaveBeenCalledTimes(4);
  });

  it("图表加载中显示 loading 文案", async () => {
    // 图表接口处于 pending 状态
    getDashboardTrendMock.mockReturnValue(new Promise(() => {}));
    getDashboardReputationMock.mockReturnValue(new Promise(() => {}));
    getDashboardModulesMock.mockReturnValue(new Promise(() => {}));
    getDashboardSystemMock.mockReturnValue(new Promise(() => {}));
    renderDashboard();
    await waitFor(() => {
      // 统计卡片先加载完成，图表区域显示"加载中..."
      const loadingTexts = screen.getAllByText("加载中...");
      expect(loadingTexts.length).toBeGreaterThan(0);
    });
  });
});
