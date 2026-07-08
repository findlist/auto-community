import client from "./client";
import type { ApiResponse } from "@/types";

// AB 测试配置：字段统一 camelCase，由响应拦截器自动转换后端 snake_case
export interface ABTestConfig {
  id: number;
  testName: string;
  description: string;
  variants: Record<string, number>;
  status: string;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VariantAssignment {
  variant: string;
  testName: string;
}

export interface VariantStats {
  variant: string;
  eventCounts: Record<string, number>;
  totalEvents: number;
  conversionRate: number;
}

export interface TestResults {
  testName: string;
  variants: VariantStats[];
  totalParticipants: number;
}

export function getAllTests() {
  return client.get<never, ApiResponse<ABTestConfig[]>>("/ab-tests");
}

export function getTestConfig(testName: string) {
  return client.get<never, ApiResponse<ABTestConfig>>(`/ab-tests/${testName}/config`);
}

export function assignVariant(testName: string) {
  return client.post<never, ApiResponse<VariantAssignment>>(`/ab-tests/${testName}/assign`);
}

export function recordEvent(
  testName: string,
  eventType: string,
  variant: string,
  metadata?: Record<string, any>,
) {
  return client.post<never, ApiResponse<null>>(`/ab-tests/${testName}/event`, {
    eventType,
    variant,
    metadata,
  });
}

export function getTestResults(testName: string) {
  return client.get<never, ApiResponse<TestResults>>(`/ab-tests/${testName}/results`);
}
