import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSafeTimeout } from "../useSafeTimeout";

// 使用 fake timers 控制 setTimeout 的触发时机，避免真实等待
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  // 每个用例结束恢复 real timers，避免 fake timers 泄漏到后续测试
  vi.useRealTimers();
});

describe("useSafeTimeout", () => {
  it("调用 safeSetTimeout 后指定 delay 触发 callback", () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useSafeTimeout());

    act(() => {
      result.current(callback, 1000);
    });

    // 未到 delay 时 callback 不应被调用
    expect(callback).not.toHaveBeenCalled();

    // 推进时间到 delay 后 callback 应被调用一次
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("快速连续调用时仅触发最后一个 callback（调用前清理上一个）", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const { result } = renderHook(() => useSafeTimeout());

    // 模拟用户快速点击：100ms 内连续设置两个定时器，第二个应清理第一个
    act(() => {
      result.current(callback1, 1000);
    });
    act(() => {
      result.current(callback2, 1000);
    });

    // 推进时间到第一个定时器应触发的时刻
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // 第一个 callback 应被清理，仅第二个触发
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
  });

  it("组件卸载时自动清理定时器，callback 不被调用", () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() => useSafeTimeout());

    act(() => {
      result.current(callback, 1000);
    });

    // 卸载组件应触发 useEffect cleanup，清理未触发的定时器
    unmount();

    // 推进时间到定时器应触发的时刻，callback 不应被调用
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("safeSetTimeout 引用稳定，多次 render 返回相同引用", () => {
    const { result, rerender } = renderHook(() => useSafeTimeout());
    const firstRef = result.current;

    // 多次 rerender，safeSetTimeout 引用应保持稳定（useCallback 无依赖）
    rerender();
    rerender();
    rerender();

    expect(result.current).toBe(firstRef);
  });

  it("触发后再调用新定时器正常工作（清理已归零的 ref）", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const { result } = renderHook(() => useSafeTimeout());

    // 第一次调用并等待触发
    act(() => {
      result.current(callback1, 500);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(callback1).toHaveBeenCalledTimes(1);

    // 第二次调用：上一个定时器已触发完毕（ref.current 仍持有已执行的 id，clearTimeout 已执行 id 无副作用）
    act(() => {
      result.current(callback2, 500);
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(callback2).toHaveBeenCalledTimes(1);
  });
});
