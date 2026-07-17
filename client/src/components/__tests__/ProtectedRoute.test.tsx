import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// vi.hoisted 提升 mock，避免 TDZ：控制 useAuth 的认证状态、token、logout 与 toast 调用
const { mockUseAuth, toastWarningMock, mockIsTokenExpired } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  toastWarningMock: vi.fn(),
  // mock isTokenExpired 以便分别测试过期与未过期场景，无需手造真实 JWT
  mockIsTokenExpired: vi.fn(),
}));

// mock useAuth：每个用例通过 mockReturnValue 控制认证状态、token、logout
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

// mock isTokenExpired：默认返回 false（未过期），用例内按需覆盖
vi.mock("@/utils/jwt", () => ({
  isTokenExpired: mockIsTokenExpired,
}));

import ProtectedRoute from "../ProtectedRoute";

// 渲染 ProtectedRoute：用 MemoryRouter 提供路由上下文，Outlet 渲染子路由
function renderProtectedRoute(options: {
  isAuthenticated: boolean;
  token?: string | null;
  tokenExpired?: boolean;
}) {
  const { isAuthenticated, token = "fake-token", tokenExpired = false } = options;
  mockIsTokenExpired.mockReturnValue(tokenExpired);
  mockUseAuth.mockReturnValue({
    isAuthenticated,
    token,
    logout: vi.fn(),
  });
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
  // 默认未过期，过期场景由用例内 mockReturnValue 覆盖
  mockIsTokenExpired.mockReturnValue(false);
});

describe("ProtectedRoute 路由守卫", () => {
  it("未认证时跳转 /login 并显示警告提示", () => {
    renderProtectedRoute({ isAuthenticated: false });
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    expect(toastWarningMock).toHaveBeenCalledWith("请先登录");
  });

  it("已认证且 token 未过期时渲染受保护内容（Outlet）", () => {
    renderProtectedRoute({ isAuthenticated: true, tokenExpired: false });
    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("toast.warning 仅触发一次（hasWarned ref 防重复）", () => {
    const { rerender } = renderProtectedRoute({ isAuthenticated: false });
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
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
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
  });

  it("token 已过期时跳转 /login 并提示「登录已过期」", () => {
    // 设计原因：isAuthenticated 为 true 但 token 已过期，守卫应主动清理并跳转登录
    renderProtectedRoute({ isAuthenticated: true, tokenExpired: true });
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith("登录已过期，请重新登录");
  });

  it("token 已过期时调用 logout 清理 zustand 状态", () => {
    // 设计原因：仅跳转不清理会导致 zustand persist 中残留过期 token，下次进入仍会判过期
    const logoutMock = vi.fn();
    mockIsTokenExpired.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      token: "expired-token",
      logout: logoutMock,
    });
    render(
      <MemoryRouter initialEntries={["/protected"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/protected" element={<div>受保护</div>} />
          </Route>
          <Route path="/login" element={<div data-testid="login-page">登录页</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(logoutMock).toHaveBeenCalled();
  });
});
