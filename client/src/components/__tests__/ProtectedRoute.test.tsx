import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// vi.hoisted 提升 mock，避免 TDZ：控制 useAuth 的认证状态与 toast 调用
const { mockUseAuth, toastWarningMock } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  toastWarningMock: vi.fn(),
}));

// mock useAuth：每个用例通过 mockReturnValue 控制认证状态
vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockUseAuth,
}));

// mock toast：仅捕获 warning 调用，验证提示文案与调用次数
vi.mock("@/components/Toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: toastWarningMock,
    info: vi.fn(),
  },
}));

import ProtectedRoute from "../ProtectedRoute";

// 渲染 ProtectedRoute：用 MemoryRouter 提供路由上下文，Outlet 渲染子路由
function renderProtectedRoute(isAuthenticated: boolean) {
  mockUseAuth.mockReturnValue({ isAuthenticated });
  return render(
    <MemoryRouter initialEntries={["/protected"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/protected" element={<div data-testid="protected-content">受保护内容</div>} />
        </Route>
        <Route path="/login" element={<div data-testid="login-page">登录页</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProtectedRoute 路由守卫", () => {
  it("未认证时跳转 /login 并显示警告提示", () => {
    renderProtectedRoute(false);
    // 验证跳转到登录页
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    // 验证受保护内容未渲染
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    // 验证 toast.warning 被调用一次，文案为"请先登录"
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    expect(toastWarningMock).toHaveBeenCalledWith("请先登录");
  });

  it("已认证时渲染受保护内容（Outlet）", () => {
    renderProtectedRoute(true);
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
    // 已认证时不触发警告
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("toast.warning 仅触发一次（hasWarned ref 防重复）", () => {
    // 同一组件实例内 re-render 不会重复触发 toast
    // 设计原因：useRef(false) 在首次未认证后置为 true，后续 re-render 不再 toast
    const { rerender } = renderProtectedRoute(false);
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    // 模拟 re-render（如父组件状态变化导致）
    rerender(
      <MemoryRouter initialEntries={["/protected"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div data-testid="protected-content">受保护内容</div>} />
          </Route>
          <Route path="/login" element={<div data-testid="login-page">登录页</div>} />
        </Routes>
      </MemoryRouter>
    );
    // 仍然只调用一次
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
  });
});
