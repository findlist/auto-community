import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import type { DashboardMetric, MetricTrendItem } from "@/api/admin";

// vi.hoisted 提升 mock 数据与 spy，避免 TDZ 问题
const {
  mockDashboardData,
  mockTrendData,
  getMetricsDashboardMock,
  getMetricTrendMock,
} = vi.hoisted(() => {
  // 5 个核心指标数据，覆盖不同 format 分支（秒/百分比/分）
  const mockDashboardData: DashboardMetric[] = [
    { name: "emergency_response_time", value: 12.5, tags: {}, recordedAt: "2026-07-10T00:00:00Z" },
    { name: "match_success_rate", value: 85.3, tags: {}, recordedAt: "2026-07-10T00:00:00Z" },
    { name: "order_completion_rate", value: 92.1, tags: {}, recordedAt: "2026-07-10T00:00:00Z" },
    { name: "user_satisfaction_score", value: 4.6, tags: {}, recordedAt: "2026-07-10T00:00:00Z" },
    { name: "ai_recommendation_accuracy", value: 78.9, tags: {}, recordedAt: "2026-07-10T00:00:00Z" },
  ];
  const mockTrendData: MetricTrendItem[] = [
    { date: "2026-07-01", value: 10 },
    { date: "2026-07-02", value: 15 },
  ];
  return {
    mockDashboardData,
    mockTrendData,
    getMetricsDashboardMock: vi.fn(),
    getMetricTrendMock: vi.fn(),
  };
});

// mock @/api/admin：仅 Metrics 用到的 2 个接口
vi.mock("@/api/admin", () => ({
  getMetricsDashboard: getMetricsDashboardMock,
  getMetricTrend: getMetricTrendMock,
  __esModule: true,
}));

// mock MetricsChart 为静态占位，隔离 Metrics 测试与图表内部实现
vi.mock("@/components/MetricsChart", () => ({
  default: ({ title }: { title: string }) => <div data-testid="metrics-chart">{title}</div>,
}));

import Metrics from "../Metrics";

// 渲染 Metrics，无路由依赖
function renderMetrics() {
  return render(<Metrics />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认 dashboard 加载成功
  getMetricsDashboardMock.mockResolvedValue({ code: 0, message: "ok", data: mockDashboardData });
  getMetricTrendMock.mockResolvedValue({ code: 0, message: "ok", data: mockTrendData });
});

describe("Metrics 效果度量页", () => {
  it("加载中显示加载文案", async () => {
    // 接口 pending，锁定 loading 态
    getMetricsDashboardMock.mockReturnValue(new Promise(() => {}));
    renderMetrics();
    await waitFor(() => {
      expect(screen.getByText("加载中...")).toBeInTheDocument();
    });
  });

  it("加载成功渲染 5 个指标卡片与格式化值", async () => {
    renderMetrics();
    // 等待指标卡片渲染
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    // 5 个指标标签
    expect(screen.getByText("匹配成功率")).toBeInTheDocument();
    expect(screen.getByText("订单完成率")).toBeInTheDocument();
    expect(screen.getByText("用户满意度")).toBeInTheDocument();
    expect(screen.getByText("AI推荐准确率")).toBeInTheDocument();
    // 格式化值：12.5s / 85.3% / 92.1% / 4.6分 / 78.9%
    expect(screen.getByText("12.5s")).toBeInTheDocument();
    expect(screen.getByText("85.3%")).toBeInTheDocument();
    expect(screen.getByText("92.1%")).toBeInTheDocument();
    expect(screen.getByText("4.6分")).toBeInTheDocument();
    expect(screen.getByText("78.9%")).toBeInTheDocument();
  });

  it("未展开指标时显示提示文案", async () => {
    renderMetrics();
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    expect(screen.getByText("点击上方指标卡片查看趋势图")).toBeInTheDocument();
  });

  it("点击指标卡片展开趋势图并加载趋势数据", async () => {
    renderMetrics();
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    // 点击"应急响应时间"卡片（按钮元素）
    const card = screen.getByText("应急响应时间").closest("button")!;
    await act(async () => {
      fireEvent.click(card);
    });
    // 趋势图渲染
    await waitFor(() => {
      expect(screen.getByTestId("metrics-chart")).toBeInTheDocument();
    });
    // 趋势接口被调用
    expect(getMetricTrendMock).toHaveBeenCalledWith(
      "emergency_response_time",
      expect.any(String),
      expect.any(String)
    );
  });

  it("再次点击已展开的指标卡片收起趋势图", async () => {
    renderMetrics();
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    const card = screen.getByText("应急响应时间").closest("button")!;
    // 展开
    await act(async () => {
      fireEvent.click(card);
    });
    await waitFor(() => {
      expect(screen.getByTestId("metrics-chart")).toBeInTheDocument();
    });
    // 收起
    await act(async () => {
      fireEvent.click(card);
    });
    // 趋势图消失，提示文案重现
    expect(screen.queryByTestId("metrics-chart")).not.toBeInTheDocument();
    expect(screen.getByText("点击上方指标卡片查看趋势图")).toBeInTheDocument();
  });

  it("点击导出 CSV 按钮触发下载", async () => {
    // 仅 mock URL.createObjectURL（jsdom 对 Blob URL 支持不稳定），其余走真实 DOM
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    renderMetrics();
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    // 点击导出 CSV
    await act(async () => {
      fireEvent.click(screen.getByText("导出 CSV"));
    });
    // 验证 createObjectURL 被调用（下载链已创建）
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it("dashboard 加载失败时静默处理（不崩溃）", async () => {
    // Metrics 内部 catch console.error，不渲染错误 UI，loading 消失后卡片值回退为 0
    getMetricsDashboardMock.mockRejectedValue(new Error("网络错误"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderMetrics();
    // 等待 loading 消失后指标卡片渲染（值回退为 0）
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    expect(screen.getByText("0.0s")).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith("加载仪表盘数据失败:", expect.any(Error));
    errorSpy.mockRestore();
  });
});
