import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./index.css";
import client from "@/api/client";
import { setupMockInterceptor } from "@/utils/mockInterceptor";

// 开发环境下启用 mock 拦截器（无 token 时自动生效）
setupMockInterceptor(client);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
