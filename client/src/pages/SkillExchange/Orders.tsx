import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getOrders, updateOrderStatus } from "@/api/skills";
import { useAuth } from "@/hooks/useAuth";
import type { SkillOrder } from "@/types";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

const statusLabels: Record<string, string> = {
  pending: "待接受",
  accepted: "已接受",
  rejected: "已拒绝",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  disputed: "争议中",
};

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  accepted: "bg-blue-100 text-blue-700",
  rejected: "bg-gray-100 text-gray-700",
  in_progress: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-700",
  disputed: "bg-red-100 text-red-700",
};

export default function SkillExchangeOrders() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orders, setOrders] = useState<SkillOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrders({ page: 1, pageSize: 20 });
      setOrders(res.data.list);
    } catch (error) {
      toast.error(getErrorMessage(error, "加载订单失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleUpdateStatus = async (orderId: string, status: string) => {
    try {
      await updateOrderStatus(orderId, status);
      toast.success("操作成功");
      loadOrders();
    } catch (error) {
      toast.error(getErrorMessage(error, "操作失败"));
    }
  };

  const handleCancel = async (orderId: string) => {
    if (!confirm("确定取消订单吗？")) return;
    await handleUpdateStatus(orderId, "cancelled");
  };

  const handleReject = async (orderId: string) => {
    if (!confirm("确定拒绝订单吗？")) return;
    await handleUpdateStatus(orderId, "rejected");
  };

  const filteredOrders = statusFilter
    ? orders.filter((order) => order.status === statusFilter)
    : orders;

  const renderActionButton = (order: SkillOrder) => {
    const isBuyer = order.buyerId === user?.id;
    const isSeller = order.sellerId === user?.id;

    if (order.status === "pending" && isSeller) {
      return (
        <>
          <button
            onClick={() => handleUpdateStatus(order.id, "accepted")}
            className="flex-1 py-2 bg-emerald-600 text-white text-sm rounded-lg"
          >
            接受
          </button>
          <button
            onClick={() => handleReject(order.id)}
            className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg"
          >
            拒绝
          </button>
        </>
      );
    }

    if (order.status === "pending" && isBuyer) {
      return (
        <button
          onClick={() => handleCancel(order.id)}
          className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg"
        >
          取消
        </button>
      );
    }

    if (order.status === "accepted") {
      return (
        <>
          {isSeller && (
            <button
              onClick={() => handleUpdateStatus(order.id, "in_progress")}
              className="flex-1 py-2 bg-emerald-600 text-white text-sm rounded-lg"
            >
              开始服务
            </button>
          )}
          <button
            onClick={() => handleCancel(order.id)}
            className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg"
          >
            取消
          </button>
          <button
            onClick={() => navigate(`/skill-exchange/orders/${order.id}/dispute`)}
            className="flex-1 py-2 border border-red-200 text-red-600 text-sm rounded-lg"
          >
            发起争议
          </button>
        </>
      );
    }

    if (order.status === "in_progress") {
      return (
        <>
          <button
            onClick={() => handleUpdateStatus(order.id, "completed")}
            className="flex-1 py-2 bg-emerald-600 text-white text-sm rounded-lg"
          >
            完成
          </button>
          <button
            onClick={() => navigate(`/skill-exchange/orders/${order.id}/dispute`)}
            className="flex-1 py-2 border border-red-200 text-red-600 text-sm rounded-lg"
          >
            发起争议
          </button>
        </>
      );
    }

    if (order.status === "disputed") {
      return (
        <button
          onClick={() => navigate(`/skill-exchange/orders/${order.id}/dispute`)}
          className="flex-1 py-2 border border-red-200 text-red-600 text-sm rounded-lg"
        >
          查看争议
        </button>
      );
    }

    if (order.status === "completed") {
      return (
        <button
          onClick={() => navigate(`/chat/${order.id}`)}
          className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg"
        >
          去聊天
        </button>
      );
    }

    return null;
  };

  const statusOptions = [
    { value: "", label: "全部" },
    { value: "pending", label: "待接受" },
    { value: "accepted", label: "已接受" },
    { value: "in_progress", label: "进行中" },
    { value: "completed", label: "已完成" },
    { value: "cancelled", label: "已取消" },
    { value: "disputed", label: "争议中" },
  ];

  return (
    // max-w-2xl mx-auto：订单列表页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      {/* 二级页面返回按钮：触控区域 ≥40px（py-1.5 px-2），与项目其他页面统一 */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-gray-600 mb-4 py-1.5 px-2 -ml-2 rounded hover:bg-gray-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {statusOptions.map((opt) => (
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

      {loading && (
        <div className="text-center py-8 text-gray-500">
          <span className="animate-spin inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full mr-2" />
          加载中...
        </div>
      )}

      {!loading && filteredOrders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <p>暂无订单</p>
        </div>
      )}

      {filteredOrders.map((order) => (
        <div key={order.id} className="bg-white rounded-lg shadow-sm p-4 mb-3">
          <div className="flex justify-between items-start mb-2">
            <div className="flex-1">
              <h3 className="font-medium text-gray-900">{order.post?.title}</h3>
              <p className="text-sm text-gray-500">
                {order.buyerId === user?.id
                  ? `卖家: ${order.seller?.nickname || "未知"}`
                  : `买家: ${order.buyer?.nickname || "未知"}`}
              </p>
            </div>
            <span className={`px-2 py-1 text-xs rounded ${statusColors[order.status]}`}>
              {statusLabels[order.status]}
            </span>
          </div>

          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-gray-600">积分</span>
            <span className="text-emerald-600 font-medium">{order.creditsAmount}</span>
          </div>

          <div className="text-xs text-gray-400 mb-3">
            {new Date(order.createdAt).toLocaleString()}
          </div>

          <div className="flex gap-2">{renderActionButton(order)}</div>
        </div>
      ))}
    </div>
  );
}
