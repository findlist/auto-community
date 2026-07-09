import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoadingButton, Spinner, InlineLoader } from "../Button/LoadingButton";

describe("LoadingButton 加载按钮", () => {
  it("非加载态渲染 children 文本", () => {
    render(<LoadingButton>提交</LoadingButton>);
    expect(screen.getByRole("button", { name: "提交" })).toBeInTheDocument();
  });

  it("加载态显示默认 loadingText「处理中...」并禁用按钮", () => {
    render(<LoadingButton loading>提交</LoadingButton>);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("处理中...");
    // 加载态不应显示原始 children
    expect(button).not.toHaveTextContent("提交");
  });

  it("加载态显示自定义 loadingText", () => {
    render(<LoadingButton loading loadingText="保存中...">保存</LoadingButton>);
    expect(screen.getByRole("button")).toHaveTextContent("保存中...");
  });

  it("加载态渲染 animate-spin 旋转动画", () => {
    const { container } = render(<LoadingButton loading>提交</LoadingButton>);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("disabled 属性独立禁用按钮但不显示 loading 文案", () => {
    render(<LoadingButton disabled>提交</LoadingButton>);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    // disabled 但非 loading 时仍显示 children
    expect(button).toHaveTextContent("提交");
  });

  it("各变体应用对应样式类", () => {
    const { rerender } = render(<LoadingButton variant="primary">按钮</LoadingButton>);
    expect(screen.getByRole("button").className).toContain("bg-emerald-500");

    rerender(<LoadingButton variant="danger">按钮</LoadingButton>);
    expect(screen.getByRole("button").className).toContain("bg-red-500");

    rerender(<LoadingButton variant="outline">按钮</LoadingButton>);
    expect(screen.getByRole("button").className).toContain("border");
  });

  it("各尺寸应用对应 padding 样式", () => {
    const { rerender } = render(<LoadingButton size="sm">按钮</LoadingButton>);
    expect(screen.getByRole("button").className).toContain("px-3");

    rerender(<LoadingButton size="lg">按钮</LoadingButton>);
    expect(screen.getByRole("button").className).toContain("px-6");
  });

  it("fullWidth 应用 w-full 类", () => {
    render(<LoadingButton fullWidth>按钮</LoadingButton>);
    expect(screen.getByRole("button").className).toContain("w-full");
  });

  it("透传 onClick 等原生按钮属性", () => {
    const onClick = vi.fn();
    render(<LoadingButton onClick={onClick}>按钮</LoadingButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("加载态点击不触发 onClick（按钮已禁用）", () => {
    const onClick = vi.fn();
    render(<LoadingButton loading onClick={onClick}>按钮</LoadingButton>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Spinner 旋转指示器", () => {
  it("默认 md 尺寸渲染 animate-spin", () => {
    const { container } = render(<Spinner />);
    // SVG 元素的 className 属性是 SVGAnimatedString，无法直接 toContain，需用 getAttribute 读取
    const svgClass = container.querySelector("svg")?.getAttribute("class") ?? "";
    expect(svgClass).toContain("animate-spin");
    expect(svgClass).toContain("w-5");
  });

  it("sm 尺寸应用 w-4 类", () => {
    const { container } = render(<Spinner size="sm" />);
    const svgClass = container.querySelector("svg")?.getAttribute("class") ?? "";
    expect(svgClass).toContain("w-4");
  });
});

describe("InlineLoader 内联加载器", () => {
  it("默认显示「加载中...」文案", () => {
    render(<InlineLoader />);
    expect(screen.getByText("加载中...")).toBeInTheDocument();
  });

  it("自定义 text 文案", () => {
    render(<InlineLoader text="正在发送..." />);
    expect(screen.getByText("正在发送...")).toBeInTheDocument();
  });

  it("渲染 animate-spin 旋转图标", () => {
    const { container } = render(<InlineLoader />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});
