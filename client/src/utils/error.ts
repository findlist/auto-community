import { ApiError } from "@/api/client";

/**
 * 从未知错误中提取用户可读的错误信息
 *
 * 设计原因：
 * 1. axios 拦截器已将所有 HTTP 错误统一转换为 ApiError（含 message 字段），
 *    消费方不应再访问 err.response.data.message（该路径在 ApiError 上不存在，永远走 fallback）
 * 2. TypeScript 5+ catch 子句默认 unknown，强制类型收窄避免 any 逃逸
 * 3. 兼容三种来源：ApiError（业务错误）、原生 Error（JS 异常）、其他（未知）
 *
 * @param err catch 块中的未知错误
 * @param fallback 兜底文案，所有路径都无法提取时返回
 */
export function getErrorMessage(err: unknown, fallback = "操作失败，请稍后重试"): string {
  // 业务错误优先：ApiError 已携带后端返回的 message
  if (err instanceof ApiError) {
    return err.message || fallback;
  }
  // 原生 Error：取 message，空则走 fallback
  if (err instanceof Error) {
    return err.message || fallback;
  }
  // 字符串错误：非空直接返回，空串走 fallback（无意义提示不如兜底文案）
  if (typeof err === "string") {
    return err || fallback;
  }
  return fallback;
}
