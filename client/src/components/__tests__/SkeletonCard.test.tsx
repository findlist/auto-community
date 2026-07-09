import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkeletonCard, SkeletonListCard, SkeletonCompactList } from "../Skeleton/SkeletonCard";

describe("SkeletonCard 卡片骨架屏", () => {
  it("默认渲染 1 张卡片", () => {
    const { container } = render(<SkeletonCard />);
    // 每张卡片含 bg-white rounded-lg 外层容器
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(1);
  });

  it("count=3 渲染 3 张卡片", () => {
    const { container } = render(<SkeletonCard count={3} />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(3);
  });

  it("showImage=true 渲染图片占位区域", () => {
    const { container } = render(<SkeletonCard showImage />);
    // 图片区域高度 h-40
    expect(container.querySelector(".h-40")).toBeInTheDocument();
  });

  it("showImage=false 不渲染图片占位", () => {
    const { container } = render(<SkeletonCard showImage={false} />);
    expect(container.querySelector(".h-40")).not.toBeInTheDocument();
  });

  it("所有骨架元素均含 animate-pulse 动画", () => {
    const { container } = render(<SkeletonCard />);
    const boxes = container.querySelectorAll(".animate-pulse");
    expect(boxes.length).toBeGreaterThan(0);
  });
});

describe("SkeletonListCard 列表项骨架屏", () => {
  it("默认渲染 1 项", () => {
    const { container } = render(<SkeletonListCard />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(1);
  });

  it("count=5 渲染 5 项", () => {
    const { container } = render(<SkeletonListCard count={5} />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(5);
  });

  it("showLeftBorder=true 添加 border-l-4 左边框", () => {
    const { container } = render(<SkeletonListCard showLeftBorder />);
    expect(container.querySelector(".border-l-4")).toBeInTheDocument();
  });

  it("showLeftBorder=false 不添加左边框", () => {
    const { container } = render(<SkeletonListCard showLeftBorder={false} />);
    expect(container.querySelector(".border-l-4")).not.toBeInTheDocument();
  });
});

describe("SkeletonCompactList 紧凑列表骨架屏", () => {
  it("默认渲染 3 项", () => {
    const { container } = render(<SkeletonCompactList />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(3);
  });

  it("count=2 渲染 2 项", () => {
    const { container } = render(<SkeletonCompactList count={2} />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(2);
  });

  it("外层容器含 space-y-3 垂直间距", () => {
    const { container } = render(<SkeletonCompactList />);
    expect(container.querySelector(".space-y-3")).toBeInTheDocument();
  });
});
