import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// vi.hoisted 提升 mock 函数避免 TDZ：模块加载阶段 vi.mock 工厂立即引用这些变量
const {
  useAuthMock,
  useIsDesktopMock,
  getUnreadCountMock,
  useLocationMock,
  toastContainerMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useIsDesktopMock: vi.fn(),
  getUnreadCountMock: vi.fn(),
  useLocationMock: vi.fn(),
  toastContainerMock: vi.fn(() => null),
}));

// mock useAuth：控制 isAuthenticated/user 状态
vi.mock("@/hooks/useAuth", () => ({
  useAuth: useAuthMock,
}));

// mock useIsDesktop：控制桌面/移动端布局
vi.mock("@/hooks/useMediaQuery", () => ({
  useIsDesktop: useIsDesktopMock,
}));

// mock getUnreadCount：控制未读消息数
vi.mock("@/api/notifications", () => ({
  getUnreadCount: getUnreadCountMock,
}));

// mock react-router-dom：useLocation 控制当前路径，保留 Outlet/Link
vi.mock("react-router-dom", async () => {
  const actual = await import("react-router-dom");
  return {
    ...actual,
    useLocation: useLocationMock,
  };
});

// mock ToastContainer：避免渲染真实 Toast 容器
vi.mock("@/components/Toast", () => ({
  default: toastContainerMock,
}));

import Layout from "../Layout";

// 默认未认证状态，每个测试可在 beforeEach 或 it 内重置
const defaultAuthState = {
  isAuthenticated: false,
  user: null,
};

const defaultLocation = {
  pathname: "/",
  search: "",
  hash: "",
  state: null,
  key: "default",
};

function renderLayout(options: {
  pathname?: string;
  isAuthenticated?: boolean;
  isDesktop?: boolean;
  user?: Parameters<typeof useAuthMock>[0] extends never ? never : Record<string, unknown> | null;
  unreadCount?: number;
} = {}) {
  const {
    pathname = "/",
    isAuthenticated = false,
    isDesktop = true,
    user = null,
    unreadCount = 0,
  } = options;

  useAuthMock.mockReturnValue({ isAuthenticated, user });
  useIsDesktopMock.mockReturnValue(isDesktop);
  useLocationMock.mockReturnValue({ ...defaultLocation, pathname });

  // 仅认证用户触发未读数拉取
  if (isAuthenticated) {
    getUnreadCountMock.mockResolvedValue({ data: { unreadCount } });
  }

  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Layout />
    </MemoryRouter>
  );
}

