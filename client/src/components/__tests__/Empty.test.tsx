import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Empty from "../Empty";

describe("Empty 空状态组件", () => {
  it("default 变体渲染默认图标、标题和描述", () => {
    render(<Empty />);
    expect(screen.getByText("暂无内容")).toBeInTheDocument();
    expect(screen.getByText("这里空空如也，去别处看看吧")).toBeInTheDocument();
    // role="status" 确保辅助技术可识别
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("error 变体渲染错误图标和加载失败文案", () => {
    render(<Empty variant="error" />);
    expect(screen.getByText("加载失败")).toBeInTheDocument();
    expect(screen.getByText("网络好像出了点问题，请稍后重试")).toBeInTheDocument();
  });

  it("permission 变体渲染权限提示", () => {
    render(<Empty variant="permission" />);
    expect(screen.getByText("暂无权限")).toBeInTheDocument();
    expect(screen.getByText("登录后即可查看此内容")).toBeInTheDocument();
  });

  it("search 变体渲染搜索无结果提示", () => {
    render(<Empty variant="search" />);
    expect(screen.getByText("未找到结果")).toBeInTheDocument();
  });

  it("自定义 title 和 description 覆盖默认配置", () => {
    render(<Empty title="自定义标题" description="自定义描述" />);
    expect(screen.getByText("自定义标题")).toBeInTheDocument();
    expect(screen.getByText("自定义描述")).toBeInTheDocument();
    // 默认文案不应出现
    expect(screen.queryByText("暂无内容")).not.toBeInTheDocument();
  });

  it("自定义 icon 覆盖默认图标", () => {
    render(<Empty icon={<span data-testid="custom-icon">图标</span>} />);
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("action 插槽渲染操作按钮", () => {
    render(<Empty action={<button>重试</button>} />);
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("具备 aria-live=polite 属性，确保辅助技术播报状态变化", () => {
    render(<Empty />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("compact 模式应用紧凑内边距类名，用于限高滚动容器", () => {
    const { container } = render(<Empty compact title="紧凑空状态" />);
    // compact 模式根容器使用 py-8 而非默认 py-16，避免在 max-h 限高容器内撑高
    expect(container.firstChild).toHaveClass("py-8");
    expect(container.firstChild).not.toHaveClass("py-16");
    expect(screen.getByText("紧凑空状态")).toBeInTheDocument();
  });
});
