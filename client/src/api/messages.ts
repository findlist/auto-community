import client from "./client";
import type { ApiResponse, CursorPaginatedResponse, Message } from "@/types";

// 支持的订单类型，与后端 OrderType 保持一致
export type OrderType = "skill" | "kitchen" | "time" | "emergency";

// 游标分页：使用 lastId 作为游标，第一页时 cursor 为空
export function getMessages(orderId: string, cursor?: string, limit = 50, orderType: OrderType = "skill") {
  return client.get<never, ApiResponse<CursorPaginatedResponse<Message>>>("/messages", {
    params: {
      order_id: orderId,
      order_type: orderType,
      cursor,
      limit,
    },
  });
}

export function markMessagesAsRead(orderId: string, orderType: OrderType = "skill") {
  return client.post<never, ApiResponse<null>>("/messages/read", {
    order_id: orderId,
    order_type: orderType,
  });
}

export function getUnreadCount(orderType?: OrderType) {
  return client.get<never, ApiResponse<{ unreadCount: number }>>("/messages/unread-count", {
    params: orderType ? { order_type: orderType } : {},
  });
}
