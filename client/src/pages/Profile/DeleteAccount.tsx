import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Trash2,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowLeft,
  Clock,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  submitDeletionRequest,
  getDeletionRequestStatus,
  cancelDeletionRequest,
  type DeletionRequestStatus,
} from "@/api/user";
import { ApiError } from "@/api/client";

export default function DeleteAccount() {
  const { isAuthenticated, logout: clearAuth } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [status, setStatus] = useState<DeletionRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // 表单状态
  const [reason, setReason] = useState("");

  // 加载注销申请状态：useCallback 稳定引用，满足 useEffect exhaustive-deps
  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getDeletionRequestStatus();
      setStatus(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载注销状态失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载注销申请状态
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    loadStatus();
  }, [isAuthenticated, navigate, loadStatus]);

  // 提交注销申请
  const handleSubmit = async () => {
    setShowConfirmModal(false);
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitDeletionRequest({ reason: reason.trim() || undefined });
      setStatus({
        id: res.data.id,
        userId: "",
        status: "pending",
        reason: reason.trim() || null,
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        reviewedBy: null,
        reviewerNickname: null,
        completedAt: null,
      });
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 取消注销申请
  const handleCancel = async () => {
    setCanceling(true);
    setError(null);
    try {
      await cancelDeletionRequest();
      setStatus(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "取消失败");
    } finally {
      setCanceling(false);
    }
  };

  // 注销已完成：通过 useEffect 执行副作用，避免渲染期间触发状态更新与导航
  useEffect(() => {
    if (status?.status === "completed") {
      // clearAuth 内部通过 zustand persist 自动同步清除 localStorage["auth-storage"]
      // 设计原因：与 Profile 退出登录逻辑一致，避免双存储不同步
      clearAuth();
      navigate("/login");
    }
  }, [status?.status, clearAuth, navigate]);

  // 渲染守卫：completed 状态下不展示表单内容（副作用由上面的 useEffect 异步执行）
  if (status?.status === "completed") {
    return null;
  }

  // 已通过审核，显示提示
  if (status?.status === "approved") {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center">
          <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-800 mb-2">注销申请已通过</h2>
          <p className="text-sm text-gray-500 mb-4">
            您的账号数据已匿名化处理，即将退出登录。
          </p>
        </div>
      </div>
    );
  }

  // 审核中
  if (status?.status === "pending") {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex flex-col px-4 py-6">
        {/* 触控区域标准：py-1.5 px-2 ≥40px，-ml-2 抵消父容器 px-4 保持视觉对齐 */}
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-1 text-gray-600 mb-4 py-1.5 px-2 -ml-2 rounded hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="bg-white rounded-xl p-6 max-w-md mx-auto w-full">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-bold text-gray-800">注销申请审核中</h2>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            您的账号注销申请正在审核中，请耐心等待管理员审核。
          </p>

          <div className="bg-gray-50 rounded-lg p-3 mb-4">
            <p className="text-xs text-gray-400">提交时间</p>
            <p className="text-sm text-gray-600">
              {status.createdAt ? new Date(status.createdAt).toLocaleString() : "-"}
            </p>
            {status.reason && (
              <>
                <p className="text-xs text-gray-400 mt-2">注销原因</p>
                <p className="text-sm text-gray-600">{status.reason}</p>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <button
            onClick={handleCancel}
            disabled={canceling}
            className="w-full py-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {canceling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                取消中...
              </>
            ) : (
              <>
                <X className="w-4 h-4" />
                取消注销申请
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // 已拒绝，可重新申请
  if (status?.status === "rejected") {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex flex-col px-4 py-6">
        {/* 触控区域标准：py-1.5 px-2 ≥40px，-ml-2 抵消父容器 px-4 保持视觉对齐 */}
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center gap-1 text-gray-600 mb-4 py-1.5 px-2 -ml-2 rounded hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>

        <div className="bg-white rounded-xl p-6 max-w-md mx-auto w-full">
          <div className="flex items-center gap-2 mb-4">
            <XCircle className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-bold text-gray-800">注销申请被拒绝</h2>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            您可以修改信息后重新提交注销申请。
          </p>

          <div className="bg-red-50 rounded-lg p-3 mb-4">
            <p className="text-xs text-gray-400">审核时间</p>
            <p className="text-sm text-gray-600">
              {status.reviewedAt ? new Date(status.reviewedAt).toLocaleString() : "-"}
            </p>
            {status.reviewerNickname && (
              <>
                <p className="text-xs text-gray-400 mt-2">审核人</p>
                <p className="text-sm text-gray-600">{status.reviewerNickname}</p>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <button
            onClick={() => setStatus(null)}
            className="w-full py-3 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 flex items-center justify-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            重新申请注销
          </button>
        </div>
      </div>
    );
  }

  // 未申请，显示申请表单
  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col px-4 py-6">
      <button
        onClick={() => navigate("/profile")}
        // 触摸目标提升：原无 padding 仅文字大小，移动端难以点击
        // py-1 px-2 + -ml-2 抵消父容器 px-4，保持视觉对齐同时扩大点击区域
        className="flex items-center gap-1 text-gray-600 mb-4 py-1 px-2 -ml-2 rounded hover:bg-gray-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : (
        <div className="bg-white rounded-xl p-6 max-w-md mx-auto w-full">
          <div className="flex items-center gap-2 mb-4">
            <Trash2 className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-bold text-gray-800">账号注销</h2>
          </div>

          <div className="bg-yellow-50 rounded-lg p-3 mb-4 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-yellow-700">
              <p className="font-medium mb-1">注销须知</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>注销后您的个人信息将被匿名化处理</li>
                <li>注销申请需管理员审核通过后生效</li>
                <li>注销后无法恢复，请谨慎操作</li>
              </ul>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm text-gray-600 mb-1">注销原因（可选）</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请填写注销原因（最多500字符）"
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={submitting}
            className="w-full py-3 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                提交注销申请
              </>
            )}
          </button>

          <p className="mt-4 text-xs text-gray-400 text-center">
            提交后将由管理员审核，审核通过后账号将被注销
          </p>
        </div>
      )}

      {/* 确认弹窗 */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500" />
              <h3 className="text-lg font-bold text-gray-800">确认注销账号？</h3>
            </div>

            <p className="text-sm text-gray-500 mb-6">
              此操作不可撤销，注销后您的个人信息将被匿名化处理，无法恢复。确定要继续吗？
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    确认中...
                  </>
                ) : (
                  "确认注销"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}