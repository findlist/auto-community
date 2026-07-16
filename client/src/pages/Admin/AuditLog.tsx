import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, AlertCircle, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { getAuditLogs, type AuditLog, type AuditLogQuery } from "@/api/admin";
import { ApiError } from "@/api/client";
import ExportButton from "@/components/ExportButton";
import Empty from "@/components/Empty";

const PAGE_SIZE = 20;

// 操作类型映射为中文标签
const actionLabels: Record<string, string> = {
  LOGIN: "登录",
  LOGOUT: "登出",
  REGISTER: "注册",
  BAN_USER: "封禁用户",
  UNBAN_USER: "解禁用户",
  UPDATE_ROLE: "修改角色",
  COMPLETE_ORDER: "完成订单",
  CANCEL_ORDER: "取消订单",
  FORCE_CANCEL: "强制取消",
  TRANSFER: "转账",
  DISPUTE_ORDER: "发起争议",
  RESOLVE_DISPUTE: "裁决争议",
  DELETE_POST: "删除帖子",
  APPROVE_VERIFICATION: "通过认证",
  REJECT_VERIFICATION: "拒绝认证",
  HANDLE_REPORT: "处理举报",
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // 筛选条件
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // 竞态守卫：跟踪当前活跃的请求标识（筛选条件+页码），快速切换筛选时旧请求返回不再覆盖新数据
  // 设计原因：loadLogs 依赖 action/status/startDate/endDate/page，切换筛选条件时旧请求的 await 完成后会 setLogs 旧列表覆盖新列表
  const activeRequestKeyRef = useRef<string>("");

  const loadLogs = useCallback(async (p: number) => {
    // 闭包捕获当前请求标识，await 后比对是否仍为最新请求
    const requestKey = `${action}|${status}|${startDate}|${endDate}|${p}`;
    activeRequestKeyRef.current = requestKey;
    setLoading(true);
    setError(null);
    try {
      const query: AuditLogQuery = { page: p, pageSize: PAGE_SIZE };
      if (action) query.action = action;
      if (status) query.status = status;
      if (startDate) query.startDate = startDate;
      if (endDate) query.endDate = endDate;
      const res = await getAuditLogs(query);
      // 竞态守卫：await 期间若筛选条件/页码已变化，跳过 setState 避免旧数据覆盖新数据
      if (activeRequestKeyRef.current !== requestKey) return;
      setLogs(res.data.list);
      setTotalPages(res.data.totalPages);
      setTotal(res.data.total);
      setPage(res.data.page);
    } catch (err) {
      if (activeRequestKeyRef.current !== requestKey) return;
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      // 仅当前活跃请求才清除 loading，避免旧请求 finally 误刷新请求的 loading 状态
      if (activeRequestKeyRef.current === requestKey) {
        setLoading(false);
      }
    }
  }, [action, status, startDate, endDate]);

  useEffect(() => {
    loadLogs(1);
  }, [loadLogs]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-neutral-800">操作日志</h2>
        {/* 导出当前筛选条件的日志：action 后端不支持，仅传 status/时间范围 */}
        <ExportButton
          type="audit-logs"
          params={{
            status: status || undefined,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          }}
        />
      </div>

      {/* 筛选区 */}
      <div className="bg-white rounded-xl border border-neutral-100 p-4 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">操作类型</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="w-full px-2 py-1.5 border border-neutral-300 rounded-lg text-sm"
            >
              <option value="">全部</option>
              {Object.entries(actionLabels).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-2 py-1.5 border border-neutral-300 rounded-lg text-sm"
            >
              <option value="">全部</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">开始日期</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2 py-1.5 border border-neutral-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">结束日期</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-2 py-1.5 border border-neutral-300 rounded-lg text-sm"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => loadLogs(1)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600"
          >
            <Search className="w-4 h-4" />
            查询
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : logs.length === 0 ? (
        <Empty title="暂无日志记录" description="操作日志会在这里显示" />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-neutral-100">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 text-left">操作者</th>
                  <th className="px-4 py-3 text-left">操作</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">IP</th>
                  <th className="px-4 py-3 text-left">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">{log.nickname || log.userId?.slice(0, 8) || "系统"}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{actionLabels[log.action] || log.action}</span>
                      {log.resourceType && (
                        <span className="text-neutral-400 ml-1">({log.resourceType})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          log.status === "success"
                            ? "bg-green-100 text-green-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {log.status === "success" ? "成功" : "失败"}
                      </span>
                      {log.errorMessage && (
                        <span className="text-xs text-red-400 ml-1" title={log.errorMessage}>!</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{log.ip || "-"}</td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片 */}
          <div className="md:hidden space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="bg-white rounded-xl border border-neutral-100 p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-medium text-neutral-800">
                      {actionLabels[log.action] || log.action}
                    </div>
                    <div className="text-xs text-neutral-500">{log.nickname || "系统"}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      log.status === "success"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {log.status === "success" ? "成功" : "失败"}
                  </span>
                </div>
                {log.ip && <div className="text-xs text-neutral-400">IP: {log.ip}</div>}
                <div className="text-xs text-neutral-400 mt-1">
                  {new Date(log.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* 分页 */}
          <div className="flex items-center justify-between mt-4 text-sm text-neutral-600">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadLogs(page - 1)}
                disabled={page <= 1}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 hover:bg-neutral-50"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span>{page} / {totalPages || 1}</span>
              <button
                onClick={() => loadLogs(page + 1)}
                disabled={page >= totalPages}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 hover:bg-neutral-50"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
