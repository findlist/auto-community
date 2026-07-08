import client from "./client";
import type { ApiResponse, User } from "@/types";

export interface LoginParams {
  phone: string;
  password: string;
}

export interface RegisterParams {
  phone: string;
  password: string;
  nickname: string;
  privacyConsentVersion: string;
}

export interface ForgotPasswordParams {
  phone: string;
}

export interface ResetPasswordParams {
  phone: string;
  code: string;
  password: string;
}

export interface SimpleResetPasswordParams {
  phone: string;
  password: string;
}

export interface TokenData {
  token: string;
  refreshToken: string;
  user: User;
}

export function login(data: LoginParams) {
  return client.post<never, ApiResponse<TokenData>>("/auth/login", data);
}

export function register(data: RegisterParams) {
  return client.post<never, ApiResponse<TokenData>>("/auth/register", data);
}

export function refreshToken(refreshToken: string) {
  return client.post<never, ApiResponse<{ token: string; refreshToken: string }>>("/auth/refresh-token", { refreshToken });
}

export function logout() {
  return client.post<never, ApiResponse<null>>("/auth/logout");
}

export function forgotPassword(data: ForgotPasswordParams) {
  return client.post<never, ApiResponse<null>>("/auth/forgot-password", data);
}

export function resetPassword(data: ResetPasswordParams) {
  return client.post<never, ApiResponse<null>>("/auth/reset-password", data);
}

// 简化版重置密码：仅凭手机号 + 新密码，免验证码（适用于未接入短信服务的环境）
export function simpleResetPassword(data: SimpleResetPasswordParams) {
  return client.post<never, ApiResponse<null>>("/auth/simple-reset-password", data);
}
