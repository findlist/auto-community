import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { env } from '../config/env';
import { AppError, FieldError } from '../utils/errors';
import { CommonErrorCode } from '../utils/errorCodes';
import { logger } from '../utils/logger';

interface ErrorResponse {
  code: string;
  message: string;
  errors?: FieldError[];
  stack?: string;
  requestId?: string;
}

// 全局错误处理中间件
// Express 通过参数数量识别错误处理中间件，必须保留 4 个参数签名
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // 如果是AppError实例
  if (err instanceof AppError) {
    const requestId = randomUUID();
    // AppError 视为业务可预期错误，使用 warn 级别记录
    logger.warn({
      requestId,
      errorType: err.constructor.name,
      message: err.message,
      stack: env.NODE_ENV === 'development' ? err.stack : undefined,
      path: req.path,
      method: req.method,
      statusCode: err.statusCode,
      code: err.code,
    }, 'AppError 业务异常');

    const response: ErrorResponse = {
      code: err.code,
      message: err.message,
      requestId,
    };

    if (err.errors && err.errors.length > 0) {
      response.errors = err.errors;
    }

    // 开发环境返回错误堆栈
    if (env.NODE_ENV === 'development') {
      response.stack = err.stack;
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // JWT错误
  if (err.name === 'JsonWebTokenError') {
    const requestId = randomUUID();
    logger.warn({
      requestId,
      errorType: err.name,
      message: '无效的认证令牌',
      path: req.path,
      method: req.method,
    }, 'JWT 校验失败');
    res.status(401).json({
      code: CommonErrorCode.UNAUTHORIZED,
      message: '无效的认证令牌',
      requestId,
    });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    const requestId = randomUUID();
    logger.warn({
      requestId,
      errorType: err.name,
      message: '认证令牌已过期',
      path: req.path,
      method: req.method,
    }, 'JWT 已过期');
    res.status(401).json({
      code: CommonErrorCode.UNAUTHORIZED,
      message: '认证令牌已过期',
      requestId,
    });
    return;
  }

  // 数据库错误
  if (err.name === 'QueryFailedError') {
    const requestId = randomUUID();
    logger.error({
      requestId,
      errorType: err.name,
      message: err.message,
      stack: env.NODE_ENV === 'development' ? err.stack : undefined,
      path: req.path,
      method: req.method,
    }, '数据库操作失败');
    res.status(500).json({
      code: CommonErrorCode.DATABASE_ERROR,
      message: '数据库操作失败',
      requestId,
    });
    return;
  }

  // 未知错误：生成 requestId 便于前后端联调定位
  const requestId = randomUUID();
  logger.error({
    requestId,
    errorType: err.constructor.name,
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  }, '未处理的服务器异常');

  const response: ErrorResponse = {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    message: env.NODE_ENV === 'production' ? '服务器内部错误' : err.message,
    requestId,
  };

  if (env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(500).json(response);
}

// 异步路由错误包装器
// 返回 Promise<unknown>：路由处理函数返回值不参与响应链（res.json 已发送响应），用 unknown 替代 any 强制丢弃返回值
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// 404错误处理
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  next(new AppError(`接口 ${req.originalUrl} 不存在`, 404));
}
