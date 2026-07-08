/**
 * 全局错误处理中间件单元测试
 *
 * 测试目标：errorHandler（AppError/JWT/DB/未知错误分类）、asyncHandler、notFoundHandler
 * 测试策略：mock env 控制 NODE_ENV 分支、mock logger 避免真实输出，验证响应状态码与响应体结构
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// hoisted env：可在测试中动态切换 NODE_ENV 验证 development/production 分支
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { NODE_ENV: 'test' },
}));
vi.mock('../../config/env', () => ({ env: mockEnv }));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { errorHandler, asyncHandler, notFoundHandler } from '../errorHandler';
import { AppError } from '../../utils/errors';
import { CommonErrorCode } from '../../utils/errorCodes';
import { logger } from '../../utils/logger';

const mockedLoggerWarn = vi.mocked(logger.warn);
const mockedLoggerError = vi.mocked(logger.error);

// 构造 mock 请求/响应/next
function createMockReqRes(originalUrl = '/api/test'): {
  req: Request;
  res: Response;
  next: NextFunction;
} {
  const req = { path: '/api/test', method: 'POST', originalUrl } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockEnv.NODE_ENV = 'test';
});

describe('errorHandler - AppError 业务异常', () => {
  it('应使用 AppError 的 statusCode 与 code 响应', () => {
    mockEnv.NODE_ENV = 'production';
    const { req, res, next } = createMockReqRes();
    const err = new AppError('资源不存在', 404, CommonErrorCode.NOT_FOUND);

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.code).toBe(CommonErrorCode.NOT_FOUND);
    expect(body.message).toBe('资源不存在');
    expect(body.requestId).toEqual(expect.any(String));
    expect(body.stack).toBeUndefined(); // production 不返回 stack
    // AppError 使用 warn 级别
    expect(mockedLoggerWarn).toHaveBeenCalledTimes(1);
  });

  it('带 errors 字段的 AppError 应在响应体中返回 errors', () => {
    const { req, res, next } = createMockReqRes();
    const errors = [{ field: 'email', message: '格式错误', value: 'abc' }];
    const err = new AppError('校验失败', 422, CommonErrorCode.VALIDATION_ERROR, errors);

    errorHandler(err, req, res, next);

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.errors).toEqual(errors);
  });

  it('无 errors 的 AppError 响应体不应包含 errors 字段', () => {
    const { req, res, next } = createMockReqRes();
    const err = new AppError('失败', 400, CommonErrorCode.BAD_REQUEST);

    errorHandler(err, req, res, next);

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.errors).toBeUndefined();
  });

  it('development 环境应返回 stack 信息', () => {
    mockEnv.NODE_ENV = 'development';
    const { req, res, next } = createMockReqRes();
    const err = new AppError('调试错误', 500);

    errorHandler(err, req, res, next);

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.stack).toEqual(expect.any(String));
  });
});

describe('errorHandler - JWT 错误', () => {
  it('JsonWebTokenError 应返回 401 与 "无效的认证令牌"', () => {
    const { req, res, next } = createMockReqRes();
    const err = new Error('jwt malformed');
    err.name = 'JsonWebTokenError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(body.message).toBe('无效的认证令牌');
  });

  it('TokenExpiredError 应返回 401 与 "认证令牌已过期"', () => {
    const { req, res, next } = createMockReqRes();
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.message).toBe('认证令牌已过期');
  });
});

describe('errorHandler - 数据库错误', () => {
  it('QueryFailedError 应返回 500 与 DATABASE_ERROR', () => {
    const { req, res, next } = createMockReqRes();
    const err = new Error('relation does not exist');
    err.name = 'QueryFailedError';

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.code).toBe(CommonErrorCode.DATABASE_ERROR);
    expect(body.message).toBe('数据库操作失败');
    // 数据库错误使用 error 级别
    expect(mockedLoggerError).toHaveBeenCalledTimes(1);
  });
});

describe('errorHandler - 未知错误', () => {
  it('production 环境应返回通用 "服务器内部错误" 且不泄露 err.message', () => {
    mockEnv.NODE_ENV = 'production';
    const { req, res, next } = createMockReqRes();
    const err = new Error('敏感的内部堆栈信息');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
    expect(body.message).toBe('服务器内部错误');
    expect(body.stack).toBeUndefined();
    expect(mockedLoggerError).toHaveBeenCalledTimes(1);
  });

  it('development 环境应返回 err.message 与 stack', () => {
    mockEnv.NODE_ENV = 'development';
    const { req, res, next } = createMockReqRes();
    const err = new Error('调试用的详细错误');

    errorHandler(err, req, res, next);

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.message).toBe('调试用的详细错误');
    expect(body.stack).toEqual(expect.any(String));
  });

  it('响应体应包含 requestId 便于前后端联调', () => {
    const { req, res, next } = createMockReqRes();
    const err = new Error('未知错误');

    errorHandler(err, req, res, next);

    const body = (res.json as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    expect(body.requestId).toEqual(expect.any(String));
  });
});

describe('asyncHandler - 异步路由包装器', () => {
  it('handler 正常 resolve 时不应调用 next', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    const { req, res, next } = createMockReqRes();

    await wrapped(req, res, next);

    expect(handler).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('handler reject 时应调用 next 传入错误', async () => {
    const error = new Error('异步处理失败');
    const handler = vi.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(handler);
    const { req, res, next } = createMockReqRes();

    await wrapped(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});

describe('notFoundHandler - 404 处理', () => {
  it('应调用 next 传入 404 AppError，message 含 originalUrl', () => {
    const { req, res, next } = createMockReqRes('/api/missing-endpoint');

    notFoundHandler(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain('/api/missing-endpoint');
  });
});
