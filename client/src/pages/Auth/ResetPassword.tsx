import { useState, useEffect, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "@/api/auth";
import { ApiError } from "@/api/client";

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
    setLoading(true);
    try {
      await resetPassword({ phone, code, password });
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

  if (success) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-emerald-500 text-5xl">✓</div>
          <h1 className="text-2xl font-bold text-gray-900">密码重置成功</h1>
          <p className="text-gray-600">
            您的密码已重置，请使用新密码登录。
            <br />
            即将跳转到登录页面...
          </p>
          <Link to="/login" className="text-emerald-500 hover:text-emerald-600">
            立即登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-8rem)] px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center text-gray-900">重置密码</h1>
        <p className="text-sm text-center text-gray-500">
          请输入验证码和新密码
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setFieldErrors(prev => ({ ...prev, phone: "" })); }}
            placeholder="请输入手机号"
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${fieldErrors.phone ? "border-red-500" : "border-gray-300"}`}
          />
          {fieldErrors.phone && <p className="mt-1 text-sm text-red-500">{fieldErrors.phone}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">验证码</label>
          <input
            type="text"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setFieldErrors(prev => ({ ...prev, code: "" })); }}
            placeholder="请输入6位验证码"
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${fieldErrors.code ? "border-red-500" : "border-gray-300"}`}
          />
          {fieldErrors.code && <p className="mt-1 text-sm text-red-500">{fieldErrors.code}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">新密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setFieldErrors(prev => ({ ...prev, password: "" })); }}
            placeholder="请输入新密码（至少6位）"
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${fieldErrors.password ? "border-red-500" : "border-gray-300"}`}
          />
          {fieldErrors.password && <p className="mt-1 text-sm text-red-500">{fieldErrors.password}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">确认密码</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setFieldErrors(prev => ({ ...prev, confirmPassword: "" })); }}
            placeholder="请再次输入新密码"
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${fieldErrors.confirmPassword ? "border-red-500" : "border-gray-300"}`}
          />
          {fieldErrors.confirmPassword && <p className="mt-1 text-sm text-red-500">{fieldErrors.confirmPassword}</p>}
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-50"
        >
          {loading ? "重置中..." : "重置密码"}
        </button>

        <p className="text-sm text-center text-gray-500">
          没收到验证码？
          <Link to="/forgot-password" className="text-emerald-500 hover:text-emerald-600 ml-1">
            重新获取
          </Link>
        </p>
      </form>
    </div>
  );
}