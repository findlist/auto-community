import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkeletonList, SkeletonHorizontalList, SkeletonGridList } from "../Skeleton/SkeletonList";

describe("SkeletonList 通用列表骨架屏", () => {
  it("默认渲染 3 项", () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(3);
  });

  it("count=1 渲染 1 项", () => {
    const { container } = render(<SkeletonList count={1} />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(1);
  });

  it("showAvatar=true（默认）渲染圆形头像占位", () => {
    const { container } = render(<SkeletonList showAvatar />);
    // 头像占位为 h-10 w-10 rounded-full
    expect(container.querySelector(".h-10.w-10.rounded-full")).toBeInTheDocument();
  });

  it("showAvatar=false 不渲染头像占位", () => {
    const { container } = render(<SkeletonList showAvatar={false} />);
    expect(container.querySelector(".h-10.w-10.rounded-full")).not.toBeInTheDocument();
  });

  it("showTags=true（默认）渲染标签占位", () => {
    const { container } = render(<SkeletonList showTags />);
    // 标签占位为 rounded-full
    const tags = container.querySelectorAll(".rounded-full");
    expect(tags.length).toBeGreaterThan(0);
  });

  it("showTags=false 不渲染标签占位行", () => {
    const { container } = render(<SkeletonList showTags={false} />);
    // showTags=false 时不应有 flex gap-2 标签容器
    const tagContainers = container.querySelectorAll(".flex.gap-2");
    // 头像区有 1 个 flex，标签区应被移除
    // 至少不应有标签区的 gap-2 容器
    expect(tagContainers.length).toBeLessThanOrEqual(1);
  });

  it("外层容器含 space-y-3 垂直间距", () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelector(".space-y-3")).toBeInTheDocument();
  });
});

describe("SkeletonHorizontalList 横向滚动列表骨架屏", () => {
  it("默认渲染 3 项", () => {
    const { container } = render(<SkeletonHorizontalList />);
    expect(container.querySelectorAll(".flex-shrink-0")).toHaveLength(3);
  });

  it("count=5 渲染 5 项", () => {
    const { container } = render(<SkeletonHorizontalList count={5} />);
    expect(container.querySelectorAll(".flex-shrink-0")).toHaveLength(5);
  });

  it("外层容器含 overflow-x-auto 横向滚动", () => {
    const { container } = render(<SkeletonHorizontalList />);
    expect(container.querySelector(".overflow-x-auto")).toBeInTheDocument();
  });
});

describe("SkeletonGridList 网格列表骨架屏", () => {
  it("默认渲染 4 项", () => {
    const { container } = render(<SkeletonGridList />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(4);
  });

  it("count=2 渲染 2 项", () => {
    const { container } = render(<SkeletonGridList count={2} />);
    expect(container.querySelectorAll(".bg-white.rounded-lg")).toHaveLength(2);
  });

  it("外层容器为 grid grid-cols-2 双列布局", () => {
    const { container } = render(<SkeletonGridList />);
    expect(container.querySelector(".grid.grid-cols-2")).toBeInTheDocument();
  });

  it("每项含图片占位 h-32", () => {
    const { container } = render(<SkeletonGridList />);
    expect(container.querySelector(".h-32")).toBeInTheDocument();
  });
});
