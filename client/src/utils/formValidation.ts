// 表单校验工具函数，所有校验函数返回 string | null，null 表示通过，string 为错误提示

// 必填校验
export function validateRequired(value: string, fieldName: string): string | null {
  return value.trim() ? null : `请填写${fieldName}`;
}

// 最小长度校验
export function validateMinLength(value: string, min: number, fieldName: string): string | null {
  if (!value.trim()) return null;
  return value.trim().length >= min ? null : `${fieldName}至少需要${min}个字符`;
}

// 最大长度校验
export function validateMaxLength(value: string, max: number, fieldName: string): string | null {
  if (!value.trim()) return null;
  return value.trim().length <= max ? null : `${fieldName}不能超过${max}个字符`;
}

// 数值范围校验
export function validateRange(value: number, min: number, max: number, fieldName: string): string | null {
  if (isNaN(value)) return `${fieldName}必须是数字`;
  return value >= min && value <= max ? null : `${fieldName}必须在${min}到${max}之间`;
}

// 手机号校验（11位）
export function validatePhone(value: string): string | null {
  if (!value.trim()) return null;
  const phoneRegex = /^1[3-9]\d{9}$/;
  return phoneRegex.test(value.trim()) ? null : "请输入正确的11位手机号";
}

// 邮箱校验
export function validateEmail(value: string): string | null {
  if (!value.trim()) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value.trim()) ? null : "请输入正确的邮箱地址";
}

// 价格校验（正数，最多2位小数）
export function validatePrice(value: string): string | null {
  if (!value.trim()) return null;
  const priceRegex = /^\d+(\.\d{1,2})?$/;
  const num = Number(value);
  return priceRegex.test(value) && num > 0 ? null : "请输入有效的价格（正数，最多2位小数）";
}

// 日期校验
export function validateDate(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return !isNaN(date.getTime()) ? null : "请输入有效的日期";
}

// 未来日期校验
export function validateFutureDate(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return "请输入有效的日期";
  return date > new Date() ? null : "日期必须是未来的日期";
}

// 组合校验函数
export function composeValidators(...validators: ((value: string) => string | null)[]): (value: string) => string | null {
  return (value: string) => {
    for (const validator of validators) {
      const error = validator(value);
      if (error) return error;
    }
    return null;
  };
}