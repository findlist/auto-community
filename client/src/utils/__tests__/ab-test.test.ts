import { describe, it, expect, beforeEach, vi } from "vitest";

// mock @/api/ab-test 模块，避免真实网络请求
// 设计原因：utils/ab-test.ts 的核心逻辑是本地缓存 + API 调用编排，
// API 层应被隔离测试，仅验证缓存读写与调用顺序
vi.mock("@/api/ab-test", () => ({
  assignVariant: vi.fn(),
  recordEvent: vi.fn(),
}));

import { getVariant, trackEvent, clearVariantCache } from "../ab-test";
import { assignVariant, recordEvent } from "@/api/ab-test";

// localStorage 在 jsdom 环境中原生可用，每个用例前清空避免相互污染
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("ab-test - A/B 测试变体分配工具", () => {
  describe("getVariant（获取变体）", () => {
    it("缓存命中时应直接返回缓存值，不调用 API", async () => {
      // 预置有效缓存：timestamp 为当前时间，未过期
      const cached = { variant: "control", timestamp: Date.now() };
      localStorage.setItem("ab_variant_test1", JSON.stringify(cached));

      const result = await getVariant("test1");

      expect(result).toBe("control");
      expect(assignVariant).not.toHaveBeenCalled();
    });

    it("缓存未命中时应调用 API 并将结果写入缓存", async () => {
      // mock API 返回变体 B
      vi.mocked(assignVariant).mockResolvedValueOnce({
        code: 0, message: "ok", data: { variant: "variant_b", testName: "test1" },
      });

      const result = await getVariant("test1");

      expect(result).toBe("variant_b");
      expect(assignVariant).toHaveBeenCalledWith("test1");
      // 缓存应已写入，下次调用不再请求 API
      const raw = localStorage.getItem("ab_variant_test1");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.variant).toBe("variant_b");
    });

    it("缓存过期时应清除旧缓存并重新调用 API", async () => {
      // 预置过期缓存：timestamp 早于 24 小时 TTL
      const expiredTs = Date.now() - 25 * 60 * 60 * 1000;
      localStorage.setItem("ab_variant_test1", JSON.stringify({ variant: "old", timestamp: expiredTs }));

      vi.mocked(assignVariant).mockResolvedValueOnce({
        code: 0, message: "ok", data: { variant: "new", testName: "test1" },
      });

      const result = await getVariant("test1");

      expect(result).toBe("new");
      expect(assignVariant).toHaveBeenCalledWith("test1");
      // 旧缓存应被清除，新缓存应已写入
      const raw = localStorage.getItem("ab_variant_test1");
      const parsed = JSON.parse(raw!);
      expect(parsed.variant).toBe("new");
    });

    it("缓存 JSON 损坏时应回退到 API 调用", async () => {
      // 预置无效 JSON（getCachedVariant 的 try-catch 应返回 null）
      localStorage.setItem("ab_variant_test1", "{invalid json");

      vi.mocked(assignVariant).mockResolvedValueOnce({
        code: 0, message: "ok", data: { variant: "fresh", testName: "test1" },
      });

      const result = await getVariant("test1");

      expect(result).toBe("fresh");
      expect(assignVariant).toHaveBeenCalledWith("test1");
    });
  });

  describe("trackEvent（记录事件）", () => {
    it("应先获取变体再调用 recordEvent", async () => {
      // 预置缓存避免 getVariant 调用 API
      localStorage.setItem("ab_variant_test1", JSON.stringify({ variant: "control", timestamp: Date.now() }));
      vi.mocked(recordEvent).mockResolvedValueOnce({ code: 0, message: "ok", data: null });

      await trackEvent("test1", "click", { source: "banner" });

      expect(recordEvent).toHaveBeenCalledWith("test1", "click", "control", { source: "banner" });
    });

    it("无 metadata 时应传 undefined 给 recordEvent", async () => {
      localStorage.setItem("ab_variant_test1", JSON.stringify({ variant: "control", timestamp: Date.now() }));
      vi.mocked(recordEvent).mockResolvedValueOnce({ code: 0, message: "ok", data: null });

      await trackEvent("test1", "view");

      expect(recordEvent).toHaveBeenCalledWith("test1", "view", "control", undefined);
    });
  });

  describe("clearVariantCache（清除缓存）", () => {
    it("指定 testName 时应仅清除该 testName 的缓存", () => {
      localStorage.setItem("ab_variant_test1", JSON.stringify({ variant: "a", timestamp: 1 }));
      localStorage.setItem("ab_variant_test2", JSON.stringify({ variant: "b", timestamp: 1 }));
      // 非 ab_variant_ 前缀的 key 不应被清除
      localStorage.setItem("other_key", "keep");

      clearVariantCache("test1");

      expect(localStorage.getItem("ab_variant_test1")).toBeNull();
      expect(localStorage.getItem("ab_variant_test2")).not.toBeNull();
      expect(localStorage.getItem("other_key")).toBe("keep");
    });

    it("不传参数时应清除所有 ab_variant_ 前缀的缓存", () => {
      localStorage.setItem("ab_variant_test1", JSON.stringify({ variant: "a", timestamp: 1 }));
      localStorage.setItem("ab_variant_test2", JSON.stringify({ variant: "b", timestamp: 1 }));
      localStorage.setItem("unrelated", "keep");

      clearVariantCache();

      expect(localStorage.getItem("ab_variant_test1")).toBeNull();
      expect(localStorage.getItem("ab_variant_test2")).toBeNull();
      // 非前缀 key 不受影响
      expect(localStorage.getItem("unrelated")).toBe("keep");
    });
  });
});
