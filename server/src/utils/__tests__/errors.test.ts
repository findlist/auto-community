/**
 * utils/errors 错误类单元测试
 *
 * 测试目标：覆盖所有错误类的构造函数与默认值逻辑
 * - AppError 基类：statusCode/code/errors/name/captureStackTrace
 * - AppError.getDefaultCode：各 HTTP 状态码到默认 code 的映射（含 fallback）
 * - 8 个子类：默认消息与自定义消息、statusCode 与 code 正确性
 *
 * 测试策略：直接实例化各错误类，断言属性值。覆盖未实例化的错误类：
 * TooManyRequestsError / InternalError / ResourceNotFoundError / RateLimitExceededError
 */
import { describe, it, expect } from 'vitest';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  TooManyRequestsError,
  InternalError,
  InsufficientCreditError,
  OrderStatusInvalidError,
  PermissionDeniedError,
  ResourceNotFoundError,
  RateLimitExceededError,
} from '../errors';
import { CommonErrorCode, BusinessErrorCode } from '../errorCodes';

describe('utils/errors - AppError 基类', () => {
  it('不传 code 时按 statusCode 推导默认 code（400 → BAD_REQUEST）', () => {
    const err = new AppError('参数错误', 400);
    expect(err.message).toBe('参数错误');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(CommonErrorCode.BAD_REQUEST);
    expect(err.name).toBe('AppError');
    expect(err.errors).toBeUndefined();
    // AppError 继承 Error，应包含 stack
    expect(err.stack).toBeDefined();
  });

  it('传入 code 时使用自定义 code 而非默认推导', () => {
    const err = new AppError('自定义', 400, 'CUSTOM_CODE');
    expect(err.code).toBe('CUSTOM_CODE');
  });

  it('传入 errors 时保留字段错误列表', () => {
    const fieldErrors = [{ field: 'name', message: '必填', value: '' }];
    const err = new AppError('校验失败', 422, undefined, fieldErrors);
    expect(err.errors).toEqual(fieldErrors);
  });

  it('getDefaultCode 各状态码映射正确', () => {
    // 通过不传 code 的构造方式间接测试 getDefaultCode 各分支
    expect(new AppError('', 401).code).toBe(CommonErrorCode.UNAUTHORIZED);
    expect(new AppError('', 403).code).toBe(CommonErrorCode.FORBIDDEN);
    expect(new AppError('', 404).code).toBe(CommonErrorCode.NOT_FOUND);
    expect(new AppError('', 409).code).toBe(CommonErrorCode.CONFLICT);
    expect(new AppError('', 422).code).toBe(CommonErrorCode.VALIDATION_ERROR);
    expect(new AppError('', 429).code).toBe(CommonErrorCode.TOO_MANY_REQUESTS);
    expect(new AppError('', 500).code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
  });

  it('未映射的 statusCode 回退到 INTERNAL_SERVER_ERROR', () => {
    // 418 等未映射的状态码应回退到 500
    expect(new AppError('', 418).code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
  });

  it('默认 statusCode 为 500', () => {
    const err = new AppError('服务器错误');
    expect(err.statusCode).toBe(500);
  });
});

describe('utils/errors - 通用错误子类', () => {
  it('BadRequestError 默认消息与 code', () => {
    const err = new BadRequestError();
    expect(err.message).toBe('请求参数错误');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(CommonErrorCode.BAD_REQUEST);
  });

  it('BadRequestError 自定义消息与 errors', () => {
    const errors = [{ field: 'email', message: '格式错误' }];
    const err = new BadRequestError('邮箱格式错误', errors);
    expect(err.message).toBe('邮箱格式错误');
    expect(err.errors).toEqual(errors);
  });

  it('UnauthorizedError 默认消息', () => {
    const err = new UnauthorizedError();
    expect(err.message).toBe('未授权访问');
    expect(err.statusCode).toBe(401);
  });

  it('ForbiddenError 默认消息', () => {
    const err = new ForbiddenError();
    expect(err.message).toBe('无权限执行此操作');
    expect(err.statusCode).toBe(403);
  });

  it('NotFoundError 默认资源名', () => {
    const err = new NotFoundError();
    expect(err.message).toBe('资源不存在');
    expect(err.statusCode).toBe(404);
  });

  it('NotFoundError 自定义资源名', () => {
    const err = new NotFoundError('用户');
    expect(err.message).toBe('用户不存在');
  });

  it('ConflictError 默认消息', () => {
    const err = new ConflictError();
    expect(err.message).toBe('数据冲突');
    expect(err.statusCode).toBe(409);
  });

  it('ValidationError 默认消息与 errors', () => {
    const err = new ValidationError();
    expect(err.message).toBe('参数验证失败');
    expect(err.statusCode).toBe(422);
  });

  // 覆盖 line 89-92：TooManyRequestsError
  it('TooManyRequestsError 默认消息', () => {
    const err = new TooManyRequestsError();
    expect(err.message).toBe('请求过于频繁，请稍后再试');
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(CommonErrorCode.TOO_MANY_REQUESTS);
  });

  it('TooManyRequestsError 自定义消息', () => {
    const err = new TooManyRequestsError('操作太快了');
    expect(err.message).toBe('操作太快了');
  });

  // 覆盖 line 95-99：InternalError
  it('InternalError 默认消息', () => {
    const err = new InternalError();
    expect(err.message).toBe('服务器内部错误');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe(CommonErrorCode.INTERNAL_SERVER_ERROR);
  });

  it('InternalError 自定义消息', () => {
    const err = new InternalError('数据库连接失败');
    expect(err.message).toBe('数据库连接失败');
  });
});

describe('utils/errors - 业务专用错误子类', () => {
  it('InsufficientCreditError 默认消息', () => {
    const err = new InsufficientCreditError();
    expect(err.message).toBe('余额不足');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(BusinessErrorCode.INSUFFICIENT_CREDIT);
  });

  it('OrderStatusInvalidError 默认消息', () => {
    const err = new OrderStatusInvalidError();
    expect(err.message).toBe('订单状态不允许此操作');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(BusinessErrorCode.ORDER_STATUS_INVALID);
  });

  it('PermissionDeniedError 默认消息', () => {
    const err = new PermissionDeniedError();
    expect(err.message).toBe('无权限执行此操作');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe(BusinessErrorCode.PERMISSION_DENIED);
  });

  // 覆盖 line 127-130：ResourceNotFoundError
  it('ResourceNotFoundError 默认资源名', () => {
    const err = new ResourceNotFoundError();
    expect(err.message).toBe('资源不存在');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe(BusinessErrorCode.RESOURCE_NOT_FOUND);
  });

  it('ResourceNotFoundError 自定义资源名', () => {
    const err = new ResourceNotFoundError('技能帖子');
    expect(err.message).toBe('技能帖子不存在');
  });

  // 覆盖 line 134-137：RateLimitExceededError
  it('RateLimitExceededError 默认消息', () => {
    const err = new RateLimitExceededError();
    expect(err.message).toBe('请求过于频繁，请稍后再试');
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe(BusinessErrorCode.RATE_LIMIT_EXCEEDED);
  });

  it('RateLimitExceededError 自定义消息', () => {
    const err = new RateLimitExceededError('评论太快了');
    expect(err.message).toBe('评论太快了');
  });
});
