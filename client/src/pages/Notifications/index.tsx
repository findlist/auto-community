import { useState, useEffect, useCallback, useRef } from "react";
import { Bell, Package, Siren, AlertTriangle, Info, ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from "@/api/notifications";
import type { Notification, NotificationType } from "@/types";
import { formatDate } from "@/utils/format";
import Empty from "@/components/Empty";
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

  // 竞态守卫：跟踪当前活跃的请求标识（页码），快速切换/重新挂载时旧请求返回不再覆盖新数据
  // 设计原因：loadNotifications 在 page 1 时替换列表，page > 1 时追加列表，
  // 旧请求返回慢时会覆盖新请求的数据（page 1 请求覆盖已追加的 page 2+ 数据）
  // 正常使用场景下 page 1 完成后才能触发 page 2（disabled={loading} 防护），不会互相取消
  const activeRequestKeyRef = useRef<string>("");

  // 加载通知列表
  const loadNotifications = useCallback(async (pageNum: number) => {
    // 闭包捕获当前请求标识，await 后比对是否仍为最新请求
    const requestKey = `${pageNum}`;
    activeRequestKeyRef.current = requestKey;
    setLoading(true);
    try {
      const res = await getNotifications(pageNum, 20);
      // 竞态守卫：await 期间若有更新的请求触发，跳过 setState 避免旧数据覆盖新数据
      if (activeRequestKeyRef.current !== requestKey) return;
      if (pageNum === 1) {
        setNotifications(res.data.list);
      } else {
        setNotifications((prev) => [...prev, ...res.data.list]);
      }
      setHasMore(res.data.hasNext);
    } catch (err) {
      if (activeRequestKeyRef.current !== requestKey) return;
      console.error("加载通知失败:", err);
      toast.error("加载通知失败，请稍后重试");
    } finally {
      // 仅当前活跃请求才清除 loading，避免旧请求 finally 误刷新请求的 loading 状态
      if (activeRequestKeyRef.current === requestKey) {
        setLoading(false);
      }
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
              className="text-sm text-emerald-600 hover:text-emerald-700 py-1.5 px-2 -mr-2 rounded hover:bg-emerald-50 transition-colors"
            >
              全部已读
            </button>
          )}
        </div>
      </header>

      {/* 通知列表：max-w-2xl 与项目其他列表页保持一致，避免比其他页面更窄 */}
      <div className="max-w-2xl mx-auto">
        {loading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : notifications.length === 0 ? (
          <Empty title="暂无通知" description="新消息会在这里显示" icon={<Bell className="w-16 h-16" />} />
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
                          <p className={`mt-1 text-sm line-clamp-2 ${isUnread ? "text-gray-700" : "text-gray-500"}`}>
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