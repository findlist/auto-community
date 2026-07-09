import { describe, it, expect } from "vitest";
import { ApiError } from "@/api/client";
import { getErrorMessage } from "../error";

// getErrorMessage 工具函数测试：覆盖 ApiError / Error / 字符串 / 未知类型四条路径
describe("getErrorMessage - 错误信息提取", () => {
  describe("ApiError 实例", () => {
    it("应返回 ApiError 的 message 字段", () => {
      const err = new ApiError("手机号已注册", 409);
      expect(getErrorMessage(err)).toBe("手机号已注册");
    });

    it("ApiError.message 为空字符串时应返回 fallback", () => {
      // 极端场景：后端返回 200 但 message 字段为空，拦截器构造 ApiError 时传空串
      const err = new ApiError("", 500);
      expect(getErrorMessage(err, "默认提示")).toBe("默认提示");
    });

    it("应使用自定义 fallback 兜底", () => {
      const err = new ApiError("", 500);
      expect(getErrorMessage(err, "操作失败")).toBe("操作失败");
    });

    it("应保留 ApiError 的 fieldErrors 元数据（不丢失上下文）", () => {
      // 验证 getErrorMessage 不破坏 ApiError 实例本身（仅读取 message）
      const fieldErrors = [{ field: "phone", message: "格式不正确" }];
      const err = new ApiError("参数校验失败", 422, fieldErrors);
      expect(getErrorMessage(err)).toBe("参数校验失败");
      expect(err.fieldErrors).toEqual(fieldErrors);
    });
  });

  describe("原生 Error 实例", () => {
    // 设计原因：原生 Error 多为网络异常/超时等技术性错误，message 不直接展示
    it("应返回 fallback 而非 Error.message（避免技术性信息泄露）", () => {
      const err = new Error("Network Error");
      expect(getErrorMessage(err)).toBe("操作失败，请稍后重试");
    });

    it("Error.message 为空时应返回 fallback", () => {
      const err = new Error("");
      expect(getErrorMessage(err, "未知错误")).toBe("未知错误");
    });
  });

  describe("字符串错误", () => {
    it("应原样返回字符串", () => {
      expect(getErrorMessage("请求超时")).toBe("请求超时");
    });

    it("空字符串应返回 fallback", () => {
      expect(getErrorMessage("", "默认提示")).toBe("默认提示");
    });
  });

  describe("未知类型", () => {
    it("number 类型应返回 fallback", () => {
      expect(getErrorMessage(42)).toBe("操作失败，请稍后重试");
    });

    it("null 应返回 fallback", () => {
      expect(getErrorMessage(null)).toBe("操作失败，请稍后重试");
    });

    it("undefined 应返回 fallback", () => {
      expect(getErrorMessage(undefined)).toBe("操作失败，请稍后重试");
    });

    it("对象应返回 fallback", () => {
      expect(getErrorMessage({ foo: "bar" })).toBe("操作失败，请稍后重试");
    });

    it("应支持自定义 fallback", () => {
      expect(getErrorMessage(42, "数字错误")).toBe("数字错误");
    });
  });

  describe("默认 fallback", () => {
    it("未传 fallback 时应使用默认文案", () => {
      expect(getErrorMessage(null)).toBe("操作失败，请稍后重试");
    });
  });
});
