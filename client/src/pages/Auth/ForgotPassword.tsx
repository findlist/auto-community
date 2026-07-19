import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Phone, ArrowRight, ArrowLeft, Send, Loader2, Check } from "lucide-react";
import { forgotPassword } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useSafeTimeout } from "@/hooks/useSafeTimeout";

// 忘记密码第一步：仅输入手机号触发验证码下发，后续重置在 /reset-password 完成
// 设计原因：原 simpleResetPassword 端点仅凭手机号即可重置密码，存在任意账号接管风险；
// 改为 forgotPassword → 下发验证码（开发环境打印到后端日志）→ resetPassword 校验验证码两步流程
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // 安全定时器：组件卸载时自动清理，避免 navigate 作用于已卸载组件
  const safeSetTimeout = useSafeTimeout();

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      errors.phone = "请输入正确的手机号";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;
    setLoading(true);
    try {
      // 调用 forgotPassword 触发后端生成验证码：开发环境验证码输出到 server 日志，
      // 生产环境接入短信服务后由短信通道下发；此处不区分环境，逻辑一致
      await forgotPassword({ phone });
      setSuccess(true);
      // 2秒后带 phone 参数跳转到重置密码页，免去用户重复输入
      safeSetTimeout(() => {
        navigate(`/reset-password?phone=${encodeURIComponent(phone)}`);
      }, 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "验证码发送失败");
    } finally {
      setLoading(false);
    }
  };

  // 成功状态：保持与表单同款玻璃态卡片，避免状态切换时布局跳变
  if (success) {
    return (
      <div className="relative min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)] flex items-center justify-center px-4 py-12 overflow-hidden">
        {/* 氛围背景图：与登录页一致 */}
        <img
          src="/llq.jpg"
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-neutral-900/55 backdrop-blur-sm" />
        <div className="relative w-full max-w-md text-center animate-fade-in-up">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center mb-5 animate-fade-in-up">
            {/* 使用 Lucide Check 图标替代字符 ✓，描边粗细与表单图标一致，避免字形渲染差异 */}
            <Check className="w-8 h-8 text-emerald-300" strokeWidth={3} />
          </div>
          <h1 className="text-white text-2xl font-bold mb-2 text-balance">验证码已发送</h1>
          <p className="text-white/70 text-sm mb-6">
            验证码已发送至 {phone}
            <br />
            开发环境可在后端日志查看，即将跳转到重置页...
          </p>
          <Link
            to={`/reset-password?phone=${encodeURIComponent(phone)}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 transition-colors"
          >
            去输入验证码
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)] flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* 氛围背景图：与登录页一致，温暖邻里生活一隅 */}
      <img
        src="/llq.jpg"
        alt=""
        aria-hidden
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* 暗化遮罩：保证表单区可读 */}
      <div className="absolute inset-0 bg-neutral-900/55 backdrop-blur-sm" />

      {/* 内容容器：品牌 + 表单 */}
      <div className="relative w-full max-w-md">
        {/* 品牌字标 */}
        <div className="text-center mb-8 animate-fade-in-up">
          <h1 className="text-white text-4xl lg:text-5xl font-bold tracking-tight mb-2 text-balance drop-shadow-sm">
            忘记密码
          </h1>
          <p className="text-white/70 text-sm tracking-wide">
            输入注册手机号获取验证码
          </p>
        </div>

        {/* 表单：玻璃态卡片，与登录页一致；悬停轻提、焦点环细化 */}
        <form
          onSubmit={handleSubmit}
          className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 lg:p-8 space-y-5 animate-fade-in-up shadow-2xl transition-shadow duration-300 hover:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)]"
          style={{ animationDelay: "120ms" }}
        >
          {/* 手机号 */}
          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              手机号
            </label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 transition-colors" />
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, phone: "" }));
                }}
                placeholder="请输入注册手机号"
                autoComplete="tel"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all ${
                  fieldErrors.phone ? "border-red-400/70" : "border-white/20"
                }`}
              />
            </div>
            {fieldErrors.phone && (
              <p className="mt-1.5 text-xs text-red-300">{fieldErrors.phone}</p>
            )}
          </div>

          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-500/20 border border-red-400/30 text-red-200 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-white text-neutral-900 rounded-xl font-semibold hover:bg-neutral-100 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-black/10"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                发送中...
              </span>
            ) : (
              <>
                <Send className="w-4 h-4" />
                发送验证码
              </>
            )}
          </button>

          <Link
            to="/login"
            className="flex items-center justify-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors pt-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            返回登录
          </Link>
        </form>

        {/* 底部标语 */}
        <p className="text-center text-white/40 text-xs mt-6 animate-fade-in-up" style={{ animationDelay: "240ms" }}>
          AI 智能推荐 · 三维匹配 · 温暖社区
        </p>
      </div>
    </div>
  );
}
