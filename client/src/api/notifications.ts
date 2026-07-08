import client from "./client";
import type { ApiResponse, PaginatedResponse, Notification } from "@/types";

// 获取通知列表
export function getNotifications(page = 1, pageSize = 20) {
  return client.get<never, ApiResponse<PaginatedResponse<Notification>>>("/notifications", {
    params: { page, pageSize },
  });
}

// 获取未读通知数量
export function getUnreadCount() {
  return client.get<never, ApiResponse<{ unreadCount: number }>>("/notifications/unread-count");
}

// 标记单条通知已读
export function markAsRead(notificationId: string) {
  return client.post<never, ApiResponse<null>>(`/notifications/${notificationId}/read`);
}

// 标记所有通知已读
export function markAllAsRead() {
  return client.post<never, ApiResponse<{ markedCount: number }>>("/notifications/read-all");
}