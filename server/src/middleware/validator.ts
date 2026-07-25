import { Request, Response, NextFunction } from 'express';
import { validationResult, param, query, type ValidationChain } from 'express-validator';
import { AppError, FieldError } from '../utils/errors';
import { CommonErrorCode } from '../utils/errorCodes';

// 验证中间件
export function validate(validations: ValidationChain[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 执行所有验证
    await Promise.all(validations.map(validation => validation.run(req)));

    // 获取验证结果
    const errors = validationResult(req);

    if (errors.isEmpty()) {
      next();
      return;
    }

    // 格式化错误信息：复用 errors.ts 的 FieldError 契约，确保与 errorHandler 类型一致
    // express-validator 的 FieldValidationError 有 path/value 字段，但联合类型中需用类型断言访问
    const formattedErrors: FieldError[] = errors.array().map(err => ({
      field: err.type === 'field' ? (err as { path: string }).path : 'unknown',
      message: err.msg,
      value: err.type === 'field' ? (err as { value: unknown }).value : undefined
    }));

    // 使用业务专用错误码 VALIDATION_ERROR，便于前端精确识别参数校验失败
    next(new AppError('参数验证失败', 422, CommonErrorCode.VALIDATION_ERROR, formattedErrors));
  };
}

// 常用验证规则
// value 用 unknown：来自 req.query/req.params 的值类型不定（可能是 string/string[]/undefined），用 unknown 强制内部类型收窄
export const rules = {
  // 分页参数
  pagination: [
    {
      name: 'page',
      in: 'query',
      validator: (value: unknown) => {
        // parseInt 接受 string，需先将 unknown 转为 string（query 参数实际为 string 或 string[]）
        const page = parseInt(String(value));
        return page > 0 ? page : 1;
      }
    },
    {
      name: 'pageSize',
      in: 'query',
      validator: (value: unknown) => {
        const pageSize = parseInt(String(value));
        return pageSize > 0 && pageSize <= 100 ? pageSize : 20;
      }
    }
  ],

  // ID参数
  id: (paramName: string = 'id') => ({
    name: paramName,
    in: 'params',
    validator: (value: unknown) => {
      if (!value || typeof value !== 'string') {
        throw new Error('无效的ID参数');
      }
      return value;
    }
  })
};

// 解析分页参数
export function getPagination(req: Request): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const offset = (page - 1) * pageSize;

  return { page, pageSize, offset };
}

// 解析排序参数
export function getSortParams(req: Request, allowedFields: string[]): { field: string; order: 'ASC' | 'DESC' } {
  const sortBy = req.query.sortBy as string;
  const sortOrder = (req.query.sortOrder as string)?.toUpperCase();

  const field = allowedFields.includes(sortBy) ? sortBy : allowedFields[0];
  const order = sortOrder === 'DESC' ? 'DESC' : 'ASC';

  return { field, order };
}

/**
 * 生成 UUID 路径参数校验链。
 *
 * 设计原因：原 routes 层 /:id 路径参数未做格式校验，依赖 service 层 query 返回空时抛 NotFoundError 兜底。
 * 这会导致非法 id（如 'abc'、'../../etc'）也走完整个 service 调用链才返回 404，既浪费 DB 查询，
 * 又让 service 层承担了本应在路由层完成的输入校验职责。前置 UUID 校验可在路由层提前返回 422，
 * 降低 service 防御压力并改善错误响应语义（参数格式错误应 422 而非 404）。
 *
 * 选择 isUUID('all') 而非 'v4'：项目数据库 uuid 字段使用 pg 默认 gen_random_uuid()（v4），
 * 但保留 'all' 版本兼容性以应对历史数据或其他生成源（如 v1 时间戳 UUID），避免过度收紧。
 *
 * @param paramName 路径参数名，默认 'id'，支持 'userId'/'orderId' 等自定义命名
 */
export function uuidParam(paramName: string = 'id'): ValidationChain {
  return param(paramName)
    .isUUID('all')
    .withMessage(`${paramName} 必须是合法 UUID`);
}

/**
 * 生成枚举型路径参数校验链。
 *
 * 设计原因：路径参数 :type 在 admin 路由中存在封闭枚举语义（如 skill/kitchen/time_bank），
 * 原代码用 `as` 类型断言直接收窄，未做运行时校验。非法值（如 'foo'）会进入 service 层
 * 走完整个调用链才返回空列表或 500，错误语义错位（应为 422 参数错误）。前置白名单校验
 * 可在路由层提前拦截，避免无效请求穿透到 service 层，同时让错误响应语义对齐 422 规范。
 *
 * 默认 required：路径参数若未在路由定义中出现，根本不会进入此 handler，
 * 仅当路由定义为可选（如 :type?）时才需传 optional=true。
 *
 * @param paramName 路径参数名
 * @param allowed 允许的枚举值列表
 * @param optional 是否可选（默认 false，路径参数通常必填）
 */
export function enumParam(paramName: string, allowed: readonly string[], optional = false): ValidationChain {
  const chain = param(paramName).isIn(allowed as string[]);
  if (optional) chain.optional();
  return chain.withMessage(`${paramName} 必须是以下值之一: ${allowed.join(', ')}`);
}

/**
 * 生成枚举型查询参数校验链。
 *
 * 设计原因：查询参数 status/type 在多个 admin 列表接口存在封闭枚举语义
 * （如 reports.status ∈ [pending, resolved, rejected]），原代码用 `as` 类型断言直接收窄，
 * 非法值会进入 service 层走参数化查询返回空列表，错误语义错位（前端难以辨别是「无数据」
 * 还是「参数非法」）。前置白名单校验让非法参数在路由层就被 422 拦截，错误响应语义清晰。
 *
 * 默认 optional：查询参数天然可选，未传时由 service 层按 undefined 处理（返回全量数据）。
 * 仅当业务上必填时才传 optional=false。
 *
 * @param queryName 查询参数名
 * @param allowed 允许的枚举值列表
 * @param optional 是否可选（默认 true，查询参数通常可选）
 */
export function enumQuery(queryName: string, allowed: readonly string[], optional = true): ValidationChain {
  const chain = query(queryName).isIn(allowed as string[]);
  if (optional) chain.optional();
  return chain.withMessage(`${queryName} 必须是以下值之一: ${allowed.join(', ')}`);
}
