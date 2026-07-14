import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, AlertCircle, Loader2, Check } from "lucide-react";
import { getOrder, disputeOrder } from "@/api/skills";
import { ApiError } from "@/api/client";
import type { SkillOrder } from "@/types";

const statusLabels: Record<string, string> = {
  pending: "待接受",
  accepted: "已接受",
  rejected: "已拒绝",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  disputed: "争议中",
};

// 常见争议原因预设，方便用户快速选择
const commonReasons = [
  "对方未按时提供服务",
  "服务质量与描述不符",
  "对方无法联系",
  "其他原因",
];

export default function Dispute() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<SkillOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [selectedReason, setSelectedReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // 加载订单详情（含争议信息）
  const loadOrder = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const res = await getOrder(orderId);
      setOrder(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载订单失败");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  // 提交争议
  const handleSubmit = async () => {
    const finalReason = reason.trim() || selectedReason;
    if (!finalReason) {
      setError("请输入或选择争议原因");
      return;
    }
    if (!orderId) return;
    setSubmitting(true);
    setError("");
    try {
      await disputeOrder(orderId, finalReason);
      setSuccess(true);
      // 重新加载订单以显示争议状态
      await loadOrder();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "发起争议失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  // 渲染优先级：!order && error 优先显示加载错误全屏。
  // 设计原因：getOrder 失败时 order 仍为 null，若先判断 !order 会错误显示"订单不存在"，
  // 掩盖真实错误信息（如 404 订单已删除、500 服务异常），影响用户排查问题。
  // 仅当 order 不存在且有 error 时才走错误全屏；order 存在时（如 disputeOrder 提交失败）
  // 仍走正常表单 + 顶部错误提示条，保留用户继续操作的上下文
  if (!order && error) {
    return (
      <div className="px-4 py-8 text-center text-gray-500">
        <div className="flex items-center justify-center gap-2 mb-3 text-red-600">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">{error}</span>
        </div>
        <button onClick={() => navigate("/skill-exchange/orders")} className="mt-3 text-emerald-500">
          返回订单列表
        </button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="px-4 py-8 text-center text-gray-500">
        <p>订单不存在</p>
        <button onClick={() => navigate("/skill-exchange/orders")} className="mt-3 text-emerald-500">
          返回订单列表
        </button>
      </div>
    );
  }

  const isDisputed = order.status === "disputed";
  const hasResolution = !!order.resolution;

  return (
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate("/skill-exchange/orders")} aria-label="返回" className="p-1.5 hover:bg-gray-100 rounded transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-lg font-bold text-gray-900">订单争议</h1>
      </div>

      {/* 顶部错误提示条：disputeOrder 提交失败时显示，保留表单上下文供用户重试 */}
      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* 订单信息卡片 */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="font-medium text-gray-900">{order.post?.title || "未知技能"}</h3>
          <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
            {statusLabels[order.status] || order.status}
          </span>
        </div>
        <div className="flex justify-between items-center text-sm text-gray-500">
          <span>
            {order.buyerId ? `对方: ${order.seller?.nickname || "未知"}` : ""}
          </span>
          <span className="text-emerald-600 font-medium">{order.creditsAmount} 积分</span>
        </div>
      </div>

      {/* 已有争议结果显示 */}
      {isDisputed && !success && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <h3 className="font-medium text-gray-900">争议处理中</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">争议原因：</span>
              <span className="text-gray-800">{order.disputeReason}</span>
            </div>
            {order.disputeTime && (
              <div>
                <span className="text-gray-500">发起时间：</span>
                <span className="text-gray-800">{new Date(order.disputeTime).toLocaleString()}</span>
              </div>
            )}
            <div className="p-3 bg-yellow-50 rounded-lg text-yellow-700 text-xs">
              管理员正在处理中，请耐心等待裁决结果。
            </div>
          </div>
        </div>
      )}

      {/* 裁决结果显示 */}
      {hasResolution && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Check className="w-5 h-5 text-emerald-500" />
            <h3 className="font-medium text-gray-900">裁决结果</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-gray-500">处理结果：</span>
              <span className="text-gray-800">{order.resolution}</span>
            </div>
            {order.resolvedAt && (
              <div>
                <span className="text-gray-500">裁决时间：</span>
                <span className="text-gray-800">{new Date(order.resolvedAt).toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-gray-500">订单状态：</span>
              <span className={`px-2 py-0.5 text-xs rounded ${
                order.status === "cancelled"
                  ? "bg-gray-100 text-gray-600"
                  : "bg-green-100 text-green-700"
              }`}>
                {statusLabels[order.status] || order.status}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 发起争议表单（仅未争议且未裁决时显示） */}
      {!isDisputed && !hasResolution && !success && (
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <h3 className="font-medium text-gray-900 mb-3">发起争议</h3>
          <p className="text-sm text-gray-500 mb-3">
            如果对方未按约定提供服务或存在其他问题，您可以发起争议。管理员将介入处理。
          </p>

          {/* 快速选择常见原因 */}
          <div className="space-y-2 mb-3">
            {commonReasons.map((r) => (
              <label key={r} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="reason"
                  checked={selectedReason === r && !reason}
                  onChange={() => {
                    setSelectedReason(r);
                    setReason("");
                  }}
                  className="text-emerald-500"
                />
                <span className="text-sm text-gray-700">{r}</span>
              </label>
            ))}
          </div>

          {/* 自定义原因输入 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              或输入具体原因
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setSelectedReason("");
              }}
              rows={3}
              placeholder="请详细描述争议原因..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || (!reason.trim() && !selectedReason)}
            className="w-full py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 text-sm font-medium"
          >
            {submitting ? "提交中..." : "确认发起争议"}
          </button>
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <Check className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <h3 className="font-medium text-gray-900 mb-1">争议已提交</h3>
          <p className="text-sm text-gray-500 mb-4">管理员将尽快处理您的争议申请</p>
          <div className="flex gap-2 justify-center">
            <button
              onClick={() => navigate("/skill-exchange/orders")}
              className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600"
            >
              返回订单列表
            </button>
            <button
              onClick={() => setSuccess(false)}
              className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm"
            >
              查看详情
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
