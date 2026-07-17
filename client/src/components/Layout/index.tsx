import { Outlet, Link, useLocation } from "react-router-dom";
import { Home, Wrench, ChefHat, Clock, Siren, User as UserIcon, LogIn, Shield, Bell } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useState, useEffect } from "react";
import { getUnreadCount } from "@/api/notifications";
import ToastContainer from "@/components/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import type { User } from "@/types";

// 导航项配置：移动端底部 Tab 与桌面端顶部导航共用
const navItems = [
  { path: "/", label: "首页", icon: Home },
  { path: "/skills", label: "技能", icon: Wrench },
  { path: "/kitchen", label: "厨房", icon: ChefHat },
  { path: "/time-bank", label: "时间银行", icon: Clock },
  { path: "/emergency", label: "应急", icon: Siren },
];

// 页面过渡动画组件
function PageTransition({ children, locationKey }: { children: React.ReactNode; locationKey: string }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(false);
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, [locationKey]);

  return (
    <div
      className={`transition-all duration-300 ease-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {children}
    </div>
  );
}

// 判断当前导航项是否处于激活状态
function useIsActive(path: string): boolean {
  const location = useLocation();
  return location.pathname === path || (path !== "/" && location.pathname.startsWith(path));
}

// 品牌字标：编辑式字重与字距，根据 mode 切换配色
function BrandMark({ mode }: { mode: "light" | "dark" }) {
  return (
    <Link
      to="/"
      className={`flex items-baseline gap-1.5 font-bold tracking-tight transition-colors duration-300 ${
        mode === "light" ? "text-white" : "text-neutral-900"
      }`}
      aria-label="邻里圈 首页"
    >
      <span className="text-xl">邻里圈</span>
      <span
        className={`text-[10px] font-mono tracking-widest translate-y-[-2px] ${
          mode === "light" ? "text-white/50" : "text-neutral-400"
        }`}
      >
        NEIGHBOR
      </span>
    </Link>
  );
}

// 桌面端顶部横向导航链接
function DesktopNavLink({
  path,
  label,
  icon: Icon,
  mode,
}: {
  path: string;
  label: string;
  icon: LucideIcon;
  mode: "light" | "dark";
}) {
  const isActive = useIsActive(path);
  const baseColor = mode === "light"
    ? isActive
      ? "text-white"
      : "text-white/70 hover:text-white"
    : isActive
      ? "text-neutral-900"
      : "text-neutral-500 hover:text-neutral-900";
  const underlineColor = mode === "light" ? "bg-white" : "bg-neutral-900";
  return (
    <Link
      to={path}
      className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors duration-200 ${baseColor}`}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      <span
        className={`absolute bottom-0 left-3 right-3 h-px rounded-full ${underlineColor} transition-all duration-200 ${
          isActive ? "opacity-100 scale-x-100" : "opacity-0 scale-x-0"
        }`}
      />
    </Link>
  );
}

// 移动端底部 Tab 导航项
function MobileTabItem({ path, label, icon: Icon }: { path: string; label: string; icon: LucideIcon }) {
  const isActive = useIsActive(path);
  return (
    <Link
      to={path}
      aria-label={label}
      className={`flex flex-col items-center gap-0.5 text-[11px] transition-colors duration-200 ${
        isActive ? "text-neutral-900" : "text-neutral-400"
      }`}
    >
      <Icon className={`w-5 h-5 transition-transform duration-200 ${isActive ? "scale-110" : ""}`} />
      <span>{label}</span>
    </Link>
  );
}

