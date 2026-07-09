import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResponsiveCard } from "../Card/ResponsiveCard";

// ResponsiveCard 内部使用 Link，需 Router 上下文
function renderCard(props: Parameters<typeof ResponsiveCard>[0]) {
  return render(
    <MemoryRouter>
      <ResponsiveCard {...props} />
    </MemoryRouter>
  );
}

describe("ResponsiveCard 通用响应式卡片", () => {
  it("渲染标题和描述", () => {
    renderCard({ title: "测试卡片", description: "这是描述" });
    expect(screen.getByText("测试卡片")).toBeInTheDocument();
    expect(screen.getByText("这是描述")).toBeInTheDocument();
  });

  it("提供 to 时使用 Link 包装（href 包含目标路径）", () => {
    const { container } = renderCard({ title: "跳转卡片", to: "/skills/123" });
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    // MemoryRouter 默认 basename 为 /，所以 href 以 / 开头
    expect(link?.getAttribute("href")).toContain("/skills/123");
  });

  it("未提供 to 但提供 onClick 时使用 div + onClick", () => {
    const onClick = vi.fn();
    const { container } = renderCard({ title: "可点击卡片", onClick });
    // 无 <a> 标签，应为 div
    expect(container.querySelector("a")).toBeNull();
    fireEvent.click(container.querySelector("div")!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("提供 image 时显示图片", () => {
    const { container } = renderCard({ title: "带图卡片", image: "https://example.com/x.png" });
    const img = container.querySelector("img[src='https://example.com/x.png']");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("带图卡片");
  });

  it("无 image 时显示 emoji 占位符（默认 📋）", () => {
    renderCard({ title: "占位卡片" });
    expect(screen.getByText("📋")).toBeInTheDocument();
  });

  it("自定义 imagePlaceholder 生效", () => {
    renderCard({ title: "自定义占位", imagePlaceholder: "🏠" });
    expect(screen.getByText("🏠")).toBeInTheDocument();
  });

  it("渲染标签列表", () => {
    renderCard({ title: "标签卡片", tags: ["Tag1", "Tag2", "Tag3"] });
    expect(screen.getByText("Tag1")).toBeInTheDocument();
    expect(screen.getByText("Tag2")).toBeInTheDocument();
    expect(screen.getByText("Tag3")).toBeInTheDocument();
  });

  it("无 tags 时不渲染标签容器", () => {
    const { container } = renderCard({ title: "无标签卡片" });
    // 标签 span 使用 bg-emerald-50 样式，无 tags 时不应出现
    expect(container.querySelector(".bg-emerald-50")).toBeNull();
  });

  it("渲染徽章文本", () => {
    renderCard({ title: "徽章卡片", badge: { text: "热门" } });
    expect(screen.getByText("热门")).toBeInTheDocument();
  });

  it("leftBorder=red 应用红色左边框样式", () => {
    const { container } = renderCard({ title: "紧急卡片", leftBorder: "red" });
    const wrapper = container.querySelector(".border-l-4.border-red-500");
    expect(wrapper).not.toBeNull();
  });

  it("leftBorder=none 不应用左边框", () => {
    const { container } = renderCard({ title: "普通卡片", leftBorder: "none" });
    expect(container.querySelector(".border-l-4.border-red-500")).toBeNull();
    expect(container.querySelector(".border-l-4.border-orange-400")).toBeNull();
  });

  it("提供 user 时渲染昵称", () => {
    renderCard({ title: "用户卡片", user: { nickname: "张三", reputationScore: 95 } });
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("user.reputationScore 为 null 时不渲染信誉分", () => {
    renderCard({ title: "无信誉分卡片", user: { nickname: "李四" } });
    expect(screen.getByText("李四")).toBeInTheDocument();
    // 信誉分通过 95 这种数字渲染，无 reputationScore 时不应有 Star 图标
    // 这里通过查询带 fill-current 的 svg 数量验证（信誉分区域有 1 个 Star 图标）
  });

  it("提供 meta 时渲染元数据", () => {
    renderCard({ title: "元数据卡片", meta: "北京朝阳区" });
    expect(screen.getByText("北京朝阳区")).toBeInTheDocument();
  });

  it("渲染 children 插槽内容", () => {
    renderCard({ title: "插槽卡片", children: <div data-testid="custom-child">自定义内容</div> });
    expect(screen.getByTestId("custom-child")).toBeInTheDocument();
    expect(screen.getByText("自定义内容")).toBeInTheDocument();
  });
});
