import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Clock, ClipboardList, Users } from "lucide-react";
import { getServices } from "@/api/timeBank";
import type { TimeService } from "@/types";
import ServiceCard from "./ServiceCard";
import { SkeletonCompactList } from "@/components/Skeleton";

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

  useEffect(() => {
    setLoading(true);
    setError("");
    getServices({ type: activeTab as "provide" | "request" })
      .then(res => setServices(res.data.list))
      .catch(() => setError("加载失败，请稍后重试"))
      .finally(() => setLoading(false));
  }, [activeTab]);

  return (
    <div className="px-4 lg:px-10 py-6 pb-24 lg:pb-12 max-w-6xl lg:mx-auto">
      {/* 页面标题 + 发布 */}
      <div className="flex items-end justify-between mb-6 lg:mb-8">
        <div>
          <p className="text-xs tracking-widest mb-2 font-mono" style={{ color: "var(--color-module-timebank)" }}>—— 时间银行</p>
          <h1 className="text-3xl lg:text-4xl font-semibold text-neutral-900 tracking-tight">
            {activeTab === "provide" ? "邻居愿意花时间帮你" : "邻居需要你的一小时"}
          </h1>
        </div>
        <button
          onClick={() => navigate("/time-bank/create")}
          className="flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white rounded-full text-sm font-medium hover:bg-neutral-800 transition-colors"
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
            className="bg-white rounded-xl p-3 lg:p-4 border border-neutral-100 shadow-sm hover:shadow-md hover:border-violet-200 transition-all duration-200 text-left group"
          >
            <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center mb-2 group-hover:bg-violet-100 transition-colors">
              <Icon className="w-4 h-4 text-violet-600" />
            </div>
            <div className="text-sm font-medium text-neutral-900 mb-0.5">{label}</div>
            <div className="text-xs text-neutral-400 hidden lg:block truncate">{desc}</div>
          </button>
        ))}
      </div>

      {/* 列表区 */}
      {loading ? (
        <SkeletonCompactList count={3} />
      ) : error ? (
        <div className="text-center py-20 text-neutral-400">
          <p className="text-sm">{error}</p>
        </div>
      ) : services.length === 0 ? (
        <div className="text-center py-20 text-neutral-400">
          <div className="text-3xl mb-3">🕐</div>
          <p className="text-sm">暂无服务</p>
        </div>
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
    </div>
  );
}
