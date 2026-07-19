import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Clock, ClipboardList, Users, Loader2 } from "lucide-react";
import Empty from "@/components/Empty";
import { getServices } from "@/api/timeBank";
import type { TimeService } from "@/types";
import ServiceCard from "./ServiceCard";
import { SkeletonCompactList } from "@/components/Skeleton";
import { LoadingButton } from "@/components/Button";

const tabs = [
  { key: "provide", label: "提供服务" },
  { key: "request", label: "请求服务" },
];

// 二级功能入口：避免 TimeAccount / MyOrders / FamilyBinding 页面成为孤儿页面
const quickEntries = [
  { path: "/time-bank/account", label: "时间账户", icon: Clock, desc: "查看余额与交易记录" },
  { path: "/time-bank/orders", label: "我的订单", icon: ClipboardList, desc: "管理时间银行订单" },
  { path: "/time-bank/family", label: "亲情绑定", icon: Users, desc: "与家人共享时间账户" },
];

export default function TimeBank() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("provide");
  const [services, setServices] = useState<TimeService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 分页状态：page 跟踪当前页（从 1 起），hasMore 控制加载更多按钮显示
  // 设计原因：原实现一次性拉取全部数据，服务量增长后首屏慢且无法触达旧服务，对齐 SkillExchange/Emergency 范式
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // 竞态守卫：跟踪当前活跃的 activeTab，快速切换 Tab 时旧请求返回不再覆盖新数据
  // 设计原因：loadServices 依赖 activeTab，切换 Tab 会重新创建并触发新请求，
  // 但旧请求的 await 仍在进行中，完成后会 setServices 旧列表覆盖新列表
  const activeTabRef = useRef(activeTab);

  const loadServices = useCallback(async (reset = false) => {
    // reset 时跳过 loading 守卫，确保切换 Tab 时即使上一次请求未完成也能重新加载
    if (!reset && loading) return;
    setLoading(true);
    if (reset) setError("");
    // 当前闭包捕获的请求标识，用于 await 后比对是否仍为最新请求
    const requestTab = activeTab;
    try {
      const newPage = reset ? 1 : page;
      const res = await getServices({
        type: activeTab as "provide" | "request",
        page: newPage,
        pageSize: 20,
      });
      // 竞态守卫：await 期间若 activeTab 已变化，跳过 setState 避免旧列表覆盖新列表
      if (activeTabRef.current !== requestTab) return;
      const { list, hasNext } = res.data;
      if (reset) {
        setServices(list);
      } else {
        setServices(prev => [...prev, ...list]);
      }
      setHasMore(hasNext);
      setPage(newPage + 1);
    } catch (err) {
      if (activeTabRef.current !== requestTab) return;
      console.error("加载服务列表失败:", err);
      // 错误信息保存到 state，渲染层展示错误 UI
      setError("加载失败，请稍后重试");
    } finally {
      // 仅当当前 activeTab 仍为活跃时才更新 loading，避免旧请求的 finally 覆盖新请求的 loading 状态
      if (activeTabRef.current === requestTab) {
        setLoading(false);
      }
    }
  }, [activeTab, page, loading]);

  // 同步活跃 activeTab 并触发请求：依赖 activeTab 变化时重置分页状态并重新拉取
  useEffect(() => {
    activeTabRef.current = activeTab;
    setPage(1);
    setHasMore(true);
    setServices([]);
    loadServices(true);
    // 仅在 activeTab 变化时重新加载；loadServices 依赖 page/loading，纳入会导致分页后无限重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="px-4 lg:px-10 py-6 pb-24 lg:pb-12 max-w-6xl mx-auto">
      {/* 页面标题 + 发布 */}
      <div className="flex items-end justify-between mb-6 lg:mb-8">
        <div>
          <p className="text-xs tracking-widest mb-2 font-mono" style={{ color: "var(--color-module-timebank)" }}>—— 时间银行</p>
          <h1 className="text-3xl lg:text-4xl font-semibold text-neutral-900 tracking-tight text-balance">
            {activeTab === "provide" ? "邻居愿意花时间帮你" : "邻居需要你的一小时"}
          </h1>
        </div>
        <button
          onClick={() => navigate("/time-bank/create")}
          className="flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white rounded-full text-sm font-medium hover:bg-neutral-800 hover:shadow-[0_8px_24px_-8px_rgba(139,92,246,0.5)] active:scale-[0.97] transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          发布
        </button>
      </div>

      {/* Tab 切换：下划线式，激活态下划线使用时间银行模块紫 */}
      {/* overflow-x-auto + whitespace-nowrap：移动端窄屏 Tab 文字不换行、可横向滚动，避免下划线动效错位 */}
      <div className="flex items-center gap-6 border-b border-neutral-200 mb-6 overflow-x-auto pb-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative pb-3 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === key ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"
            }`}
          >
            {label}
            <span
              className={`absolute bottom-0 left-0 right-0 h-0.5 bg-violet-600 transition-transform duration-200 ${
                activeTab === key ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        ))}
      </div>

      {/* 二级功能入口：横向排列，移动端自适应换行，沿用时间银行模块紫 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {quickEntries.map(({ path, label, icon: Icon, desc }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            className="bg-white rounded-xl p-3 lg:p-4 border border-neutral-100 shadow-sm hover:shadow-md hover:border-violet-200 hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 text-left group"
          >
            <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center mb-2 group-hover:bg-violet-100 group-hover:scale-105 transition-all">
              <Icon className="w-4 h-4 text-violet-600" />
            </div>
            <div className="text-sm font-medium text-neutral-900 mb-0.5">{label}</div>
            <div className="text-xs text-neutral-400 hidden lg:block truncate">{desc}</div>
          </button>
        ))}
      </div>

      {/* 列表区 */}
      {loading && services.length === 0 ? (
        <SkeletonCompactList count={3} />
      ) : error && services.length === 0 ? (
        <div className="text-center py-20 text-neutral-400">
          <p className="text-sm">{error}</p>
        </div>
      ) : services.length === 0 ? (
        <Empty title="暂无服务" description="发布后会在这里显示" />
      ) : (
        // 列表项自带分隔线，外层仅做纵向排列
        <div className="flex flex-col">
          {services.map(service => (
            <ServiceCard
              key={service.id}
              service={service}
              onClick={() => navigate(`/time-bank/${service.id}`)}
            />
          ))}
        </div>
      )}

      {/* 已有列表时的加载中间态：避免骨架屏闪烁覆盖现有内容 */}
      {loading && services.length > 0 && (
        <div className="text-center py-6 text-neutral-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-neutral-400 inline-block mr-2 align-middle" />
          加载中...
        </div>
      )}

      {/* 加载更多按钮：仅在还有更多数据且当前未在加载时显示 */}
      {hasMore && !loading && services.length > 0 && (
        <LoadingButton onClick={() => loadServices()} variant="outline" fullWidth className="mt-6">
          加载更多
        </LoadingButton>
      )}
    </div>
  );
}
