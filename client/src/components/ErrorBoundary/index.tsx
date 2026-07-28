/**
 * 全局错误边界
 * 捕获 React 组件树中的未捕获错误，避免白屏
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 生产环境可上报到 Sentry / 自建埋点
    if (import.meta.env.PROD) {
      console.error("[ErrorBoundary]", error, info);
    } else {
      console.error("[ErrorBoundary]", error, info);
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div className="min-h-[60vh] flex items-center justify-center px-4 animate-fade-in">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-[var(--color-error)]/10 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-[var(--color-error)]" />
            </div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">
              出了点小问题
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">
              页面遇到了意外错误，请刷新重试。如问题持续存在，请联系客服。
            </p>
            {/* 临时诊断：生产环境也展示错误信息，便于定位"应急帖子打不开"问题
                设计原因：线上 ErrorBoundary 触发但只显示"出了点小问题"，用户/客服无法定位。
                等问题修完后建议改回 import.meta.env.DEV only，或接入 Sentry 等远程上报 */}
            <pre className="text-left text-xs text-[var(--color-error)] bg-red-50 p-3 rounded mb-4 overflow-auto max-h-40 whitespace-pre-wrap break-all">
              {this.state.error.message}
              {this.state.error.stack && '\n\nStack:\n' + this.state.error.stack.split('\n').slice(0, 6).join('\n')}
            </pre>
            <button
              onClick={this.reset}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-primary-500)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-primary-600)] transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
