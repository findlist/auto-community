import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  ArrowLeft,
  Clock,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  submitVerification,
  getVerificationStatus,
  type VerificationStatus,
} from "@/api/user";
import { ApiError } from "@/api/client";

export default function Verify() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 表单状态
  const [realName, setRealName] = useState("");
  const [idCard, setIdCard] = useState("");

  // 加载认证状态：useCallback 稳定引用，满足 useEffect exhaustive-deps
  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getVerificationStatus();
      setStatus(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载认证状态失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载认证状态
  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    loadStatus();
  }, [isAuthenticated, navigate, loadStatus]);

  // 提交认证申请
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!realName.trim() || !idCard.trim()) {
      setError("请填写完整信息");
      return;
    }
    if (realName.trim().length < 2 || realName.trim().length > 100) {
      setError("真实姓名长度需在2-100字符之间");
      return;
    }
    if (!/^[1-9]\d{5}(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/.test(idCard.trim())) {
      setError("身份证号格式不正确");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitVerification({
        realName: realName.trim(),
        idCard: idCard.trim(),
      });
      // 重新加载状态
      await loadStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 已认证通过
  if (status?.verifyStatus === "approved") {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center">
          <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-800 mb-2">实名认证已通过</h2>
          <p className="text-sm text-gray-500 mb-4">
            您已完成实名认证，真实姓名：{status.request?.realName}
          </p>
          <button
            onClick={() => navigate("/profile")}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600"
          >
            返回个人中心
          </button>
        </div>
      </div>
    );
  }

  // 审核中
  if (status?.verifyStatus === "pending") {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-xl p-6 max-w-sm w-full text-center">
          <Clock className="w-16 h-16 text-yellow-500 mx-auto mb-4 animate-pulse" />
          <h2 className="text-lg font-bold text-gray-800 mb-2">认证审核中</h2>
          <p className="text-sm text-gray-500 mb-4">
            您的实名认证申请正在审核中，请耐心等待管理员审核。
          </p>
          <p className="text-xs text-gray-400 mb-4">
            提交时间：{status.submittedAt ? new Date(status.submittedAt).toLocaleString() : "-"}
          </p>
          <button
            onClick={() => navigate("/profile")}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600"
          >
            返回个人中心
          </button>
        </div>
      </div>
    );
  }

  // 已拒绝，可重新申请
  if (status?.verifyStatus === "rejected") {
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
            <h2 className="text-lg font-bold text-gray-800">认证被拒绝</h2>
          </div>

          {status.request?.rejectReason && (
            <div className="bg-red-50 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-600">
                拒绝原因：{status.request.rejectReason}
              </p>
            </div>
          )}

          <p className="text-sm text-gray-500 mb-4">
            您可以修改信息后重新提交认证申请。
          </p>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">真实姓名 *</label>
              <input
                type="text"
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
                placeholder="请输入真实姓名"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">身份证号 *</label>
              <input
                type="text"
                value={idCard}
                onChange={(e) => setIdCard(e.target.value)}
                placeholder="请输入18位身份证号"
                maxLength={18}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                身份证号将使用 AES-256-GCM 加密存储，仅用于实名认证
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  重新提交认证
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 未认证，显示申请表单
  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col px-4 py-6">
      <button
        onClick={() => navigate("/profile")}
        className="flex items-center gap-1 text-gray-600 mb-4"
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
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold text-gray-800">实名认证</h2>
          </div>

          <p className="text-sm text-gray-500 mb-4">
            完成实名认证后，您将获得更多平台权益和信任度。
          </p>

          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">真实姓名 *</label>
              <input
                type="text"
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
                placeholder="请输入真实姓名（2-100字符）"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">身份证号 *</label>
              <input
                type="text"
                value={idCard}
                onChange={(e) => setIdCard(e.target.value.toUpperCase())}
                placeholder="请输入18位身份证号"
                maxLength={18}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                身份证号将使用 AES-256-GCM 加密存储，仅用于实名认证
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  提交认证申请
                </>
              )}
            </button>
          </form>

          <div className="mt-4 text-xs text-gray-400 text-center">
            <p>提交后将由管理员审核，审核通过后即可完成认证</p>
          </div>
        </div>
      )}
    </div>
  );
}