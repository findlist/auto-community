// 基础骨架元素
function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

interface SkeletonDetailProps {
  /** 是否显示图片 */
  showImage?: boolean;
  /** 是否显示标签 */
  showTags?: boolean;
  /** 是否显示操作按钮 */
  showActions?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 详情页骨架屏 - 适用于技能详情、厨房详情等
 */
export function SkeletonDetail({
  showImage = true,
  showTags = true,
  showActions = false,
  className = "",
}: SkeletonDetailProps) {
  return (
    <div className={`bg-white rounded-lg shadow-sm ${className}`}>
      {showImage && <SkeletonBox className="h-48 w-full rounded-t-lg" />}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <SkeletonBox className="h-6 w-2/3" />
          <SkeletonBox className="h-6 w-20" />
        </div>
        <SkeletonBox className="h-4 w-full mb-2" />
        <SkeletonBox className="h-4 w-4/5 mb-4" />
        {showTags && (
          <div className="flex gap-2 mb-4">
            <SkeletonBox className="h-6 w-16 rounded-full" />
            <SkeletonBox className="h-6 w-20 rounded-full" />
            <SkeletonBox className="h-6 w-14 rounded-full" />
          </div>
        )}
        <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
          <SkeletonBox className="h-10 w-10 rounded-full" />
          <div className="flex-1">
            <SkeletonBox className="h-4 w-24 mb-1" />
            <SkeletonBox className="h-3 w-16" />
          </div>
        </div>
        {showActions && (
          <div className="flex gap-3 pt-4 border-t border-gray-100 mt-4">
            <SkeletonBox className="h-10 w-full rounded-lg" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 用户信息骨架屏
 */
export function SkeletonUserInfo({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <SkeletonBox className="h-14 w-14 rounded-full" />
        <div className="flex-1">
          <SkeletonBox className="h-5 w-28 mb-2" />
          <SkeletonBox className="h-3 w-20" />
        </div>
      </div>
      <SkeletonBox className="h-4 w-full mb-2" />
      <SkeletonBox className="h-4 w-3/4" />
    </div>
  );
}

/**
 * 用户资料骨架屏 - 适用于个人中心页面
 */
export function SkeletonProfile({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm ${className}`}>
      <div className="p-4 text-center">
        <SkeletonBox className="h-20 w-20 rounded-full mx-auto mb-3" />
        <SkeletonBox className="h-5 w-24 mx-auto mb-2" />
        <SkeletonBox className="h-3 w-32 mx-auto mb-4" />
        <div className="flex justify-center gap-4 mb-4">
          <SkeletonBox className="h-6 w-16 rounded-full" />
          <SkeletonBox className="h-6 w-16 rounded-full" />
        </div>
      </div>
      <div className="border-t border-gray-100 p-4">
        <SkeletonBox className="h-4 w-full mb-3" />
        <SkeletonBox className="h-4 w-3/4 mb-3" />
        <SkeletonBox className="h-4 w-1/2" />
      </div>
    </div>
  );
}

/**
 * 表单骨架屏 - 适用于编辑页面
 */
export function SkeletonForm({ className = "" }: { className?: string }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm p-4 ${className}`}>
      <div className="space-y-4">
        <div>
          <SkeletonBox className="h-4 w-20 mb-2" />
          <SkeletonBox className="h-10 w-full" />
        </div>
        <div>
          <SkeletonBox className="h-4 w-24 mb-2" />
          <SkeletonBox className="h-10 w-full" />
        </div>
        <div>
          <SkeletonBox className="h-4 w-16 mb-2" />
          <SkeletonBox className="h-24 w-full" />
        </div>
        <div className="flex gap-3 pt-4">
          <SkeletonBox className="h-10 w-24 rounded-lg" />
          <SkeletonBox className="h-10 w-24 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default SkeletonDetail;