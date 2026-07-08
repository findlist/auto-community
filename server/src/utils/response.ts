import { Response } from 'express';
import { SUCCESS_CODE, CREATED_CODE, errorCodeToStatus } from './errorCodes';
import { FieldError } from './errors';

// 成功响应：code 统一为字符串 'SUCCESS'，与错误响应的字符串 code 类型保持一致
// 泛型 T 保留调用方传入的 data 类型信息，避免 any 丢失类型推断
export function success<T>(res: Response, data?: T, message?: string): void {
  res.json({
    code: SUCCESS_CODE,
    message: message || '操作成功',
    data
  });
}

// 错误响应：code 统一为字符串（业务错误码或通用错误码）
// errors 复用 errors.ts 的 FieldError 契约，避免与 AppError.errors 类型漂移
export function error(res: Response, message: string, code: string = 'BAD_REQUEST', errors?: FieldError[]): void {
  res.status(httpStatusFromCode(code)).json({
    code,
    message,
    errors
  });
}

// 分页响应：统一输出扁平结构 { list, total, page, pageSize, totalPages, hasNext }
// 泛型 T 让调用方传入的 list 元素类型自动推断，避免 any[] 丢失元素类型
export function paginated<T>(
  res: Response,
  list: T[],
  total: number,
  page: number,
  pageSize: number,
  message?: string
): void {
  const totalPages = Math.ceil(total / pageSize);

  res.json({
    code: SUCCESS_CODE,
    message: message || '查询成功',
    data: {
      list,
      total,
      page,
      pageSize,
      totalPages,
      hasNext: page < totalPages,
    }
  });
}

// 游标分页响应：输出结构 { list, nextCursor, hasMore }
export function cursorPaginated<T>(
  res: Response,
  list: T[],
  nextCursor: string | null,
  hasMore: boolean,
  message?: string
): void {
  res.json({
    code: SUCCESS_CODE,
    message: message || '查询成功',
    data: {
      list,
      nextCursor,
      hasMore,
    }
  });
}

// 创建成功响应：HTTP 201，code 为 'CREATED'
export function created<T>(res: Response, data?: T, message?: string): void {
  res.status(201).json({
    code: CREATED_CODE,
    message: message || '创建成功',
    data
  });
}

// 更新成功响应
export function updated<T>(res: Response, data?: T, message?: string): void {
  res.json({
    code: SUCCESS_CODE,
    message: message || '更新成功',
    data
  });
}

// 删除成功响应
export function deleted(res: Response, message?: string): void {
  res.json({
    code: SUCCESS_CODE,
    message: message || '删除成功'
  });
}

// 无内容响应
export function noContent(res: Response): void {
  res.status(204).send();
}

// 根据字符串 code 推导 HTTP 状态码（内部使用，避免外部误传数字 code）
function httpStatusFromCode(code: string): number {
  return errorCodeToStatus[code] ?? 400;
}
