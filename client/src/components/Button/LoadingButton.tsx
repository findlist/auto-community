import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface LoadingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 加载状态 */
  loading?: boolean;
  /** 加载时显示的文字 */
  loadingText?: string;
  /** 按钮变体样式 */
  variant?: "primary" | "secondary" | "danger" | "outline" | "ghost";
  /** 按钮尺寸 */
  size?: "sm" | "md" | "lg";
  /** 按钮内容 */
  children: ReactNode;
  /** 是否全宽 */
  fullWidth?: boolean;
}

const variantStyles: Record<string, string> = {
  primary: "bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-emerald-300",
  secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:bg-gray-50",
  danger: "bg-red-500 text-white hover:bg-red-600 disabled:bg-red-300",
  outline: "border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:text-gray-300",
  ghost: "text-gray-600 hover:bg-gray-100 disabled:text-gray-300",
};

const sizeStyles: Record<string, string> = {
  sm: "px-3 py-1.5 text-sm rounded-lg",
  md: "px-4 py-2.5 text-sm rounded-xl",
  lg: "px-6 py-3 text-base rounded-xl",
};

/**
 * 加载按钮组件 - 支持加载状态和禁用状态
 */
export function LoadingButton({
  loading = false,
  loadingText,
  variant = "primary",
  size = "md",
  fullWidth = false,
  disabled,
  className = "",
  children,
  ...props
}: LoadingButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`
        inline-flex items-center justify-center gap-2 font-medium
        transition-colors duration-200
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${fullWidth ? "w-full" : ""}
        ${isDisabled ? "cursor-not-allowed opacity-50" : ""}
        ${className}
      `}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {loading ? (loadingText || "处理中...") : children}
    </button>
  );
}

/**
 * 简单的 Spinner 组件
 */
export function Spinner({ size = "md", className = "" }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const sizeMap = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  return (
    <Loader2
      className={`animate-spin text-emerald-500 ${sizeMap[size]} ${className}`}
    />
  );
}

/**
 * 内联加载指示器 - 用于按钮或链接旁边的加载状态
 */
export function InlineLoader({ text = "加载中...", className = "" }: { text?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-gray-500 ${className}`}>
      <Loader2 className="w-4 h-4 animate-spin" />
      {text}
    </span>
  );
}

export default LoadingButton;