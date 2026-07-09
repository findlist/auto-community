import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { User } from "@/types";

// vi.hoisted 提升 mock：控制 useAuth 返回的认证状态与用户角色
const { mockUseAuth, toastWarningMock } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  toastWarningMock: vi.fn(),
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
function renderAdminRoute(isAuthenticated: boolean, user: User | null) {
  mockUseAuth.mockReturnValue({ isAuthenticated, user });
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
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminRoute 管理后台路由守卫", () => {
  it("未认证时跳转首页并显示警告", () => {
    renderAdminRoute(false, null);
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
    expect(toastWarningMock).toHaveBeenCalledWith("无管理权限，已返回首页");
  });

  it("已认证但非 admin 角色时跳转首页并显示警告", () => {
    renderAdminRoute(true, makeUser("user"));
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-content")).not.toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith("无管理权限，已返回首页");
  });

  it("已认证且 admin 角色时渲染管理后台内容", () => {
    renderAdminRoute(true, makeUser("admin"));
    expect(screen.getByTestId("admin-content")).toBeInTheDocument();
    expect(screen.queryByTestId("home-page")).not.toBeInTheDocument();
    // 有权限时不触发警告
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("user 为 null 时视为无权限（短路判断）", () => {
    // 设计原因：hasNoAccess = !isAuthenticated || user?.role !== "admin"
    // user 为 null 时 user?.role 为 undefined，!== "admin" 为 true
    renderAdminRoute(true, null);
    expect(screen.getByTestId("home-page")).toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith("无管理权限，已返回首页");
  });
});
