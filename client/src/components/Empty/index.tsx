/**
 * 空状态组件
 * 用于列表为空、加载失败、无权限等边界场景
 */
import { ReactNode } from "react";
import { Inbox, AlertCircle, Lock, Search } from "lucide-react";

export type EmptyVariant = "default" | "error" | "permission" | "search";

interface EmptyProps {
  variant?: EmptyVariant;
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /**
   * 紧凑模式：用于 max-h 限高的滚动容器内（如告警日志面板），
   * 缩小内边距与图标尺寸避免撑高容器导致多余滚动条
   */
  compact?: boolean;
}

const defaultConfig: Record<EmptyVariant, { icon: ReactNode; title: string; description: string; color: string }> = {
  default: {
    icon: <Inbox className="w-16 h-16" />,
    title: "暂无内容",
    description: "这里空空如也，去别处看看吧",
    color: "text-[var(--color-neutral-400)]",
  },
  error: {
    icon: <AlertCircle className="w-16 h-16" />,
    title: "加载失败",
    description: "网络好像出了点问题，请稍后重试",
    color: "text-[var(--color-error)]",
  },
  permission: {
    icon: <Lock className="w-16 h-16" />,
    title: "暂无权限",
    description: "登录后即可查看此内容",
    color: "text-[var(--color-warning)]",
  },
  search: {
    icon: <Search className="w-16 h-16" />,
    title: "未找到结果",
    description: "试试其他关键词或筛选条件",
    color: "text-[var(--color-neutral-400)]",
  },
};

export default function Empty({
  variant = "default",
  title,
  description,
  icon,
  action,
  compact = false,
}: EmptyProps) {
  const config = defaultConfig[variant];
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center px-4 animate-fade-in ${
        compact ? "py-8" : "py-16"
      }`}
    >
      <div className={`${config.color} ${compact ? "mb-2" : "mb-4"} opacity-80`}>
        {icon || config.icon}
      </div>
      <h3
        className={`${compact ? "text-base" : "text-lg"} font-medium text-[var(--color-text-primary)] ${
          compact ? "mb-1" : "mb-2"
        }`}
      >
        {title || config.title}
      </h3>
      <p className="text-sm text-[var(--color-text-tertiary)] text-center max-w-xs mb-6">
        {description || config.description}
      </p>
      {action && <div>{action}</div>}
    </div>
  );
}
