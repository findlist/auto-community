import { useEffect, useRef } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/Toast";
import { isTokenExpired } from "@/utils/jwt";

export default function ProtectedRoute() {
  const { isAuthenticated, token, logout } = useAuth();
  const hasWarned = useRef(false);

  // 过期预判：路由进入前主动校验 exp，避免带过期 token 进入受保护页面后才被 401 被动清理
  // 设计原因：isAuthenticated 在登录时被置 true 后会一直保存在 zustand persist 中，
  // 即使 token 已过期，守卫仍会放行；主动校验可及时清理登录态并引导用户重新登录
  const tokenExpired = isTokenExpired(token);

  useEffect(() => {
    if (tokenExpired) {
      // 过期场景：清理 zustand 状态，toast 提示一次
      logout();
      if (!hasWarned.current) {
        hasWarned.current = true;
        toast.warning("登录已过期，请重新登录");
      }
    } else if (!isAuthenticated && !hasWarned.current) {
      hasWarned.current = true;
      toast.warning("请先登录");
    }
  }, [isAuthenticated, tokenExpired, logout]);

  // 未认证或 token 已过期均跳转登录页
  if (!isAuthenticated || tokenExpired) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
