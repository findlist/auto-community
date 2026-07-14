/**
 * utils/errorCodes 错误码映射完整性单元测试
 *
 * 测试目标：守护错误码与 HTTP 状态码映射的不变式，防止未来新增错误码时遗漏映射
 * - 完整性：CommonErrorCode / BusinessErrorCode 中每个 code 必须在 errorCodeToStatus 中有映射
 *   设计原因：response.ts httpStatusFromCode 对未映射 code 静默回退 400，
 *   若新增错误码遗漏映射，会将 500/404 等正确状态码误降级为 400，掩盖真实错误语义
 * - 有效性：errorCodeToStatus 中每个值必须是合法 HTTP 4xx/5xx 状态码
 *   设计原因：错误响应不应返回 2xx/3xx，状态码拼写错误（如 40 而非 400）需尽早暴露
 * - 一致性：CommonErrorCode 与 AppError.getDefaultCode 反向映射保持一致
 *   设计原因：errors.ts AppError 构造时若仅传 statusCode 不传 code，getDefaultCode 推导出的 code
 *   再经 httpStatusFromCode 反查应得到原 statusCode，否则会出现"状态码→code→不同状态码"的回环漂移
 */
import { describe, it, expect } from 'vitest';
import {
  SUCCESS_CODE,
  CREATED_CODE,
  CommonErrorCode,
  BusinessErrorCode,
  errorCodeToStatus,
} from '../errorCodes';
import {
  AppError,
  InsufficientCreditError,
  OrderStatusInvalidError,
  PermissionDeniedError,
  ResourceNotFoundError,
  RateLimitExceededError,
} from '../errors';

// 收集 CommonErrorCode 与 BusinessErrorCode 的所有 code 值，作为完整性校验数据源
const allCommonCodes = Object.values(CommonErrorCode);
const allBusinessCodes = Object.values(BusinessErrorCode);
const allErrorCodes = [...allCommonCodes, ...allBusinessCodes];

// 合法 HTTP 错误状态码范围：4xx 客户端错误 + 5xx 服务端错误
function isValidHttpErrorStatus(status: number): boolean {
  return status >= 400 && status < 600;
}

describe('utils/errorCodes - 成功码常量', () => {
  it('SUCCESS_CODE 应为 "SUCCESS" 字符串常量', () => {
    expect(SUCCESS_CODE).toBe('SUCCESS');
    expect(typeof SUCCESS_CODE).toBe('string');
  });

  it('CREATED_CODE 应为 "CREATED" 字符串常量', () => {
    expect(CREATED_CODE).toBe('CREATED');
    expect(typeof CREATED_CODE).toBe('string');
  });

  it('成功码不应出现在 errorCodeToStatus 映射表中', () => {
    // 成功码与错误码语义对立，不应混入错误状态码映射，避免误用
    expect(errorCodeToStatus).not.toHaveProperty(SUCCESS_CODE);
    expect(errorCodeToStatus).not.toHaveProperty(CREATED_CODE);
  });
});

describe('utils/errorCodes - 映射完整性不变式', () => {
  it('CommonErrorCode 中每个 code 必须在 errorCodeToStatus 中有映射', () => {
    // 防止新增通用错误码时遗漏映射，导致 httpStatusFromCode 静默回退 400
    const missing = allCommonCodes.filter((code) => !(code in errorCodeToStatus));
    expect(missing).toEqual([]);
  });

  it('BusinessErrorCode 中每个 code 必须在 errorCodeToStatus 中有映射', () => {
    // 防止新增业务错误码时遗漏映射，业务错误通常对应 4xx，遗漏会导致状态码降级
    const missing = allBusinessCodes.filter((code) => !(code in errorCodeToStatus));
    expect(missing).toEqual([]);
  });

  it('errorCodeToStatus 不应包含 CommonErrorCode / BusinessErrorCode 之外的未知 code', () => {
    // 防止映射表中出现已废弃或拼写错误的 code，避免维护者混淆
    const knownCodes = new Set<string>(allErrorCodes);
    const unknown = Object.keys(errorCodeToStatus).filter((code) => !knownCodes.has(code));
    expect(unknown).toEqual([]);
  });

  it('errorCodeToStatus 映射表 key 数量应等于 CommonErrorCode + BusinessErrorCode 总数', () => {
    // 防止映射表出现重复 key 或遗漏：key 总数应严格等于错误码定义总数
    expect(Object.keys(errorCodeToStatus).length).toBe(allErrorCodes.length);
  });
});

