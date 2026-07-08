import type { ReactNode } from "react";

// 基础骨架元素
function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

interface SkeletonListProps {
  /** 列表项数量 */
  count?: number;
  /** 是否显示头像 */
  showAvatar?: boolean;
  /** 是否显示标签 */
  showTags?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 通用列表骨架屏 - 适用于各种列表页面
 */
export function SkeletonList({
  count = 3,
  showAvatar = true,
  showTags = true,
  className = "",
}: SkeletonListProps) {
  const items: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      <div key={i} className={`bg-white rounded-lg shadow-sm p-4 ${className}`}>
        <div className="flex items-start gap-3">
          {showAvatar && <SkeletonBox className="h-10 w-10 rounded-full flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <SkeletonBox className="h-4 w-24" />
              <SkeletonBox className="h-4 w-16" />
            </div>
            <SkeletonBox className="h-3 w-full mb-2" />
            <SkeletonBox className="h-3 w-3/4 mb-3" />
            {showTags && (
              <div className="flex gap-2">
                <SkeletonBox className="h-5 w-14 rounded-full" />
                <SkeletonBox className="h-5 w-16 rounded-full" />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  return <div className="space-y-3">{items}</div>;
}

/**
 * 横向滚动列表骨架屏
 */
export function SkeletonHorizontalList({ count = 3, className = "" }: { count?: number; className?: string }) {
  const items: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      <div key={i} className={`flex-shrink-0 w-40 bg-white rounded-lg shadow-sm p-3 ${className}`}>
        <SkeletonBox className="h-24 w-full mb-2 rounded-lg" />
        <SkeletonBox className="h-4 w-3/4 mb-1" />
        <SkeletonBox className="h-3 w-1/2" />
      </div>
    );
  }
  return <div className="flex gap-3 overflow-x-auto pb-2">{items}</div>;
}

/**
 * 网格列表骨架屏 - 适用于双列布局
 */
export function SkeletonGridList({ count = 4, className = "" }: { count?: number; className?: string }) {
  const items: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      <div key={i} className={`bg-white rounded-lg shadow-sm overflow-hidden ${className}`}>
        <SkeletonBox className="h-32 w-full" />
        <div className="p-3">
          <SkeletonBox className="h-4 w-3/4 mb-2" />
          <SkeletonBox className="h-3 w-1/2 mb-2" />
          <div className="flex items-center justify-between">
            <SkeletonBox className="h-5 w-16 rounded-full" />
            <SkeletonBox className="h-4 w-12" />
          </div>
        </div>
      </div>
    );
  }
  return <div className="grid grid-cols-2 gap-3">{items}</div>;
}

export default SkeletonList;