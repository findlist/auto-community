/**
 * PII（个人身份信息）脱敏工具
 *
 * 用于 API 响应中对手机号、身份证号等敏感字段进行脱敏，
 * 保证返回结构兼容（字段仍存在，但值为脱敏后的字符串）。
 */

/**
 * 手机号脱敏：保留前 3 位与后 4 位，中间用 4 个 * 替换
 * 示例：13812345678 -> 138****5678
 *
 * 长度不足 7 位时（异常输入），全部替换为 *，避免泄露部分号码
 */
export function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) {
    return '*'.repeat(Math.max(phone?.length || 0, 0));
  }
  const head = phone.slice(0, 3);
  const tail = phone.slice(-4);
  return `${head}****${tail}`;
}

/**
 * 身份证号脱敏：保留前 3 位与后 4 位，中间用 * 替换
 * 示例：110101199001011234 -> 110***********1234
 *
 * 18 位身份证：3 + 11 + 4
 * 长度不足 7 位时全部替换为 *
 */
export function maskIdCard(idCard: string): string {
  if (!idCard || idCard.length < 7) {
    return '*'.repeat(Math.max(idCard?.length || 0, 0));
  }
  const head = idCard.slice(0, 3);
  const tail = idCard.slice(-4);
  const middleLen = idCard.length - head.length - tail.length;
  return `${head}${'*'.repeat(middleLen)}${tail}`;
}
