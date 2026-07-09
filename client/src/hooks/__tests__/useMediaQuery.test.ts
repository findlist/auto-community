import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery, useIsDesktop } from "../useMediaQuery";

// mock matchMedia：jsdom 不原生支持 matchMedia
// 设计原因：useMediaQuery 依赖 window.matchMedia，需模拟 matches 与 change 事件
// matches 设为可变属性，listener 读取 media.matches 时获取最新值
function mockMatchMedia(initialMatches: boolean) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches: initialMatches,
    addEventListener: vi.fn((event: string, listener: (e: MediaQueryListEvent) => void) => {
      if (event === "change") listeners.push(listener);
    }),
    removeEventListener: vi.fn((listener: (e: MediaQueryListEvent) => void) => {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return { mql, listeners };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useMediaQuery", () => {
  it("返回 matchMedia 的初始匹配状态（true）", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(true);
  });

  it("返回 matchMedia 的初始匹配状态（false）", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
  });

  it("matchMedia change 事件触发后更新匹配状态", () => {
    const { mql, listeners } = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);

    // 更新 mql.matches 为 true，listener 内部读取 media.matches 时获取最新值
    mql.matches = true;
    act(() => {
      listeners.forEach((fn) => fn({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);
  });

  it("query 变化时重新注册监听并更新状态", () => {
    mockMatchMedia(true);
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) => useMediaQuery(query),
      { initialProps: { query: "(min-width: 768px)" } }
    );
    expect(result.current).toBe(true);

    rerender({ query: "(min-width: 1024px)" });
    expect(result.current).toBe(true);
  });
});

describe("useIsDesktop", () => {
  it("桌面端（>= 1024px）返回 true", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it("移动端（< 1024px）返回 false", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });
});
