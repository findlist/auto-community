/**
 * 参数校验中间件单元测试
 *
 * 测试目标：validate 中间件、rules 规则、getPagination、getSortParams
 * 测试策略：mock express-validator 的 validationResult，验证校验通过/失败两条路径与错误格式化逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// 使用 vi.hoisted 提升 mock 对象：vi.mock 工厂与 beforeEach 都需要引用同一个 chain 实例
// 设计原因：beforeEach 中 vi.resetAllMocks() 会清空 param 的 mockReturnValue，导致 param() 返回 undefined
// 提升 chain 到模块作用域后，可在 beforeEach 中重新调用 mockReturnValue(chain) 恢复链式行为
//
// 注意：链式方法不能用 mockReturnThis()，因为 vitest mock 函数的 this 在严格模式/独立调用时为 undefined
// 改用闭包引用 chain 自身：mockReturnValue(chain) 让 isUUID/withMessage 都返回同一个 chain 对象
const { mockChain, mockParam } = vi.hoisted(() => {
  // 先声明对象再设置 mockReturnValue，避免 TDZ（chain 在自身字面量内部不可引用）
  const chain: {
    isUUID: ReturnType<typeof vi.fn>;
    withMessage: ReturnType<typeof vi.fn>;
  } = {
    isUUID: vi.fn(),
    withMessage: vi.fn(),
  };
  chain.isUUID.mockReturnValue(chain);
  chain.withMessage.mockReturnValue(chain);
  return {
    mockChain: chain,
    mockParam: vi.fn().mockReturnValue(chain),
  };
});

// mock express-validator：仅替换 validationResult，ValidationChain 为类型在运行时擦除
// param 也需 mock：uuidParam 工厂内部调用 param(name).isUUID().withMessage() 链式构造 ValidationChain
// 链式方法均返回 this（chain 对象），故用同一个 mockChain 串联
vi.mock('express-validator', () => ({
  validationResult: vi.fn(),
  param: mockParam,
}));

import { validate, rules, getPagination, getSortParams, uuidParam } from '../validator';
import { validationResult, param } from 'express-validator';
import { AppError } from '../../utils/errors';
import { CommonErrorCode } from '../../utils/errorCodes';

const mockedValidationResult = vi.mocked(validationResult);

// 构造 mock 校验链：含 run 方法（validate 内部 Promise.all 调用）
function createMockValidation(): { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn().mockResolvedValue(undefined) };
}

// 构造 Express 请求/响应/next
function createMockReqRes(query: Record<string, unknown> = {}, params: Record<string, unknown> = {}): {
  req: Request;
  res: Response;
  next: NextFunction;
} {
  const req = { query, params } as unknown as Request;
  const res = {} as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

beforeEach(() => {
  // 使用 clearAllMocks 而非 resetAllMocks：仅清除调用记录，保留 mockReturnValue/mockImplementation
  // 设计原因：vi.mock('express-validator') 工厂在模块初始化时仅执行一次，param 的 mockReturnValue(mockChain)
  // 与 mockChain 内部方法的 mockReturnValue(chain) 若被 resetAllMocks 清空，会导致后续测试 param() 返回 undefined。
  // mockReturnValueOnce 设置的实现通过 mock.results 跟踪，每个测试自行设置自己的 mockReturnValueOnce
  vi.clearAllMocks();
});

describe('validate - 校验中间件', () => {
  it('校验通过时应调用 next 无错误', async () => {
    // isEmpty 返回 true 表示无校验错误
    mockedValidationResult.mockReturnValueOnce({ isEmpty: () => true } as never);
    const { req, res, next } = createMockReqRes();
    const validation = createMockValidation();

    const middleware = validate([validation as never]);
    await middleware(req, res, next);

    expect(validation.run).toHaveBeenCalledWith(req);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('校验失败时应调用 next 传入 AppError（422 + VALIDATION_ERROR）', async () => {
    mockedValidationResult.mockReturnValueOnce({
      isEmpty: () => false,
      array: () => [{ type: 'field', path: 'email', msg: '邮箱格式错误', value: 'abc' }],
    } as never);
    const { req, res, next } = createMockReqRes();

    const middleware = validate([createMockValidation() as never]);
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(CommonErrorCode.VALIDATION_ERROR);
    expect(err.errors).toEqual([{ field: 'email', message: '邮箱格式错误', value: 'abc' }]);
  });

  it('非 field 类型错误应格式化为 field="unknown"，value=undefined', async () => {
    mockedValidationResult.mockReturnValueOnce({
      isEmpty: () => false,
      array: () => [{ type: 'alternative', msg: '未知错误' }],
    } as never);
    const { req, res, next } = createMockReqRes();

    const middleware = validate([createMockValidation() as never]);
    await middleware(req, res, next);

    const err = (next as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as AppError;
    expect(err.errors).toEqual([{ field: 'unknown', message: '未知错误', value: undefined }]);
  });
});

describe('rules - 常用验证规则', () => {
  describe('rules.pagination', () => {
    it('page 校验器：合法值 >0 应返回对应数字', () => {
      const pageRule = rules.pagination[0];
      expect(pageRule.validator('5')).toBe(5);
    });

    it('page 校验器：值<=0 应回退默认 1', () => {
      const pageRule = rules.pagination[0];
      expect(pageRule.validator('0')).toBe(1);
      expect(pageRule.validator('-3')).toBe(1);
    });

    it('page 校验器：非法值（undefined/非数字）应回退默认 1', () => {
      // parseInt(String(undefined))=NaN，NaN>0 为 false → 1
      const pageRule = rules.pagination[0];
      expect(pageRule.validator(undefined)).toBe(1);
      expect(pageRule.validator('abc')).toBe(1);
    });

    it('pageSize 校验器：1-100 内应返回对应数字', () => {
      const pageSizeRule = rules.pagination[1];
      expect(pageSizeRule.validator('50')).toBe(50);
    });

    it('pageSize 校验器：超过 100 应回退默认 20', () => {
      const pageSizeRule = rules.pagination[1];
      expect(pageSizeRule.validator('200')).toBe(20);
    });

    it('pageSize 校验器：<=0 应回退默认 20', () => {
      const pageSizeRule = rules.pagination[1];
      expect(pageSizeRule.validator('0')).toBe(20);
    });
  });

  describe('rules.id', () => {
    it('合法字符串应原样返回', () => {
      const idRule = rules.id('id');
      expect(idRule.validator('abc-123')).toBe('abc-123');
      expect(idRule.name).toBe('id');
    });

    it('自定义参数名应透传', () => {
      const idRule = rules.id('orderId');
      expect(idRule.name).toBe('orderId');
    });

    it('undefined 值应抛错', () => {
      const idRule = rules.id('id');
      expect(() => idRule.validator(undefined)).toThrow('无效的ID参数');
    });

    it('非字符串值应抛错', () => {
      const idRule = rules.id('id');
      expect(() => idRule.validator(123)).toThrow('无效的ID参数');
    });
  });
});

describe('getPagination - 分页参数解析', () => {
  it('无 query 应返回默认 page=1 pageSize=20 offset=0', () => {
    const { req } = createMockReqRes();
    expect(getPagination(req)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('正常值应正确计算 offset', () => {
    // page=3 pageSize=50 → offset=(3-1)*50=100
    const { req } = createMockReqRes({ page: '3', pageSize: '50' });
    expect(getPagination(req)).toEqual({ page: 3, pageSize: 50, offset: 100 });
  });

  it('pageSize 超过 100 应截断为 100', () => {
    const { req } = createMockReqRes({ pageSize: '500' });
    expect(getPagination(req).pageSize).toBe(100);
  });

  it('非法值应回退默认', () => {
    const { req } = createMockReqRes({ page: 'abc', pageSize: 'xyz' });
    expect(getPagination(req)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('page<1 应被 Math.max 钳制为 1', () => {
    const { req } = createMockReqRes({ page: '0' });
    expect(getPagination(req).page).toBe(1);
  });
});

describe('getSortParams - 排序参数解析', () => {
  it('sortBy 在允许字段内应使用该字段', () => {
    const { req } = createMockReqRes({ sortBy: 'created_at', sortOrder: 'desc' });
    expect(getSortParams(req, ['created_at', 'updated_at'])).toEqual({ field: 'created_at', order: 'DESC' });
  });

  it('sortBy 不在允许字段内应回退首个字段', () => {
    const { req } = createMockReqRes({ sortBy: 'malicious_field', sortOrder: 'asc' });
    expect(getSortParams(req, ['created_at', 'updated_at'])).toEqual({ field: 'created_at', order: 'ASC' });
  });

  it('未提供 sortBy 应回退首个字段', () => {
    const { req } = createMockReqRes({});
    expect(getSortParams(req, ['name'])).toEqual({ field: 'name', order: 'ASC' });
  });

  it('sortOrder 非 DESC 应回退 ASC', () => {
    const { req } = createMockReqRes({ sortBy: 'name', sortOrder: 'random' });
    expect(getSortParams(req, ['name']).order).toBe('ASC');
  });

  it('sortOrder 大小写不敏感（desc → DESC）', () => {
    const { req } = createMockReqRes({ sortBy: 'name', sortOrder: 'desc' });
    expect(getSortParams(req, ['name']).order).toBe('DESC');
  });
});

describe('uuidParam - UUID 路径参数校验工厂', () => {
  // express-validator 的 param 被 mock 为 mockParam，链式调用均返回同一个 mockChain 对象
  // 此处验证 uuidParam 工厂按预期调用 param(name).isUUID('all').withMessage(...)
  // 真实的 UUID 格式校验由 express-validator 在运行时执行，集成测试已覆盖

  it('默认参数名应为 "id"，并调用 isUUID("all")', () => {
    uuidParam();
    expect(param).toHaveBeenCalledWith('id');
    expect(mockChain.isUUID).toHaveBeenCalledWith('all');
  });

  it('自定义参数名应透传（如 "userId"）', () => {
    uuidParam('userId');
    expect(param).toHaveBeenCalledWith('userId');
  });

  it('应设置 withMessage 含参数名的中文提示', () => {
    uuidParam('orderId');
    // withMessage 第一参数应包含参数名 'orderId'，便于前端识别是哪个路径参数格式错误
    expect(mockChain.withMessage).toHaveBeenCalled();
    const messageArg = mockChain.withMessage.mock.calls[0][0] as string;
    expect(messageArg).toContain('orderId');
    expect(messageArg).toContain('UUID');
  });
});
