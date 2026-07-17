import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef } from "react";
import { toast } from "@/components/Toast";
import { isTokenExpired } from "@/utils/jwt";

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user, token, logout } = useAuth();
  // 过期预判：与 ProtectedRoute 同步，避免管理员页面带过期 token 进入
  const tokenExpired = isTokenExpired(token);
  const hasNoAccess = !isAuthenticated || tokenExpired || user?.role !== "admin";
  const toastShown = useRef(false);

  useEffect(() => {
    if (hasNoAccess && !toastShown.current) {
      toastShown.current = true;
      // 区分提示文案：过期场景提示重新登录，权限不足场景提示无权限
      if (tokenExpired) {
        logout();
        toast.warning("登录已过期，请重新登录");
      } else {
        toast.warning("无管理权限，已返回首页");
      }
    }
  }, [hasNoAccess, tokenExpired, logout]);

  if (hasNoAccess) {
    // 仅 token 过期跳登录页要求重新登录；未认证与权限不足均跳首页（保留原行为）
    // 设计原因：AdminRoute 兜底比 ProtectedRoute 更宽容，未认证访问 /admin 不强制跳登录
    if (tokenExpired) {
      return <Navigate to="/login" replace />;
    }
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
