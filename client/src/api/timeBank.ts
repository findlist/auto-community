import client from "./client";
import type { ApiResponse, PaginatedResponse, CursorPaginatedResponse, TimeService, TimeOrder, ServiceDispute, TimeAccount, TimeTransaction, FamilyBinding, Review } from "@/types";

export interface CreateServiceParams {
  type: "provide" | "request";
  title: string;
  description: string;
  category: string;
  durationMinutes: number;
  location?: string;
  // 服务配图：可选，由 ImageUpload 组件上传后传入，空数组转为 undefined 避免发送空数组
  images?: string[];
}

export interface UpdateServiceParams extends Partial<CreateServiceParams> {
  id: string;
  // 编辑服务时更新 address 列：后端 UPDATABLE_SERVICE_FIELDS 白名单含 address
  // 设计原因：CreateServiceParams 用 location 创建，但 updateService 白名单用 address，字段命名需对齐后端
  address?: string;
}

export interface GetServicesParams {
  type?: "provide" | "request";
  category?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export function getServices(params?: GetServicesParams) {
  return client.get<never, ApiResponse<PaginatedResponse<TimeService>>>("/time-bank/services", { params });
}

export function getService(id: string) {
  return client.get<never, ApiResponse<TimeService>>(`/time-bank/services/${id}`);
}

export function createService(data: CreateServiceParams) {
  // 字段命名转换由 axios 请求拦截器统一处理（camelCase → snake_case），此处直传即可
  return client.post<never, ApiResponse<TimeService>>("/time-bank/services", data);
}

export function updateService(data: UpdateServiceParams) {
  // 字段命名转换由 axios 请求拦截器统一处理（camelCase → snake_case），此处直传即可
  return client.put<never, ApiResponse<TimeService>>(`/time-bank/services/${data.id}`, data);
}

export interface CreateOrderParams {
  serviceId: string;
}

export function createOrder(data: CreateOrderParams) {
  return client.post<never, ApiResponse<TimeOrder>>("/time-bank/orders", data);
}

export function getOrders(params?: { page?: number; pageSize?: number }) {
  return client.get<never, ApiResponse<PaginatedResponse<TimeOrder>>>("/time-bank/orders", { params });
}

// 状态值映射：前端状态名词 → 后端 action 动词
// 后端 PUT /time-bank/orders/:id/status 期望 body.action 为 accept/start/cancel/complete，
// 前端 MyOrders 传入状态名词（accepted/in_progress/cancelled/completed），需转换
const STATUS_TO_ACTION: Record<string, string> = {
  accepted: 'accept',
  in_progress: 'start',
  completed: 'complete',
  cancelled: 'cancel',
};

export function updateOrderStatus(orderId: string, status: string, actualDuration?: number) {
  const action = STATUS_TO_ACTION[status] ?? status;
  return client.put<never, ApiResponse<TimeOrder>>(`/time-bank/orders/${orderId}/status`, { action, actualDuration });
}

export interface CreateDisputeParams {
  orderId: string;
  reason: string;
  evidence?: string[];
}

export function createDispute(data: CreateDisputeParams) {
  return client.post<never, ApiResponse<ServiceDispute>>("/time-bank/disputes", data);
}

export function getAccount() {
  return client.get<never, ApiResponse<TimeAccount>>("/time-bank/account");
}

export function transferTime(toUserId: string, amount: number, remark?: string) {
  return client.post<never, ApiResponse<TimeTransaction>>("/time-bank/transfer", { toUserId, amount, remark });
}

/**
 * 时间币捐赠：将时间币无偿赠予其他用户。
 * 与 transferTime 的差异：后端流水 type='donate'，且不计入接收方 total_earned（不污染日收益上限）。
 */
export function donateTime(toUserId: string, amount: number, remark?: string) {
  return client.post<never, ApiResponse<TimeTransaction>>("/time-bank/donate", { toUserId, amount, remark });
}

// 游标分页：使用 lastId 作为游标，第一页时 cursor 为空
export function getTransactions(cursor?: string, limit = 20) {
  return client.get<never, ApiResponse<CursorPaginatedResponse<TimeTransaction>>>("/time-bank/transactions", {
    params: { cursor, limit },
  });
}

export function createFamilyBinding(parentPhone: string, relationship: string) {
  return client.post<never, ApiResponse<FamilyBinding>>("/time-bank/family", { parentPhone, relationship });
}

export function confirmFamilyBinding(id: string) {
  return client.put<never, ApiResponse<FamilyBinding>>(`/time-bank/family/${id}/confirm`);
}

export function rejectFamilyBinding(id: string) {
  return client.put<never, ApiResponse<FamilyBinding>>(`/time-bank/family/${id}/reject`);
}

// 解绑亲情绑定：仅已确认的绑定可解绑，双方均可发起
export function unbindFamilyBinding(id: string) {
  return client.put<never, ApiResponse<FamilyBinding>>(`/time-bank/family/${id}/unbind`);
}

export function getFamilyBindings() {
  return client.get<never, ApiResponse<FamilyBinding[]>>("/time-bank/family");
}

export function createReview(orderId: string, rating: number, content?: string) {
  return client.post<never, ApiResponse<Review>>("/time-bank/reviews", { orderId, rating, content });
}

export function getDisputes(params?: { page?: number; pageSize?: number }) {
  return client.get<never, ApiResponse<PaginatedResponse<ServiceDispute>>>("/time-bank/disputes", { params });
}
