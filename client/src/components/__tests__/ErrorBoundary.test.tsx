import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ErrorBoundary from "../ErrorBoundary";

// 构造可控的子组件，通过 prop 控制是否抛出错误
function MaybeThrow({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("测试错误：组件渲染失败");
  }
  return <div data-testid="child-content">正常内容</div>;
}



beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ErrorBoundary 错误边界", () => {
  it("无错误时渲染子组件内容", () => {
    render(
      <ErrorBoundary>
        <MaybeThrow shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.queryByText("出了点小问题")).not.toBeInTheDocument();
  });

  it("子组件抛出错误时显示默认 fallback UI", () => {
    render(
      <ErrorBoundary>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText("出了点小问题")).toBeInTheDocument();
    expect(screen.getByText(/页面遇到了意外错误/)).toBeInTheDocument();
    expect(screen.getByText("重新加载")).toBeInTheDocument();
    expect(screen.queryByTestId("child-content")).not.toBeInTheDocument();
  });

  it("提供自定义 fallback 时使用自定义渲染", () => {
    const customFallback = vi.fn((err: Error, reset: () => void) => (
      <div>
        <span data-testid="custom-error">{err.message}</span>
        <button onClick={reset} data-testid="custom-reset">
          自定义重置
        </button>
      </div>
    ));

    render(
      <ErrorBoundary fallback={customFallback}>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(customFallback).toHaveBeenCalled();
    expect(screen.getByTestId("custom-error")).toHaveTextContent("测试错误：组件渲染失败");

    // 点击自定义重置按钮调用 reset 函数
    // 设计原因：reset 将 hasError 置为 false，但子组件仍会抛错，fallback 重新出现
    const resetBtn = screen.getByTestId("custom-reset");
    expect(resetBtn).toBeInTheDocument();
  });

  it("componentDidCatch 调用 console.error 记录错误", () => {
    render(
      <ErrorBoundary>
        <MaybeThrow shouldThrow={true} />
      </ErrorBoundary>
    );

    // React 自身和 componentDidCatch 都会调用 console.error
    // 在所有调用中找到以 [ErrorBoundary] 开头的
    const calls = vi.mocked(console.error).mock.calls;
    const boundaryCall = calls.find((call) => call[0] === "[ErrorBoundary]");
    expect(boundaryCall).toBeDefined();
  });
});