describe("Layout 主布局组件", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(defaultAuthState);
    useIsDesktopMock.mockReturnValue(true);
    useLocationMock.mockReturnValue(defaultLocation);
  });

  it("渲染品牌字标「邻里圈」与英文副标「NEIGHBOR」", () => {
    renderLayout();
    expect(screen.getByText("邻里圈")).toBeInTheDocument();
    expect(screen.getByText("NEIGHBOR")).toBeInTheDocument();
  });

  it("渲染 5 个导航项（首页/技能/厨房/时间银行/应急）", () => {
    renderLayout({ isDesktop: true });
    // 桌面端导航 + 底部 tab 移动端模式不渲染，故桌面端只出现一次
    expect(screen.getAllByText("首页").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("技能").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("厨房").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("时间银行").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("应急").length).toBeGreaterThanOrEqual(1);
  });

  it("未认证用户渲染「登录」按钮", () => {
    renderLayout({ isAuthenticated: false });
    expect(screen.getByText("登录")).toBeInTheDocument();
  });

  it("认证用户不渲染「登录」按钮，渲染头像链接（aria-label 含「个人中心」）", () => {
    renderLayout({
      isAuthenticated: true,
      user: { id: "u1", nickname: "张三", role: "user" },
    });
    expect(screen.queryByText("登录")).toBeNull();
    // 个人中心链接 aria-label 含「个人中心」
    const profileLink = screen.getByLabelText(/个人中心/);
    expect(profileLink).toBeInTheDocument();
  });

  it("认证用户触发 getUnreadCount 接口调用", async () => {
    renderLayout({ isAuthenticated: true, user: { id: "u1", nickname: "张三" }, unreadCount: 5 });
    await waitFor(() => {
      expect(getUnreadCountMock).toHaveBeenCalledTimes(1);
    });
  });

  it("未认证用户不触发 getUnreadCount 接口调用", () => {
    renderLayout({ isAuthenticated: false });
    expect(getUnreadCountMock).not.toHaveBeenCalled();
  });

  it("未读数 > 0 时渲染徽章数字", async () => {
    renderLayout({ isAuthenticated: true, user: { id: "u1", nickname: "张三" }, unreadCount: 3 });
    await waitFor(() => {
      // 徽章显示数字 3
      expect(screen.getByText("3")).toBeInTheDocument();
    });
  });

  it("未读数 > 9 时徽章显示「9+」", async () => {
    renderLayout({ isAuthenticated: true, user: { id: "u1", nickname: "张三" }, unreadCount: 15 });
    await waitFor(() => {
      expect(screen.getByText("9+")).toBeInTheDocument();
    });
  });

  it("未读数 = 0 时不渲染徽章", async () => {
    renderLayout({ isAuthenticated: true, user: { id: "u1", nickname: "张三" }, unreadCount: 0 });
    await waitFor(() => {
      expect(getUnreadCountMock).toHaveBeenCalled();
    });
    // 不应出现 9+ 或 1-9 数字徽章
    expect(screen.queryByText("9+")).toBeNull();
  });

  it("admin 用户渲染「管理」后台入口", () => {
    renderLayout({
      isAuthenticated: true,
      user: { id: "u1", nickname: "管理员", role: "admin" },
    });
    expect(screen.getByText("管理")).toBeInTheDocument();
  });

  it("普通用户不渲染「管理」入口", () => {
    renderLayout({
      isAuthenticated: true,
      user: { id: "u1", nickname: "普通用户", role: "user" },
    });
    expect(screen.queryByText("管理")).toBeNull();
  });

  it("桌面端不渲染底部 Tab 导航", () => {
    renderLayout({ isDesktop: true });
    // 移动端底部 nav 使用 fixed bottom-0 样式
    // 桌面端不应渲染底部 nav，所以「首页」等文本只在桌面 nav 中出现 1 次
    const homeLinks = screen.getAllByText("首页");
    expect(homeLinks).toHaveLength(1);
  });

  it("移动端渲染底部 Tab 导航（5 个 Tab）", () => {
    renderLayout({ isDesktop: false });
    // 移动端：桌面 header 不渲染导航项，仅底部 tab 渲染 5 个导航项
    // 每个导航项在底部 tab 出现 1 次
    expect(screen.getAllByText("首页").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("技能").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("厨房").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("时间银行").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("应急").length).toBeGreaterThanOrEqual(1);
  });

  it("首页路径使用透明头部（useTransparent=true）", () => {
    renderLayout({ pathname: "/", isDesktop: true });
    // 透明头部时 BrandMark 使用 text-white
    const brand = screen.getByText("邻里圈").closest("a");
    expect(brand?.className).toContain("text-white");
  });

  it("非首页路径使用实色头部（BrandMark 为深色）", () => {
    renderLayout({ pathname: "/skills", isDesktop: true });
    const brand = screen.getByText("邻里圈").closest("a");
    expect(brand?.className).toContain("text-neutral-900");
  });

  it("认证用户头像有图片时渲染 img", () => {
    renderLayout({
      isAuthenticated: true,
      user: {
        id: "u1",
        nickname: "头像用户",
        avatar: "https://example.com/avatar.png",
        role: "user",
      },
    });
    const avatarImg = screen.getByAltText("头像用户 的头像");
    expect(avatarImg).toBeInTheDocument();
    expect(avatarImg.getAttribute("src")).toBe("https://example.com/avatar.png");
  });

  it("认证用户无头像时渲染默认用户图标（不渲染 img）", () => {
    renderLayout({
      isAuthenticated: true,
      user: { id: "u1", nickname: "无头像用户", role: "user" },
    });
    // 无头像时不渲染 img
    expect(screen.queryByAltText(/头像/)).toBeNull();
  });

  it("首页滚动后头部由透明转为实色", () => {
    renderLayout({ pathname: "/", isDesktop: true });
    // 初始：透明头部，BrandMark 为白色
    const brand = screen.getByText("邻里圈").closest("a");
    expect(brand?.className).toContain("text-white");

    // 模拟滚动 > 40px
    act(() => {
      // jsdom 默认 scrollY=0，通过 Object.defineProperty 设置
      Object.defineProperty(window, "scrollY", { value: 100, writable: true, configurable: true });
      window.dispatchEvent(new Event("scroll"));
    });

    // 滚动后头部实色，BrandMark 变深色
    const brandAfter = screen.getByText("邻里圈").closest("a");
    expect(brandAfter?.className).toContain("text-neutral-900");
  });

  it("渲染 ToastContainer", () => {
    renderLayout();
    expect(toastContainerMock).toHaveBeenCalled();
  });

  it("导航项 aria-label 包含目标 label（移动端 Tab）", () => {
    renderLayout({ isDesktop: false });
    // 移动端 MobileTabItem 设置 aria-label={label}
    expect(screen.getByLabelText("技能")).toBeInTheDocument();
    expect(screen.getByLabelText("厨房")).toBeInTheDocument();
    expect(screen.getByLabelText("时间银行")).toBeInTheDocument();
  });

  it("通知链接 aria-label 含未读数（认证用户且有未读）", async () => {
    renderLayout({ isAuthenticated: true, user: { id: "u1", nickname: "张三" }, unreadCount: 2 });
    await waitFor(() => {
      // aria-label 格式：通知，2 条未读
      const notifLink = screen.getByLabelText(/通知/);
      expect(notifLink.getAttribute("aria-label")).toContain("2");
    });
  });

  it("导航激活态：当前路径为 /skills 时「技能」导航项激活", () => {
    renderLayout({ pathname: "/skills", isDesktop: true });
    // 桌面端 DesktopNavLink 激活态使用 text-neutral-900，非激活态使用 text-neutral-500
    const skillLink = screen.getAllByText("技能")[0]!.closest("a");
    expect(skillLink?.className).toContain("text-neutral-900");
  });

  it("导航非激活态使用次要文本色", () => {
    renderLayout({ pathname: "/", isDesktop: true });
    // 当首页激活时，「技能」应为非激活态
    const skillLink = screen.getAllByText("技能")[0]!.closest("a");
    expect(skillLink?.className).toContain("text-neutral-500");
  });
});
