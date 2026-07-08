import client from "./client";
import type { ApiResponse } from "@/types";

// 地址数据类型
export interface Address {
  id: string;
  userId: string;
  recipient: string;
  phone: string;
  address: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAddressParams {
  recipient: string;
  phone: string;
  address: string;
  isDefault?: boolean;
}

export type UpdateAddressParams = Partial<CreateAddressParams>;

// 获取地址列表
export function getAddresses() {
  return client.get<never, ApiResponse<Address[]>>("/addresses");
}

// 创建地址
export function createAddress(data: CreateAddressParams) {
  return client.post<never, ApiResponse<Address>>("/addresses", data);
}

// 更新地址
export function updateAddress(id: string, data: UpdateAddressParams) {
  return client.put<never, ApiResponse<Address>>(`/addresses/${id}`, data);
}

// 删除地址
export function deleteAddress(id: string) {
  return client.delete<never, ApiResponse<null>>(`/addresses/${id}`);
}

// 设为默认地址
export function setDefaultAddress(id: string) {
  return client.put<never, ApiResponse<null>>(`/addresses/${id}/default`);
}
