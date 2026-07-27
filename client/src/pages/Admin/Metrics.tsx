import { useState, useEffect, useCallback, useRef } from "react";
// 使用 lucide 图标统一项目视觉语言：原 emoji 在不同平台渲染差异较大，且与全项目图标体系不一致
import { Loader2, Siren, Target, Package, Star, Bot } from "lucide-react";
import MetricsChart from "@/components/MetricsChart";
import Empty from "@/components/Empty";
import { ApiError } from "@/api/client";
import {
  getMetricsDashboard,
  getMetricTrend,
  type DashboardMetric,
  type MetricTrendItem,
} from "@/api/admin";
import { toast } from "@/components/Toast";

// 核心指标配置：icon 直接引用 lucide 组件类型，避免每次渲染创建新元素
const METRIC_CONFIG = {
  emergency_response_time: {
    label: "应急响应时间",
    unit: "秒",
    color: "#ef4444",
    icon: Siren,
    format: (v: number) => `${v.toFixed(1)}s`,
  },
  match_success_rate: {
    label: "匹配成功率",
    unit: "%",
    color: "#22c55e",
    icon: Target,
    format: (v: number) => `${v.toFixed(1)}%`,
  },
  order_completion_rate: {
    label: "订单完成率",
    unit: "%",
    color: "#3b82f6",
    icon: Package,
    format: (v: number) => `${v.toFixed(1)}%`,
  },
  user_satisfaction_score: {
    label: "用户满意度",
    unit: "分",
    color: "#f59e0b",
    icon: Star,
    format: (v: number) => `${v.toFixed(1)}分`,
  },
  ai_recommendation_accuracy: {
    label: "AI推荐准确率",
    unit: "%",
    color: "#8b5cf6",
    icon: Bot,
    format: (v: number) => `${v.toFixed(1)}%`,
  },
} as const;

type MetricName = keyof typeof METRIC_CONFIG;

// stale 判定阈值：scheduler 每小时第 5 分钟采集一次，2 小时未更新意味着连续 2 次采集失败
// 设计原因：阈值放前端而非后端预计算，便于后续调整且避免阈值常量散落前后端两处
const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// 格式化「更新于 N 分钟前」文案
// 设计原因：用相对时间而非绝对时间，管理员一眼感知数据新旧程度，无需心算时间差
function formatUpdatedAt(recordedAt: string): string {
  const diffMs = Date.now() - new Date(recordedAt).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚更新";
  if (diffMin < 60) return `${diffMin} 分钟前更新`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前更新`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前更新`;
}

// 判断指标是否过期：超过阈值或无 recordedAt 时返回 true
// 设计原因：无 recordedAt 视为过期，提示管理员数据采集可能异常（如首次部署未触发采集）
function isStale(recordedAt: string | undefined): boolean {
  if (!recordedAt) return true;
  return Date.now() - new Date(recordedAt).getTime() > STALE_THRESHOLD_MS;
}

