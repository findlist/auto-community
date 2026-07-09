import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// mock LineChart：MetricsChart 的核心子组件，避免依赖完整 SVG 渲染
// 通过 data-testid 暴露接收到的 props，便于断言数据流
vi.mock("@/components/Charts", () => ({
  LineChart: (props: { labels: string[]; series: Array<{ name: string; data: number[]; color: string }>; height: number; showLegend: boolean }) => (
    <div data-testid="line-chart" data-labels={props.labels.join(",")} data-height={props.height} data-show-legend={props.showLegend}>
      {props.series.map((s, i) => (
        <div key={i} data-testid="series-item" data-name={s.name} data-color={s.color}>
          {s.data.join(",")}
        </div>
      ))}
    </div>
  ),
}));

import MetricsChart from "../MetricsChart";

const sampleData = [
  { date: "2026-07-01", value: 10 },
  { date: "2026-07-02", value: 20 },
  { date: "2026-07-03", value: 15 },
];

describe("MetricsChart 指标图表", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染标题和单位", () => {
    render(<MetricsChart title="活跃用户" unit="人" data={sampleData} />);
    expect(screen.getByText("活跃用户")).toBeInTheDocument();
    expect(screen.getByText("单位：人")).toBeInTheDocument();
  });

  it("无 unit 时不渲染单位标签", () => {
    render(<MetricsChart title="访问量" data={sampleData} />);
    expect(screen.queryByText(/单位/)).toBeNull();
  });

  it("默认 timeRange 为 7d（高亮 7天 按钮）", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    const sevenDayBtn = screen.getByText("7天");
    // 7d 激活态使用 bg-white + font-medium，非激活态使用 text-[var(--color-text-tertiary)]
    expect(sevenDayBtn.className).toContain("bg-white");
    expect(sevenDayBtn.className).toContain("font-medium");
  });

  it("点击 30天 按钮切换内部 timeRange", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    const thirtyDayBtn = screen.getByText("30天");
    fireEvent.click(thirtyDayBtn);
    // 30天 按钮变为激活态
    expect(thirtyDayBtn.className).toContain("bg-white");
    expect(thirtyDayBtn.className).toContain("font-medium");
    // 7天 按钮变为非激活态
    expect(screen.getByText("7天").className).not.toContain("font-medium");
  });

  it("点击 90天 按钮切换内部 timeRange", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    fireEvent.click(screen.getByText("90天"));
    expect(screen.getByText("90天").className).toContain("bg-white");
  });

  it("受控模式调用 onTimeRangeChange 回调", () => {
    const onTimeRangeChange = vi.fn();
    render(
      <MetricsChart
        title="测试"
        data={sampleData}
        timeRange="7d"
        onTimeRangeChange={onTimeRangeChange}
      />
    );
    fireEvent.click(screen.getByText("30天"));
    expect(onTimeRangeChange).toHaveBeenCalledWith("30d");
    expect(onTimeRangeChange).toHaveBeenCalledTimes(1);
  });

  it("受控模式不更新内部状态（点击 30天 不改变 7天 高亮）", () => {
    const onTimeRangeChange = vi.fn();
    render(
      <MetricsChart
        title="测试"
        data={sampleData}
        timeRange="7d"
        onTimeRangeChange={onTimeRangeChange}
      />
    );
    fireEvent.click(screen.getByText("30天"));
    // timeRange 由父组件控制，仍为 7d
    expect(screen.getByText("7天").className).toContain("bg-white");
    expect(screen.getByText("30天").className).not.toContain("bg-white");
  });

  it("将 data 转换为 labels（月/日 格式）和 series", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    const chart = screen.getByTestId("line-chart");
    const labels = chart.getAttribute("data-labels") || "";
    // 日期 "2026-07-01" 应转换为 "7/1"
    expect(labels).toContain("7/1");
    expect(labels).toContain("7/2");
    expect(labels).toContain("7/3");
  });

  it("将数据 values 传递给 LineChart series", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    const seriesItems = screen.getAllByTestId("series-item");
    expect(seriesItems).toHaveLength(1);
    // toHaveLength(1) 后 [0] 仍可能为 undefined，用非空断言
    expect(seriesItems[0]!.textContent).toBe("10,20,15");
    expect(seriesItems[0]!.getAttribute("data-name")).toBe("测试");
  });

  it("自定义 color 传递给 series", () => {
    render(<MetricsChart title="测试" data={sampleData} color="#ff0000" />);
    const seriesItem = screen.getByTestId("series-item");
    expect(seriesItem.getAttribute("data-color")).toBe("#ff0000");
  });

  it("showLegend 固定为 false 传递给 LineChart", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    const chart = screen.getByTestId("line-chart");
    expect(chart.getAttribute("data-show-legend")).toBe("false");
  });

  it("height 固定为 200 传递给 LineChart", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    const chart = screen.getByTestId("line-chart");
    expect(chart.getAttribute("data-height")).toBe("200");
  });

  it("渲染 3 个时间范围按钮", () => {
    render(<MetricsChart title="测试" data={sampleData} />);
    expect(screen.getByText("7天")).toBeInTheDocument();
    expect(screen.getByText("30天")).toBeInTheDocument();
    expect(screen.getByText("90天")).toBeInTheDocument();
  });
});
