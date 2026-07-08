/**
 * 业务错误码集中定义
 *
 * 统一约定：所有 code 均为字符串常量，便于前端按语义分支处理与国际化映射。
 * 与 HTTP 状态码解耦：同一状态码可对应多个业务 code，定位更精确。
 */

// 通用成功码（与 response.ts 中的 success/created 保持一致）
export const SUCCESS_CODE = 'SUCCESS' as const;
export const CREATED_CODE = 'CREATED' as const;

// 通用错误码（与 AppError 默认 code 对齐）
export const CommonErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

// 业务专用错误码：高频业务场景使用专用 code 便于前端精确处理
export const BusinessErrorCode = {
  // 余额不足：积分/时间币余额不足，无法完成支付或转账
  INSUFFICIENT_CREDIT: 'INSUFFICIENT_CREDIT',
  // 订单状态无效：当前订单状态不允许执行该操作
  ORDER_STATUS_INVALID: 'ORDER_STATUS_INVALID',
  // 权限不足：用户无权操作该资源（区别于未登录的 UNAUTHORIZED）
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  // 资源不存在：业务资源未找到（与通用 NOT_FOUND 等价，但语义更明确）
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  // 限流：触发了业务限流策略
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  // 注：VALIDATION_ERROR 已在 CommonErrorCode 中定义，此处不再重复
} as const;

// 错误码到 HTTP 状态码的映射，便于 AppError 子类构造时统一推导
export const errorCodeToStatus: Record<string, number> = {
  [CommonErrorCode.BAD_REQUEST]: 400,
  [CommonErrorCode.UNAUTHORIZED]: 401,
  [CommonErrorCode.FORBIDDEN]: 403,
  [CommonErrorCode.NOT_FOUND]: 404,
  [CommonErrorCode.CONFLICT]: 409,
  [CommonErrorCode.VALIDATION_ERROR]: 422,
  [CommonErrorCode.TOO_MANY_REQUESTS]: 429,
  [CommonErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [CommonErrorCode.DATABASE_ERROR]: 500,
  // 业务错误码对应的 HTTP 状态
  [BusinessErrorCode.INSUFFICIENT_CREDIT]: 400,
  [BusinessErrorCode.ORDER_STATUS_INVALID]: 400,
  [BusinessErrorCode.PERMISSION_DENIED]: 403,
  [BusinessErrorCode.RESOURCE_NOT_FOUND]: 404,
  [BusinessErrorCode.RATE_LIMIT_EXCEEDED]: 429,
};

export type ErrorCode = typeof CommonErrorCode | typeof BusinessErrorCode;
