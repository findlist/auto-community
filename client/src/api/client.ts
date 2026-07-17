import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
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

// GET 请求重试配置：仅幂等的 GET 方法重试，5xx 与网络错误属于可恢复故障
// 设计原因：弱网/服务端瞬时抖动（5xx、连接重置）下，GET 请求自动重试 1-2 次可显著提升用户体验；
// POST/PUT/DELETE 不重试，避免非幂等操作重复执行造成数据不一致
const MAX_RETRY = 2;
const RETRY_BASE_DELAY_MS = 500;

// 通过模块扩展为 InternalAxiosRequestConfig 增加 _retryCount 字段
// 设计原因：axios 不原生支持重试计数，需在 config 上挂载自定义字段跟踪重试次数；
// 使用 declare module 比直接 (config as any)._retryCount 更安全，编译期可类型检查
declare module "axios" {
  interface InternalAxiosRequestConfig {
    _retryCount?: number;
  }
}

function isRetryableError(error: AxiosError): boolean {
  // 网络错误（无 response，如断网、DNS 失败、连接重置）或 5xx 服务端错误可重试
  // 4xx 客户端错误不可重试（401 鉴权、403 权限、404 资源不存在、422 参数校验等）
  if (!error.response) return true;
  const status = error.response.status;
  return status >= 500 && status < 600;
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
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig | undefined;
    // GET 请求重试：5xx 与网络错误为可恢复故障，幂等的 GET 方法重试可提升弱网体验
    // 设计原因：重试必须放在 401 处理之前，避免 5xx 错误误触 401 分支；
    // 401 本身为 4xx 不会被 isRetryableError 命中，重试分支不会影响鉴权失败逻辑
    if (config?.method === "get" && isRetryableError(error)) {
      const retryCount = config._retryCount ?? 0;
      if (retryCount < MAX_RETRY) {
        config._retryCount = retryCount + 1;
        // 指数退避：第 1 次重试等待 500ms，第 2 次等待 1000ms，避免服务端尚未恢复时连重试
        const delay = RETRY_BASE_DELAY_MS * config._retryCount;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return client.request(config);
      }
    }

    const status = error.response?.status;
    const data = error.response?.data as
      | { message?: string; errors?: Array<{ field?: string; message?: string }> }
      | undefined;

    // 401 → 清除 token，跳转登录
    if (status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("auth-storage");
      window.location.href = "/login";
      return Promise.reject(new ApiError(data?.message || "登录已过期，请重新登录", 401));
    }

    // 提取字段级错误（422 验证错误）
    // 后端返回的 errors 项结构不严格保证，用精准可选类型替代 any，
    // 强制编译期收窄访问，避免运行时因字段缺失导致 undefined 污染下游
    const fieldErrors = data?.errors?.map((e: { field?: string; message?: string }) => ({
      field: e.field || "unknown",
      message: e.message ?? "",
    }));

    // 无 response（网络错误/超时）时根据 error.code 区分错误类型，避免统一报 500 掩盖真实原因
    // 设计原因：axios 网络错误无 response.status，原 `status ?? 500` 会让前端误判为服务端 500，
    // 影响监控告警与用户错误提示。区分超时与网络错误可让用户得到更准确的反馈
    if (!status) {
      // axios timeout 错误 code 为 ECONNABORTED，对应 HTTP 408 语义
      if (error.code === "ECONNABORTED") {
        return Promise.reject(
          new ApiError(data?.message || "请求超时，请检查网络后重试", 408, fieldErrors)
        );
      }
      // axios 网络错误（DNS 失败、连接被拒、断网）code 为 ERR_NETWORK，对应 HTTP 503 语义
      if (error.code === "ERR_NETWORK") {
        return Promise.reject(
          new ApiError(data?.message || "网络连接失败，请检查网络", 503, fieldErrors)
        );
      }
    }

    const message = data?.message || "请求失败，请稍后重试";
    return Promise.reject(new ApiError(message, status ?? 500, fieldErrors));
  }
);

export default client;
