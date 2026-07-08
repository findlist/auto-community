import { useState, useEffect } from "react";

// 检测媒体查询是否匹配
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== "undefined") {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    setMatches(media.matches);
    return () => media.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

// 便捷方法：检测是否为桌面端（>= 1024px）
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
