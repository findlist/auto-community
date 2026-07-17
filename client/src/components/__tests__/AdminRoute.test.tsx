import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { User } from "@/types";

// vi.hoisted 提升 mock：控制 useAuth 返回的认证状态、token、logout、用户角色与 toast 调用
const { mockUseAuth, toastWarningMock, mockIsTokenExpired } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  toastWarningMock: vi.fn(),
  mockIsTokenExpired: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockUseAuth,
}));

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

import AdminRoute from "../AdminRoute";

// 构造 mock 用户：role 为 admin 或 user
function makeUser(role: "admin" | "user"): User {
  return {
    id: "user-1",
    phone: "13800000000",
    nickname: "管理员",
    creditBalance: 100,
    timeBalance: 60,
    reputationScore: 80,
    role,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

// 渲染 AdminRoute：children 为受保护的管理页面
function renderAdminRoute(options: {
  isAuthenticated: boolean;
  user: User | null;
  tokenExpired?: boolean;
  logout?: ReturnType<typeof vi.fn>;
}) {
  const { isAuthenticated, user, tokenExpired = false, logout = vi.fn() } = options;
  mockIsTokenExpired.mockReturnValue(tokenExpired);
  mockUseAuth.mockReturnValue({
    isAuthenticated,
    user,
    token: "fake-token",
    logout,
  });
  return render(
    <MemoryRouter initialEntries={["/admin"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <div data-testid="admin-content">管理后台内容</div>
            </AdminRoute>
          }
        />
        <Route path="/" element={<div data-testid="home-page">首页</div>} />
        <Route path="/login" element={<div data-testid="login-page">登录页</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsTokenExpired.mockReturnValue(false);
});

describe("AdminRoute 管理后台路由守卫", () => {
  it("未认证时跳转首页并显示警告", () => {
    renderAdminRoute({ isAuthenticated: false, user: null });
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    expect(toastWarningMock).toHaveBeenCalledWith("无管理权限，已返回首页");
  });

  it("已认证但非 admin 角色时跳转首页并显示警告", () => {
    renderAdminRoute({ isAuthenticated: true, user: makeUser("user") });
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith("无管理权限，已返回首页");
  });

  it("已认证且 admin 角色时渲染管理后台内容", () => {
    renderAdminRoute({ isAuthenticated: true, user: makeUser("admin") });
    expect(screen.getByTestId("admin-content")).toBeInTheDocument();
    expect(screen.queryByTestId("home-page")).not.toBeInTheDocument();
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("user 为 null 时视为无权限（短路判断）", () => {
    renderAdminRoute({ isAuthenticated: true, user: null });
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith("无管理权限，已返回首页");
  });

  it("token 已过期时跳转 /login 并提示「登录已过期」", () => {
    // 设计原因：管理员 token 过期应跳登录页而非首页，与 ProtectedRoute 行为一致
    renderAdminRoute({ isAuthenticated: true, user: makeUser("admin"), tokenExpired: true });
    expect(screen.getByTestId("login-page")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith("登录已过期，请重新登录");
  });

  it("token 已过期时调用 logout 清理 zustand 状态", () => {
    const logoutMock = vi.fn();
    renderAdminRoute({
      isAuthenticated: true,
      user: makeUser("admin"),
      tokenExpired: true,
      logout: logoutMock,
    });
    expect(logoutMock).toHaveBeenCalled();
  });
});
