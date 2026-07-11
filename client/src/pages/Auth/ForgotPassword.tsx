import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Phone, Lock, ArrowRight, ArrowLeft } from "lucide-react";
import { simpleResetPassword } from "@/api/auth";
import { ApiError } from "@/api/client";

// 简化版忘记密码：无需短信验证码，仅凭注册手机号 + 新密码即可重置
export default function ForgotPassword() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      errors.phone = "请输入正确的手机号";
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
    setLoading(true);
    try {
      await simpleResetPassword({ phone, password });
      setSuccess(true);
      // 2秒后跳转到登录页面
      setTimeout(() => {
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
          src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Soft%20warm%20photograph%20of%20a%20windowsill%20with%20a%20cup%20of%20tea%20and%20a%20small%20potted%20plant%20at%20golden%20hour%2C%20gentle%20bokeh%20of%20a%20cozy%20neighborhood%20outside%2C%20calm%20earthy%20tones%2C%20shallow%20depth%20of%20field%2C%20documentary%20lifestyle%20photography%2C%20no%20text%20no%20people&image_size=landscape_16_9"
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-neutral-900/55 backdrop-blur-sm" />
        <div className="relative w-full max-w-md text-center animate-fade-in-up">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center mb-5">
            <span className="text-emerald-300 text-3xl">✓</span>
          </div>
          <h1 className="text-white text-2xl font-bold mb-2">密码重置成功</h1>
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
        src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Soft%20warm%20photograph%20of%20a%20windowsill%20with%20a%20cup%20of%20tea%20and%20a%20small%20potted%20plant%20at%20golden%20hour%2C%20gentle%20bokeh%20of%20a%20cozy%20neighborhood%20outside%2C%20calm%20earthy%20tones%2C%20shallow%20depth%20of%20field%2C%20documentary%20lifestyle%20photography%2C%20no%20text%20no%20people&image_size=landscape_16_9"
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
          <h1 className="text-white text-4xl lg:text-5xl font-bold tracking-tight mb-2">
            重置密码
          </h1>
          <p className="text-white/70 text-sm tracking-wide">
            输入注册手机号和新密码即可重置
          </p>
        </div>

        {/* 表单：玻璃态卡片，与登录页一致 */}
        <form
          onSubmit={handleSubmit}
          className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 lg:p-8 space-y-5 animate-fade-in-up shadow-2xl"
          style={{ animationDelay: "120ms" }}
        >
          {/* 手机号 */}
          <div>
            <label htmlFor="phone" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              手机号
            </label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
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
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all ${
                  fieldErrors.phone ? "border-red-400/70" : "border-white/20"
                }`}
              />
            </div>
            {fieldErrors.phone && (
              <p className="mt-1.5 text-xs text-red-300">{fieldErrors.phone}</p>
            )}
          </div>

          {/* 新密码 */}
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              新密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: "" }));
                }}
                placeholder="请输入新密码（至少6位）"
                autoComplete="new-password"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all ${
                  fieldErrors.password ? "border-red-400/70" : "border-white/20"
                }`}
              />
            </div>
            {fieldErrors.password && (
              <p className="mt-1.5 text-xs text-red-300">{fieldErrors.password}</p>
            )}
          </div>

          {/* 确认密码 */}
          <div>
            <label htmlFor="confirmPassword" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              确认密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50" />
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, confirmPassword: "" }));
                }}
                placeholder="请再次输入新密码"
                autoComplete="new-password"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 transition-all ${
                  fieldErrors.confirmPassword ? "border-red-400/70" : "border-white/20"
                }`}
              />
            </div>
            {fieldErrors.confirmPassword && (
              <p className="mt-1.5 text-xs text-red-300">{fieldErrors.confirmPassword}</p>
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
            className="w-full py-3 bg-white text-neutral-900 rounded-xl font-semibold hover:bg-neutral-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-neutral-900/30 border-t-neutral-900 rounded-full animate-spin" />
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
