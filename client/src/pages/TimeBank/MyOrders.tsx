import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Star, Play, CheckCircle, XCircle, MessageSquare, AlertCircle, Loader2 } from "lucide-react";
import { getOrders, updateOrderStatus, createReview } from "@/api/timeBank";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/utils/format";
import type { TimeOrder } from "@/types";

const statusTabs = [
  { key: "", label: "全部" },
  { key: "pending", label: "待接受" },
  { key: "accepted", label: "已接受" },
  { key: "in_progress", label: "进行中" },
  { key: "completed", label: "已完成" },
  { key: "cancelled", label: "已取消" },
];

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "待接受", color: "bg-yellow-100 text-yellow-700" },
  accepted: { label: "已接受", color: "bg-blue-100 text-blue-700" },
  in_progress: { label: "进行中", color: "bg-emerald-100 text-emerald-700" },
  completed: { label: "已完成", color: "bg-green-100 text-green-700" },
  cancelled: { label: "已取消", color: "bg-gray-100 text-gray-500" },
  disputed: { label: "纠纷中", color: "bg-red-100 text-red-700" },
};

export default function MyOrders() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState("");
  const [orders, setOrders] = useState<TimeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [reviewingOrderId, setReviewingOrderId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewContent, setReviewContent] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // 页面级错误：替代原生 alert，与项目其他页面风格一致（红色背景 + AlertCircle）
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (reset = false) => {
    try {
      const p = reset ? 1 : page;
      const res = await getOrders({ page: p, pageSize: 20 });
      const { list, hasNext } = res.data;
      setOrders(prev => reset ? list : [...prev, ...list]);
      setHasMore(hasNext);
      setPage(p + 1);
      setError(null);
    } catch (err) {
      // ApiError 精准提取后端错误消息，兜底通用提示
      setError(err instanceof ApiError ? err.message : "加载订单失败");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    setLoading(true);
    loadOrders(true);
    // navigate 由 React Router 保证引用稳定，安全纳入依赖
    // loadOrders 依赖 page，纳入会导致分页后无限重载，故显式排除
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, navigate]);

  const filteredOrders = activeTab ? orders.filter(o => o.status === activeTab) : orders;

  const handleStatusUpdate = async (orderId: string, status: string) => {
    setActionLoading(orderId);
    try {
      await updateOrderStatus(orderId, status);
      toast.success("操作成功");
      loadOrders(true);
    } catch (err) {
      // 操作类失败用 toast 即时反馈，避免遮挡列表
      toast.error(err instanceof ApiError ? err.message : "操作失败，请重试");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReview = async (orderId: string) => {
    if (reviewSubmitting) return;
    setReviewSubmitting(true);
    try {
      await createReview(orderId, reviewRating, reviewContent.trim() || undefined);
      toast.success("评价提交成功");
      setReviewingOrderId(null);
      setReviewRating(5);
      setReviewContent("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "评价失败，请重试");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const renderActions = (order: TimeOrder) => {
    const isProvider = user?.id === order.providerId;
    const isRequester = user?.id === order.requesterId;
    const isLoading = actionLoading === order.id;
    const buttons: React.ReactNode[] = [];

    if (order.status === "pending" && isProvider) {
      buttons.push(
        <button
          key="accept"
          onClick={() => handleStatusUpdate(order.id, "accepted")}
          disabled={isLoading}
          className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          接受
        </button>
      );
    }

    if (order.status === "accepted" && isProvider) {
      buttons.push(
        <button
          key="start"
          onClick={() => handleStatusUpdate(order.id, "in_progress")}
          disabled={isLoading}
          className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          开始服务
        </button>
      );
    }

    if (order.status === "in_progress" && isRequester) {
      buttons.push(
        <button
          key="complete"
          onClick={() => handleStatusUpdate(order.id, "completed")}
          disabled={isLoading}
          className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          完成服务
        </button>
      );
    }

    if ((order.status === "pending" || order.status === "accepted") && (isProvider || isRequester)) {
      buttons.push(
        <button
          key="cancel"
          onClick={() => handleStatusUpdate(order.id, "cancelled")}
          disabled={isLoading}
          className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium flex items-center justify-center gap-1 hover:bg-gray-200 transition-colors"
        >
          <XCircle className="w-3.5 h-3.5" />
          取消
        </button>
      );
    }

    if (order.status === "completed" && isRequester) {
      buttons.push(
        <button
          key="review"
          onClick={() => setReviewingOrderId(reviewingOrderId === order.id ? null : order.id)}
          className="flex-1 py-2 bg-amber-500 text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 hover:bg-amber-600 transition-colors"
        >
          <Star className="w-3.5 h-3.5" />
          评价
        </button>
      );
    }

    return buttons.length > 0 ? <div className="flex gap-2 mt-3">{buttons}</div> : null;
  };

  const renderReviewForm = (orderId: string) => {
    if (reviewingOrderId !== orderId) return null;
    return (
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center gap-1 mb-2">
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => setReviewRating(n)}>
              <Star
                className={`w-5 h-5 ${n <= reviewRating ? "text-amber-400 fill-amber-400" : "text-gray-300"}`}
              />
            </button>
          ))}
        </div>
        <textarea
          value={reviewContent}
          onChange={e => setReviewContent(e.target.value)}
          placeholder="写下您的评价..."
          rows={2}
          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none mb-2"
        />
        <div className="flex gap-2">
          <button
            onClick={() => handleReview(orderId)}
            disabled={reviewSubmitting}
            className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {reviewSubmitting ? "提交中..." : "提交评价"}
          </button>
          <button
            onClick={() => { setReviewingOrderId(null); setReviewContent(""); setReviewRating(5); }}
            className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    );
  };

  return (
    // max-w-2xl mx-auto：订单列表页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate(-1)} className="text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">我的订单</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              loadOrders(true);
            }}
            // 触摸目标提升：原纯 text-xs underline 无 padding，移动端难以精准点击
            className="ml-auto text-xs underline py-1 px-2 rounded hover:bg-red-50 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? "bg-emerald-600 text-white"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredOrders.map(order => {
          const cfg = statusConfig[order.status] ?? { label: order.status, color: "bg-gray-100 text-gray-500" };
          return (
            <div key={order.id} className="bg-white rounded-lg p-4 shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-gray-900 flex-1 truncate pr-2">
                  {order.service?.title || "服务订单"}
                </h3>
                <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>

              <div className="flex items-center gap-4 text-sm text-gray-500 mb-1">
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5" />
                  {formatTime(order.durationMinutes)}
                </span>
              </div>

              <p className="text-xs text-gray-400">
                {new Date(order.createdAt).toLocaleString("zh-CN")}
              </p>

              {renderActions(order)}
              {renderReviewForm(order.id)}
            </div>
          );
        })}
      </div>

      {loading && (
        <div className="text-center py-8 text-gray-500 inline-flex items-center justify-center w-full gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
          加载中...
        </div>
      )}

      {hasMore && !loading && filteredOrders.length > 0 && (
        <button
          onClick={() => loadOrders()}
          className="w-full py-3 mt-4 text-center text-emerald-600 hover:bg-emerald-50 rounded-lg"
        >
          加载更多
        </button>
      )}

      {!loading && filteredOrders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📦</div>
          <p>暂无订单</p>
        </div>
      )}
    </div>
  );
}
