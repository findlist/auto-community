import { Request, Response, NextFunction, RequestHandler } from 'express';
import { writeAuditLog, AuditLogParams } from '../services/audit.service';
import { logger } from '../utils/logger';

// 敏感字段关键词清单：用子串匹配覆盖字段名变体
// 设计原因：原 SENSITIVE_FIELDS 用精确匹配，无法覆盖 phoneNumber、user_phone、idCardNumber、
// accessToken、refreshToken、clientSecret、sessionId 等变体，导致 PII 经字段名变体泄露。
// 子串匹配在请求体场景下误伤风险极低（不太可能有 smartphone/headphone 等字段名），可接受。
const SENSITIVE_KEYWORDS = [
  'password', // 命中 password、passwordHash、passwordConfirm
  'phone',    // 命中 phone、phoneNumber、user_phone、phone_number
  'mobile',   // 命中 mobile、mobileNumber
  'idcard',   // 命中 idcard、idCardNumber（toLowerCase 后包含 idcard）
  'id_card',  // 命中 id_card、id_card_number
  'token',    // 命中 token、accessToken、refreshToken、csrf_token
  'secret',   // 命中 secret、clientSecret、apiSecret
  'apikey',   // 命中 apikey、apiKey（toLowerCase 后 apikey）
  'api_key',  // 命中 api_key
  'session',  // 命中 sessionId、session_token
];

function isSensitiveField(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

// 审计中间件配置
interface AuditMiddlewareOptions {
  // 资源类型，如 user/order/transaction
  resourceType?: string;
  // 从请求中提取资源 ID 的函数
  getResourceId?: (req: Request) => string | undefined;
  // 动态生成 action 名称（当同一接口处理多种操作时使用）
  getAction?: (req: Request) => string;
}

/**
 * 对请求体进行脱敏处理
 * 将敏感字段的值替换为 ***，保留字段名以便排查问题
 * 入参与返回用 unknown：请求体结构不定（可能是对象/字符串/Buffer），用 unknown 强制消费方类型收窄
 *
 * 设计原因：递归处理嵌套对象与数组，避免 { user: { phone, password } } 形式的请求体
 * 在内层命中敏感字段时被原样写入审计日志，造成 PII 泄露。
 * 数组场景同样需递归：批量接口 { users: [{ password }] } 中数组元素的敏感字段也必须脱敏。
 * 递归深度限制 MAX_SANITIZE_DEPTH 防止恶意构造超深嵌套导致栈溢出。
 */
const MAX_SANITIZE_DEPTH = 5;
function sanitizeRequestBody(body: unknown, depth = 0): unknown {
  // 超过最大递归深度直接脱敏整个值，避免栈溢出
  if (depth >= MAX_SANITIZE_DEPTH) {
    return '***';
  }
  // null 或非对象直接返回（string/number/boolean/undefined 不需要脱敏）
  if (!body || typeof body !== 'object') {
    return body;
  }
  // 数组：递归处理每个元素，确保元素为对象时内层敏感字段也被覆盖
  if (Array.isArray(body)) {
    return body.map((item) => sanitizeRequestBody(item, depth + 1));
  }
  // 类型收窄后 body 为 object，但为保留字段索引能力用 Record<string, unknown>
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    // 字段名小写后命中任一敏感关键词则脱敏（子串匹配覆盖字段名变体）
    if (isSensitiveField(key)) {
      sanitized[key] = '***';
    } else if (typeof value === 'object' && value !== null) {
      // 嵌套对象或数组递归脱敏，确保内层敏感字段也被覆盖
      sanitized[key] = sanitizeRequestBody(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * 从响应体中提取错误信息
 * 入参用 unknown：res.send 的 body 可能是 Buffer/string/object
 */
function extractErrorMessage(body: unknown): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    // parsed 可能是任意 JSON 结构，用类型断言访问 message/error 字段
    const obj = parsed as { message?: string; error?: string };
    return obj?.message || obj?.error;
  } catch {
    return typeof body === 'string' ? body.substring(0, 500) : undefined;
  }
}

/**
 * 审计日志中间件工厂
 * 包装 res.send 捕获响应状态码与错误信息，异步写入审计日志（不阻塞响应）
 *
 * @param action 操作类型，如 LOGIN/TRANSFER/COMPLETE_ORDER
 * @param options 资源类型与资源 ID 提取配置
 */
export function auditMiddleware(
  action: string,
  options?: AuditMiddlewareOptions,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 保存原始 res.send 引用，确保 this 指向正确
    const originalSend = res.send.bind(res);

    // 覆盖 res.send 以捕获响应内容
    // body 用 unknown：Express res.send 接受任意类型（string/Buffer/object），用 unknown 强制内部类型收窄
    res.send = function (body?: unknown): Response {
      // 先恢复原始 send，避免后续调用重复触发审计
      res.send = originalSend;

      // 支持动态 action（同一接口处理多种操作时按请求体区分）
      const actualAction = options?.getAction ? options.getAction(req) : action;

      const statusCode = res.statusCode;
      const status: 'success' | 'failed' = statusCode < 400 ? 'success' : 'failed';
      const errorMessage = status === 'failed' ? extractErrorMessage(body) : undefined;

      const auditParams: AuditLogParams = {
        userId: req.user?.id,
        action: actualAction,
        resourceType: options?.resourceType,
        resourceId: options?.getResourceId?.(req),
        ip: req.ip || req.socket?.remoteAddress,
        userAgent: req.get('user-agent'),
        requestBody: sanitizeRequestBody(req.body),
        status,
        errorMessage,
      };

      // 异步写入审计日志，不阻塞响应；失败仅记录日志不抛出
      writeAuditLog(auditParams).catch((err) => {
        logger.error({ err, action: actualAction }, '审计日志写入异常');
      });

      return originalSend(body);
    } as typeof res.send;

    next();
  };
}
