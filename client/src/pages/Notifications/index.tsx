import { useState, useEffect, useCallback } from "react";
import { Bell, Package, Siren, AlertTriangle, Info, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from "@/api/notifications";
import type { Notification, NotificationType } from "@/types";
import { formatDate } from "@/utils/format";
import { toast } from "@/components/Toast";

// 通知类型图标映射
const NOTIFICATION_ICONS: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  order_status: Package,
  emergency_response: Siren,
  report_result: AlertTriangle,
  system: Info,
};

// 通知类型颜色映射
const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  order_status: "text-blue-500 bg-blue-50",
  emergency_response: "text-red-500 bg-red-50",
  report_result: "text-orange-500 bg-orange-50",
  system: "text-gray-500 bg-gray-50",
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // 加载通知列表
  const loadNotifications = useCallback(async (pageNum: number) => {
    setLoading(true);
    try {
      const res = await getNotifications(pageNum, 20);
      if (pageNum === 1) {
        setNotifications(res.data.list);
      } else {
        setNotifications((prev) => [...prev, ...res.data.list]);
      }
      setHasMore(res.data.hasNext);
    } catch (err) {
      console.error("加载通知失败:", err);
      toast.error("加载通知失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载未读数量
  const loadUnreadCount = useCallback(async () => {
    try {
      const res = await getUnreadCount();
      setUnreadCount(res.data.unreadCount);
    } catch (err) {
      console.error("加载未读数量失败:", err);
    }
  }, []);

  // 初始化加载
  useEffect(() => {
    loadNotifications(1);
    loadUnreadCount();
  }, [loadNotifications, loadUnreadCount]);

  // 加载更多
  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadNotifications(nextPage);
  };

  // 标记单条已读
  const handleMarkRead = async (notification: Notification) => {
    if (notification.readAt) return;
    try {
      await markAsRead(notification.id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id ? { ...n, readAt: new Date().toISOString() } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("标记已读失败:", err);
      toast.error("标记已读失败");
    }
  };

  // 全部标记已读
  const handleMarkAllRead = async () => {
    try {
      await markAllAsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (err) {
      console.error("全部标记已读失败:", err);
      toast.error("操作失败，请稍后重试");
    }
  };

  // 获取跳转路径
  const getNotificationLink = (notification: Notification): string | null => {
    if (!notification.referenceId || !notification.referenceType) return null;
    switch (notification.referenceType) {
      case "skill_order":
        return `/skills/orders`;
      case "kitchen_order":
        return `/kitchen/orders`;
      case "emergency_request":
        return `/emergency/${notification.referenceId}`;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-4">
      {/* 头部 */}
      <header className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-gray-500">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-lg font-semibold">通知中心</h1>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="text-sm text-emerald-600 hover:text-emerald-700"
            >
              全部已读
            </button>
          )}
        </div>
      </header>

      {/* 通知列表 */}
      <div className="max-w-lg mx-auto">
        {loading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Bell className="w-12 h-12 mb-4" />
            <p>暂无通知</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-100">
              {notifications.map((notification) => {
                const Icon = NOTIFICATION_ICONS[notification.type];
                const colorClass = NOTIFICATION_COLORS[notification.type];
                const link = getNotificationLink(notification);
                const isUnread = !notification.readAt;

                return (
                  <li
                    key={notification.id}
                    className={`bg-white ${isUnread ? "bg-opacity-95" : "bg-opacity-80"}`}
                  >
                    <div
                      className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                      onClick={() => handleMarkRead(notification)}
                    >
                      {/* 图标 */}
                      <div className={`p-2 rounded-full ${colorClass}`}>
                        <Icon className="w-5 h-5" />
                      </div>

                      {/* 内容 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className={`font-medium truncate ${isUnread ? "text-gray-900" : "text-gray-600"}`}>
                            {notification.title}
                          </h3>
                          {isUnread && (
                            <span className="w-2 h-2 bg-red-500 rounded-full" />
                          )}
                        </div>
                        {notification.content && (
                          <p className={`mt-1 text-sm ${isUnread ? "text-gray-700" : "text-gray-500"}`}>
                            {notification.content}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-400">
                          {formatDate(notification.createdAt)}
                        </p>
                      </div>

                      {/* 操作 */}
                      {link && (
                        <Link
                          to={link}
                          className="text-sm text-emerald-600 hover:text-emerald-700 whitespace-nowrap"
                        >
                          查看
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* 加载更多 */}
            {hasMore && (
              <div className="flex justify-center py-4">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-emerald-600 hover:text-emerald-700 disabled:text-gray-400"
                >
                  {loading ? "加载中..." : "加载更多"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}