import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./index.css";
import client from "@/api/client";
import { setupMockInterceptor } from "@/utils/mockInterceptor";

// 开发环境下启用 mock 拦截器（无 token 时自动生效）
setupMockInterceptor(client);

// 全局未捕获 Promise rejection 监听
// 设计原因：ErrorBoundary 仅能捕获 React 渲染阶段的异常，
// 无法捕获组件之外的 promise 失败（事件回调中的 async 操作、setTimeout 内异步、
// fire-and-forget 调用、动态 import 失败等）。这些失败在生产构建中会静默丢失，
// 排查无任何线索。此处注册全局兜底，将未捕获 rejection 输出到 console 便于定位，
// 并预留 production 上报接入点（Sentry / 自建埋点），后续接入时只需替换 console.error
window.addEventListener("unhandledrejection", (event) => {
  // eslint-disable-next-line no-console
  console.error("[UnhandledRejection]", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
