import { describe, it, expect } from "vitest";
import { toCamelCase, toSnakeCase, convertKeys } from "../caseConverter";

describe("caseConverter - 键名转换工具", () => {
  describe("toCamelCase（snake_case → camelCase）", () => {
    it("应将下划线命名转为驼峰", () => {
      expect(toCamelCase("duration_minutes")).toBe("durationMinutes");
      expect(toCamelCase("to_user_id")).toBe("toUserId");
      expect(toCamelCase("created_at")).toBe("createdAt");
      expect(toCamelCase("order_id")).toBe("orderId");
    });

    it("已是 camelCase 的键应幂等不变", () => {
      expect(toCamelCase("durationMinutes")).toBe("durationMinutes");
      expect(toCamelCase("orderId")).toBe("orderId");
    });

    it("无下划线的简单键应原样返回", () => {
      expect(toCamelCase("title")).toBe("title");
      expect(toCamelCase("id")).toBe("id");
    });

    it("连续下划线应正确处理", () => {
      // 双下划线中间空字符不会被 [a-z] 匹配，仅转换有效下划线后跟字母的位置
      expect(toCamelCase("user__name")).toBe("user_Name");
    });

    it("全大写键名应保持原样（无下划线触发转换）", () => {
      expect(toCamelCase("URL")).toBe("URL");
    });
  });

  describe("toSnakeCase（camelCase → snake_case）", () => {
    it("应将驼峰命名转为下划线", () => {
      expect(toSnakeCase("durationMinutes")).toBe("duration_minutes");
      expect(toSnakeCase("toUserId")).toBe("to_user_id");
      expect(toSnakeCase("createdAt")).toBe("created_at");
      expect(toSnakeCase("orderId")).toBe("order_id");
    });

    it("已是 snake_case 的键应幂等不变", () => {
      expect(toSnakeCase("duration_minutes")).toBe("duration_minutes");
      expect(toSnakeCase("order_id")).toBe("order_id");
    });

    it("无大写字母的简单键应原样返回", () => {
      expect(toSnakeCase("title")).toBe("title");
      expect(toSnakeCase("id")).toBe("id");
    });

    it("首字符大写的键应仅转小写首字符，不加下划线前缀", () => {
      // PascalCase 首字符大写：offset===0 时只转小写，不加下划线
      expect(toSnakeCase("HelloWorld")).toBe("hello_world");
    });

    it("连续大写字母应每个都加下划线", () => {
      expect(toSnakeCase("userID")).toBe("user_i_d");
    });
  });

  describe("convertKeys - 递归转换", () => {
    it("应递归转换嵌套对象的键名", () => {
      const input = {
        user_id: "u1",
        created_at: "2026-01-01",
        nested: {
          order_id: "o1",
          deep: { total_amount: 100 },
        },
      };
      const result = convertKeys(input, toCamelCase);
      expect(result).toEqual({
        userId: "u1",
        createdAt: "2026-01-01",
        nested: {
          orderId: "o1",
          deep: { totalAmount: 100 },
        },
      });
    });

    it("应递归转换数组内对象的键名", () => {
      const input = {
        list: [
          { order_id: "o1", total_amount: 100 },
          { order_id: "o2", total_amount: 200 },
        ],
        total: 2,
      };
      const result = convertKeys(input, toCamelCase);
      expect(result).toEqual({
        list: [
          { orderId: "o1", totalAmount: 100 },
          { orderId: "o2", totalAmount: 200 },
        ],
        total: 2,
      });
    });

    it("应保留基本类型与 null/undefined 不转换", () => {
      expect(convertKeys(null, toCamelCase)).toBeNull();
      expect(convertKeys(undefined, toCamelCase)).toBeUndefined();
      expect(convertKeys("string", toCamelCase)).toBe("string");
      expect(convertKeys(123, toCamelCase)).toBe(123);
      expect(convertKeys(true, toCamelCase)).toBe(true);
    });

    it("应原样返回 Date/RegExp 等类实例，不破坏其语义", () => {
      const date = new Date("2026-01-01");
      const regex = /test/;
      expect(convertKeys(date, toCamelCase)).toBe(date);
      expect(convertKeys(regex, toCamelCase)).toBe(regex);
    });

    it("应原样返回 Blob/File/FormData 等二进制或表单对象", () => {
      const blob = new Blob(["data"], { type: "text/plain" });
      const formData = new FormData();
      formData.append("key", "value");
      expect(convertKeys(blob, toCamelCase)).toBe(blob);
      expect(convertKeys(formData, toCamelCase)).toBe(formData);
    });

    it("数组应仅递归转换元素，不转换数组索引", () => {
      const input = [{ order_id: "o1" }, { order_id: "o2" }];
      const result = convertKeys(input, toCamelCase);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([{ orderId: "o1" }, { orderId: "o2" }]);
    });

    it("Object.create(null) 创建的无原型对象应可被转换", () => {
      const obj = Object.create(null);
      obj.user_id = "u1";
      const result = convertKeys(obj, toCamelCase);
      expect(result).toEqual({ userId: "u1" });
    });

    it("请求方向：camelCase → snake_case 完整示例", () => {
      const request = {
        durationMinutes: 30,
        toUserId: "u2",
        images: ["img1.jpg"],
        nested: { parentPhone: "13800138000" },
      };
      const result = convertKeys(request, toSnakeCase);
      expect(result).toEqual({
        duration_minutes: 30,
        to_user_id: "u2",
        images: ["img1.jpg"],
        nested: { parent_phone: "13800138000" },
      });
    });

    it("响应方向：snake_case → camelCase 完整示例", () => {
      const response = {
        code: 0,
        message: "ok",
        data: {
          service_id: "s1",
          duration_minutes: 60,
          created_at: "2026-01-01",
          images: ["a.jpg", "b.jpg"],
          user: { user_id: "u1", nickname: "张三" },
        },
      };
      const result = convertKeys(response, toCamelCase);
      expect(result).toEqual({
        code: 0,
        message: "ok",
        data: {
          serviceId: "s1",
          durationMinutes: 60,
          createdAt: "2026-01-01",
          images: ["a.jpg", "b.jpg"],
          user: { userId: "u1", nickname: "张三" },
        },
      });
    });

    it("已是目标命名风格的键应幂等不变（避免双重转换）", () => {
      // 响应已是 camelCase：toCamelCase 不改变无下划线的键
      const camelData = { durationMinutes: 30, createdAt: "2026-01-01" };
      expect(convertKeys(camelData, toCamelCase)).toEqual({
        durationMinutes: 30,
        createdAt: "2026-01-01",
      });
      // 请求已是 snake_case：toSnakeCase 不改变无大写字母的键
      const snakeData = { duration_minutes: 30, created_at: "2026-01-01" };
      expect(convertKeys(snakeData, toSnakeCase)).toEqual({
        duration_minutes: 30,
        created_at: "2026-01-01",
      });
    });

    it("混合命名风格应统一转换（幂等性保障向后兼容）", () => {
      // 后端某些接口可能混合返回 camelCase 与 snake_case 字段
      const mixed = {
        userId: "u1", // 已 camelCase
        created_at: "2026-01-01", // snake_case
        nested: { orderId: "o1", total_amount: 100 },
      };
      const result = convertKeys(mixed, toCamelCase);
      expect(result).toEqual({
        userId: "u1",
        createdAt: "2026-01-01",
        nested: { orderId: "o1", totalAmount: 100 },
      });
    });
  });
});
