import { useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { LayoutDashboard, Users, FileCheck, ShoppingCart, Flag, Menu, X, UserCheck, LineChart, Beaker, Image, ScrollText, Settings, ArrowLeft } from "lucide-react";

// 导航项分组：运营 / 数据 / 系统，提升信息架构与扫读效率
type NavGroup = {
  title: string;
  items: Array<{ path: string; label: string; icon: React.ComponentType<{ className?: string }>; end: boolean }>;
};

const navGroups: NavGroup[] = [
  {
    title: "运营",
    items: [
      { path: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
      { path: "/admin/users", label: "用户管理", icon: Users, end: false },
      { path: "/admin/content", label: "内容审核", icon: FileCheck, end: false },
      { path: "/admin/orders", label: "订单管理", icon: ShoppingCart, end: false },
      { path: "/admin/reports", label: "举报处理", icon: Flag, end: false },
      { path: "/admin/verifications", label: "实名认证", icon: UserCheck, end: false },
    ],
  },
  {
    title: "数据",
    items: [
      { path: "/admin/metrics", label: "效果度量", icon: LineChart, end: false },
      { path: "/admin/ab-tests", label: "A/B 测试", icon: Beaker, end: false },
    ],
  },
  {
    title: "系统",
    items: [
      { path: "/admin/homepage-image", label: "首页图片", icon: Image, end: false },
      { path: "/admin/audit-logs", label: "操作日志", icon: ScrollText, end: false },
      { path: "/admin/settings", label: "系统配置", icon: Settings, end: false },
    ],
  },
];

export default function AdminLayout() {
  const location = useLocation();
  // 移动端侧边栏开关状态
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 判断当前路由是否激活
  const isActive = (path: string, end: boolean) => {
    return end ? location.pathname === path : location.pathname.startsWith(path);
  };

  // 渲染分组导航：组标题用极小号大写字母 + 字距，编辑式分隔
  const renderNavItems = () => (
    <nav className="flex flex-col p-3">
      {navGroups.map((group, gi) => (
        <div key={group.title} className={gi > 0 ? "mt-4 pt-4 border-t border-neutral-100" : ""}>
          <p className="px-3 mb-1.5 text-[10px] font-mono tracking-widest uppercase text-neutral-400">
            {group.title}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ path, label, icon: Icon, end }) => {
              const active = isActive(path, end);
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setSidebarOpen(false)}
                  className={`relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                    active
                      ? "bg-emerald-50 text-emerald-700 font-medium"
                      : "text-neutral-600 hover:bg-neutral-100 hover:translate-x-0.5"
                  }`}
                >
                  {/* 激活态左侧色条：编辑式位置标记 */}
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-emerald-600" />
                  )}
                  <Icon className="w-[18px] h-[18px]" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
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
              className="md:hidden p-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
              aria-label="切换菜单"
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <h1 className="text-lg font-bold text-neutral-800">邻里圈管理后台</h1>
          </div>
          <Link
            to="/"
            className="text-sm text-emerald-600 hover:text-emerald-700 transition-colors inline-flex items-center gap-1 group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
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
