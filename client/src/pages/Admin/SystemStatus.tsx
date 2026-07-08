import { useEffect, useState, useCallback } from "react";
import {
  Database,
  Server,
  MemoryStick,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  Clock,
  Loader2,
} from "lucide-react";
import {
  getSystemMetrics,
  clearAlertLogs,
  type SystemMetrics,
  type AlertLog,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";

// 格式化运行时间
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  parts.push(`${secs}秒`);

  return parts.join(" ");
}

// 格式化内存大小
function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

// 状态指示器组件
function StatusIndicator({ status }: { status: "healthy" | "unhealthy" }) {
  return status === "healthy" ? (
    <span className="flex items-center gap-1 text-emerald-600">
      <CheckCircle className="w-4 h-4" />
      正常
    </span>
  ) : (
    <span className="flex items-center gap-1 text-red-600">
      <XCircle className="w-4 h-4" />
      异常
    </span>
  );
}

// 告警类型图标
function AlertTypeIcon({ type }: { type: AlertLog["type"] }) {
  switch (type) {
    case "database":
      return <Database className="w-4 h-4" />;
    case "redis":
      return <Server className="w-4 h-4" />;
    case "memory":
      return <MemoryStick className="w-4 h-4" />;
  }
}

export default function SystemStatus() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);

  // 加载系统指标
  const loadMetrics = useCallback(async () => {
    try {
      const res = await getSystemMetrics();
      setMetrics(res.data.metrics);
      setAlerts(res.data.alerts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 手动刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMetrics();
  };

  // 清除告警日志
  const handleClearAlerts = async () => {
    if (!confirm("确定要清除所有告警日志吗？")) return;
    setClearing(true);
    try {
      await clearAlertLogs();
      setAlerts([]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "清除失败");
    } finally {
      setClearing(false);
    }
  };

  // 初始加载和定时刷新
  useEffect(() => {
    loadMetrics();
    const interval = setInterval(loadMetrics, 10000); // 每 10 秒刷新
    return () => clearInterval(interval);
  }, [loadMetrics]);

  // 加载中状态
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-red-500">
        <AlertTriangle className="w-8 h-8 mb-2" />
        <p>{error}</p>
        <button
          onClick={loadMetrics}
          className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600"
        >
          重试
        </button>
      </div>
    );
  }

  // 计算内存使用率
  const memoryUsagePercent = metrics
    ? ((metrics.server.memoryUsage.heapUsed / metrics.server.memoryUsage.heapTotal) * 100).toFixed(1)
    : "0";

  return (
    <div className="space-y-6">
      {/* 标题和操作按钮 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800">系统状态监控</h2>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            onClick={handleClearAlerts}
            disabled={clearing || alerts.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            清除告警
          </button>
        </div>
      </div>

      {/* 系统指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 数据库状态 */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-600" />
              </div>
              <span className="font-medium text-gray-800">数据库</span>
            </div>
            {metrics && <StatusIndicator status={metrics.database.status} />}
          </div>
          {metrics && (
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>连接池大小</span>
                <span className="font-medium">{metrics.database.poolSize}</span>
              </div>
              <div className="flex justify-between">
                <span>空闲连接</span>
                <span className="font-medium">{metrics.database.idleConnections}</span>
              </div>
              <div className="flex justify-between">
                <span>等待请求数</span>
                <span
                  className={`font-medium ${
                    metrics.database.waitingCount > 10 ? "text-red-600" : ""
                  }`}
                >
                  {metrics.database.waitingCount}
                  {metrics.database.waitingCount > 10 && (
                    <AlertTriangle className="inline w-4 h-4 ml-1" />
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Redis 状态 */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                <Server className="w-5 h-5 text-purple-600" />
              </div>
              <span className="font-medium text-gray-800">Redis</span>
            </div>
            {metrics && <StatusIndicator status={metrics.redis.status} />}
          </div>
          {metrics && (
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>连接状态</span>
                <span
                  className={`font-medium ${
                    metrics.redis.connected ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {metrics.redis.connected ? "已连接" : "断开"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>内存使用</span>
                <span className="font-medium">{metrics.redis.memoryUsage}</span>
              </div>
            </div>
          )}
        </div>

        {/* 服务器状态 */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-lg bg-orange-50 flex items-center justify-center">
                <MemoryStick className="w-5 h-5 text-orange-600" />
              </div>
              <span className="font-medium text-gray-800">服务器</span>
            </div>
            <span className="flex items-center gap-1 text-emerald-600">
              <CheckCircle className="w-4 h-4" />
              运行中
            </span>
          </div>
          {metrics && (
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>运行时间</span>
                <span className="font-medium text-xs">{formatUptime(metrics.server.uptime)}</span>
              </div>
              <div className="flex justify-between">
                <span>内存使用率</span>
                <span
                  className={`font-medium ${
                    parseFloat(memoryUsagePercent) > 80 ? "text-red-600" : ""
                  }`}
                >
                  {memoryUsagePercent}%
                  {parseFloat(memoryUsagePercent) > 80 && (
                    <AlertTriangle className="inline w-4 h-4 ml-1" />
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span>堆内存</span>
                <span className="font-medium">
                  {formatBytes(metrics.server.memoryUsage.heapUsed)} /{" "}
                  {formatBytes(metrics.server.memoryUsage.heapTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 告警日志列表 */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="font-medium text-gray-800 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            告警日志
            {alerts.length > 0 && (
              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded-full">
                {alerts.length}
              </span>
            )}
          </h3>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="px-4 py-8 text-center text-gray-500">
              暂无告警日志
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {alerts.map((alert, index) => (
                <li key={index} className="px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        alert.level === "critical"
                          ? "bg-red-50 text-red-600"
                          : "bg-yellow-50 text-yellow-600"
                      }`}
                    >
                      <AlertTypeIcon type={alert.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            alert.level === "critical"
                              ? "bg-red-100 text-red-600"
                              : "bg-yellow-100 text-yellow-600"
                          }`}
                        >
                          {alert.level === "critical" ? "严重" : "警告"}
                        </span>
                        <span className="text-xs text-gray-500">
                          {alert.type === "database"
                            ? "数据库"
                            : alert.type === "redis"
                            ? "Redis"
                            : "内存"}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 mt-1">{alert.message}</p>
                      <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                        <Clock className="w-3 h-3" />
                        {new Date(alert.timestamp).toLocaleString("zh-CN")}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}