export default function Metrics() {
  const [dashboardData, setDashboardData] = useState<DashboardMetric[]>([]);
  const [trendData, setTrendData] = useState<Record<string, MetricTrendItem[]>>({});
  const [expandedMetric, setExpandedMetric] = useState<MetricName | null>(null);
  const [loading, setLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState<Record<string, boolean>>({});
  // 错误状态：保存仪表盘加载失败原因，渲染层据此展示错误 UI 与重试入口
  // 设计原因：原实现仅 toast 提示后回退空数据，用户无法区分"加载失败"与"真无数据"
  const [error, setError] = useState<string | null>(null);
  // 重试触发器：递增后作为 useEffect 依赖触发仪表盘重新加载
  const [retryKey, setRetryKey] = useState(0);

  // mountedRef 守卫：防御组件卸载后 setState 泄漏与 retryKey 切换时旧请求覆盖新数据
  // 设计原因：loadDashboard 在 await 后调用多个 setState，若用户切换页面或重试触发 cleanup，
  // 旧请求 resolve 仍会触发 setState，引发 React 警告与潜在脏数据写入
  const mountedRef = useRef(true);

  // 加载仪表盘数据
  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getMetricsDashboard();
      // 卸载或重试触发 cleanup 后跳过 setState，避免泄漏与脏数据覆盖
      if (!mountedRef.current) return;
      setDashboardData(response.data || []);
    } catch (err) {
      if (!mountedRef.current) return;
      // 保存错误信息到 state，渲染层展示错误 UI 与重试按钮，不再仅 toast
      setError(err instanceof ApiError ? err.message : "加载仪表盘数据失败");
      console.error("加载仪表盘数据失败:", err);
    } finally {
      // 仅当组件仍挂载时才更新 loading，避免卸载后 setState 警告
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 竞态守卫：跟踪当前活跃的趋势请求标识（指标+天数），快速切换时旧请求返回不再覆盖新数据
  // 设计原因：同一指标快速切换时间范围（7d→30d）时，旧请求的 setTrendData 会覆盖新请求的趋势数据
  const activeTrendKeyRef = useRef<string>("");

  // 加载趋势数据
  const loadTrend = useCallback(async (metricName: MetricName, days: number = 7) => {
    // 当前闭包捕获的请求标识，用于 await 后比对是否仍为最新请求
    const trendKey = `${metricName}|${days}`;
    activeTrendKeyRef.current = trendKey;
    try {
      setTrendLoading((prev) => ({ ...prev, [metricName]: true }));
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const response = await getMetricTrend(metricName, startDate, endDate);
      // 竞态守卫：await 期间若指标或时间范围已变化，跳过 setTrendData 避免旧趋势覆盖新趋势
      if (activeTrendKeyRef.current !== trendKey) return;
      setTrendData((prev) => ({ ...prev, [metricName]: response.data || [] }));
    } catch (error) {
      if (activeTrendKeyRef.current !== trendKey) return;
      console.error(`加载 ${metricName} 趋势数据失败:`, error);
      toast.error("加载趋势数据失败，请稍后重试");
    } finally {
      // 仅当当前请求标识仍为活跃时才更新 trendLoading，避免旧请求的 finally 覆盖新请求的 loading 状态
      if (activeTrendKeyRef.current === trendKey) {
        setTrendLoading((prev) => ({ ...prev, [metricName]: false }));
      }
    }
  }, []);

  useEffect(() => {
    // 每次依赖变化时重置 mountedRef 为 true（含首次挂载与 retryKey 变化触发的重新加载）
    mountedRef.current = true;
    loadDashboard();
    return () => {
      // cleanup 置 false 让进行中的旧请求失效，避免卸载或重试切换后 setState 泄漏
      mountedRef.current = false;
    };
  }, [loadDashboard, retryKey]);

  // 重试：递增 retryKey 触发上方 useEffect 重新执行加载
  const handleRetry = () => setRetryKey((k) => k + 1);

  // 展开/收起指标详情
  const handleToggleMetric = (metricName: MetricName) => {
    if (expandedMetric === metricName) {
      setExpandedMetric(null);
    } else {
      setExpandedMetric(metricName);
      if (!trendData[metricName]) {
        loadTrend(metricName);
      }
    }
  };

  // 时间范围变化
  const handleTimeRangeChange = (metricName: MetricName, range: "7d" | "30d" | "90d") => {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    loadTrend(metricName, days);
  };

  // CSV 导出
  const handleExportCSV = () => {
    // 表头新增「最后更新时间」：导出时附带 recordedAt 便于离线分析数据时效性
    const headers = ["指标名称", "当前值", "标签", "最后更新时间"];
    const rows = dashboardData.map((metric) => {
      const config = METRIC_CONFIG[metric.name as MetricName];
      return [
        config?.label || metric.name,
        config?.format(metric.value) || String(metric.value),
        JSON.stringify(metric.tags),
        // 格式化为本地时间字符串，避免 ISO 时区歧义
        metric.recordedAt ? new Date(metric.recordedAt).toLocaleString("zh-CN") : "",
      ];
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `效果度量_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 获取指标当前值
  const getMetricValue = (metricName: MetricName) => {
    const metric = dashboardData.find((m) => m.name === metricName);
    return metric?.value ?? 0;
  };

  // 获取指标最后更新时间
  // 设计原因：dashboardData 为数组，需按 name 查找对应 metric 的 recordedAt，封装避免重复
  const getMetricRecordedAt = (metricName: MetricName): string | undefined => {
    const metric = dashboardData.find((m) => m.name === metricName);
    return metric?.recordedAt;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-64">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        <span className="text-sm text-neutral-400">加载中...</span>
      </div>
    );
  }

  // 错误状态：展示失败原因与重试入口，避免静默回退空数据让用户误判为"无数据"
  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200">
        <Empty
          variant="error"
          title="加载失败"
          description={error}
          action={
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 transition-colors"
            >
              重新加载
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">
          效果度量
        </h1>
        <button
          onClick={handleExportCSV}
          className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors"
        >
          导出 CSV
        </button>
      </div>

      {/* 指标卡片区域 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {(Object.keys(METRIC_CONFIG) as MetricName[]).map((metricName) => {
          const config = METRIC_CONFIG[metricName];
          const value = getMetricValue(metricName);
          const recordedAt = getMetricRecordedAt(metricName);
          // stale 判定：超过 2 小时未更新视为过期，提示管理员数据采集可能异常
          const stale = isStale(recordedAt);
          const isExpanded = expandedMetric === metricName;
          // 将 icon 字段提到局部大写变量：lucide 组件需要作为 JSX 标签使用，小写会被识别为原生标签
          const Icon = config.icon;

          return (
            <button
              key={metricName}
              onClick={() => handleToggleMetric(metricName)}
              className={`p-4 rounded-2xl border transition-all text-left card-hover-glow ${
                isExpanded
                  ? "border-emerald-500 bg-emerald-50 shadow-md"
                  : "border-neutral-200 bg-white hover:shadow-md"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-6 h-6" style={{ color: config.color }} />
                <span className="text-xs text-neutral-400">
                  {config.label}
                </span>
              </div>
              <div
                className="text-2xl font-bold tabular-nums"
                style={{ color: config.color }}
              >
                {config.format(value)}
              </div>
              {/* 更新时间与 stale 标签：让管理员感知数据新旧程度，stale 时高亮提示 */}
              <div className="flex items-center gap-1 mt-1.5 text-[10px]">
                <span className={stale ? "text-orange-500" : "text-neutral-400"}>
                  {recordedAt ? formatUpdatedAt(recordedAt) : "暂无数据"}
                </span>
                {stale && (
                  <span className="px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded">
                    可能过期
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 图表区域 */}
      {expandedMetric && (
        <div className="animate-fade-in">
          {trendLoading[expandedMetric] ? (
            <div className="flex flex-col items-center justify-center gap-2 h-48 bg-white rounded-2xl border border-neutral-200">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
              <span className="text-sm text-neutral-400">
                加载趋势数据...
              </span>
            </div>
          ) : (
            <MetricsChart
              title={METRIC_CONFIG[expandedMetric].label}
              data={trendData[expandedMetric] || []}
              color={METRIC_CONFIG[expandedMetric].color}
              unit={METRIC_CONFIG[expandedMetric].unit}
              onTimeRangeChange={(range) =>
                handleTimeRangeChange(expandedMetric, range)
              }
            />
          )}
        </div>
      )}

      {/* 提示信息 */}
      {!expandedMetric && (
        <div className="text-center py-12 bg-white rounded-2xl border border-neutral-200">
          <p className="text-neutral-400">
            点击上方指标卡片查看趋势图
          </p>
        </div>
      )}
    </div>
  );
}
