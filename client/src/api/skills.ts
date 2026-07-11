import client from "./client";
import type { ApiResponse, PaginatedResponse, SkillPost, SkillOrder } from "@/types";

export interface CreatePostParams {
  type: "offer" | "request";
  title: string;
  description: string;
  category: string;
  creditPrice: number;
  location?: string;
  images?: string[];
}

export interface UpdatePostParams extends Partial<CreatePostParams> {
  id: string;
}

export interface GetPostsParams {
  type?: "offer" | "request";
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export function getPosts(params?: GetPostsParams) {
  return client.get<never, ApiResponse<PaginatedResponse<SkillPost>>>("/skills/posts", { params });
}

export function getPost(id: string) {
  return client.get<never, ApiResponse<SkillPost>>(`/skills/posts/${id}`);
}

export function createPost(data: CreatePostParams) {
  return client.post<never, ApiResponse<SkillPost>>("/skills/posts", data);
}

export function updatePost(data: UpdatePostParams) {
  return client.put<never, ApiResponse<SkillPost>>(`/skills/posts/${data.id}`, data);
}

export function deletePost(id: string) {
  return client.delete<never, ApiResponse<null>>(`/skills/posts/${id}`);
}

export interface CreateOrderParams {
  postId: string;
}

export function createOrder(data: CreateOrderParams) {
  return client.post<never, ApiResponse<SkillOrder>>("/skills/orders", data);
}

export function getOrders(params?: { page?: number; pageSize?: number }) {
  return client.get<never, ApiResponse<PaginatedResponse<SkillOrder>>>("/skills/orders", { params });
}

export function updateOrderStatus(orderId: string, status: string) {
  return client.put<never, ApiResponse<SkillOrder>>(`/skills/orders/${orderId}/status`, { status });
}

// 发起争议：买家或卖家在订单进行中可发起争议
export function disputeOrder(orderId: string, reason: string) {
  return client.post<never, ApiResponse<SkillOrder>>(`/skills/orders/${orderId}/dispute`, { reason });
}

// 获取订单详情（含争议信息）
export function getOrder(orderId: string) {
  return client.get<never, ApiResponse<SkillOrder>>(`/skills/orders/${orderId}`);
}

// 管理员裁决争议：action ∈ refund(退款) | continue(继续) | cancel(取消)
export function resolveDispute(orderId: string, resolution: string, action: "refund" | "continue" | "cancel") {
  return client.put<never, ApiResponse<SkillOrder>>(`/skills/orders/${orderId}/resolve`, { resolution, action });
}
