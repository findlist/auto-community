import { useState, useEffect, useCallback } from "react";
import { getFoodOrders, confirmFoodOrder, cancelFoodOrder } from "@/api/kitchen";
import { ReviewSubmitModal } from "@/pages/SharedKitchen/FoodReview";
import type { KitchenOrder } from "@/types";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

export default function Orders() {
  const [activeTab, setActiveTab] = useState<"buyer" | "seller">("buyer");
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  // 评价弹窗状态
  const [reviewOrderId, setReviewOrderId] = useState<string | null>(null);

  // 加载订单
  const loadOrders = useCallback(async (reset = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const newPage = reset ? 1 : page;
      const res = await getFoodOrders({
        role: activeTab,
        status: statusFilter || undefined,
        page: newPage,
        pageSize: 10,
      });
      if (reset) {
        setOrders(res.data.list);
      } else {
        setOrders(prev => [...prev, ...res.data.list]);
      }
      setHasMore(res.data.hasNext);
      setPage(newPage + 1);
    } catch (error) {
      console.error("加载失败:", error);
    } finally {
      setLoading(false);
    }
  }, [activeTab, statusFilter, page, loading]);

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    setOrders([]);
    loadOrders(true);
    // 仅在 activeTab/statusFilter 变化时重新加载；loadOrders 依赖 page/loading，纳入会导致分页后无限重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, statusFilter]);

  // 确认订单
  const handleConfirm = async (orderId: string) => {
    if (!confirm("确认此订单？")) return;
    try {
      await confirmFoodOrder(orderId);
      loadOrders(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "操作失败"));
    }
  };

  // 完成订单：打开评价弹窗
  const handleComplete = (orderId: string) => {
    setReviewOrderId(orderId);
  };

  // 评价成功回调
  const handleReviewSuccess = () => {
    loadOrders(true);
  };

  // 取消订单
  const handleCancel = async (orderId: string) => {
    if (!confirm("确定取消订单吗？")) return;
    try {
      await cancelFoodOrder(orderId);
      loadOrders(true);
    } catch ( error: any) {
      toast.error(error.response?.data?.message || "操作失败");
    }
  };

  // 状态标签
  const getStatusLabel = (status: string) => {
    const map: Record<string, string> = {
      pending: "待确认",
      confirmed: "已确认",
      completed: "已完成",
      cancelled: "已取消",
      timeout: "已超时",
    };
    return map[status] || status;
  };

  const getStatusColor = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-700",
      confirmed: "bg-blue-100 text-blue-700",
      completed: "bg-green-100 text-green-700",
      cancelled: "bg-gray-100 text-gray-700",
      timeout: "bg-red-100 text-red-700",
    };
    return map[status] || "bg-gray-100";
  };

  // 渲染订单卡片
  const renderOrderCard = (order: KitchenOrder) => (
    <div key={order.id} className="bg-white rounded-lg shadow-sm p-4 mb-3">
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">{order.post?.title}</h3>
          <p className="text-sm text-gray-500">
            {activeTab === "buyer" ? `卖家: ${order.seller?.nickname}` : `买家: ${order.buyer?.nickname}`}
          </p>
        </div>
        <span className={`px-2 py-1 text-xs rounded ${getStatusColor(order.status)}`}>
          {getStatusLabel(order.status)}
        </span>
      </div>

      <div className="flex justify-between items-center mb-3">
        <span className="text-gray-600">份数: {order.quantity}</span>
        <span className="text-emerald-600 font-medium">{order.totalPrice}积分</span>
      </div>

      {order.remark && (
        <p className="text-sm text-gray-500 mb-3">备注: {order.remark}</p>
      )}

      <div className="text-xs text-gray-400 mb-3">
        {new Date(order.createdAt).toLocaleString()}
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-2">
        {activeTab === "seller" && order.status === "pending" && (
          <button
            onClick={() => handleConfirm(order.id)}
            className="flex-1 py-2 bg-emerald-600 text-white text-sm rounded-lg"
          >
            确认
          </button>
        )}
        {activeTab === "buyer" && order.status === "confirmed" && (
          <button
            onClick={() => handleComplete(order.id)}
            className="flex-1 py-2 bg-emerald-600 text-white text-sm rounded-lg"
          >
            完成
          </button>
        )}
        {["pending", "confirmed"].includes(order.status) && (
          <button
            onClick={() => handleCancel(order.id)}
            className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg"
          >
            取消
          </button>
        )}
      </div>
    </div>
  );

  const statusOptions = [
    { value: "", label: "全部" },
    { value: "pending", label: "待确认" },
    { value: "confirmed", label: "已确认" },
    { value: "completed", label: "已完成" },
    { value: "cancelled", label: "已取消" },
  ];

  return (
    // max-w-2xl mx-auto：订单列表页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      {/* Tab 切换 */}
      <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
        <button
          onClick={() => setActiveTab("buyer")}
          className={`flex-1 py-2 text-sm rounded-md transition-colors ${
            activeTab === "buyer" ? "bg-white text-emerald-600 shadow-sm" : "text-gray-500"
          }`}
        >
          我领取的
        </button>
        <button
          onClick={() => setActiveTab("seller")}
          className={`flex-1 py-2 text-sm rounded-md transition-colors ${
            activeTab === "seller" ? "bg-white text-emerald-600 shadow-sm" : "text-gray-500"
          }`}
        >
          我分享的
        </button>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {statusOptions.map(opt => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap ${
              statusFilter === opt.value
                ? "bg-emerald-100 text-emerald-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* 订单列表 */}
      {orders.map(renderOrderCard)}

      {/* 加载状态 */}
      {loading && (
        <div className="text-center py-8 text-gray-500">
          <span className="animate-spin inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full mr-2" />
          加载中...
        </div>
      )}

      {/* 加载更多 */}
      {hasMore && !loading && orders.length > 0 && (
        <button
          onClick={() => loadOrders()}
          className="w-full py-3 mt-4 text-center text-emerald-600 hover:bg-emerald-50 rounded-lg"
        >
          加载更多
        </button>
      )}

      {/* 空状态 */}
      {!loading && orders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <p>暂无订单</p>
        </div>
      )}

      {/* 评价弹窗：订单完成时提交评价 */}
      <ReviewSubmitModal
        orderId={reviewOrderId || ""}
        visible={!!reviewOrderId}
        onClose={() => setReviewOrderId(null)}
        onSuccess={handleReviewSuccess}
      />
    </div>
  );
}
