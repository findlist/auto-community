// 客户端 JWT 解析与过期预判工具
// 设计原因：路由守卫原先只检查 isAuthenticated 布尔值，无法感知 token 已在服务端过期，
// 仍会放行进入受保护页面，直到下一次 API 请求触发 401 才被动清理。
// 此处仅解码 payload 检查 exp 字段做"预判"，不验证签名（签名验证仍由后端完成）。
// 真实安全性始终由后端鉴权保证，这里只是改善用户体验与减少无效请求。

// 过期判定提前量（毫秒）：避免客户端与服务器时钟差异导致 token 临过期时被误判为有效
// 设计原因：网络 RTT + 时钟漂移可能让"未过期"的 token 在抵达后端时刚好过期，留 30s 缓冲
const EXPIRY_SKEW_MS = 30 * 1000;

interface JwtPayload {
  exp?: number;
  [key: string]: unknown;
}

/**
 * 解码 JWT payload（第二段），不验证签名
 * @param token JWT 字符串
 * @returns 解码后的 payload 对象；token 非法或解析失败返回 null
 */
export function decodeJwt(token: string): JwtPayload | null {
  // JWT 由 header.payload.signature 三段组成，以 . 分隔
  const parts = token.split(".");
  // 严格索引访问下 parts[1] 可能为 undefined，需显式判空
  const payloadSegment = parts[1];
  if (parts.length !== 3 || !payloadSegment) {
    return null;
  }

  // base64url → base64：替换字符集差异并按需补齐 padding（=）
  // 设计原因：JWT 使用 base64url（- 与 _）而 atob 仅识别 base64（+ 与 /），需先转换
  let base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) {
    base64 += "=".repeat(4 - pad);
  }

  try {
    // atob 在浏览器与 Node 16+ 均可用；decodeURIComponent 处理 UTF-8 多字节字符
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 判断 token 是否已过期
 * 保守策略：无法判定（非法 token、解析失败、无 exp 字段）一律返回 false，
 * 让后端鉴权做最终裁决，避免误清除合法用户的登录态
 * @param token JWT 字符串
 * @returns true 表示已过期；false 表示未过期或无法判定
 */
export function isTokenExpired(token: string | null | undefined): boolean {
  if (!token) {
    // 无 token 不视为"过期"，由调用方根据 isAuthenticated 判断是否需要登录
    return false;
  }

  const payload = decodeJwt(token);
  if (!payload) {
    // 非法 token 无法判定，保守返回 false，交给后端鉴权
    return false;
  }

  // 无 exp 字段的 token（如旧版签发或非标准 JWT）无法判定，保守返回 false
  if (typeof payload.exp !== "number") {
    return false;
  }

  // exp 单位为秒，比较时换算为毫秒；预留时钟漂移缓冲
  return payload.exp * 1000 - Date.now() <= EXPIRY_SKEW_MS;
}
