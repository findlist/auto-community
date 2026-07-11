import { useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, FileCheck, ShoppingCart, Flag, Menu, X, UserCheck, LineChart, Beaker, Image, ScrollText, Settings } from "lucide-react";

const navItems = [
  { path: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { path: "/admin/users", label: "用户管理", icon: Users, end: false },
  { path: "/admin/content", label: "内容审核", icon: FileCheck, end: false },
  { path: "/admin/orders", label: "订单管理", icon: ShoppingCart, end: false },
  { path: "/admin/reports", label: "举报处理", icon: Flag, end: false },
  { path: "/admin/verifications", label: "实名认证", icon: UserCheck, end: false },
  { path: "/admin/metrics", label: "效果度量", icon: LineChart, end: false },
  { path: "/admin/ab-tests", label: "A/B 测试", icon: Beaker, end: false },
  { path: "/admin/homepage-image", label: "首页图片", icon: Image, end: false },
  { path: "/admin/audit-logs", label: "操作日志", icon: ScrollText, end: false },
  { path: "/admin/settings", label: "系统配置", icon: Settings, end: false },
];

export default function AdminLayout() {
  const location = useLocation();
  // 移动端侧边栏开关状态
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 判断当前路由是否激活
  const isActive = (path: string, end: boolean) => {
    return end ? location.pathname === path : location.pathname.startsWith(path);
  };

  // 渲染侧边栏导航项：激活态增加左侧色条，强化当前位置指示
  const renderNavItems = () => (
    <nav className="flex flex-col gap-1 p-3">
      {navItems.map(({ path, label, icon: Icon, end }) => {
        const active = isActive(path, end);
        return (
          <Link
            key={path}
            to={path}
            onClick={() => setSidebarOpen(false)}
            className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              active
                ? "bg-emerald-50 text-emerald-700 font-medium"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {/* 激活态左侧色条：编辑式位置标记 */}
            {active && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-600" />
            )}
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* 顶部标题栏 */}
      <header className="sticky top-0 z-40 bg-white border-b border-neutral-200">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            {/* 移动端菜单按钮 */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="md:hidden p-1.5 rounded-lg hover:bg-neutral-100"
              aria-label="切换菜单"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h1 className="text-lg font-bold text-neutral-800">邻里圈管理后台</h1>
          </div>
          <Link
            to="/"
            className="text-sm text-emerald-600 hover:text-emerald-700"
          >
            返回前台
          </Link>
        </div>
      </header>

      <div className="flex">
        {/* 桌面端固定侧边栏 */}
        <aside className="hidden md:block w-60 min-h-[calc(100vh-3.5rem)] bg-white border-r border-neutral-200">
          {renderNavItems()}
        </aside>

        {/* 移动端抽屉式侧边栏：遮罩淡入 + 抽屉滑入 */}
        {sidebarOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 z-30 bg-black/40 animate-fade-in"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="md:hidden fixed left-0 top-14 bottom-0 z-40 w-60 bg-white border-r border-neutral-200 overflow-y-auto animate-slide-in-left">
              {renderNavItems()}
            </aside>
          </>
        )}

        {/* 主内容区域 */}
        <main className="flex-1 p-4 md:p-6 overflow-x-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
