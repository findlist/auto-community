import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useScrollReveal } from "../useScrollReveal";

// mock IntersectionObserver：jsdom 不原生支持
// 设计原因：useScrollReveal 依赖 IntersectionObserver，需模拟 observe/disconnect 与回调
let intersectCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null;
let observeSpy: ReturnType<typeof vi.fn>;
let disconnectSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  intersectCallback = null;
  observeSpy = vi.fn();
  disconnectSpy = vi.fn();
  // 使用 class 而非箭头函数：源码通过 new IntersectionObserver(cb) 调用，箭头函数不能作为构造函数
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
      intersectCallback = cb;
    }
    observe = observeSpy;
    disconnect = disconnectSpy;
  });
  // 默认 mock matchMedia 返回非减弱动画偏好，使走 IntersectionObserver 路径
  // 设计原因：jsdom 不原生支持 matchMedia，useScrollReveal 在 useEffect 中调用需模拟
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// 包装组件：将 ref 挂载到真实 DOM 元素，使 useEffect 能获取 ref.current
function RevealWrapper() {
  const { ref, visible } = useScrollReveal();
  return (
    <div ref={ref} data-testid="reveal-target">
      {visible ? "visible" : "hidden"}
    </div>
  );
}

describe("useScrollReveal", () => {
  it("初始 visible 为 false", () => {
    render(<RevealWrapper />);
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("元素进入视口时 visible 变为 true", () => {
    render(<RevealWrapper />);
    expect(screen.getByText("hidden")).toBeInTheDocument();

    // 模拟 IntersectionObserver 回调：元素进入视口
    // 设计原因：回调触发 setVisible，属 React state 更新，需用 act 包裹使更新同步刷新
    act(() => {
      if (intersectCallback) {
        intersectCallback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
    });
    expect(screen.getByText("visible")).toBeInTheDocument();
  });

  it("元素未进入视口时 visible 保持 false", () => {
    render(<RevealWrapper />);
    expect(screen.getByText("hidden")).toBeInTheDocument();

    act(() => {
      if (intersectCallback) {
        intersectCallback([{ isIntersecting: false } as IntersectionObserverEntry]);
      }
    });
    expect(screen.getByText("hidden")).toBeInTheDocument();
  });

  it("visible 变为 true 后调用 disconnect", () => {
    render(<RevealWrapper />);

    // 元素进入视口，触发 setVisible(true) + observer.disconnect()
    act(() => {
      if (intersectCallback) {
        intersectCallback([{ isIntersecting: true } as IntersectionObserverEntry]);
      }
    });
    expect(screen.getByText("visible")).toBeInTheDocument();
    // disconnect 被调用（observer.disconnect()）
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("尊重 prefers-reduced-motion 偏好：直接 visible=true", () => {
    // 模拟用户设置了减弱动画偏好
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<RevealWrapper />);
    // 减弱动画偏好下直接 visible=true，不创建 IntersectionObserver
    expect(screen.getByText("visible")).toBeInTheDocument();
    // IntersectionObserver 不应被实例化
    expect(intersectCallback).toBeNull();
  });
});
