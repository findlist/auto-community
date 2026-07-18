import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle,
  XCircle,
  UserCheck,
} from "lucide-react";
import Empty from "@/components/Empty";
import {
  getVerificationRequests,
  reviewVerification,
  type VerificationRequest,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import type { PaginatedResponse } from "@/types";

const PAGE_SIZE = 20;

// 审核弹窗配置
interface ReviewConfig {
  requestId: string;
  realName: string;
  userNickname: string;
  action: "approve" | "reject";
}

export default function VerificationReview() {
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewConfig | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 竞态守卫：跟踪当前活跃的请求标识，避免快速切换状态筛选时旧请求覆盖新数据
  // 设计原因：useEffect 依赖 statusFilter，用户快速切换筛选时旧请求的 await 仍在进行，
  // 完成后 setRequests 会用旧筛选结果覆盖新数据；分页/审核后主动调用 loadRequests 时
  // 标识未变，ref 检查通过，正常执行
  const activeRequestKeyRef = useRef(`1|${statusFilter}`);

  // 加载认证申请列表
  const loadRequests = useCallback(
    async (targetPage: number, targetStatus: string) => {
      setLoading(true);
      setError(null);
      const requestKey = `${targetPage}|${targetStatus}`;
      activeRequestKeyRef.current = requestKey;
      try {
        const res = await getVerificationRequests(
          targetPage,
          PAGE_SIZE,
          targetStatus || undefined
        );
        // 竞态守卫：await 期间若 statusFilter/page 已变化，跳过 setState 避免旧数据覆盖新数据
        if (activeRequestKeyRef.current !== requestKey) return;
        const data: PaginatedResponse<VerificationRequest> = res.data;
        setRequests(data.list);
        setTotalPages(data.totalPages);
        setTotal(data.total);
        setPage(data.page);
      } catch (err) {
        if (activeRequestKeyRef.current !== requestKey) return;
        setError(err instanceof ApiError ? err.message : "加载失败");
      } finally {
        // 仅当当前请求标识仍为活跃时才更新 loading，避免旧请求的 finally 覆盖新请求的 loading 状态
        if (activeRequestKeyRef.current === requestKey) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    loadRequests(1, statusFilter);
  }, [loadRequests, statusFilter]);

  // 状态筛选变更
  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    loadRequests(1, status);
  };

  // 执行审核操作
  const handleReviewAction = async () => {
    // 入口守卫：与 disabled + 文案变化形成三重防御，避免 React 批处理延迟导致弱网下连点产生多次认证审核
    if (submitting) return;
    if (!review) return;
    if (review.action === "reject" && !rejectReason.trim()) {
      setError("拒绝认证时必须填写原因");
      return;
    }
    setSubmitting(true);
    try {
      await reviewVerification(
        review.requestId,
        review.action,
        review.action === "reject" ? rejectReason.trim() : undefined
      );
      setReview(null);
      setRejectReason("");
      loadRequests(page, statusFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 状态标签样式
  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-700",
      approved: "bg-green-100 text-green-700",
      rejected: "bg-red-100 text-red-700",
    };
    const labels: Record<string, string> = {
      pending: "待审核",
      approved: "已通过",
      rejected: "已拒绝",
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-neutral-800 mb-4">实名认证审核</h2>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => handleStatusChange("")}
          className={`px-3 py-1.5 rounded-lg text-sm ${
            statusFilter === ""
              ? "bg-emerald-500 text-white"
              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          }`}
        >
          全部
        </button>
        <button
          onClick={() => handleStatusChange("pending")}
          className={`px-3 py-1.5 rounded-lg text-sm ${
            statusFilter === "pending"
              ? "bg-emerald-500 text-white"
              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          }`}
        >
          待审核
        </button>
        <button
          onClick={() => handleStatusChange("approved")}
          className={`px-3 py-1.5 rounded-lg text-sm ${
            statusFilter === "approved"
              ? "bg-emerald-500 text-white"
              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          }`}
        >
          已通过
        </button>
        <button
          onClick={() => handleStatusChange("rejected")}
          className={`px-3 py-1.5 rounded-lg text-sm ${
            statusFilter === "rejected"
              ? "bg-emerald-500 text-white"
              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
          }`}
        >
          已拒绝
        </button>
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
      ) : requests.length === 0 ? (
        <Empty title="暂无认证申请" description="认证申请会在这里显示" icon={<UserCheck className="w-16 h-16" />} />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-neutral-100">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 text-left">申请人</th>
                  <th className="px-4 py-3 text-left">手机号</th>
                  <th className="px-4 py-3 text-left">真实姓名</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">提交时间</th>
                  <th className="px-4 py-3 text-left">审核人</th>
                  <th className="px-4 py-3 text-left">拒绝原因</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {requests.map((r) => (
                  <tr key={r.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">{r.userNickname}</td>
                    <td className="px-4 py-3">{r.userPhone}</td>
                    <td className="px-4 py-3 font-medium">{r.realName}</td>
                    <td className="px-4 py-3">{getStatusBadge(r.status)}</td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {r.reviewerNickname || "-"}
                    </td>
                    <td className="px-4 py-3 text-neutral-500 max-w-[200px] truncate">
                      {r.rejectReason || "-"}
                    </td>
                    <td className="px-4 py-3">
                      {r.status === "pending" && (
                        <div className="flex gap-2">
                          <button
                            onClick={() =>
                              setReview({
                                requestId: r.id,
                                realName: r.realName,
                                userNickname: r.userNickname,
                                action: "approve",
                              })
                            }
                            className="text-emerald-600 hover:underline text-xs flex items-center gap-1"
                          >
                            <CheckCircle className="w-3 h-3" />
                            通过
                          </button>
                          <button
                            onClick={() =>
                              setReview({
                                requestId: r.id,
                                realName: r.realName,
                                userNickname: r.userNickname,
                                action: "reject",
                              })
                            }
                            className="text-red-600 hover:underline text-xs flex items-center gap-1"
                          >
                            <XCircle className="w-3 h-3" />
                            拒绝
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片布局 */}
          <div className="md:hidden space-y-3">
            {requests.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-xl border border-neutral-100 p-4"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="font-medium text-neutral-800">
                      {r.userNickname}
                    </div>
                    <div className="text-sm text-neutral-500">{r.userPhone}</div>
                  </div>
                  {getStatusBadge(r.status)}
                </div>
                <div className="text-sm mb-2">
                  <span className="text-neutral-500">真实姓名：</span>
                  <span className="font-medium">{r.realName}</span>
                </div>
                <div className="text-sm text-neutral-500 mb-3">
                  提交时间：{new Date(r.createdAt).toLocaleDateString()}
                  {r.reviewerNickname && (
                    <span className="ml-2">审核人：{r.reviewerNickname}</span>
                  )}
                </div>
                {r.rejectReason && (
                  <div className="text-sm text-red-600 mb-3">
                    拒绝原因：{r.rejectReason}
                  </div>
                )}
                {r.status === "pending" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setReview({
                          requestId: r.id,
                          realName: r.realName,
                          userNickname: r.userNickname,
                          action: "approve",
                        })
                      }
                      className="text-emerald-600 hover:underline text-xs flex items-center gap-1"
                    >
                      <CheckCircle className="w-3 h-3" />
                      通过
                    </button>
                    <button
                      onClick={() =>
                        setReview({
                          requestId: r.id,
                          realName: r.realName,
                          userNickname: r.userNickname,
                          action: "reject",
                        })
                      }
                      className="text-red-600 hover:underline text-xs flex items-center gap-1"
                    >
                      <XCircle className="w-3 h-3" />
                      拒绝
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 分页控件 */}
          <div className="flex items-center justify-between mt-4 text-sm text-neutral-600">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadRequests(page - 1, statusFilter)}
                disabled={page <= 1}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span>
                {page} / {totalPages || 1}
              </span>
              <button
                onClick={() => loadRequests(page + 1, statusFilter)}
                disabled={page >= totalPages}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* 审核弹窗 */}
      {review && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdrop">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm animate-modal-enter">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-neutral-800 flex items-center gap-2">
                <UserCheck className="w-5 h-5" />
                {review.action === "approve" ? "确认通过" : "确认拒绝"}
              </h3>
              <button
                onClick={() => {
                  setReview(null);
                  setRejectReason("");
                }}
                className="text-neutral-400 hover:text-neutral-600 p-1 rounded hover:bg-neutral-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-600 mb-2">
              申请人：<span className="font-medium">{review.userNickname}</span>
            </p>
            <p className="text-sm text-neutral-600 mb-4">
              真实姓名：<span className="font-medium">{review.realName}</span>
            </p>
            {review.action === "reject" && (
              <div className="mb-4">
                <label className="block text-sm text-neutral-600 mb-1">
                  拒绝原因 *
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="请填写拒绝原因（2-200字符）"
                  className="w-full px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 resize-none"
                  rows={3}
                />
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setReview(null);
                  setRejectReason("");
                }}
                className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                onClick={handleReviewAction}
                disabled={submitting}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                  review.action === "approve"
                    ? "bg-emerald-500 hover:bg-emerald-600"
                    : "bg-red-500 hover:bg-red-600"
                }`}
              >
                {submitting
                  ? "处理中..."
                  : review.action === "approve"
                  ? "确认通过"
                  : "确认拒绝"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}