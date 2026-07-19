import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Phone, Lock, KeyRound, ArrowRight, ArrowLeft, Loader2, Check } from "lucide-react";
import { resetPassword } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useSafeTimeout } from "@/hooks/useSafeTimeout";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const phoneFromQuery = searchParams.get("phone") || "";

  const [phone, setPhone] = useState(phoneFromQuery);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // 安全定时器：组件卸载时自动清理，避免 navigate 作用于已卸载组件
  const safeSetTimeout = useSafeTimeout();

  useEffect(() => {
    if (phoneFromQuery) {
      setPhone(phoneFromQuery);
    }
  }, [phoneFromQuery]);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      errors.phone = "请输入正确的手机号";
    }
    if (!/^\d{6}$/.test(code)) {
      errors.code = "请输入6位数字验证码";
    }
    if (password.length < 6) {
      errors.password = "密码至少6位";
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = "两次密码不一致";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;
    // 入口守卫：与按钮 disabled + 文案变化形成三重防御，避免 React 批处理延迟导致弱网下连点产生多次重置密码请求
    if (loading) return;
    setLoading(true);
    try {
      await resetPassword({ phone, code, password });
      setSuccess(true);
      // 2秒后跳转到登录页面
      safeSetTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "重置密码失败");
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
            {/* 使用 Lucide Check 图标替代字符 ✓，与 ForgotPassword 成功态保持视觉一致 */}
            <Check className="w-8 h-8 text-emerald-300" strokeWidth={3} />
          </div>
          <h1 className="text-white text-2xl font-bold mb-2 text-balance">密码重置成功</h1>
          <p className="text-white/70 text-sm mb-6">
            您的密码已重置，请使用新密码登录。
            <br />
            即将跳转到登录页面...
          </p>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 transition-colors"
          >
            立即登录
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
            重置密码
          </h1>
          <p className="text-white/70 text-sm tracking-wide">
            请输入验证码和新密码
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
                onChange={(e) => { setPhone(e.target.value); setFieldErrors(prev => ({ ...prev, phone: "" })); }}
                placeholder="请输入手机号"
                autoComplete="tel"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all ${fieldErrors.phone ? "border-red-400/70" : "border-white/20"}`}
              />
            </div>
            {fieldErrors.phone && <p className="mt-1.5 text-xs text-red-300">{fieldErrors.phone}</p>}
          </div>

          {/* 验证码 */}
          <div>
            <label htmlFor="code" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              验证码
            </label>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 transition-colors" />
              <input
                id="code"
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setFieldErrors(prev => ({ ...prev, code: "" })); }}
                placeholder="请输入6位验证码"
                inputMode="numeric"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all tracking-widest ${fieldErrors.code ? "border-red-400/70" : "border-white/20"}`}
              />
            </div>
            {fieldErrors.code && <p className="mt-1.5 text-xs text-red-300">{fieldErrors.code}</p>}
          </div>

          {/* 新密码 */}
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              新密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 transition-colors" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => ({ ...prev, password: "" })); }}
                placeholder="请输入新密码（至少6位）"
                autoComplete="new-password"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all ${fieldErrors.password ? "border-red-400/70" : "border-white/20"}`}
              />
            </div>
            {fieldErrors.password && <p className="mt-1.5 text-xs text-red-300">{fieldErrors.password}</p>}
          </div>

          {/* 确认密码 */}
          <div>
            <label htmlFor="confirmPassword" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              确认密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 transition-colors" />
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setFieldErrors(prev => ({ ...prev, confirmPassword: "" })); }}
                placeholder="请再次输入新密码"
                autoComplete="new-password"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all ${fieldErrors.confirmPassword ? "border-red-400/70" : "border-white/20"}`}
              />
            </div>
            {fieldErrors.confirmPassword && <p className="mt-1.5 text-xs text-red-300">{fieldErrors.confirmPassword}</p>}
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
                重置中...
              </span>
            ) : (
              <>
                重置密码
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <Link
            to="/forgot-password"
            className="flex items-center justify-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors pt-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            没收到验证码？重新获取
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
