import { useCallback, useEffect, useRef } from "react";

/**
 * 安全定时器 Hook：统一封装 setTimeout 的引用持有、调用前清理与卸载时清理
 *
 * 设计原因：组件中直接使用 setTimeout 容易遗漏清理，组件卸载后定时器仍可能触发
 * setState/navigate，轻则引发 React 警告（state update on unmounted component），
 * 重则导致内存泄漏或副作用作用于已卸载组件。本 Hook 收敛三处样板代码：
 * 1. useRef 持有定时器引用，避免每次 render 重建
 * 2. useEffect cleanup 在组件卸载时自动 clearTimeout，杜绝泄漏
 * 3. 调用前自动清理上一个定时器，避免快速点击时定时器累积导致提前触发
 *
 * 适用场景：成功提示自动隐藏、跳转延迟、关闭动画、DOM 操作延迟等单一定时器场景
 */
export function useSafeTimeout() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 组件卸载时清理，避免 setState/navigate 作用于已卸载组件
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // useCallback 稳定 safeSetTimeout 引用，避免依赖该函数的 useEffect 反复重建
  const safeSetTimeout = useCallback((callback: () => void, delay: number) => {
    // 调用前清理上一个定时器，避免快速点击时定时器累积导致提前触发
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(callback, delay);
  }, []);

  return safeSetTimeout;
}