// 右侧用户操作区：通知、管理后台、头像/登录
function UserActions({
  isAuthenticated,
  user,
  unreadCount,
  mode,
}: {
  isAuthenticated: boolean;
  user: User | null;
  unreadCount: number;
  mode: "light" | "dark";
}) {
  const iconColor = mode === "light" ? "text-white/80" : "text-neutral-600";
  const loginBtn = mode === "light"
    ? "bg-white text-neutral-900 hover:bg-neutral-100"
    : "bg-neutral-900 text-white hover:bg-neutral-800";

  if (!isAuthenticated) {
    return (
      <Link
        to="/login"
        className={`flex items-center gap-1 px-4 py-1.5 text-sm font-medium rounded-full transition-colors duration-200 ${loginBtn}`}
      >
        <LogIn className="w-4 h-4" />
        登录
      </Link>
    );
  }

  return (
    <>
      <Link
        to="/notifications"
        className={`relative flex items-center gap-1 px-2 py-1.5 ${iconColor}`}
        aria-label={`通知${unreadCount > 0 ? `，${unreadCount} 条未读` : ""}`}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[10px] bg-red-500 text-white rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Link>
      {user?.role === "admin" && (
        <Link
          to="/admin"
          className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-full border transition-colors duration-200 ${
            mode === "light"
              ? "border-white/40 text-white hover:bg-white/10"
              : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
          }`}
          aria-label="管理后台"
        >
          <Shield className="w-4 h-4" />
          管理
        </Link>
      )}
      <Link
        to="/profile"
        className="flex items-center gap-2"
        aria-label={`个人中心，${user?.nickname || ""}`}
      >
        <div className={`w-8 h-8 rounded-full overflow-hidden flex items-center justify-center ${
          mode === "light" ? "bg-white/20 ring-1 ring-white/30" : "bg-neutral-100"
        }`}>
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={user?.nickname ? `${user.nickname} 的头像` : "用户头像"}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <UserIcon className={`w-4 h-4 ${mode === "light" ? "text-white" : "text-neutral-600"}`} />
          )}
        </div>
      </Link>
    </>
  );
}

export default function Layout() {
  const location = useLocation();
  const { isAuthenticated, user } = useAuth();
  const isDesktop = useIsDesktop();
  const [unreadCount, setUnreadCount] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  // 首页 hero 透明头部：滚动后转为实色
  const isHome = location.pathname === "/";
  const useTransparent = isHome && !scrolled;
  const headerMode: "light" | "dark" = useTransparent ? "light" : "dark";

  // 设计原因：getUnreadCount Promise 在组件卸载后仍可能 resolve，用 cancelled 标志守护
  // 避免对已卸载组件 setUnreadCount 造成内存泄漏与 React 警告
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    getUnreadCount()
      .then((res) => {
        if (!cancelled) setUnreadCount(res.data.unreadCount);
      })
      .catch((err) => {
        if (!cancelled) console.error("获取未读消息数失败:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // 监听滚动，控制首页头部从透明到实色的切换
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    if (!isHome) {
      setScrolled(true);
      return;
    }
    setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHome]);

  const headerBg = useTransparent
    ? "bg-transparent border-transparent"
    : "bg-white/85 backdrop-blur-lg border-neutral-200/70";

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <header className={`sticky top-0 z-50 transition-colors duration-300 border-b ${headerBg}`}>
        {isDesktop ? (
          <div className="flex items-center justify-between px-6 lg:px-10 h-16 max-w-7xl mx-auto">
            <div className="flex items-center gap-10">
              <BrandMark mode={headerMode} />
              <nav className="flex items-center gap-1" aria-label="主导航">
                {navItems.map(({ path, label, icon }) => (
                  <DesktopNavLink key={path} path={path} label={label} icon={icon} mode={headerMode} />
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <UserActions
                isAuthenticated={isAuthenticated}
                user={user}
                unreadCount={unreadCount}
                mode={headerMode}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between px-4 h-14">
            <BrandMark mode={headerMode} />
            <div className="flex items-center gap-2">
              <UserActions
                isAuthenticated={isAuthenticated}
                user={user}
                unreadCount={unreadCount}
                mode={headerMode}
              />
            </div>
          </div>
        )}
      </header>

      <main className={`flex-1 ${isDesktop ? "pb-0" : "pb-[calc(4rem+env(safe-area-inset-bottom))]"}`}>
        <div className={isDesktop ? "" : ""}>
          <PageTransition locationKey={location.pathname}>
            {/* 路由级错误边界：key 绑定 pathname 确保切换路由时重置错误状态
                设计原因：全局 ErrorBoundary 仅在 main.tsx 包裹整个 App，页面内异常会白屏整个应用；
                此处再加一层路由级兜底，单页异常仅影响内容区，导航/头部保持可用，用户可切到其他路由自恢复 */}
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </PageTransition>
        </div>
      </main>

      {/* 底部 Tab 导航：仅移动端显示 */}
      {!isDesktop && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-lg border-t border-neutral-200 pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
            {navItems.map(({ path, label, icon }) => (
              <MobileTabItem key={path} path={path} label={label} icon={icon} />
            ))}
          </div>
        </nav>
      )}

      <ToastContainer />
    </div>
  );
}