describe('utils/errorCodes - 状态码有效性不变式', () => {
  it('errorCodeToStatus 中每个值必须是合法 HTTP 4xx/5xx 状态码', () => {
    // 防止状态码拼写错误（如 40 而非 400）或误配 2xx/3xx
    const invalid = Object.entries(errorCodeToStatus)
      .filter(([, status]) => !isValidHttpErrorStatus(status))
      .map(([code, status]) => `${code}=${status}`);
    expect(invalid).toEqual([]);
  });

  it('CommonErrorCode 状态码映射应符合 HTTP 语义约定', () => {
    // 守护通用错误码与 HTTP 标准状态码的语义对齐
    const expectedMapping: Record<string, number> = {
      [CommonErrorCode.BAD_REQUEST]: 400,
      [CommonErrorCode.UNAUTHORIZED]: 401,
      [CommonErrorCode.FORBIDDEN]: 403,
      [CommonErrorCode.NOT_FOUND]: 404,
      [CommonErrorCode.CONFLICT]: 409,
      [CommonErrorCode.VALIDATION_ERROR]: 422,
      [CommonErrorCode.TOO_MANY_REQUESTS]: 429,
      [CommonErrorCode.INTERNAL_SERVER_ERROR]: 500,
      [CommonErrorCode.DATABASE_ERROR]: 500,
    };
    for (const [code, expectedStatus] of Object.entries(expectedMapping)) {
      expect(errorCodeToStatus[code]).toBe(expectedStatus);
    }
  });

  it('BusinessErrorCode 状态码应分布在 4xx 范围内', () => {
    // 业务错误通常由客户端请求引发，状态码应为 4xx；若出现 5xx 需复审语义
    const businessCodeSet = new Set<string>(allBusinessCodes);
    const outOfRange = Object.entries(errorCodeToStatus)
      .filter(([code]) => businessCodeSet.has(code))
      .filter(([, status]) => status < 400 || status >= 500)
      .map(([code, status]) => `${code}=${status}`);
    expect(outOfRange).toEqual([]);
  });
});

describe('utils/errorCodes - 映射一致性不变式', () => {
  it('CommonErrorCode 反向映射应与 AppError.getDefaultCode 保持一致', () => {
    // 防止"statusCode → code → 不同 statusCode"的回环漂移：
    // AppError 不传 code 时 getDefaultCode(statusCode) 推导出 code，
    // 该 code 再经 errorCodeToStatus 反查应得到原 statusCode
    // 仅校验 getDefaultCode 覆盖的状态码（400/401/403/404/409/422/429/500）
    const testCases = [400, 401, 403, 404, 409, 422, 429, 500];
    for (const statusCode of testCases) {
      const err = new AppError('test', statusCode);
      const roundTripStatus = errorCodeToStatus[err.code];
      expect(roundTripStatus).toBe(statusCode);
    }
  });

  it('业务错误类的 statusCode 应与 errorCodeToStatus 映射一致', () => {
    // 业务错误子类构造时通过 errorCodeToStatus[code] 取 statusCode，
    // 这里反向验证：实例化后 err.code → errorCodeToStatus 应等于 err.statusCode
    const businessErrors = [
      new InsufficientCreditError(),
      new OrderStatusInvalidError(),
      new PermissionDeniedError(),
      new ResourceNotFoundError(),
      new RateLimitExceededError(),
    ];
    for (const err of businessErrors) {
      expect(errorCodeToStatus[err.code]).toBe(err.statusCode);
    }
  });
});
