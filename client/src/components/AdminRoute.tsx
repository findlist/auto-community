import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef } from "react";
import { toast } from "@/components/Toast";

export default function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const hasNoAccess = !isAuthenticated || user?.role !== "admin";
  const toastShown = useRef(false);

  useEffect(() => {
    if (hasNoAccess && !toastShown.current) {
      toastShown.current = true;
      toast.warning("无管理权限，已返回首页");
    }
  }, [hasNoAccess]);

  if (hasNoAccess) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
