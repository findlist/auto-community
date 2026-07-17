import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { decodeJwt, isTokenExpired } from "../jwt";

// 构造测试用 JWT 字符串
// 设计原因：JWT 由 header.payload.signature 三段 base64url 组成，测试需手造各场景 token
function makeToken(payload: Record<string, unknown>): string {
  // base64url 编码：浏览器与 Node 16+ 均支持 btoa
  const b64url = (obj: unknown) => {
    const json = JSON.stringify(obj);
    // encodeURIComponent + replace 处理 UTF-8 多字节字符，避免 btoa 报 InvalidCharacterError
    const base64 = btoa(
      encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
    // base64 → base64url：替换字符集并去除 padding
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;
}

describe("decodeJwt", () => {
  it("正常解码标准 JWT payload", () => {
    const token = makeToken({ sub: "user-1", name: "张三", exp: 9999999999 });
    const payload = decodeJwt(token);
    expect(payload).toEqual({
      sub: "user-1",
      name: "张三",
      exp: 9999999999,
    });
  });

  it("支持 base64url 字符集（- 与 _）", () => {
    // 构造会产生 + 与 / 的 payload，验证解码端能正确还原
    const token = makeToken({ data: "+++///===" });
    const payload = decodeJwt(token);
    expect(payload?.data).toBe("+++///===");
  });

  it("非 JWT 格式（段数不为 3）返回 null", () => {
    expect(decodeJwt("not-a-jwt")).toBeNull();
    expect(decodeJwt("only.two")).toBeNull();
    expect(decodeJwt("a.b.c.d")).toBeNull();
  });

  it("payload 非法 JSON 返回 null", () => {
    // 手造一个 payload 段不是合法 JSON 的 token
    const fakeBase64url = btoa("not-json").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `header.${fakeBase64url}.sig`;
    expect(decodeJwt(token)).toBeNull();
  });
});

describe("isTokenExpired", () => {
  beforeEach(() => {
    // 锁定时间避免用例间时间漂移影响断言
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("null / undefined / 空字符串返回 false（保守策略）", () => {
    // 设计原因：无 token 不视为过期，由调用方根据 isAuthenticated 判断是否登录
    expect(isTokenExpired(null)).toBe(false);
    expect(isTokenExpired(undefined)).toBe(false);
    expect(isTokenExpired("")).toBe(false);
  });

  it("未过期 token 返回 false", () => {
    // exp 设为当前时间 +1 小时
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = makeToken({ exp: futureExp });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("已过期 token 返回 true", () => {
    // exp 设为当前时间 -1 小时
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const token = makeToken({ exp: pastExp });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("距过期 30 秒内（含 30 秒缓冲）视为已过期", () => {
    // 设计原因：EXPIRY_SKEW_MS = 30 * 1000，预留时钟漂移缓冲
    // exp 设为当前时间 +20 秒（小于 30 秒缓冲），应判为过期
    const nearExp = Math.floor(Date.now() / 1000) + 20;
    const token = makeToken({ exp: nearExp });
    expect(isTokenExpired(token)).toBe(true);
  });

  it("距过期 60 秒外视为未过期", () => {
    // exp 设为当前时间 +60 秒（大于 30 秒缓冲），应判为未过期
    const safeExp = Math.floor(Date.now() / 1000) + 60;
    const token = makeToken({ exp: safeExp });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("无 exp 字段返回 false（保守策略，交给后端鉴权）", () => {
    const token = makeToken({ sub: "user-1" });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("exp 字段类型异常返回 false（保守策略）", () => {
    const token = makeToken({ exp: "not-a-number" });
    expect(isTokenExpired(token)).toBe(false);
  });

  it("非法 token 返回 false（保守策略）", () => {
    expect(isTokenExpired("illegal-token")).toBe(false);
  });
});
