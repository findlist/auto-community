import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Toast 使用 zustand store，需在测试前重置 store 状态
// 设计原因：toastIdCounter 为模块级变量，跨用例递增，store 中 toasts 需在每个用例前清空
import {
  useToastStore,
  showToast,
  toast,
  default as ToastContainer,
} from "../Toast";

// 辅助：清空 store 状态
function resetStore() {
  useToastStore.setState({ toasts: [] });
}

beforeEach(() => {
  resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast 全局通知组件", () => {
  it("showToast 添加提示到 store", () => {
    showToast("操作成功", "success", 3000);
    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe("操作成功");
    expect(toasts[0]!.type).toBe("success");
    expect(toasts[0]!.duration).toBe(3000);
  });

  it("toast.success/error/warning/info 便捷方法调用 showToast 并传递正确类型", () => {
    toast.success("成功消息");
    toast.error("错误消息");
    toast.warning("警告消息");
    toast.info("信息消息");

    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(4);
    expect(toasts[0]!.type).toBe("success");
    expect(toasts[1]!.type).toBe("error");
    expect(toasts[2]!.type).toBe("warning");
    expect(toasts[3]!.type).toBe("info");
  });

  it("ToastContainer 渲染所有提示项", () => {
    toast.success("成功");
    toast.error("失败");

    render(<ToastContainer />);

    expect(screen.getByText("成功")).toBeInTheDocument();
    expect(screen.getByText("失败")).toBeInTheDocument();
    // 每个提示项有 role="alert"
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("无提示时 ToastContainer 不渲染提示项", () => {
    render(<ToastContainer />);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("duration 后自动移除提示", () => {
    // 设计原因：fake timers 下 waitFor 会卡死，改为同步断言
    // act 包裹 advanceTimersByTime 确保 React state 更新被刷新
    showToast("自动消失", "info", 2000);
    render(<ToastContainer />);

    expect(screen.getByText("自动消失")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // setTimeout 回调触发 remove → store 更新 → ToastContainer 重新渲染
    expect(screen.queryByText("自动消失")).not.toBeInTheDocument();
  });

  it("点击关闭按钮手动移除提示", () => {
    toast.success("可关闭提示");
    render(<ToastContainer />);

    const closeBtn = screen.getByLabelText("关闭提示");
    fireEvent.click(closeBtn);

    expect(screen.queryByText("可关闭提示")).not.toBeInTheDocument();
  });

  it("store.remove 直接移除指定 ID 的提示", () => {
    showToast("测试1", "info");
    const { toasts } = useToastStore.getState();
    const id = toasts[0]!.id;

    useToastStore.getState().remove(id);

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("duration=0 时不会自动移除（不设定时器）", () => {
    // 设计原因：duration=0 时 useEffect 内 if(toast.duration > 0) 为 false，不设定时器
    showToast("不自动消失", "info", 0);
    render(<ToastContainer />);

    act(() => {
      vi.advanceTimersByTime(100000);
    });

    expect(screen.getByText("不自动消失")).toBeInTheDocument();
  });
});
