import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkeletonDetail, SkeletonUserInfo, SkeletonProfile, SkeletonForm } from "../Skeleton/SkeletonDetail";

describe("SkeletonDetail 详情页骨架屏", () => {
  it("默认渲染图片占位（showImage=true）", () => {
    const { container } = render(<SkeletonDetail />);
    expect(container.querySelector(".h-48")).toBeInTheDocument();
  });

  it("showImage=false 不渲染图片占位", () => {
    const { container } = render(<SkeletonDetail showImage={false} />);
    expect(container.querySelector(".h-48")).not.toBeInTheDocument();
  });

  it("showTags=true（默认）渲染标签占位", () => {
    const { container } = render(<SkeletonDetail showTags />);
    // 标签占位为 rounded-full
    expect(container.querySelectorAll(".rounded-full").length).toBeGreaterThan(0);
  });

  it("showTags=false 不渲染标签占位", () => {
    const { container } = render(<SkeletonDetail showTags={false} />);
    // 标签容器 flex gap-2 在 showTags=false 时不应出现
    const tagContainers = container.querySelectorAll(".flex.gap-2");
    expect(tagContainers.length).toBe(0);
  });

  it("showActions=false（默认）不渲染操作按钮占位", () => {
    const { container } = render(<SkeletonDetail />);
    // 操作按钮占位为 h-10 w-full rounded-lg
    expect(container.querySelector(".h-10.w-full.rounded-lg")).not.toBeInTheDocument();
  });

  it("showActions=true 渲染操作按钮占位", () => {
    const { container } = render(<SkeletonDetail showActions />);
    expect(container.querySelector(".h-10.w-full.rounded-lg")).toBeInTheDocument();
  });

  it("className 自定义类名应用到外层容器", () => {
    const { container } = render(<SkeletonDetail className="custom-class" />);
    expect(container.querySelector(".custom-class")).toBeInTheDocument();
  });
});

describe("SkeletonUserInfo 用户信息骨架屏", () => {
  it("渲染头像占位（h-14 w-14 rounded-full）", () => {
    const { container } = render(<SkeletonUserInfo />);
    expect(container.querySelector(".h-14.w-14.rounded-full")).toBeInTheDocument();
  });

  it("渲染用户名和副标题占位", () => {
    const { container } = render(<SkeletonUserInfo />);
    expect(container.querySelector(".h-5.w-28")).toBeInTheDocument();
    expect(container.querySelector(".h-3.w-20")).toBeInTheDocument();
  });
});

describe("SkeletonProfile 个人中心骨架屏", () => {
  it("渲染居中大头像占位（h-20 w-20）", () => {
    const { container } = render(<SkeletonProfile />);
    expect(container.querySelector(".h-20.w-20.rounded-full")).toBeInTheDocument();
  });

  it("渲染统计标签占位行", () => {
    const { container } = render(<SkeletonProfile />);
    // 两个统计标签 h-6 w-16 rounded-full
    const stats = container.querySelectorAll(".h-6.w-16.rounded-full");
    expect(stats).toHaveLength(2);
  });

  it("渲染分隔线后的详情占位", () => {
    const { container } = render(<SkeletonProfile />);
    expect(container.querySelector(".border-t")).toBeInTheDocument();
  });
});

describe("SkeletonForm 表单骨架屏", () => {
  it("渲染 2 个普通输入框占位（h-10 w-full）", () => {
    const { container } = render(<SkeletonForm />);
    // SkeletonForm 实际结构：2 个 h-10 w-full 输入框 + 1 个 h-24 w-full 文本域
    expect(container.querySelectorAll(".h-10.w-full")).toHaveLength(2);
  });

  it("渲染底部双按钮占位", () => {
    const { container } = render(<SkeletonForm />);
    // 两个按钮 h-10 w-24 rounded-lg
    const buttons = container.querySelectorAll(".h-10.w-24.rounded-lg");
    expect(buttons).toHaveLength(2);
  });

  it("最后一个字段为大文本域（h-24）", () => {
    const { container } = render(<SkeletonForm />);
    expect(container.querySelector(".h-24.w-full")).toBeInTheDocument();
  });
});
