/**
 * 全局 Toast 提示组件
 * 支持 success / error / warning / info 四种类型
 *
 * 使用方式：
 *   import { showToast } from '@/components/Toast';
 *   showToast('操作成功', 'success');
 */
import { create } from "zustand";
import { CheckCircle, XCircle, AlertTriangle, Info, X } from "lucide-react";
import { useCallback, useEffect } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastStore {
  toasts: ToastItem[];
  add: (toast: Omit<ToastItem, "id">) => void;
  remove: (id: number) => void;
}

let toastIdCounter = 0;

// eslint-disable-next-line react-refresh/only-export-components -- store hook 与组件共置便于消费方统一导入，拆分需改动 29 个引用文件，收益不抵成本
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = ++toastIdCounter;
    set((state) => ({ toasts: [...state.toasts, { id, ...toast }] }));
  },
  remove: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));

/**
 * 触发全局提示的快捷方法
 */
// eslint-disable-next-line react-refresh/only-export-components -- 同上，快捷方法与组件共置
export function showToast(message: string, type: ToastType = "info", duration = 3000) {
  useToastStore.getState().add({ type, message, duration });
}

// 业务便捷方法
// eslint-disable-next-line react-refresh/only-export-components -- 同上，便捷对象与组件共置
export const toast = {
  success: (msg: string, duration?: number) => showToast(msg, "success", duration),
  error: (msg: string, duration?: number) => showToast(msg, "error", duration),
  warning: (msg: string, duration?: number) => showToast(msg, "warning", duration),
  info: (msg: string, duration?: number) => showToast(msg, "info", duration),
};

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="w-5 h-5" />,
  error: <XCircle className="w-5 h-5" />,
  warning: <AlertTriangle className="w-5 h-5" />,
  info: <Info className="w-5 h-5" />,
};

const colorMap: Record<ToastType, string> = {
  success: "bg-[var(--color-success)] text-white",
  error: "bg-[var(--color-error)] text-white",
  warning: "bg-[var(--color-warning)] text-white",
  info: "bg-[var(--color-info)] text-white",
};

function ToastItemView({ toast }: { toast: ToastItem }) {
  // 直接从 store 取 remove，避免父组件 ToastContainer 渲染时创建新闭包作为 prop 传入
  // 设计原因：原实现 onClose={() => remove(t.id)} 每次 ToastContainer 重渲染都创建新箭头函数，
  // 导致 ToastItemView 的 useEffect deps [onClose] 变化，setTimeout 被反复清除重建，
  // toast 实际显示时长可能远超 duration；改用 store + useCallback 稳定引用
  const remove = useToastStore((state) => state.remove);
  // toast.id 与 remove 均为稳定引用，handleClose 在组件生命周期内保持稳定
  const handleClose = useCallback(() => remove(toast.id), [remove, toast.id]);

  useEffect(() => {
    if (toast.duration > 0) {
      const timer = setTimeout(handleClose, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.duration, handleClose]);

  return (
    <div
      role="alert"
      className={`flex items-center gap-3 min-w-[280px] max-w-md px-4 py-3 rounded-lg shadow-lg ${colorMap[toast.type]} animate-slide-in-right`}
    >
      <span className="flex-shrink-0">{iconMap[toast.type]}</span>
      <span className="flex-1 text-sm font-medium">{toast.message}</span>
      <button
        onClick={handleClose}
        aria-label="关闭提示"
        className="flex-shrink-0 opacity-80 hover:opacity-100 transition-opacity"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * Toast 容器，应挂在根布局
 */
export default function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-4 right-4 z-[var(--z-toast)] flex flex-col gap-2 pointer-events-none"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItemView toast={t} />
        </div>
      ))}
    </div>
  );
}
