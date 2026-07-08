import { BusinessErrorCode, CommonErrorCode, errorCodeToStatus } from './errorCodes';

/**
 * 参数校验错误项：用于 AppError.errors 与响应体 errors 字段。
 * 设计原因：原 errors?: any[] 让调用方无所适从，统一为 FieldError[] 后，
 * errorHandler 与 validator 共享同一份契约，避免类型漂移。
 * value 用 unknown 而非 any：API 边界入参类型不定，用 unknown 强制消费方类型收窄。
 * 命名为 FieldError 而非 ValidationError：避免与本文件下方的 ValidationError 类冲突。
 */
export interface FieldError {
  field: string;
  message: string;
  value?: unknown;
}

// 基础应用错误：code 统一为字符串
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly errors?: FieldError[];

  constructor(message: string, statusCode: number = 500, code?: string, errors?: FieldError[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || this.getDefaultCode(statusCode);
    this.errors = errors;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  private getDefaultCode(statusCode: number): string {
    const codeMap: Record<number, string> = {
      400: CommonErrorCode.BAD_REQUEST,
      401: CommonErrorCode.UNAUTHORIZED,
      403: CommonErrorCode.FORBIDDEN,
      404: CommonErrorCode.NOT_FOUND,
      409: CommonErrorCode.CONFLICT,
      422: CommonErrorCode.VALIDATION_ERROR,
      429: CommonErrorCode.TOO_MANY_REQUESTS,
      500: CommonErrorCode.INTERNAL_SERVER_ERROR
    };
    return codeMap[statusCode] || CommonErrorCode.INTERNAL_SERVER_ERROR;
  }
}

// 400 错误请求
export class BadRequestError extends AppError {
  constructor(message: string = '请求参数错误', errors?: FieldError[]) {
    super(message, 400, CommonErrorCode.BAD_REQUEST, errors);
  }
}

// 401 未授权
export class UnauthorizedError extends AppError {
  constructor(message: string = '未授权访问') {
    super(message, 401, CommonErrorCode.UNAUTHORIZED);
  }
}

// 403 禁止访问
export class ForbiddenError extends AppError {
  constructor(message: string = '无权限执行此操作') {
    super(message, 403, CommonErrorCode.FORBIDDEN);
  }
}

// 404 资源不存在
export class NotFoundError extends AppError {
  constructor(resource: string = '资源') {
    super(`${resource}不存在`, 404, CommonErrorCode.NOT_FOUND);
  }
}

// 409 冲突
export class ConflictError extends AppError {
  constructor(message: string = '数据冲突') {
    super(message, 409, CommonErrorCode.CONFLICT);
  }
}

// 422 验证错误
export class ValidationError extends AppError {
  constructor(message: string = '参数验证失败', errors?: FieldError[]) {
    super(message, 422, CommonErrorCode.VALIDATION_ERROR, errors);
  }
}

// 429 请求过多
export class TooManyRequestsError extends AppError {
  constructor(message: string = '请求过于频繁，请稍后再试') {
    super(message, 429, CommonErrorCode.TOO_MANY_REQUESTS);
  }
}

// 500 服务器内部错误
export class InternalError extends AppError {
  constructor(message: string = '服务器内部错误') {
    super(message, 500, CommonErrorCode.INTERNAL_SERVER_ERROR);
  }
}

// ==================== 业务专用错误 ====================
// 高频业务错误使用专用 code，便于前端按语义分支处理

// 余额不足：积分/时间币余额不足
export class InsufficientCreditError extends AppError {
  constructor(message: string = '余额不足') {
    super(message, errorCodeToStatus[BusinessErrorCode.INSUFFICIENT_CREDIT], BusinessErrorCode.INSUFFICIENT_CREDIT);
  }
}

// 订单状态无效：当前订单状态不允许执行该操作
export class OrderStatusInvalidError extends AppError {
  constructor(message: string = '订单状态不允许此操作') {
    super(message, errorCodeToStatus[BusinessErrorCode.ORDER_STATUS_INVALID], BusinessErrorCode.ORDER_STATUS_INVALID);
  }
}

// 权限不足：用户无权操作该资源
export class PermissionDeniedError extends AppError {
  constructor(message: string = '无权限执行此操作') {
    super(message, errorCodeToStatus[BusinessErrorCode.PERMISSION_DENIED], BusinessErrorCode.PERMISSION_DENIED);
  }
}

// 资源不存在：业务资源未找到
export class ResourceNotFoundError extends AppError {
  constructor(resource: string = '资源') {
    super(`${resource}不存在`, errorCodeToStatus[BusinessErrorCode.RESOURCE_NOT_FOUND], BusinessErrorCode.RESOURCE_NOT_FOUND);
  }
}

// 限流：触发了业务限流策略
export class RateLimitExceededError extends AppError {
  constructor(message: string = '请求过于频繁，请稍后再试') {
    super(message, errorCodeToStatus[BusinessErrorCode.RATE_LIMIT_EXCEEDED], BusinessErrorCode.RATE_LIMIT_EXCEEDED);
  }
}
