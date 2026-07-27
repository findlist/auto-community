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

  it("CSV 导出内容含「最后更新时间」表头与 recordedAt 值", async () => {
    // 验证 CSV 表头补全「最后更新时间」列：捕获 Blob 内容解析
    // 参数类型对齐 URL.createObjectURL 签名（Blob | MediaSource），避免 tsc 报错
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockImplementation((obj: Blob | MediaSource) => {
      // 仅 Blob 有 text() 方法，MediaSource 无需处理（本项目 CSV 导出只传 Blob）
      if (obj instanceof Blob) {
        obj.text().then((text) => { (createObjectURLSpy as unknown as { __csvContent?: string }).__csvContent = text; });
      }
      return "blob:mock";
    });
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderMetrics();
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("导出 CSV"));
    });

    // 等待 Blob.text() 异步解析完成
    await waitFor(() => {
      const csv = (createObjectURLSpy as unknown as { __csvContent?: string }).__csvContent;
      expect(csv).toBeDefined();
    });
    const csv = (createObjectURLSpy as unknown as { __csvContent?: string }).__csvContent || "";
    // 表头含「最后更新时间」
    expect(csv).toContain("最后更新时间");
    // 数据行含 mockDashboardData 的 recordedAt（2026-07-10）本地化后的年份
    expect(csv).toContain("2026");

    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it("指标数据 stale（超过 2 小时）时显示「可能过期」标签与相对时间文案", async () => {
    // 默认 mockDashboardData 的 recordedAt=2026-07-10，相对当前是 18 天前，肯定 stale
    renderMetrics();
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    // 5 个指标卡片均应显示「可能过期」标签
    expect(screen.getAllByText("可能过期")).toHaveLength(5);
    // 相对时间文案应包含「天前更新」（18 天前）
    expect(screen.getAllByText(/天前更新/)).toHaveLength(5);
  });

  it("指标数据 fresh（2 小时内）时不显示「可能过期」标签且显示「刚刚更新」", async () => {
    // mock recordedAt 为 30 秒前，肯定在 2 小时阈值内，显示「刚刚更新」且无 stale 标签
    const freshIso = new Date(Date.now() - 30 * 1000).toISOString();
    const freshData: DashboardMetric[] = [
      { name: "emergency_response_time", value: 12.5, tags: {}, recordedAt: freshIso },
      { name: "match_success_rate", value: 85.3, tags: {}, recordedAt: freshIso },
      { name: "order_completion_rate", value: 92.1, tags: {}, recordedAt: freshIso },
      { name: "user_satisfaction_score", value: 4.6, tags: {}, recordedAt: freshIso },
      { name: "ai_recommendation_accuracy", value: 78.9, tags: {}, recordedAt: freshIso },
    ];
    getMetricsDashboardMock.mockResolvedValue({ code: 0, message: "ok", data: freshData });
    renderMetrics();
    await waitFor(() => {
      expect(screen.getAllByText("刚刚更新")).toHaveLength(5);
    });
    // 不应出现「可能过期」标签
    expect(screen.queryByText("可能过期")).not.toBeInTheDocument();
  });

  it("recordedAt 缺失时显示「暂无数据」与「可能过期」标签", async () => {
    // mock 数据无 recordedAt 字段，验证兜底文案与 stale 标签
    // 设计原因：getMetricRecordedAt 返回 undefined 时，isStale 视为过期，
    // 5 个卡片中仅 1 个有 metric（无 recordedAt）+ 4 个无 metric，均应显示「暂无数据」+「可能过期」
    const noTimestampData: DashboardMetric[] = [
      { name: "emergency_response_time", value: 12.5, tags: {} },
    ] as DashboardMetric[];
    getMetricsDashboardMock.mockResolvedValue({ code: 0, message: "ok", data: noTimestampData });
    renderMetrics();
    await waitFor(() => {
      // 5 个卡片均显示「暂无数据」（1 个 metric 无 recordedAt + 4 个无 metric）
      expect(screen.getAllByText("暂无数据")).toHaveLength(5);
    });
    // 缺 recordedAt 视为 stale，5 个卡片均应显示「可能过期」
    expect(screen.getAllByText("可能过期")).toHaveLength(5);
  });

  it("dashboard 加载失败时展示错误 UI 与重试按钮", async () => {
    // 错误状态：渲染层应展示 Empty variant=error + 重试按钮，不再静默回退空数据
    getMetricsDashboardMock.mockRejectedValue(new Error("网络错误"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderMetrics();
    // 等待 loading 消失后错误 UI 渲染
    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });
    // 错误描述应展示通用错误信息（非 ApiError 时使用兜底文案）
    expect(screen.getByText("加载仪表盘数据失败")).toBeInTheDocument();
    // 重试按钮存在
    expect(screen.getByText("重新加载")).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalledWith("加载仪表盘数据失败:", expect.any(Error));
    errorSpy.mockRestore();
  });

  it("点击重新加载按钮触发 retryKey 递增并重新请求 dashboard", async () => {
    // 首次失败、重试成功：验证 retryKey 递增触发 useEffect 重新执行 loadDashboard
    getMetricsDashboardMock.mockRejectedValueOnce(new Error("网络错误"));
    getMetricsDashboardMock.mockResolvedValueOnce({ code: 0, message: "ok", data: mockDashboardData });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderMetrics();
    // 等待错误 UI 渲染
    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });
    // 点击重新加载
    await act(async () => {
      fireEvent.click(screen.getByText("重新加载"));
    });
    // 等待重试成功后指标卡片渲染
    await waitFor(() => {
      expect(screen.getByText("应急响应时间")).toBeInTheDocument();
    });
    // dashboard 接口被调用 2 次（初次 + 重试）
    expect(getMetricsDashboardMock).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
