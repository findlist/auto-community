import { useState } from "react";
import { X, Heart, Loader2, AlertCircle } from "lucide-react";
import { donateTime } from "@/api/timeBank";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";

interface DonateModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** 当前账户余额，用于前端预校验，避免明显超额提交 */
  currentBalance?: number;
}

/**
 * 捐赠金额校验：必须为正整数（与后端 donateTime 校验口径一致）。
 * 不允许 0、负数、浮点数，避免后端 422 拒绝。
 */
const isAmountValid = (value: string) => {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
};

/**
 * 捐赠时间币弹窗：与 TransferModal 区别在语义（公益捐赠）与流水 type。
 * 设计要点：
 * - 字段级错误提示（AlertCircle + 红色背景），不使用浏览器原生 alert；
 * - 提交中展示 Loader2 旋转动画，禁用按钮防止重复提交；
 * - 紫色主题与 typeConfig.donate 颜色保持一致，便于用户视觉识别。
 */
export default function DonateModal({ open, onClose, onSuccess, currentBalance }: DonateModalProps) {
  const [toUserId, setToUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!open) return null;

  // 字段级校验：分别检查必填、格式、余额，返回首个错误信息
  const validate = (): string | null => {
    if (!toUserId.trim()) return "请输入对方用户ID";
    if (!isAmountValid(amount)) return "捐赠金额必须为正整数";
    if (currentBalance !== undefined && Number(amount) > currentBalance) {
      return "捐赠金额不能超过当前余额";
    }
    return null;
  };

  const error = validate();

  const handleSubmit = async () => {
    if (error || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await donateTime(toUserId.trim(), Number(amount), remark.trim() || undefined);
      // 成功后清空表单、通知父组件刷新、关闭弹窗、提示用户
      setToUserId("");
      setAmount("");
      setRemark("");
      toast.success("捐赠成功");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      // 区分 API 业务错误（余额不足、用户不存在等）与未知异常，给出精准提示
      const message = err instanceof ApiError ? err.message : "捐赠失败，请重试";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // 关闭弹窗时清空错误状态，避免下次打开仍残留
  const handleClose = () => {
    setFormError(null);
    onClose();
  };

  // 外层 p-4：iOS Safari 软键盘弹起或地址栏可见时避免弹窗贴边/超出视口
  // 内容 w-full max-w-sm：替代 w-[90%] 固定百分比，配合 p-4 实现稳定的 viewport 适配
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl w-full max-w-sm p-5 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Heart className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">捐赠时间</h2>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">受赠用户ID</label>
            <input
              type="text"
              value={toUserId}
              onChange={e => setToUserId(e.target.value)}
              placeholder="请输入受赠用户ID"
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">捐赠金额（分钟）</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="请输入捐赠分钟数"
              min="1"
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input
              type="text"
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="选填"
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* 字段级错误提示：AlertCircle 红色背景，符合项目错误提示规范 */}
        {(formError || error) && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{formError || error}</p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!!error || submitting}
          className="w-full mt-5 py-3 bg-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Heart className="w-4 h-4" />
          )}
          {submitting ? "提交中..." : "确认捐赠"}
        </button>
      </div>
    </div>
  );
}
