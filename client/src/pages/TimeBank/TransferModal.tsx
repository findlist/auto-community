import { useState } from "react";
import { X, Send, Loader2, AlertCircle } from "lucide-react";
import { transferTime } from "@/api/timeBank";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** 当前账户余额，用于前端预校验，避免明显超额提交 */
  currentBalance?: number;
}

/**
 * 转赠金额校验：必须为正整数（与后端 transferTime 校验口径一致）。
 * 不允许 0、负数、浮点数，避免后端 422 拒绝。
 */
const isAmountValid = (value: string) => {
  const num = Number(value);
  return Number.isInteger(num) && num > 0;
};

/**
 * 时间币转赠弹窗：与 DonateModal 区别在语义（用户间转赠）与流水 type。
 * 设计要点：
 * - 字段级错误提示（AlertCircle + 红色背景），不使用浏览器原生 alert；
 * - 提交中展示 Loader2 旋转动画，禁用按钮防止重复提交；
 * - emerald 主题与 TimeAccount 转赠按钮颜色保持一致，便于用户视觉识别。
 */
export default function TransferModal({ open, onClose, onSuccess, currentBalance }: TransferModalProps) {
  const [toUserId, setToUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // 标记用户是否尝试过提交：仅在此后显示渲染期校验错误，避免用户刚输入第一字符就出现红色提示
  // 设计原因：原实现 error=validate() 在渲染期同步计算并直接展示，用户开始输入即触发校验，UX 不友好
  const [submitAttempted, setSubmitAttempted] = useState(false);

  if (!open) return null;

  // 字段级校验：分别检查必填、格式、余额，返回首个错误信息
  const validate = (): string | null => {
    if (!toUserId.trim()) return "请输入对方用户ID";
    if (!isAmountValid(amount)) return "转赠金额必须为正整数";
    if (currentBalance !== undefined && Number(amount) > currentBalance) {
      return "转赠金额不能超过当前余额";
    }
    return null;
  };

  const error = validate();

  const handleSubmit = async () => {
    // 首次点击即标记提交尝试，后续输入错误可实时显示
    if (submitting) return;
    setSubmitAttempted(true);
    if (error) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await transferTime(toUserId.trim(), Number(amount), remark.trim() || undefined);
      // 成功后清空表单、通知父组件刷新、关闭弹窗、提示用户
      setToUserId("");
      setAmount("");
      setRemark("");
      setSubmitAttempted(false);
      toast.success("转赠成功");
      onSuccess();
      onClose();
    } catch (err: unknown) {
      // 区分 API 业务错误（余额不足、用户不存在等）与未知异常，给出精准提示
      const message = err instanceof ApiError ? err.message : "转赠失败，请重试";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // 关闭弹窗时清空错误状态与提交标记，避免下次打开仍残留
  const handleClose = () => {
    setFormError(null);
    setSubmitAttempted(false);
    onClose();
  };

  // 外层 p-4：iOS Safari 软键盘弹起或地址栏可见时避免弹窗贴边/超出视口
  // 内容 w-full max-w-sm：替代 w-[90%] 固定百分比，配合 p-4 实现稳定的 viewport 适配
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl w-full max-w-sm p-5 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-gray-900">转赠时间</h2>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">对方用户ID</label>
            <input
              type="text"
              value={toUserId}
              onChange={e => setToUserId(e.target.value)}
              placeholder="请输入对方用户ID"
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">转赠金额（分钟）</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="请输入转赠分钟数"
              min="1"
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input
              type="text"
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="选填"
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* 字段级错误提示：AlertCircle 红色背景，符合项目错误提示规范 */}
        {/* submitAttempted 守卫：用户提交尝试前不显示渲染期校验错误，避免输入即报红 */}
        {((submitAttempted && error) || formError) && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{formError || error}</p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full mt-5 py-3 bg-emerald-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {submitting ? "提交中..." : "确认转赠"}
        </button>
      </div>
    </div>
  );
}
