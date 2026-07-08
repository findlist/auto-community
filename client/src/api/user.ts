import client from "./client";
import type { ApiResponse, PaginatedResponse, CreditTransaction, User } from "@/types";

// 实名认证状态
export interface VerificationStatus {
  verifyStatus: 'pending' | 'approved' | 'rejected' | null;
  submittedAt: string | null;
  request: {
    id: string;
    realName: string;
    status: 'pending' | 'approved' | 'rejected';
    rejectReason: string | null;
    createdAt: string;
    reviewedAt: string | null;
  } | null;
}

// 更新用户资料参数：昵称与头像均可选，至少传一项
export interface UpdateProfileParams {
  nickname?: string;
  avatar?: string;
}

// 更新当前用户资料（昵称/头像）
export function updateProfile(data: UpdateProfileParams) {
  return client.put<never, ApiResponse<User>>("/users/profile", data);
}

// 注销申请状态
export interface DeletionRequestStatus {
  id: string;
  userId: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  reason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerNickname: string | null;
  completedAt: string | null;
}

// 提交实名认证申请参数
export interface SubmitVerificationParams {
  realName: string;
  idCard: string;
}

// 提交注销申请参数
export interface SubmitDeletionParams {
  reason?: string;
}

// 提交实名认证申请
export function submitVerification(data: SubmitVerificationParams) {
  return client.post<never, ApiResponse<{ status: string; message: string }>>("/users/verify", data);
}

// 获取实名认证状态
export function getVerificationStatus() {
  return client.get<never, ApiResponse<VerificationStatus>>("/users/verify/status");
}

// 提交账号注销申请
export function submitDeletionRequest(data: SubmitDeletionParams) {
  return client.post<never, ApiResponse<{ id: string; status: string; message: string }>>("/users/deletion", data);
}

// 获取账号注销申请状态
export function getDeletionRequestStatus() {
  return client.get<never, ApiResponse<DeletionRequestStatus | null>>("/users/deletion/status");
}

// 取消账号注销申请
export function cancelDeletionRequest() {
  return client.delete<never, ApiResponse<null>>("/users/deletion");
}

// 获取积分历史明细（分页）
export function getCreditHistory(page: number = 1, pageSize: number = 20) {
  return client.get<never, ApiResponse<PaginatedResponse<CreditTransaction>>>(
    "/users/credit-history",
    { params: { page, pageSize } },
  );
}