import client from "./client";
import type { ApiResponse, PaginatedResponse, EmergencyRequest, EmergencyResponse, EmergencyResource } from "@/types";

export interface CreateRequestParams {
  type?: "emergency" | "daily";
  category: string;
  title: string;
  description: string;
  urgency?: "critical" | "high" | "medium" | "low";
  address?: string;
  location?: { lng: number; lat: number };
  contactPhone?: string;
  isAnonymous?: boolean;
  images?: string[];
}

export interface GetRequestsParams {
  type?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export function getRequests(params?: GetRequestsParams) {
  return client.get<never, ApiResponse<PaginatedResponse<EmergencyRequest>>>("/emergency/requests", { params });
}

export function getRequest(id: string) {
  return client.get<never, ApiResponse<EmergencyRequest>>(`/emergency/requests/${id}`);
}

export function createRequest(data: CreateRequestParams) {
  return client.post<never, ApiResponse<EmergencyRequest>>("/emergency/requests", data);
}

export interface RespondToRequestParams {
  message: string;
  eta?: number;
}

export function respondToRequest(requestId: string, data: RespondToRequestParams) {
  return client.post<never, ApiResponse<EmergencyResponse>>(`/emergency/requests/${requestId}/respond`, data);
}

export interface UpdateStatusParams {
  status: "arrived" | "completed";
  rating?: number;
  review?: string;
}

export function updateResponseStatus(responseId: string, data: UpdateStatusParams) {
  return client.put<never, ApiResponse<EmergencyResponse>>(`/emergency/responses/${responseId}/status`, data);
}

export function submitFalseReport(requestId: string, reason: string) {
  return client.post<never, ApiResponse<null>>("/emergency/false-reports", { requestId, reason });
}

export interface GetResourcesParams {
  type?: string;
  page?: number;
  pageSize?: number;
}

export function getResources(params?: GetResourcesParams) {
  return client.get<never, ApiResponse<PaginatedResponse<EmergencyResource>>>("/emergency/resources", { params });
}

export function getResource(id: string) {
  return client.get<never, ApiResponse<EmergencyResource>>(`/emergency/resources/${id}`);
}

// 地图相关 API
export interface GeocodeResult {
  lng: number;
  lat: number;
}

export function geocode(address: string) {
  return client.get<never, ApiResponse<GeocodeResult | null>>('/emergency/map/geocode', { params: { address } });
}

export function regeo(lng: number, lat: number) {
  return client.get<never, ApiResponse<string | null>>('/emergency/map/regeo', { params: { lng, lat } });
}
