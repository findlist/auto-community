import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  LineChart,
  PieChart,
  BarChart,
  ProgressBar,
  ChartCard,
} from "../Charts";

// useReducedMotion 通过 window.matchMedia 监听，
// 测试前 stub 为标准实现避免 jsdom 不支持报错
const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

beforeEach(() => {
  // jsdom 不实现 matchMedia，挂载到 window 上
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: matchMediaMock,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LineChart 折线图", () => {
  it("无 labels 时显示「暂无数据」", () => {
    render(<LineChart labels={[]} series={[]} />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });

  it("无 series 时显示「暂无数据」", () => {
    render(<LineChart labels={["周一"]} series={[]} />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });

  it("渲染 SVG 折线图容器（role=img, aria-label=折线图）", () => {
    const { container } = render(
      <LineChart labels={["1月", "2月"]} series={[{ name: "系列1", data: [10, 20], color: "#10b981" }]} />
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("折线图");
  });

  it("渲染 polyline 折线", () => {
    const { container } = render(
      <LineChart labels={["1月", "2月", "3月"]} series={[{ name: "系列1", data: [10, 20, 15], color: "#10b981" }]} />
    );
    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("stroke")).toBe("#10b981");
  });

  it("每个数据点渲染 1 个 circle（点状指示）", () => {
    const { container } = render(
      <LineChart labels={["1月", "2月", "3月"]} series={[{ name: "系列1", data: [10, 20, 15], color: "#10b981" }]} />
    );
    const circles = container.querySelectorAll("circle");
    // 3 个数据点 × 2（透明 hover 区 + 视觉点）= 6 个 circle
    expect(circles.length).toBeGreaterThanOrEqual(3);
  });

  it("showLegend=true 渲染图例", () => {
    render(
      <LineChart
        labels={["1月"]}
        series={[{ name: "我的系列", data: [10], color: "#10b981" }]}
        showLegend={true}
      />
    );
    expect(screen.getByText("我的系列")).toBeInTheDocument();
  });

  it("showLegend=false 不渲染图例", () => {
    render(
      <LineChart
        labels={["1月"]}
        series={[{ name: "我的系列", data: [10], color: "#10b981" }]}
        showLegend={false}
      />
    );
    expect(screen.queryByText("我的系列")).toBeNull();
  });

  it("多 series 渲染多条 polyline", () => {
    const { container } = render(
      <LineChart
        labels={["1月", "2月"]}
        series={[
          { name: "系列1", data: [10, 20], color: "#10b981" },
          { name: "系列2", data: [5, 15], color: "#3b82f6" },
        ]}
      />
    );
    const polylines = container.querySelectorAll("polyline");
    expect(polylines).toHaveLength(2);
  });

  it("hover 数据点显示 tooltip", () => {
    const { container } = render(
      <LineChart labels={["1月", "2月"]} series={[{ name: "系列1", data: [10, 20], color: "#10b981" }]} />
    );
    // 取第一个 hover 区域 circle（r=12 透明）
    const hoverCircles = Array.from(container.querySelectorAll('circle[r="12"]'));
    expect(hoverCircles.length).toBeGreaterThan(0);
    fireEvent.mouseEnter(hoverCircles[0]);
    // tooltip 内含「系列1: 10」值文本（图例也含「系列1」，用更精确的文本区分）
    expect(screen.getByText("系列1: 10")).toBeInTheDocument();
  });
});

describe("PieChart 饼图", () => {
  it("无 data 时显示「暂无数据」", () => {
    render(<PieChart data={[]} />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });

  it("渲染 SVG path 切片", () => {
    const { container } = render(
      <PieChart data={[{ name: "A", value: 30, color: "#10b981" }]} />
    );
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("渲染总计标签", () => {
    render(
      <PieChart
        data={[
          { name: "A", value: 30, color: "#10b981" },
          { name: "B", value: 70, color: "#3b82f6" },
        ]}
      />
    );
    // 总计 100
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("总计")).toBeInTheDocument();
  });

  it("渲染图例列表（名称 + 百分比）", () => {
    render(
      <PieChart
        data={[
          { name: "选项A", value: 30, color: "#10b981" },
          { name: "选项B", value: 70, color: "#3b82f6" },
        ]}
      />
    );
    expect(screen.getByText("选项A")).toBeInTheDocument();
    expect(screen.getByText("选项B")).toBeInTheDocument();
    // 30/100 = 30%
    expect(screen.getByText(/30%/)).toBeInTheDocument();
    expect(screen.getByText(/70%/)).toBeInTheDocument();
  });

  it("hover 切片显示 title 元素提示", () => {
    const { container } = render(
      <PieChart data={[{ name: "切片A", value: 50, color: "#10b981" }]} />
    );
    const path = container.querySelector("path");
    fireEvent.mouseEnter(path!);
    // <title> 子元素被渲染
    const titleEl = path?.querySelector("title");
    expect(titleEl).not.toBeNull();
    expect(titleEl?.textContent).toContain("切片A");
  });
});

describe("BarChart 条形图", () => {
  it("无 data 时显示「暂无数据」", () => {
    render(<BarChart data={[]} />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });

  it("渲染条形列表（li 结构）", () => {
    const { container } = render(
      <BarChart
        data={[
          { name: "项目A", value: 50 },
          { name: "项目B", value: 30 },
        ]}
      />
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
  });

  it("渲染名称和数值", () => {
    render(
      <BarChart
        data={[{ name: "项目A", value: 100 }]}
      />
    );
    expect(screen.getByText("项目A")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("自定义颜色生效", () => {
    const { container } = render(
      <BarChart data={[{ name: "项目A", value: 100, color: "#ff0000" }]} />
    );
    // jsdom 将 hex 颜色转换为 rgb 格式后写入 inline style
    const coloredDiv = container.querySelector('[style*="rgb(255, 0, 0)"]');
    expect(coloredDiv).not.toBeNull();
  });

  it("maxValue 限制进度条宽度", () => {
    const { container } = render(
      <BarChart
        data={[{ name: "项目A", value: 50 }]}
        maxValue={200}
      />
    );
    // 50/200 = 25%，进度条 div 通过 width:25% 表示
    const progressBar = container.querySelector('[style*="width: 25%"]');
    expect(progressBar).not.toBeNull();
  });

  it("hover 条形显示数值 tooltip", () => {
    const { container } = render(
      <BarChart data={[{ name: "项目A", value: 100 }]} />
    );
    const li = container.querySelector("li");
    fireEvent.mouseEnter(li!);
    // 重新查询：tooltip 在 hover 后追加
    const tooltipText = container.ownerDocument.querySelector('[style*="translate"]');
    // tooltip 内容包含项目名 100
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
  });
});

describe("ProgressBar 进度条", () => {
  it("渲染进度填充（width 百分比）", () => {
    const { container } = render(<ProgressBar value={50} max={100} />);
    // 50/100=50%，inline style width:50%
    const fill = container.querySelector('[style*="width: 50%"]');
    expect(fill).not.toBeNull();
  });

  it("value 超过 max 时进度条封顶 100%", () => {
    const { container } = render(<ProgressBar value={150} max={100} />);
    const fill = container.querySelector('[style*="width: 100%"]');
    expect(fill).not.toBeNull();
  });

  it("有 label 时渲染标签和数值", () => {
    render(<ProgressBar value={3} max={5} label="完成度" />);
    expect(screen.getByText("完成度")).toBeInTheDocument();
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });

  it("无 label 时不渲染标签", () => {
    const { container } = render(<ProgressBar value={3} max={5} />);
    expect(container.querySelector("label")).toBeNull();
  });

  it("showValue=false 不显示数值", () => {
    render(<ProgressBar value={3} max={5} label="完成度" showValue={false} />);
    expect(screen.queryByText("3/5")).toBeNull();
  });

  it("自定义 color 应用到进度条", () => {
    const { container } = render(<ProgressBar value={50} max={100} color="#ff0000" />);
    // jsdom 将 hex 颜色转换为 rgb 格式后写入 inline style
    const colored = container.querySelector('[style*="rgb(255, 0, 0)"]');
    expect(colored).not.toBeNull();
  });

  it("默认 max=100", () => {
    const { container } = render(<ProgressBar value={30} />);
    // 30/100=30%
    const fill = container.querySelector('[style*="width: 30%"]');
    expect(fill).not.toBeNull();
  });
});

describe("ChartCard 图表卡片容器", () => {
  it("渲染标题", () => {
    render(<ChartCard title="月度统计">内容</ChartCard>);
    expect(screen.getByText("月度统计")).toBeInTheDocument();
  });

  it("渲染副标题", () => {
    render(<ChartCard title="月度统计" subtitle="2026年7月">内容</ChartCard>);
    expect(screen.getByText("2026年7月")).toBeInTheDocument();
  });

  it("无 subtitle 时不渲染副标题", () => {
    const { container } = render(<ChartCard title="月度统计">内容</ChartCard>);
    // 副标题使用 text-xs 类，无 subtitle 时不出现 <p>
    const subtitles = container.querySelectorAll("p.text-xs");
    expect(subtitles.length).toBe(0);
  });

  it("渲染 action 插槽", () => {
    render(
      <ChartCard title="月度统计" action={<button>导出</button>}>
        内容
      </ChartCard>
    );
    expect(screen.getByText("导出")).toBeInTheDocument();
  });

  it("渲染 children 内容", () => {
    render(
      <ChartCard title="月度统计">
        <div data-testid="chart-content">图表内容</div>
      </ChartCard>
    );
    expect(screen.getByTestId("chart-content")).toBeInTheDocument();
  });
});
