import { Request, Response, NextFunction } from 'express';
import { validationResult, type ValidationChain } from 'express-validator';
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
