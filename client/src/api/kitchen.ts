import client from "./client";
import type { ApiResponse, PaginatedResponse, KitchenPost, KitchenOrder, GroupOrder, FoodReview } from "@/types";

// ==================== 美食分享 API ====================

export interface CreateFoodShareParams {
  type: "offer" | "need";
  title: string;
  description?: string;
  category: string;
  price?: number;
  quantity: number;
  pickupTime?: string;
  pickupLocation?: string;
  pickupType?: "self_pickup" | "delivery";
  images?: string[];
  allergens?: string[];
  healthCert?: boolean;
}

export interface UpdateFoodShareParams extends Partial<CreateFoodShareParams> {
  id: string;
}

export interface GetFoodSharesParams {
  type?: "offer" | "need";
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export function getFoodShares(params?: GetFoodSharesParams) {
  return client.get<never, ApiResponse<PaginatedResponse<KitchenPost>>>("kitchen/posts", { params });
}

export function getFoodShareById(id: string) {
  return client.get<never, ApiResponse<KitchenPost>>(`kitchen/posts/${id}`);
}

export function createFoodShare(data: CreateFoodShareParams) {
  return client.post<never, ApiResponse<KitchenPost>>("kitchen/posts", data);
}

export function updateFoodShare(data: UpdateFoodShareParams) {
  return client.put<never, ApiResponse<KitchenPost>>(`kitchen/posts/${data.id}`, data);
}

export function deleteFoodShare(id: string) {
  return client.delete<never, ApiResponse<null>>(`kitchen/posts/${id}`);
}

// ==================== 订单 API ====================

export interface CreateFoodOrderParams {
  postId: string;
  quantity: number;
  pickupType?: "self_pickup" | "delivery";
  pickupTime?: string;
  deliveryAddress?: string;
  remark?: string;
}

export interface CompleteFoodOrderParams {
  rating: number;
  content?: string;
}

export function getFoodOrders(params?: { role?: "buyer" | "seller"; status?: string; page?: number; pageSize?: number }) {
  return client.get<never, ApiResponse<PaginatedResponse<KitchenOrder>>>("kitchen/orders", { params });
}

export function createFoodOrder(data: CreateFoodOrderParams) {
  return client.post<never, ApiResponse<KitchenOrder>>("kitchen/orders", data);
}

export function confirmFoodOrder(id: string) {
  return client.put<never, ApiResponse<KitchenOrder>>(`kitchen/orders/${id}/confirm`);
}

export function completeFoodOrder(id: string, data: CompleteFoodOrderParams) {
  return client.put<never, ApiResponse<KitchenOrder>>(`kitchen/orders/${id}/complete`, data);
}

export function cancelFoodOrder(id: string) {
  return client.put<never, ApiResponse<KitchenOrder>>(`kitchen/orders/${id}/cancel`);
}

// ==================== 拼单 API ====================

export interface CreateGroupOrderParams {
  title: string;
  description?: string;
  targetAmount: number;
  minParticipants: number;
  maxParticipants: number;
  address: string;
  deadline: string;
}

export function getGroupOrders(params?: { status?: string; page?: number; pageSize?: number }) {
  return client.get<never, ApiResponse<PaginatedResponse<GroupOrder>>>("kitchen/group-orders", { params });
}

export function getGroupOrderById(id: string) {
  return client.get<never, ApiResponse<GroupOrder>>(`kitchen/group-orders/${id}`);
}

export function createGroupOrder(data: CreateGroupOrderParams) {
  return client.post<never, ApiResponse<GroupOrder>>("kitchen/group-orders", data);
}

export function joinGroupOrder(id: string, amount: number) {
  return client.post<never, ApiResponse<{ id: string; currentAmount: number; currentParticipants: number; status: string }>>(`kitchen/group-orders/${id}/join`, { amount });
}

// ==================== 评价 API ====================

export function getFoodReviews(params?: { userId?: string; page?: number; pageSize?: number }) {
  return client.get<never, ApiResponse<PaginatedResponse<FoodReview>>>("kitchen/reviews", { params });
}
