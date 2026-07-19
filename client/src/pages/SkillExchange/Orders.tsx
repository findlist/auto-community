import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import Empty from "@/components/Empty";
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

// 待确认操作的状态：保存 orderId + 目标 status + 提示文案
// 设计原因：原生 confirm() 阻塞主线程且移动端样式不可控，改用状态驱动的自定义 Modal，
// 用户点击"确定"后才真正调用 updateOrderStatus，与 SystemStatus.tsx 弹窗风格保持一致
interface ConfirmAction {
  orderId: string;
  status: string;
  message: string;
}

export default function SkillExchangeOrders() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orders, setOrders] = useState<SkillOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  // 确认弹窗状态：null 表示弹窗关闭，非 null 即待执行的操作
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  // 状态变更进行中的订单 ID：用作重复提交守卫与按钮加载态指示
  // 设计原因：updateOrderStatus 非幂等（订单状态机严格递进），弱网下用户连点会触发多次状态变更，
  // 可能跳过中间状态（如 pending → accepted 后再次点击变成 in_progress，绕过 accepted 阶段）
  const [actioningId, setActioningId] = useState<string | null>(null);
  // 挂载标志：useEffect cleanup 时置为 false，loadOrders/handleUpdateStatus await 后检查避免卸载后 setState 泄漏
  // 设计原因：loadOrders 由 useEffect 触发，handleUpdateStatus 由用户事件触发，两路异步在卸载后 resolve 都会触发 setState 泄漏
  const mountedRef = useRef(true);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrders({ page: 1, pageSize: 20 });
      // 卸载后不再 setState，避免 React 警告与内存泄漏
      if (!mountedRef.current) return;
      setOrders(res.data.list);
    } catch (error) {
      if (!mountedRef.current) return;
      toast.error(getErrorMessage(error, "加载订单失败"));
    } finally {
      // 仅挂载中才更新 loading，避免卸载后 finally 触发 setState
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 重置挂载标志：组件重新挂载时恢复为 true
    mountedRef.current = true;
    loadOrders();
    // cleanup：组件卸载时置为 false，使进行中的 loadOrders 失效
    return () => { mountedRef.current = false; };
  }, [loadOrders]);

  const handleUpdateStatus = async (orderId: string, status: string) => {
    // 重复提交守卫：避免弱网下连点触发多次状态变更，破坏订单状态机严格递进
    if (actioningId) return;
    setActioningId(orderId);
    try {
      await updateOrderStatus(orderId, status);
      if (!mountedRef.current) return;
      toast.success("操作成功");
      loadOrders();
    } catch (error) {
      if (!mountedRef.current) return;
      toast.error(getErrorMessage(error, "操作失败"));
    } finally {
      // 仅挂载中才更新 actioningId，避免卸载后 finally 触发 setState
      if (mountedRef.current) setActioningId(null);
    }
  };

  // 打开取消订单确认弹窗：仅设置待执行操作，实际调用由弹窗内"确定"按钮触发
  const handleCancel = (orderId: string) => {
    setConfirmAction({ orderId, status: "cancelled", message: "确定取消订单吗？" });
  };

  // 打开拒绝订单确认弹窗：同上，延迟到用户确认后才执行状态变更
  const handleReject = (orderId: string) => {
    setConfirmAction({ orderId, status: "rejected", message: "确定拒绝订单吗？" });
  };

  // 用户在弹窗中点击"确定"后执行实际状态更新
  // 先清空 confirmAction 关闭弹窗，避免重复点击；handleUpdateStatus 内部已有 actioningId 守卫与 try/catch + toast 兜底
  const confirmActionRun = async () => {
    if (!confirmAction) return;
    const { orderId, status } = confirmAction;
    setConfirmAction(null);
    await handleUpdateStatus(orderId, status);
  };

  const filteredOrders = statusFilter
    ? orders.filter((order) => order.status === statusFilter)
    : orders;

  const renderActionButton = (order: SkillOrder) => {
    const isBuyer = order.buyerId === user?.id;
    const isSeller = order.sellerId === user?.id;
    // 当前订单正在进行状态变更：按钮禁用 + 显示加载态
    // 设计原因：updateOrderStatus 非幂等，弱网下连点会破坏订单状态机严格递进
    const isActioning = actioningId === order.id;
    // 全局禁用：任一订单状态变更进行中时，所有操作按钮都不可点，避免并发触发多个状态变更
    const disabledAny = actioningId !== null;
    // 状态变更按钮统一加 disabled + 加载文案，与按钮原 emerald/gray 配色协调
    const actionBtnClass = (base: string) =>
      `flex-1 py-2 text-sm rounded-lg transition-colors ${base} ${
        disabledAny ? "opacity-50 cursor-not-allowed" : ""
      }`;

    if (order.status === "pending" && isSeller) {
      return (
        <>
          <button
            onClick={() => handleUpdateStatus(order.id, "accepted")}
            disabled={disabledAny}
            className={actionBtnClass("bg-emerald-600 text-white")}
          >
            {isActioning ? "处理中..." : "接受"}
          </button>
          <button
            onClick={() => handleReject(order.id)}
            disabled={disabledAny}
            className={actionBtnClass("border border-gray-200 text-gray-600")}
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
          disabled={disabledAny}
          className={actionBtnClass("border border-gray-200 text-gray-600")}
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
              disabled={disabledAny}
              className={actionBtnClass("bg-emerald-600 text-white")}
            >
              {isActioning ? "处理中..." : "开始服务"}
            </button>
          )}
          <button
            onClick={() => handleCancel(order.id)}
            disabled={disabledAny}
            className={actionBtnClass("border border-gray-200 text-gray-600")}
          >
            取消
          </button>
          <button
            onClick={() => navigate(`/skill-exchange/orders/${order.id}/dispute`)}
            disabled={disabledAny}
            className={actionBtnClass("border border-red-200 text-red-600")}
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
            disabled={disabledAny}
            className={actionBtnClass("bg-emerald-600 text-white")}
          >
            {isActioning ? "处理中..." : "完成"}
          </button>
          <button
            onClick={() => navigate(`/skill-exchange/orders/${order.id}/dispute`)}
            disabled={disabledAny}
            className={actionBtnClass("border border-red-200 text-red-600")}
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
          disabled={disabledAny}
          className={actionBtnClass("border border-red-200 text-red-600")}
        >
          查看争议
        </button>
      );
    }

    if (order.status === "completed") {
      return (
        <button
          onClick={() => navigate(`/chat/${order.id}`)}
          disabled={disabledAny}
          className={actionBtnClass("bg-blue-600 text-white")}
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
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500 inline-block mr-2 align-middle" />
          加载中...
        </div>
      )}

      {!loading && filteredOrders.length === 0 && (
        <Empty title="暂无订单" description="订单记录会在这里显示" />
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

      {/* 操作确认弹窗：替代原生 confirm()，与 SystemStatus.tsx 弹窗风格统一 */}
      {/* role="dialog" 提升无障碍语义，便于测试用 within 精确定位弹窗内按钮 */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setConfirmAction(null)}
        >
          <div
            role="dialog"
            aria-label="操作确认"
            className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-neutral-800 mb-2">操作确认</h3>
            <p className="text-sm text-neutral-600 mb-6">{confirmAction.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmActionRun}
                className="px-4 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
