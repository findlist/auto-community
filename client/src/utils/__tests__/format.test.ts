import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatDate,
  formatDistanceToNow,
  formatPhone,
  formatCredits,
  formatTime,
} from "../format";

// format 工具函数测试：覆盖相对时间、手机号脱敏、积分格式化、时长格式化
describe("format - 格式化工具", () => {
  describe("formatDate（相对时间格式化）", () => {
    beforeEach(() => {
      // 固定当前时间，避免相对时间测试因运行时刻不同而 flaky
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("1分钟内应返回'刚刚'", () => {
      // 30秒前
      expect(formatDate("2026-07-08T11:59:30Z")).toBe("刚刚");
    });

    it("1-59分钟应返回'X分钟前'", () => {
      expect(formatDate("2026-07-08T11:30:00Z")).toBe("30分钟前");
      expect(formatDate("2026-07-08T11:01:00Z")).toBe("59分钟前");
    });

    it("1-23小时应返回'X小时前'", () => {
      expect(formatDate("2026-07-08T10:00:00Z")).toBe("2小时前");
      expect(formatDate("2026-07-07T13:00:00Z")).toBe("23小时前");
    });

    it("1-6天应返回'X天前'", () => {
      expect(formatDate("2026-07-06T12:00:00Z")).toBe("2天前");
      expect(formatDate("2026-07-02T12:00:00Z")).toBe("6天前");
    });

    it("7天以上当年应返回 MM-DD", () => {
      // 2026年6月1日（同年，超过7天）
      expect(formatDate("2026-06-01T00:00:00Z")).toBe("06-01");
    });

    it("跨年应返回 YYYY-MM-DD", () => {
      expect(formatDate("2025-06-01T00:00:00Z")).toBe("2025-06-01");
    });
  });

  describe("formatDistanceToNow（formatDate 别名）", () => {
    it("应与 formatDate 行为一致", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
      expect(formatDistanceToNow("2026-07-08T11:59:30Z")).toBe("刚刚");
      vi.useRealTimers();
    });
  });

  describe("formatPhone（手机号脱敏）", () => {
    it("11位手机号应脱敏中间4位", () => {
      expect(formatPhone("13800138000")).toBe("138****8000");
    });
    it("非11位应原样返回", () => {
      expect(formatPhone("123456")).toBe("123456");
      expect(formatPhone("12345678901234")).toBe("12345678901234");
      expect(formatPhone("")).toBe("");
    });
  });

  describe("formatCredits（积分格式化）", () => {
    it(">=10000 应格式化为'X.X万'", () => {
      expect(formatCredits(10000)).toBe("1.0万");
      expect(formatCredits(15000)).toBe("1.5万");
      expect(formatCredits(100000)).toBe("10.0万");
    });
    it("<10000 应原样返回数字字符串", () => {
      expect(formatCredits(0)).toBe("0");
      expect(formatCredits(9999)).toBe("9999");
      expect(formatCredits(500)).toBe("500");
    });
  });

  describe("formatTime（时长格式化）", () => {
    it("<60分钟应返回'X分钟'", () => {
      expect(formatTime(0)).toBe("0分钟");
      expect(formatTime(30)).toBe("30分钟");
      expect(formatTime(59)).toBe("59分钟");
    });
    it("整小时应返回'X小时'", () => {
      expect(formatTime(60)).toBe("1小时");
      expect(formatTime(120)).toBe("2小时");
      expect(formatTime(180)).toBe("3小时");
    });
    it("非整小时应返回'X小时X分钟'", () => {
      expect(formatTime(90)).toBe("1小时30分钟");
      expect(formatTime(125)).toBe("2小时5分钟");
    });
  });
});
