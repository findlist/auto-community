/**
 * 递归转换对象键名：snake_case ↔ camelCase
 *
 * 设计原因：后端数据库列名用 snake_case（如 duration_minutes、created_at），
 * 后端路由按 snake_case 解构请求体；前端 TypeScript 接口用 camelCase（如 durationMinutes、createdAt）。
 * 若无统一转换层，前端需在每个 api 函数手动映射字段名（如 timeBank.createService 手动
 * durationMinutes → duration_minutes），易遗漏导致丢值 bug（已发生过 durationMinutes 丢值案例）。
 * 本工具配合 axios 拦截器，在请求/响应边界统一转换，消除手动映射隐患。
 */

// snake_case → camelCase：hello_world → helloWorld；已为 camelCase 的键幂等不变
export function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

// camelCase → snake_case：helloWorld → hello_world；已为 snake_case 的键幂等不变
export function toSnakeCase(key: string): string {
  // 在每个大写字母前插入下划线并转小写；首字符不处理（避免 HelloWorld 开头多出下划线）
  return key.replace(/[A-Z]/g, (char, offset: number) =>
    offset === 0 ? char.toLowerCase() : `_${char.toLowerCase()}`
  );
}

/**
 * 判断值是否为「纯对象」（可安全递归转换键名的对象）。
 * 仅接受对象字面量（proto === Object.prototype）或 Object.create(null) 创建的对象。
 * 排除：null/undefined、基本类型、数组、Date、RegExp、Error、Blob、File、FormData、
 * ArrayBuffer、URLSearchParams 等类实例，避免误转换二进制或类实例导致破坏。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 递归转换对象键名。
 * - 基本类型、null、undefined：原样返回
 * - 数组：递归转换每个元素（数组本身键为数字索引，不转换）
 * - 纯对象：转换每个键名，并递归转换对应值
 * - 其他类型（Blob/Date/FormData 等）：原样返回，避免破坏类实例
 *
 * 采用函数重载：公开签名保留泛型 T（调用方看到 T → T），
 * 实现签名用 unknown（内部无需 as unknown as T 双重断言）。
 * 设计原因：TypeScript 无法表达"转换键名后类型结构不变"，
 * 泛型 T 仅用于对外类型约束，实现内部统一按 unknown 处理。
 */
export function convertKeys<T>(value: T, convert: (key: string) => string): T;
export function convertKeys(value: unknown, convert: (key: string) => string): unknown {
  // null/undefined/基本类型直接返回，避免无意义递归
  if (value === null || value === undefined) return value;

  // 数组：仅递归转换元素，不转换数组索引
  if (Array.isArray(value)) {
    return value.map((item) => convertKeys(item, convert));
  }

  // 纯对象：转换键名并递归转换值
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[convert(key)] = convertKeys(val, convert);
    }
    return result;
  }

  // 其他类型（Date/Blob/FormData/RegExp/Error 等）原样返回，保留类实例语义
  return value;
}
