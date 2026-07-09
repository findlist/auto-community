import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import AdminLayout from "../AdminLayout";

// 全部 11 个导航项的 path 与 label，用于断言渲染与激活态
const NAV_ITEMS = [
  { path: "/admin", label: "Dashboard", end: true },
  { path: "/admin/users", label: "用户管理", end: false },
  { path: "/admin/content", label: "内容审核", end: false },
  { path: "/admin/orders", label: "订单管理", end: false },
  { path: "/admin/reports", label: "举报处理", end: false },
  { path: "/admin/verifications", label: "实名认证", end: false },
  { path: "/admin/metrics", label: "效果度量", end: false },
  { path: "/admin/ab-tests", label: "A/B 测试", end: false },
  { path: "/admin/homepage-image", label: "首页图片", end: false },
  { path: "/admin/audit-logs", label: "操作日志", end: false },
  { path: "/admin/settings", label: "系统配置", end: false },
];

// 渲染 AdminLayout：用 MemoryRouter 注入当前路由，Routes + Outlet 提供子路由内容
// future flag 提前适配 React Router v7，消除 future flag 警告
function renderAdminLayout(initialPath = "/admin") {
  return render(
    <MemoryRouter initialEntries={[initialPath]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<div data-testid="outlet-content">仪表盘内容</div>} />
          <Route path="users" element={<div data-testid="outlet-content">用户管理内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminLayout 管理后台布局", () => {
  it("渲染标题与返回前台链接", () => {
    renderAdminLayout();
    expect(screen.getByText("邻里圈管理后台")).toBeInTheDocument();
    const backLink = screen.getByText("返回前台");
    expect(backLink.closest("a")).toHaveAttribute("href", "/");
  });

  it("渲染全部 11 个导航项", () => {
    renderAdminLayout();
    NAV_ITEMS.forEach(({ label }) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it("Outlet 渲染子路由内容", () => {
    renderAdminLayout();
    expect(screen.getByTestId("outlet-content")).toBeInTheDocument();
    expect(screen.getByText("仪表盘内容")).toBeInTheDocument();
  });

  it("当前路由为 /admin 时 Dashboard 高亮", () => {
    renderAdminLayout("/admin");
    // end=true 的精确匹配：仅 /admin 激活
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).toContain("bg-emerald-50");
    // 其他导航项不高亮
    const usersLink = screen.getByText("用户管理").closest("a");
    expect(usersLink?.className).not.toContain("bg-emerald-50");
  });

  it("当前路由为 /admin/users 时用户管理高亮", () => {
    renderAdminLayout("/admin/users");
    const usersLink = screen.getByText("用户管理").closest("a");
    expect(usersLink?.className).toContain("bg-emerald-50");
    // Dashboard 不高亮（end=true 精确匹配，/admin/users !== /admin）
    const dashboardLink = screen.getByText("Dashboard").closest("a");
    expect(dashboardLink?.className).not.toContain("bg-emerald-50");
  });

  it("点击移动端菜单按钮展开/收起抽屉", () => {
    renderAdminLayout();
    // 初始无遮罩层（sidebarOpen=false 时不渲染抽屉），但桌面侧边栏始终有导航项
    expect(screen.getByText("举报处理")).toBeInTheDocument();
    // 点击菜单按钮
    const menuBtn = screen.getByLabelText("切换菜单");
    act(() => {
      fireEvent.click(menuBtn);
    });
    // 展开后菜单按钮图标变为 X（通过 aria-label 仍可定位）
    // 点击遮罩层关闭抽屉
    const overlay = document.querySelector(".bg-black\\/40");
    expect(overlay).not.toBeNull();
    act(() => {
      if (overlay) fireEvent.click(overlay);
    });
  });

  it("移动端点击导航项关闭抽屉", () => {
    renderAdminLayout();
    // 展开抽屉
    const menuBtn = screen.getByLabelText("切换菜单");
    act(() => {
      fireEvent.click(menuBtn);
    });
    // 展开后桌面侧边栏与移动抽屉各渲染一份导航项，getAllByText 取全部
    const navLinks = screen.getAllByText("系统配置");
    // 移动抽屉在 DOM 中位于桌面侧边栏之后，取最后一个
    const mobileNavLink = navLinks[navLinks.length - 1]!;
    act(() => {
      fireEvent.click(mobileNavLink);
    });
    // 抽屉关闭后遮罩层消失
    // 设计原因：sidebarOpen=false 时条件渲染不输出遮罩层 DOM 节点
    const overlay = document.querySelector(".bg-black\\/40");
    expect(overlay).toBeNull();
  });
});
