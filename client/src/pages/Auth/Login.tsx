import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Phone, Lock, Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";
import { login } from "@/api/auth";
import { ApiError } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/Toast";

export default function Login() {
  const navigate = useNavigate();
  const { login: setAuth } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;
    // 入口守卫：与按钮 disabled + 文案变化形成三重防御，避免 React 批处理延迟导致弱网下连点产生多次登录请求
    if (loading) return;
    setLoading(true);
    try {
      const res = await login({ phone, password });
      // setAuth 内部通过 zustand persist 自动同步到 localStorage["auth-storage"]
      // 设计原因：原实现同时手动 localStorage.setItem("token", ...) 形成双存储，
      // 两处独立写入非原子，存在不一致风险；统一由 store 作为唯一写入入口
      setAuth(res.data.user, res.data.token);
      toast.success("欢迎回来！");
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        const map: Record<string, string> = {};
        for (const fe of err.fieldErrors) {
          map[fe.field] = fe.message;
        }
        setFieldErrors(map);
      } else {
        const msg = err instanceof Error ? err.message : "登录失败";
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100svh-3.5rem)] lg:min-h-[calc(100svh-4rem)] flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* 氛围背景图：温暖的邻里生活一隅 */}
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
            邻里圈
          </h1>
          <p className="text-white/70 text-sm tracking-wide">
            登录后，遇见温暖的邻居
          </p>
        </div>

        {/* 表单：玻璃态卡片，克制边框，悬停轻提，焦点环细化 */}
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
                placeholder="请输入密码"
                autoComplete="current-password"
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
                登录中...
              </span>
            ) : (
              <>
                登录
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="flex items-center justify-between text-sm pt-1">
            <Link
              to="/forgot-password"
              className="text-white/60 hover:text-white transition-colors"
            >
              忘记密码？
            </Link>
            <Link
              to="/register"
              className="text-white font-medium hover:text-white/80 transition-colors"
            >
              立即注册 →
            </Link>
          </div>
        </form>

        {/* 底部标语 */}
        <p className="text-center text-white/40 text-xs mt-6 animate-fade-in-up" style={{ animationDelay: "240ms" }}>
          AI 智能推荐 · 三维匹配 · 温暖社区
        </p>
      </div>
    </div>
  );
}
