import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { getReports, handleReport, type Report } from "@/api/admin";
import { ApiError } from "@/api/client";
import ExportButton from "@/components/ExportButton";
import Empty from "@/components/Empty";
import type { PaginatedResponse } from "@/types";

const PAGE_SIZE = 20;

// 状态筛选配置
const statusFilters = [
  { key: "", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "resolved", label: "已解决" },
  { key: "rejected", label: "已驳回" },
];

// 处理弹窗状态
interface HandleTarget {
  id: string;
}

export default function ReportManagement() {
  const [status, setStatus] = useState("pending");
  const [list, setList] = useState<Report[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handleTarget, setHandleTarget] = useState<HandleTarget | null>(null);
  const [handleNote, setHandleNote] = useState("");
  const [handleStatus, setHandleStatus] = useState<"resolved" | "rejected">("resolved");
  const [submitting, setSubmitting] = useState(false);

  // 竞态守卫：跟踪当前活跃的请求标识（状态+页码），快速切换筛选时旧请求返回不再覆盖新数据
  // 设计原因：loadReports 依赖 status/page，切换状态筛选时旧请求的 await 完成后会 setList 旧列表覆盖新列表
  const activeRequestKeyRef = useRef<string>("");

  // 加载举报列表
  const loadReports = useCallback(async (s: string, p: number) => {
    // 闭包捕获当前请求标识，await 后比对是否仍为最新请求
    const requestKey = `${s}|${p}`;
    activeRequestKeyRef.current = requestKey;
    setLoading(true);
    setError(null);
    try {
      const res = await getReports(p, PAGE_SIZE, s || undefined);
      // 竞态守卫：await 期间若状态/页码已变化，跳过 setState 避免旧数据覆盖新数据
      if (activeRequestKeyRef.current !== requestKey) return;
      const data: PaginatedResponse<Report> = res.data;
      setList(data.list);
      setTotalPages(data.totalPages);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      if (activeRequestKeyRef.current !== requestKey) return;
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      // 仅当前活跃请求才清除 loading，避免旧请求 finally 误刷新请求的 loading 状态
      if (activeRequestKeyRef.current === requestKey) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadReports(status, 1);
  }, [status, loadReports]);

  // 打开处理弹窗
  const openHandleModal = (report: Report) => {
    setHandleTarget({ id: report.id });
    setHandleNote("");
    setHandleStatus("resolved");
  };

  // 提交处理举报
  const handleConfirm = async () => {
    // 入口守卫：与 disabled + 文案变化形成三重防御，避免 React 批处理延迟导致弱网下连点产生多次举报处理
    if (submitting) return;
    if (!handleTarget || !handleNote.trim()) return;
    setSubmitting(true);
    try {
      await handleReport(handleTarget.id, handleStatus, handleNote.trim());
      setHandleTarget(null);
      setHandleNote("");
      loadReports(status, page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 举报类型文案
  const getTargetTypeText = (t: string) => {
    const map: Record<string, string> = {
      skill_post: "技能帖",
      kitchen_post: "厨房帖",
      time_service: "时间服务",
      emergency: "应急请求",
      user: "用户",
      order: "订单",
    };
    return map[t] || t;
  };

  // 举报状态文案
  const getStatusText = (s: string) => {
    const map: Record<string, string> = {
      pending: "待处理",
      resolved: "已解决",
      rejected: "已驳回",
    };
    return map[s] || s;
  };

  // 举报状态样式
  const getStatusStyle = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-700",
      resolved: "bg-green-100 text-green-700",
      rejected: "bg-neutral-100 text-neutral-600",
    };
    return map[s] || "bg-neutral-100 text-neutral-600";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-neutral-800">举报处理</h2>
        {/* 导出当前状态的举报，status 为空字符串时不传，导出全部 */}
        <ExportButton type="reports" params={{ status: status || undefined }} />
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {statusFilters.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatus(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              status === tab.key
                ? "bg-emerald-500 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
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
      ) : list.length === 0 ? (
        <Empty title="暂无数据" description="举报记录会在这里显示" />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-neutral-100">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 text-left">举报类型</th>
                  <th className="px-4 py-3 text-left">目标ID</th>
                  <th className="px-4 py-3 text-left">原因</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">举报时间</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {list.map((report) => (
                  <tr key={report.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">{getTargetTypeText(report.targetType)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                      {report.targetId.length > 12
                        ? `${report.targetId.slice(0, 12)}...`
                        : report.targetId}
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate" title={report.reason}>
                      {report.reason}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${getStatusStyle(report.status)}`}
                      >
                        {getStatusText(report.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(report.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {report.status === "pending" ? (
                        <button
                          onClick={() => openHandleModal(report)}
                          className="text-emerald-600 hover:underline text-xs"
                        >
                          处理
                        </button>
                      ) : (
                        <span className="text-neutral-400 text-xs">
                          {report.handleNote ? "已处理" : "-"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片布局 */}
          <div className="md:hidden space-y-3">
            {list.map((report) => (
              <div key={report.id} className="bg-white rounded-xl border border-neutral-100 p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-medium text-neutral-800">
                    {getTargetTypeText(report.targetType)}
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${getStatusStyle(report.status)}`}
                  >
                    {getStatusText(report.status)}
                  </span>
                </div>
                <div className="text-sm space-y-1 mb-3">
                  <div className="text-neutral-500 font-mono text-xs">
                    目标: {report.targetId}
                  </div>
                  <div className="text-neutral-700">原因: {report.reason}</div>
                  <div className="text-neutral-500">
                    举报时间: {new Date(report.createdAt).toLocaleString()}
                  </div>
                  {report.handleNote && (
                    <div className="text-neutral-500">
                      处理备注: {report.handleNote}
                    </div>
                  )}
                </div>
                {report.status === "pending" && (
                  <button
                    onClick={() => openHandleModal(report)}
                    className="text-emerald-600 hover:underline text-xs"
                  >
                    处理
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 分页控件 */}
          <div className="flex items-center justify-between mt-4 text-sm text-neutral-600">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadReports(status, page - 1)}
                disabled={page <= 1}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span>
                {page} / {totalPages || 1}
              </span>
              <button
                onClick={() => loadReports(status, page + 1)}
                disabled={page >= totalPages}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* 处理举报弹窗 */}
      {handleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdrop">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm animate-modal-enter">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-neutral-800">处理举报</h3>
              <button
                onClick={() => {
                  setHandleTarget(null);
                  setHandleNote("");
                }}
                className="text-neutral-400 hover:text-neutral-600 p-1 rounded hover:bg-neutral-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-500 mb-3">
              举报 ID: <span className="font-mono">{handleTarget.id}</span>
            </p>
            <label className="block text-sm text-neutral-600 mb-1">处理结果</label>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setHandleStatus("resolved")}
                className={`flex-1 px-3 py-2 text-sm rounded-lg border ${
                  handleStatus === "resolved"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-neutral-300 text-neutral-600"
                }`}
              >
                已解决
              </button>
              <button
                onClick={() => setHandleStatus("rejected")}
                className={`flex-1 px-3 py-2 text-sm rounded-lg border ${
                  handleStatus === "rejected"
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                    : "border-neutral-300 text-neutral-600"
                }`}
              >
                已驳回
              </button>
            </div>
            <label className="block text-sm text-neutral-600 mb-1">处理备注</label>
            <textarea
              value={handleNote}
              onChange={(e) => setHandleNote(e.target.value)}
              placeholder="请输入处理备注"
              rows={3}
              className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => {
                  setHandleTarget(null);
                  setHandleNote("");
                }}
                className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting || !handleNote.trim()}
                className="px-4 py-2 text-sm text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50"
              >
                {submitting ? "处理中..." : "确认处理"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
