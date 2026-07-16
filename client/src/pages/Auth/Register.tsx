import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Phone, Lock, User, ArrowRight, ArrowLeft, Sparkles, Eye, EyeOff, Shield, Loader2 } from "lucide-react";
import { register } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/Toast";

// 当前隐私政策版本
const PRIVACY_POLICY_VERSION = "v1.0";

export default function Register() {
  const navigate = useNavigate();
  const { login: setAuth } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [nickname, setNickname] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const errors: Record<string, string> = {};
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      errors.phone = "请输入正确的手机号";
    }
    if (password.length < 6) {
      errors.password = "密码至少6位";
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = "两次输入的密码不一致";
    }
    if (nickname.length < 2) {
      errors.nickname = "昵称至少2个字符";
    }
    if (!privacyConsent) {
      errors.privacyConsent = "请阅读并同意隐私政策";
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
      const res = await register({
        phone,
        password,
        nickname,
        privacyConsentVersion: PRIVACY_POLICY_VERSION,
      });
      setAuth(res.data.user, res.data.token);
      localStorage.setItem("token", res.data.token);
      toast.success("注册成功，欢迎加入邻里圈！");
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        const map: Record<string, string> = {};
        for (const fe of err.fieldErrors) {
          map[fe.field] = fe.message;
        }
        setFieldErrors(map);
      } else {
        const msg = err instanceof Error ? err.message : "注册失败";
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

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
            加入邻里圈
          </h1>
          <p className="text-white/70 text-sm tracking-wide">
            注册账号，开启温暖的邻里互助之旅
          </p>
        </div>

        {/* 表单：玻璃态卡片，与登录页一致；悬停轻提、焦点环细化 */}
        <form
          onSubmit={handleSubmit}
          className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 lg:p-8 space-y-4 animate-fade-in-up shadow-2xl transition-shadow duration-300 hover:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.5)]"
          style={{ animationDelay: "120ms" }}
        >
          {/* 昵称 */}
          <div>
            <label htmlFor="nickname" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              昵称
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 transition-colors" />
              <input
                id="nickname"
                type="text"
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, nickname: "" }));
                }}
                placeholder="给自己取个名字"
                autoComplete="nickname"
                className={`w-full pl-10 pr-3.5 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all ${
                  fieldErrors.nickname ? "border-red-400/70" : "border-white/20"
                }`}
              />
            </div>
            {fieldErrors.nickname && (
              <p className="mt-1.5 text-xs text-red-300">{fieldErrors.nickname}</p>
            )}
          </div>

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
                placeholder="请输入手机号"
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

          {/* 密码 */}
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-white/80 mb-2 tracking-wide">
              密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 transition-colors" />
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, password: "" }));
                }}
                placeholder="至少6位"
                autoComplete="new-password"
                className={`w-full pl-10 pr-10 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all ${
                  fieldErrors.password ? "border-red-400/70" : "border-white/20"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
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
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 transition-colors" />
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setFieldErrors((prev) => ({ ...prev, confirmPassword: "" }));
                }}
                placeholder="再次输入密码"
                autoComplete="new-password"
                className={`w-full pl-10 pr-10 py-3 bg-white/5 border rounded-xl text-white placeholder:text-white/40 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/40 focus:border-white/50 focus:shadow-[0_0_0_4px_rgba(255,255,255,0.06)] transition-all ${
                  fieldErrors.confirmPassword ? "border-red-400/70" : "border-white/20"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-all"
                aria-label={showConfirmPassword ? "隐藏密码" : "显示密码"}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {fieldErrors.confirmPassword && (
              <p className="mt-1.5 text-xs text-red-300">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          {/* 隐私政策 */}
          <div>
            <div className="flex items-start">
              <input
                type="checkbox"
                id="privacyConsent"
                checked={privacyConsent}
                onChange={(e) => {
                  setPrivacyConsent(e.target.checked);
                  setFieldErrors((prev) => ({ ...prev, privacyConsent: "" }));
                }}
                className="mt-1 h-4 w-4 rounded border-white/30 bg-white/5 text-emerald-500 focus:ring-emerald-500/40"
              />
              <label htmlFor="privacyConsent" className="ml-2 text-sm text-white/70">
                我已阅读并同意
                <Link
                  to="/privacy"
                  className="text-emerald-300 hover:text-emerald-200 ml-1"
                >
                  《隐私政策》
                </Link>
              </label>
            </div>
            {fieldErrors.privacyConsent && (
              <p className="mt-1 text-xs text-red-300">{fieldErrors.privacyConsent}</p>
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
                注册中...
              </span>
            ) : (
              <>
                立即注册
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <Link
            to="/login"
            className="flex items-center justify-center gap-1.5 text-sm text-white/60 hover:text-white transition-colors pt-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            已有账号？直接登录
          </Link>

          <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-white/40">
            <Shield className="w-3 h-3" />
            <span>您的数据已加密保护，符合隐私政策规范</span>
          </div>
        </form>

        {/* 注册福利提示 */}
        <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-emerald-300/80 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <Sparkles className="w-3 h-3" />
          注册即送 100 积分 + 60 分钟时间银行额度
        </div>
      </div>
    </div>
  );
}
