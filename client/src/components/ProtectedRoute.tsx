import { useEffect, useRef } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/Toast";

export default function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const hasWarned = useRef(false);

  useEffect(() => {
    if (!isAuthenticated && !hasWarned.current) {
      hasWarned.current = true;
      toast.warning("请先登录");
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
