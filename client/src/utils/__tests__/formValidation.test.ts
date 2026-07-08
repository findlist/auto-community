import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  validateRequired,
  validateMinLength,
  validateMaxLength,
  validateRange,
  validatePhone,
  validateEmail,
  validatePrice,
  validateDate,
  validateFutureDate,
  composeValidators,
} from "../formValidation";

// 表单校验工具函数测试：所有函数返回 string|null，null 表示通过
// 设计原因：覆盖正常通过、空值跳过、边界值、非法值四类分支，确保校验逻辑闭环
describe("formValidation - 表单校验工具", () => {
  describe("validateRequired（必填校验）", () => {
    it("有内容应通过", () => {
      expect(validateRequired("张三", "姓名")).toBeNull();
    });
    it("空字符串应返回错误", () => {
      expect(validateRequired("", "姓名")).toBe("请填写姓名");
    });
    it("纯空格应返回错误（trim 后判定）", () => {
      expect(validateRequired("   ", "姓名")).toBe("请填写姓名");
    });
  });

  describe("validateMinLength（最小长度校验）", () => {
    it("空字符串应跳过返回 null（与 required 配合使用）", () => {
      expect(validateMinLength("", 3, "昵称")).toBeNull();
    });
    it("长度不足应返回错误", () => {
      expect(validateMinLength("ab", 3, "昵称")).toBe("昵称至少需要3个字符");
    });
    it("长度等于最小值应通过", () => {
      expect(validateMinLength("abc", 3, "昵称")).toBeNull();
    });
    it("长度超过最小值应通过", () => {
      expect(validateMinLength("abcd", 3, "昵称")).toBeNull();
    });
    it("应先 trim 再计算长度", () => {
      // 前后空格不计入长度：'  ab  ' trim 后为 'ab'，长度 2 < 3
      expect(validateMinLength("  ab  ", 3, "昵称")).toBe("昵称至少需要3个字符");
    });
  });

  describe("validateMaxLength（最大长度校验）", () => {
    it("空字符串应跳过返回 null", () => {
      expect(validateMaxLength("", 10, "备注")).toBeNull();
    });
    it("超长应返回错误", () => {
      expect(validateMaxLength("abcdefghijk", 10, "备注")).toBe("备注不能超过10个字符");
    });
    it("长度等于最大值应通过", () => {
      expect(validateMaxLength("abcdefghij", 10, "备注")).toBeNull();
    });
    it("应先 trim 再计算长度", () => {
      // '  abcdefghij  ' trim 后为 'abcdefghij'，长度 10 = max，应通过
      expect(validateMaxLength("  abcdefghij  ", 10, "备注")).toBeNull();
    });
  });

  describe("validateRange（数值范围校验）", () => {
    it("NaN 应返回错误", () => {
      expect(validateRange(NaN, 1, 10, "数量")).toBe("数量必须是数字");
    });
    it("小于最小值应返回错误", () => {
      expect(validateRange(0, 1, 10, "数量")).toBe("数量必须在1到10之间");
    });
    it("大于最大值应返回错误", () => {
      expect(validateRange(11, 1, 10, "数量")).toBe("数量必须在1到10之间");
    });
    it("等于最小值应通过", () => {
      expect(validateRange(1, 1, 10, "数量")).toBeNull();
    });
    it("等于最大值应通过", () => {
      expect(validateRange(10, 1, 10, "数量")).toBeNull();
    });
    it("范围内应通过", () => {
      expect(validateRange(5, 1, 10, "数量")).toBeNull();
    });
  });

  describe("validatePhone（手机号校验）", () => {
    it("空字符串应跳过返回 null", () => {
      expect(validatePhone("")).toBeNull();
    });
    it("合法手机号应通过", () => {
      expect(validatePhone("13800138000")).toBeNull();
      expect(validatePhone("19912345678")).toBeNull();
    });
    it("不足11位应返回错误", () => {
      expect(validatePhone("1380013800")).toBe("请输入正确的11位手机号");
    });
    it("超过11位应返回错误", () => {
      expect(validatePhone("138001380000")).toBe("请输入正确的11位手机号");
    });
    it("以 10/11/12 开头应返回错误（第二位必须是3-9）", () => {
      expect(validatePhone("10012345678")).toBe("请输入正确的11位手机号");
      expect(validatePhone("11012345678")).toBe("请输入正确的11位手机号");
      expect(validatePhone("12012345678")).toBe("请输入正确的11位手机号");
    });
    it("含非数字字符应返回错误", () => {
      expect(validatePhone("1380013800a")).toBe("请输入正确的11位手机号");
    });
    it("应先 trim 再校验", () => {
      expect(validatePhone("  13800138000  ")).toBeNull();
    });
  });

  describe("validateEmail（邮箱校验）", () => {
    it("空字符串应跳过返回 null", () => {
      expect(validateEmail("")).toBeNull();
    });
    it("合法邮箱应通过", () => {
      expect(validateEmail("user@example.com")).toBeNull();
      expect(validateEmail("test.name+tag@sub.domain.org")).toBeNull();
    });
    it("无 @ 应返回错误", () => {
      expect(validateEmail("userexample.com")).toBe("请输入正确的邮箱地址");
    });
    it("无域名应返回错误", () => {
      expect(validateEmail("user@")).toBe("请输入正确的邮箱地址");
    });
    it("无用户名应返回错误", () => {
      expect(validateEmail("@example.com")).toBe("请输入正确的邮箱地址");
    });
    it("无点号分隔的顶级域应返回错误", () => {
      expect(validateEmail("user@example")).toBe("请输入正确的邮箱地址");
    });
    it("含空格应返回错误", () => {
      expect(validateEmail("user @example.com")).toBe("请输入正确的邮箱地址");
    });
  });

  describe("validatePrice（价格校验）", () => {
    it("空字符串应跳过返回 null", () => {
      expect(validatePrice("")).toBeNull();
    });
    it("整数应通过", () => {
      expect(validatePrice("100")).toBeNull();
    });
    it("一位小数应通过", () => {
      expect(validatePrice("9.9")).toBeNull();
    });
    it("两位小数应通过", () => {
      expect(validatePrice("9.99")).toBeNull();
    });
    it("零应返回错误（必须为正数）", () => {
      expect(validatePrice("0")).toBe("请输入有效的价格（正数，最多2位小数）");
    });
    it("负数应返回错误", () => {
      expect(validatePrice("-5")).toBe("请输入有效的价格（正数，最多2位小数）");
    });
    it("三位小数应返回错误（最多2位小数）", () => {
      expect(validatePrice("9.999")).toBe("请输入有效的价格（正数，最多2位小数）");
    });
    it("非数字字符串应返回错误", () => {
      expect(validatePrice("abc")).toBe("请输入有效的价格（正数，最多2位小数）");
    });
  });

  describe("validateDate（日期校验）", () => {
    it("空字符串应跳过返回 null", () => {
      expect(validateDate("")).toBeNull();
    });
    it("合法日期应通过", () => {
      expect(validateDate("2026-01-01")).toBeNull();
      expect(validateDate("2026/01/01")).toBeNull();
    });
    it("非法日期字符串应返回错误", () => {
      expect(validateDate("not-a-date")).toBe("请输入有效的日期");
    });
    it("空字符串类型的非法值应返回错误", () => {
      expect(validateDate("abc")).toBe("请输入有效的日期");
    });
  });

  describe("validateFutureDate（未来日期校验）", () => {
    beforeEach(() => {
      // 固定当前时间，避免测试因运行时间不同而 flaky
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("空字符串应跳过返回 null", () => {
      expect(validateFutureDate("")).toBeNull();
    });
    it("非法日期应返回错误", () => {
      expect(validateFutureDate("not-a-date")).toBe("请输入有效的日期");
    });
    it("过去日期应返回错误", () => {
      expect(validateFutureDate("2020-01-01")).toBe("日期必须是未来的日期");
    });
    it("未来日期应通过", () => {
      expect(validateFutureDate("2027-01-01")).toBeNull();
    });
  });

  describe("composeValidators（组合校验）", () => {
    it("全部通过应返回 null", () => {
      // composeValidators 返回的函数接收一个 value，依次调用各校验器
      const combined = composeValidators(
        (v: string) => validateRequired(v, "字段"),
        (v: string) => validateMinLength(v, 2, "字段"),
      );
      expect(combined("ab")).toBeNull();
    });
    it("第一个校验失败应返回第一个错误", () => {
      const combined = composeValidators(
        (v: string) => validateRequired(v, "字段"),
        (v: string) => validateMinLength(v, 5, "字段"),
      );
      expect(combined("")).toBe("请填写字段");
    });
    it("中间校验失败应返回该中间错误", () => {
      const combined = composeValidators(
        (v: string) => validateRequired(v, "字段"),
        (v: string) => validateMinLength(v, 5, "字段"),
        (v: string) => validateMaxLength(v, 10, "字段"),
      );
      // 'ab' 通过 required，但 min=5 失败，应返回 min 错误，不执行 max 校验
      expect(combined("ab")).toBe("字段至少需要5个字符");
    });
    it("空校验器列表应始终返回 null", () => {
      const combined = composeValidators();
      expect(combined("anything")).toBeNull();
    });
  });
});
