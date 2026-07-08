import axios from "axios";
import { convertKeys, toCamelCase, toSnakeCase } from "./caseConverter";

// 扩展 Error 类以支持字段级错误
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly fieldErrors?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const client = axios.create({
  baseURL: "/api",
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // 请求方向：camelCase → snake_case，统一前后端字段命名
  // 设计原因：后端路由按 snake_case 解构请求体（如 duration_minutes），
  // 前端 TypeScript 接口用 camelCase（如 durationMinutes），无统一转换层易丢值
  // 注意：仅转换 request.data，不转换 request.params（query 命名不统一，避免破坏）
  if (config.data) {
    config.data = convertKeys(config.data, toSnakeCase);
  }
  return config;
});

client.interceptors.response.use(
  (response) => {
    // 响应方向：snake_case → camelCase，统一前后端字段命名
    // 仅转换普通对象，Blob/ArrayBuffer 等二进制响应（如 CSV 导出）原样返回
    response.data = convertKeys(response.data, toCamelCase);
    return response.data;
  },
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data;

    // 401 → 清除 token，跳转登录
    if (status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("auth-storage");
      window.location.href = "/login";
      return Promise.reject(new ApiError(data?.message || "登录已过期，请重新登录", 401));
    }

    // 提取字段级错误（422 验证错误）
    const fieldErrors = data?.errors?.map((e: any) => ({
      field: e.field || "unknown",
      message: e.message,
    }));

    const message = data?.message || "请求失败，请稍后重试";
    return Promise.reject(new ApiError(message, status ?? 500, fieldErrors));
  }
);

export default client;
