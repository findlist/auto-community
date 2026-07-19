/**
 * App.tsx 路由集成测试
 *
 * 测试目标：覆盖根路由组件的路由表完整性、ProtectedRoute/AdminRoute 守卫逻辑、
 *           404 兜底等关键集成场景
 * 测试策略：
 *   - mock react-router-dom：将 BrowserRouter 替换为 MemoryRouter，useNavigate 替换为 mock
 *   - mock @/hooks/useAuth 控制鉴权状态（未登录 / 已登录普通用户 / 已登录管理员）
 *   - mock @/utils/jwt 的 isTokenExpired 控制 token 过期场景
 *   - mock 关键懒加载页面为静态占位，避免引入真实页面依赖
 *   - 保留 ProtectedRoute / AdminRoute 真实实现以验证守卫逻辑
 *
 * initialEntries 透传方案：App 默认不接收 props，通过 vi.spyOn 拦截 MemoryRouter 调用，
 * 在测试渲染前用 wrapper 注入 initialEntries，避免污染生产代码
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { User } from "@/types";

// vi.hoisted 提升 mock 数据避免 TDZ：测试模块加载时 vi.mock 工厂会立即引用这些变量
const {
  useAuthMock,
  isTokenExpiredMock,
  navigateMock,
  getUnreadCountMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  isTokenExpiredMock: vi.fn(),
  navigateMock: vi.fn(),
  getUnreadCountMock: vi.fn(),
}));

// 测试期间持有的初始路由：renderApp 时设置，供 mock 的 MemoryRouter 读取
let nextInitialEntries: string[] = ["/"];

// mock react-router-dom：保留除 BrowserRouter 外的所有 API（Routes/Route/Navigate/Outlet 等），
// 将 BrowserRouter 替换为 MemoryRouter，并通过模块级变量 nextInitialEntries 透传初始路由
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    // BrowserRouter 在 App 内被调用，这里替换为 MemoryRouter 并注入 initialEntries
    BrowserRouter: function MockBrowserRouter({ children }: { children: React.ReactNode }) {
      const MemoryRouter = actual.MemoryRouter;
      return <MemoryRouter initialEntries={nextInitialEntries}>{children}</MemoryRouter>;
    },
    useNavigate: () => navigateMock,
  };
});

// mock useAuth：每个测试用例可通过 useAuthMock.mockReturnValue 切换鉴权状态
vi.mock("@/hooks/useAuth", () => ({
  useAuth: useAuthMock,
}));

// mock isTokenExpired：默认返回 false（token 未过期），过期场景测试可改为 true
vi.mock("@/utils/jwt", () => ({
  isTokenExpired: isTokenExpiredMock,
}));

// mock 通知 API：避免 Layout 调用真实接口触发未读数请求
vi.mock("@/api/notifications", () => ({
  getUnreadCount: getUnreadCountMock,
}));

// mock Toast 容器为静态占位，避免依赖真实 portal 实现
vi.mock("@/components/Toast", () => ({
  default: function MockToastContainer() {
    return <div data-testid="toast-container" />;
  },
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// mock useIsDesktop：默认返回 true（桌面端布局），避免 ResizeObserver 依赖
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsDesktop: () => true,
}));

// mock Layout 为简单 Outlet 占位：Layout 内部逻辑由其自身测试覆盖，App 集成测试只需验证路由表
// 设计原因：Layout 在 App 中以 <Layout /> 自闭合形式使用，子路由通过其内部 <Outlet /> 渲染，
// mock 必须复用真实 Outlet 才能让嵌套路由（Home/Skills/Profile 等）正确渲染
vi.mock("@/components/Layout", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    default: function MockLayout() {
      return (
        <div data-testid="layout">
          <actual.Outlet />
        </div>
      );
    },
  };
});

// mock 关键懒加载页面为静态占位，避免引入真实页面依赖
vi.mock("@/pages/Home", () => ({
  default: () => <div data-testid="page-home">首页</div>,
}));
vi.mock("@/pages/Auth/Login", () => ({
  default: () => <div data-testid="page-login">登录页</div>,
}));
vi.mock("@/pages/NotFound", () => ({
  default: () => <div data-testid="page-not-found">404 页</div>,
}));
vi.mock("@/pages/SkillExchange", () => ({
  default: () => <div data-testid="page-skills">技能交换</div>,
}));
vi.mock("@/pages/Profile", () => ({
  default: () => <div data-testid="page-profile">个人中心</div>,
}));
// AdminLayout 在 App 中以 <AdminLayout /> 自闭合形式使用，admin 子路由通过其内部 <Outlet /> 渲染
// 设计原因：与 Layout 同理，mock 必须复用真实 Outlet 才能让 /admin 的 index 子路由（Dashboard）渲染
vi.mock("@/pages/Admin/AdminLayout", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    default: function MockAdminLayout() {
      return (
        <div data-testid="page-admin-layout">
          <h1>邻里圈管理后台</h1>
          <actual.Outlet />
        </div>
      );
    },
  };
});
vi.mock("@/pages/Admin/Dashboard", () => ({
  default: () => <div data-testid="page-admin-dashboard">管理后台 Dashboard</div>,
}));

import App from "@/App";

// 渲染 App：通过 nextInitialEntries 控制初始路由，便于测试不同路由的守卫与渲染行为
function renderApp(initialEntry = "/") {
  nextInitialEntries = [initialEntry];
  return render(<App />);
}

beforeEach(() => {
  vi.clearAllMocks();
  nextInitialEntries = ["/"];
  // 默认：未登录、token 未过期、无未读消息
  useAuthMock.mockReturnValue({
    user: null,
    token: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  });
  isTokenExpiredMock.mockReturnValue(false);
  getUnreadCountMock.mockResolvedValue({ code: 0, message: "ok", data: { unreadCount: 0 } });
});

describe("App 根路由集成", () => {
  it("公开路由 / 渲染 Home 页面（未登录可访问）", async () => {
    renderApp("/");
    await waitFor(() => {
      expect(screen.getByTestId("page-home")).toBeInTheDocument();
    });
  });

  it("公开路由 /skills 渲染技能交换页（未登录可访问）", async () => {
    renderApp("/skills");
    await waitFor(() => {
      expect(screen.getByTestId("page-skills")).toBeInTheDocument();
    });
  });

  it("公开路由 /login 渲染登录页（未登录可访问）", async () => {
    renderApp("/login");
    await waitFor(() => {
      expect(screen.getByTestId("page-login")).toBeInTheDocument();
    });
  });

  it("未登录访问受保护路由 /profile 跳转到 /login", async () => {
    // 验证 ProtectedRoute 守卫：未认证时 Navigate to="/login" replace
    renderApp("/profile");
    await waitFor(() => {
      expect(screen.getByTestId("page-login")).toBeInTheDocument();
    });
    // Profile 页面不应渲染
    expect(screen.queryByTestId("page-profile")).not.toBeInTheDocument();
  });

  it("未登录访问 /admin 跳转到 /（AdminRoute 兜底，未认证不强制跳登录）", async () => {
    // AdminRoute 行为：未认证 → Navigate to="/" replace（与 ProtectedRoute 区分）
    renderApp("/admin");
    await waitFor(() => {
      expect(screen.getByTestId("page-home")).toBeInTheDocument();
    });
    // AdminLayout 不应渲染
    expect(screen.queryByTestId("page-admin-layout")).not.toBeInTheDocument();
  });

  it("已登录普通用户访问 /admin 跳转到 /（权限不足）", async () => {
    // 验证 AdminRoute role 校验：已认证但 role !== "admin" → Navigate to="/"
    useAuthMock.mockReturnValue({
      user: { id: "u1", nickname: "普通用户", role: "user" } as unknown as User,
      token: "valid-token",
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });
    renderApp("/admin");
    await waitFor(() => {
      expect(screen.getByTestId("page-home")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("page-admin-layout")).not.toBeInTheDocument();
  });

  it("已登录管理员访问 /admin 进入 AdminLayout 并渲染 Dashboard", async () => {
    // 验证 AdminRoute 放行：已认证 + role="admin" → 渲染 AdminLayout 子路由
    useAuthMock.mockReturnValue({
      user: { id: "u1", nickname: "管理员", role: "admin" } as unknown as User,
      token: "valid-token",
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });
    renderApp("/admin");
    await waitFor(() => {
      expect(screen.getByTestId("page-admin-layout")).toBeInTheDocument();
    });
    // AdminLayout 内的 Dashboard 子路由也应渲染
    expect(screen.getByTestId("page-admin-dashboard")).toBeInTheDocument();
  });

  it("访问不存在的路由 /xxx-yyy 显示 NotFound 404 页", async () => {
    // 验证 path="*" 兜底路由
    renderApp("/xxx-yyy");
    await waitFor(() => {
      expect(screen.getByTestId("page-not-found")).toBeInTheDocument();
    });
  });

  it("已登录用户访问受保护路由 /profile 正常渲染（不被守卫拦截）", async () => {
    // 验证 ProtectedRoute 放行：已认证 + token 未过期 → 渲染 Profile
    useAuthMock.mockReturnValue({
      user: { id: "u1", nickname: "张三", role: "user" } as unknown as User,
      token: "valid-token",
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    });
    renderApp("/profile");
    await waitFor(() => {
      expect(screen.getByTestId("page-profile")).toBeInTheDocument();
    });
    // 不应跳转到登录页
    expect(screen.queryByTestId("page-login")).not.toBeInTheDocument();
  });
});
