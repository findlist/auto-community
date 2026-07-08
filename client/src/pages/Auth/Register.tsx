import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Phone, Lock, User, ArrowRight, Heart, Sparkles, Eye, EyeOff, Shield } from "lucide-react";
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
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Logo & 标题 */}
        <div className="text-center mb-6 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-white shadow-lg mb-3">
            <Heart className="w-8 h-8" fill="currentColor" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-1">
            加入邻里圈
          </h1>
          <p className="text-sm text-[var(--color-text-tertiary)]">
            注册账号，开启温暖的邻里互助之旅
          </p>
        </div>

        {/* 表单卡片 */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-lg border border-[var(--color-border)] p-6 space-y-4 animate-fade-in-up"
          style={{ animationDelay: "100ms" }}
        >
          {/* 昵称 */}
          <div>
            <label htmlFor="nickname" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              昵称
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
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
                className={`w-full pl-10 pr-3 py-2.5 border rounded-lg bg-[var(--color-neutral-50)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20 transition-all ${
                  fieldErrors.nickname ? "border-[var(--color-error)]" : "border-[var(--color-border)]"
                }`}
              />
            </div>
            {fieldErrors.nickname && (
              <p className="mt-1 text-xs text-[var(--color-error)]">{fieldErrors.nickname}</p>
            )}
          </div>

          {/* 手机号 */}
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              手机号
            </label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
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
                className={`w-full pl-10 pr-3 py-2.5 border rounded-lg bg-[var(--color-neutral-50)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20 transition-all ${
                  fieldErrors.phone ? "border-[var(--color-error)]" : "border-[var(--color-border)]"
                }`}
              />
            </div>
            {fieldErrors.phone && (
              <p className="mt-1 text-xs text-[var(--color-error)]">{fieldErrors.phone}</p>
            )}
          </div>

          {/* 密码 */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
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
                className={`w-full pl-10 pr-10 py-2.5 border rounded-lg bg-[var(--color-neutral-50)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20 transition-all ${
                  fieldErrors.password ? "border-[var(--color-error)]" : "border-[var(--color-border)]"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-[var(--color-error)]">{fieldErrors.password}</p>
            )}
          </div>

          {/* 确认密码 */}
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
              确认密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" />
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
                className={`w-full pl-10 pr-10 py-2.5 border rounded-lg bg-[var(--color-neutral-50)] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/20 transition-all ${
                  fieldErrors.confirmPassword ? "border-[var(--color-error)]" : "border-[var(--color-border)]"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {fieldErrors.confirmPassword && (
              <p className="mt-1 text-xs text-[var(--color-error)]">{fieldErrors.confirmPassword}</p>
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
                className="mt-1 h-4 w-4 text-[var(--color-primary-500)] border-[var(--color-border)] rounded focus:ring-[var(--color-primary-500)]"
              />
              <label htmlFor="privacyConsent" className="ml-2 text-sm text-[var(--color-text-secondary)]">
                我已阅读并同意
                <Link
                  to="/privacy"
                  className="text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)] ml-1"
                >
                  《隐私政策》
                </Link>
              </label>
            </div>
            {fieldErrors.privacyConsent && (
              <p className="mt-1 text-xs text-[var(--color-error)]">{fieldErrors.privacyConsent}</p>
            )}
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[var(--color-error)]/10 text-[var(--color-error)] text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-gradient-to-r from-[var(--color-primary-500)] to-[var(--color-primary-600)] text-white rounded-lg font-medium shadow-md hover:shadow-lg hover:from-[var(--color-primary-600)] hover:to-[var(--color-primary-700)] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-1"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                注册中...
              </span>
            ) : (
              <>
                立即注册
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-sm text-center text-[var(--color-text-tertiary)] pt-1">
            已有账号？
            <Link
              to="/login"
              className="text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)] font-medium ml-1"
            >
              直接登录
            </Link>
          </p>

          <div className="flex items-center justify-center gap-1.5 pt-2 text-xs text-[var(--color-text-tertiary)]">
            <Shield className="w-3 h-3" />
            <span>您的数据已加密保护，符合隐私政策规范</span>
          </div>
        </form>

        {/* 注册福利提示 */}
        <div className="flex items-center justify-center gap-1.5 mt-4 text-xs text-[var(--color-text-tertiary)] animate-fade-in-up" style={{ animationDelay: "200ms" }}>
          <Sparkles className="w-3 h-3" />
          注册即送 100 积分 + 60 分钟时间银行额度
        </div>
      </div>
    </div>
  );
}
