import type { ReactNode } from "react";

// 基础骨架元素
function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

interface SkeletonCardProps {
  /** 卡片数量 */
  count?: number;
  /** 是否显示图片区域 */
  showImage?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 卡片骨架屏 - 适用于技能卡片、厨房卡片等
 */
export function SkeletonCard({ count = 1, showImage = false, className = "" }: SkeletonCardProps) {
  const cards: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    cards.push(
      <div key={i} className={`bg-white rounded-lg shadow-sm p-4 ${className}`}>
        {showImage && <SkeletonBox className="h-40 w-full mb-3" />}
        <div className="flex items-start justify-between mb-2">
          <SkeletonBox className="h-5 w-3/4" />
          <SkeletonBox className="h-5 w-16" />
        </div>
        <SkeletonBox className="h-4 w-full mb-2" />
        <SkeletonBox className="h-4 w-2/3 mb-3" />
        <div className="flex items-center gap-2 mb-2">
          <SkeletonBox className="h-5 w-16 rounded-full" />
          <SkeletonBox className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-gray-50">
          <div className="flex items-center gap-2">
            <SkeletonBox className="h-6 w-6 rounded-full" />
            <SkeletonBox className="h-4 w-16" />
          </div>
          <SkeletonBox className="h-4 w-8" />
        </div>
      </div>
    );
  }
  return <>{cards}</>;
}

interface SkeletonListCardProps {
  /** 列表项数量 */
  count?: number;
  /** 是否显示左边框（用于应急列表） */
  showLeftBorder?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 列表项骨架屏 - 适用于时间银行、应急列表等
 */
export function SkeletonListCard({ count = 1, showLeftBorder = false, className = "" }: SkeletonListCardProps) {
  const items: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      <div
        key={i}
        className={`p-4 bg-white rounded-lg ${showLeftBorder ? "border-l-4 border-gray-200" : "shadow-sm"} ${className}`}
      >
        <div className="flex items-start justify-between mb-2">
          <SkeletonBox className="h-4 w-3/4" />
          <SkeletonBox className="h-5 w-12 rounded-full" />
        </div>
        <SkeletonBox className="h-3 w-full mb-2" />
        <SkeletonBox className="h-3 w-1/2 mb-3" />
        <div className="flex items-center gap-2">
          <SkeletonBox className="h-5 w-16 rounded-full" />
          <SkeletonBox className="h-5 w-20 rounded-full" />
        </div>
      </div>
    );
  }
  return <>{items}</>;
}

/**
 * 紧凑列表骨架屏 - 更简单的列表项样式
 */
export function SkeletonCompactList({ count = 3, className = "" }: { count?: number; className?: string }) {
  const items: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      <div key={i} className={`p-4 bg-white rounded-lg animate-pulse ${className}`}>
        <SkeletonBox className="h-4 w-3/4 mb-2" />
        <SkeletonBox className="h-3 w-1/2 mb-3" />
        <div className="flex gap-2">
          <SkeletonBox className="h-6 w-16 rounded-full" />
          <SkeletonBox className="h-6 w-20 rounded-full" />
        </div>
      </div>
    );
  }
  return <div className="space-y-3">{items}</div>;
}

export default SkeletonCard;