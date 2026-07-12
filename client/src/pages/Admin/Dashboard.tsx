import { useEffect, useState, useMemo } from "react";
import { Users, UserPlus, Wrench, ChefHat, Clock, Siren, Flag, Loader2, TrendingUp, Activity } from "lucide-react";
import {
  getDashboard,
  type DashboardData,
  getDashboardTrend,
  getDashboardReputation,
  getDashboardModules,
  getDashboardSystem,
  type TrendItem,
  type ReputationItem,
  type ModuleItem,
  type SystemStatsData,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import Empty from "@/components/Empty";
import { LineChart, PieChart, BarChart, ChartCard } from "@/components/Charts";

// 统计卡片配置
const cardConfig: Array<{
  key: keyof DashboardData;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}> = [
  { key: "totalUsers", label: "用户总数", icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
  { key: "todayNewUsers", label: "今日新增", icon: UserPlus, color: "text-emerald-600", bg: "bg-emerald-50" },
  { key: "skillOrders", label: "技能订单", icon: Wrench, color: "text-purple-600", bg: "bg-purple-50" },
  { key: "kitchenOrders", label: "厨房订单", icon: ChefHat, color: "text-orange-600", bg: "bg-orange-50" },
  { key: "timeBankOrders", label: "时间银行", icon: Clock, color: "text-cyan-600", bg: "bg-cyan-50" },
  { key: "emergencyRequests", label: "应急请求", icon: Siren, color: "text-red-600", bg: "bg-red-50" },
  { key: "pendingReports", label: "待处理举报", icon: Flag, color: "text-yellow-600", bg: "bg-yellow-50" },
];

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartsLoading, setChartsLoading] = useState(true);
  // 图表加载独立错误状态：Promise.all 任一失败时记录原因，避免静默回退空数据让用户误以为无数据
  const [chartsError, setChartsError] = useState<string | null>(null);
  // 重试触发器：递增后作为 useEffect 依赖触发图表重新加载，避免把 fetchCharts 提到组件作用域
  const [chartsRetryKey, setChartsRetryKey] = useState(0);
  const [regTrendData, setRegTrendData] = useState<TrendItem[]>([]);
  const [orderTrendData, setOrderTrendData] = useState<TrendItem[]>([]);
  const [reputationData, setReputationData] = useState<ReputationItem[]>([]);
  const [moduleData, setModuleData] = useState<ModuleItem[]>([]);
  const [systemData, setSystemData] = useState<SystemStatsData>({
    pendingReports: 0,
    todayActiveUsers: 0,
    totalMutualAids: 0,
    monthNewUsers: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const loadDashboard = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await getDashboard();
        if (!cancelled) setData(res.data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchCharts = async () => {
      setChartsLoading(true);
      setChartsError(null);
      try {
        const [regRes, orderRes, repRes, modRes, sysRes] = await Promise.all([
          getDashboardTrend('registration', 7),
          getDashboardTrend('order', 7),
          getDashboardReputation(),
          getDashboardModules(),
          getDashboardSystem(),
        ]);
        if (!cancelled) {
          setRegTrendData(regRes.data);
          setOrderTrendData(orderRes.data);
          setReputationData(repRes.data);
          setModuleData(modRes.data);
          setSystemData(sysRes.data);
        }
      } catch (err) {
        // 图表加载失败不阻塞统计卡片，但记录原因供渲染层展示错误提示与重试入口
        // 设计原因：原实现 catch 为空导致任一请求失败时所有图表静默显示空数据，用户无法区分"无数据"与"加载失败"
        if (!cancelled) {
          setChartsError(err instanceof ApiError ? err.message : "图表数据加载失败");
        }
      } finally {
        if (!cancelled) setChartsLoading(false);
      }
    };
    fetchCharts();
    return () => {
      cancelled = true;
    };
  }, [chartsRetryKey]);

  // 重试图表加载：递增 retryKey 触发上方 useEffect 重新执行
  const handleRetryCharts = () => setChartsRetryKey((k) => k + 1);

  // 模块订单分布数据（用于饼图）
  const moduleDistribution = useMemo(() => {
    const colors = ["#3b82f6", "#f97316", "#8b5cf6", "#ef4444", "#10b981"];
    return moduleData.map((item, i) => ({
      name: item.name,
      value: item.posts + item.orders,
      // 提供 fallback 颜色，确保 color 始终为 string（noUncheckedIndexedAccess 下数组访问可能为 undefined）
      color: colors[i % colors.length] ?? "#10b981",
    }));
  }, [moduleData]);

  const trendChartData = useMemo(() => {
    const labels = regTrendData.map((item) => item.date.slice(5));
    return {
      labels,
      series: [
        {
          name: "新增用户",
          color: "#10b981",
          data: regTrendData.map((item) => item.count),
        },
        {
          name: "新增订单",
          color: "#3b82f6",
          data: orderTrendData.map((item) => item.count),
        },
      ],
    };
  }, [regTrendData, orderTrendData]);

  const reputationChartData = useMemo(() => {
    const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];
    return reputationData.map((item, i) => ({
      name: item.label,
      value: item.count,
      color: colors[i % colors.length],
    }));
  }, [reputationData]);

  // 加载中
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2" role="status">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        <span className="text-sm text-[var(--color-text-tertiary)]">正在加载数据...</span>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <Empty
        variant="error"
        title="加载失败"
        description={error}
        action={
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-md text-sm hover:bg-[var(--color-primary-600)]"
          >
            重新加载
          </button>
        }
      />
    );
  }

  if (!data) return null;

  return (
    <div>
      {/* 顶部欢迎区 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
            <Activity className="w-5 h-5 text-[var(--color-primary-500)]" />
            数据统计看板
          </h2>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">实时反映平台运营状态</p>
        </div>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {new Date().toLocaleString("zh-CN")}
        </span>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {cardConfig.map(({ key, label, icon: Icon, color, bg }, idx) => {
          const val = data[key];
          return (
            <div
              key={key}
              className="bg-white rounded-2xl p-4 border border-[var(--color-border)] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 stagger-item"
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${bg}`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div className="text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
                {val}
              </div>
              <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5 flex items-center gap-1">
                {label}
                {key === "todayNewUsers" && val > 0 && (
                  <span className="inline-flex items-center text-[var(--color-success)] text-[10px] font-medium">
                    <TrendingUp className="w-2.5 h-2.5" />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 图表区：加载失败时统一展示错误提示与重试入口，避免静默回退空数据让用户误以为无数据 */}
      {chartsError ? (
        <div className="bg-white rounded-2xl border border-[var(--color-border)] shadow-sm mb-5">
          <Empty
            variant="error"
            title="图表加载失败"
            description={chartsError}
            action={
              <button
                onClick={handleRetryCharts}
                className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-md text-sm hover:bg-[var(--color-primary-600)]"
              >
                重新加载图表
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
            <ChartCard title="近 7 日趋势" subtitle="新增用户与订单趋势">
              {chartsLoading ? (
                <div className="flex items-center justify-center py-10 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
                </div>
              ) : (
                <LineChart labels={trendChartData.labels} series={trendChartData.series} height={220} />
              )}
            </ChartCard>

            <ChartCard title="模块订单分布" subtitle="各核心服务订单占比">
              {chartsLoading ? (
                <div className="flex items-center justify-center py-10 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
                </div>
              ) : (
                <PieChart data={moduleDistribution} size={160} />
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard title="信誉分分布" subtitle="用户信誉分区间分布">
              {chartsLoading ? (
                <div className="flex items-center justify-center py-10 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
                </div>
              ) : (
                <BarChart data={reputationChartData} />
              )}
            </ChartCard>

            <ChartCard title="待处理事项" subtitle="需要关注的关键指标">
              {chartsLoading ? (
                <div className="flex items-center justify-center py-10 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  <span className="text-xs text-[var(--color-text-tertiary)]">加载中...</span>
                </div>
              ) : (
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center justify-between py-2 px-3 bg-red-50 rounded-lg">
                    <span className="text-[var(--color-text-primary)]">待处理举报</span>
                    <span className="text-base font-bold text-[var(--color-error)] tabular-nums">
                      {systemData.pendingReports}
                    </span>
                  </li>
                  <li className="flex items-center justify-between py-2 px-3 bg-yellow-50 rounded-lg">
                    <span className="text-[var(--color-text-primary)]">互助总数</span>
                    <span className="text-base font-bold text-[var(--color-warning)] tabular-nums">
                      {systemData.totalMutualAids}
                    </span>
                  </li>
                  <li className="flex items-center justify-between py-2 px-3 bg-emerald-50 rounded-lg">
                    <span className="text-[var(--color-text-primary)]">今日活跃用户</span>
                    <span className="text-base font-bold text-[var(--color-success)] tabular-nums">
                      {systemData.todayActiveUsers}
                    </span>
                  </li>
                  <li className="flex items-center justify-between py-2 px-3 bg-blue-50 rounded-lg">
                    <span className="text-[var(--color-text-primary)]">本月新增用户</span>
                    <span className="text-base font-bold text-[var(--color-info)] tabular-nums">
                      {systemData.monthNewUsers}
                    </span>
                  </li>
                </ul>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
