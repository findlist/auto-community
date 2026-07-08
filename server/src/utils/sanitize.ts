/**
 * XSS 过滤与图片 URL 校验工具
 *
 * - sanitizeXss：对用户输入的富文本字段进行 XSS 清洗，剥离 <script>、事件处理器等危险节点
 * - sanitizeObject：批量清洗对象中指定字段，便于 service 入库前统一处理
 * - validateImageUrl / validateImageUrls：校验图片 URL，支持本地上传相对路径与 HTTPS 白名单外链
 */
import xss from 'xss';
import { env } from '../config/env';
import { BadRequestError } from './errors';

/**
 * 单字段 XSS 过滤
 * 非字符串原样返回，避免误伤数字、布尔等类型
 */
export function sanitizeXss(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return xss(value);
}

/**
 * 批量清洗对象中指定字段
 * @param data 原始对象（不会修改入参，返回新对象）
 * @param fields 需要清洗的字段名列表
 *
 * 设计原因：泛型约束使用 object 而非 Record<string, any>，避免 any 静默吞掉字段误用，
 * 同时让接口类型（无索引签名）也能传入。内部 result 用 Record<string, unknown>
 * 做字段写入，让 sanitizeXss 的返回值（unknown）可以赋给字段；返回类型仍为 T，
 * 调用方传入具名接口（如 CreateRequestData）时，sanitized.title 仍保持具名类型。
 */
export function sanitizeObject<T extends object>(
  data: T,
  fields: string[],
): T {
  const result = { ...data } as Record<string, unknown>;
  for (const field of fields) {
    if (result[field] !== undefined) {
      result[field] = sanitizeXss(result[field]);
    }
  }
  return result as T;
}

/**
 * 图片 URL 域名白名单
 *
 * 通过 env.IMAGES_WHITELIST_DOMAINS 配置，多个域名以英文逗号分隔
 * 默认包含 trae-api-cn.mchost.guru，便于本地与默认部署场景使用
 * 接入 OSS 后需将 OSS 自定义域名追加到此白名单
 */
function getImagesWhitelistDomains(): string[] {
  return env.IMAGES_WHITELIST_DOMAINS
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

/**
 * 校验单个图片 URL，支持两种合法格式：
 * 1. 本地上传返回的相对路径：必须以 /uploads/ 开头，禁止路径遍历（..）
 * 2. 外链 HTTPS 绝对 URL：协议必须为 https，hostname 必须在白名单内
 *
 * 兼容本地存储与云存储的设计：OSS 启用后上传接口会返回完整 HTTPS URL，
 * 走白名单校验；本地存储返回相对路径，走 /uploads/ 前缀校验
 */
export function validateImageUrl(url: string): void {
  // 本地上传相对路径：/uploads/ 前缀直接放行，仅做路径遍历防护
  if (url.startsWith('/uploads/')) {
    if (url.includes('..')) {
      throw new BadRequestError(`图片 URL 包含非法路径: ${url}`);
    }
    return;
  }

  // 外链必须是 HTTPS + 白名单域名
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestError(`图片 URL 格式不正确: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new BadRequestError(`图片 URL 必须使用 HTTPS 协议: ${url}`);
  }

  const whitelist = getImagesWhitelistDomains();
  if (!whitelist.includes(parsed.hostname)) {
    throw new BadRequestError(`图片 URL 域名不在白名单内: ${url}`);
  }
}

/**
 * 批量校验图片 URL 列表
 * 非数组或空数组直接通过，由上层 validator 负责必填校验
 */
export function validateImageUrls(images?: string[]): void {
  if (!Array.isArray(images) || images.length === 0) return;
  for (const url of images) {
    if (typeof url !== 'string') {
      throw new BadRequestError('图片 URL 必须为字符串');
    }
    validateImageUrl(url);
  }
}
