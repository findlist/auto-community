import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormValidation } from "../useFormValidation";

// 构造测试用字段配置
function makeFields() {
  return {
    username: {
      value: "",
      rules: [
        (v: string) => (v.length < 2 ? "用户名至少2字符" : null),
        (v: string) => (v.length > 20 ? "用户名最多20字符" : null),
      ],
    },
    email: {
      value: "",
      rules: [
        (v: string) => (v === "" ? "邮箱不能为空" : null),
        (v: string) => (!v.includes("@") ? "邮箱格式不正确" : null),
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFormValidation", () => {
  it("初始状态：无错误、无 touched", () => {
    const { result } = renderHook(() => useFormValidation(makeFields()));
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.hasErrors()).toBe(false);
  });

  it("validateField：验证通过时返回 true 且无错误", () => {
    const fields = {
      username: { value: "validname", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    let isValid = false;
    act(() => {
      isValid = result.current.validateField("username");
    });
    expect(isValid).toBe(true);
    expect(result.current.errors.username).toBeNull();
  });

  it("validateField：验证失败时返回 false 且有错误消息", () => {
    const fields = {
      username: { value: "a", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    let isValid = true;
    act(() => {
      isValid = result.current.validateField("username");
    });
    expect(isValid).toBe(false);
    expect(result.current.errors.username).toBe("太短");
  });

  it("validateField：未知字段返回 true", () => {
    const { result } = renderHook(() => useFormValidation(makeFields()));
    let isValid = false;
    act(() => {
      isValid = result.current.validateField("unknown");
    });
    expect(isValid).toBe(true);
  });

  it("validateAll：全部通过时返回 true 并标记所有字段 touched", () => {
    const fields = {
      username: { value: "validname", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
      email: { value: "test@test.com", rules: [(v: string) => (!v.includes("@") ? "格式错误" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    let isValid = false;
    act(() => {
      isValid = result.current.validateAll();
    });
    expect(isValid).toBe(true);
    // 所有字段标记为 touched
    expect(result.current.touched.username).toBe(true);
    expect(result.current.touched.email).toBe(true);
  });

  it("validateAll：任一字段失败时返回 false", () => {
    const fields = {
      username: { value: "validname", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
      email: { value: "invalid", rules: [(v: string) => (!v.includes("@") ? "格式错误" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    let isValid = true;
    act(() => {
      isValid = result.current.validateAll();
    });
    expect(isValid).toBe(false);
    expect(result.current.errors.email).toBe("格式错误");
  });

  it("getFieldError：未 touched 时返回 null", () => {
    const fields = {
      username: { value: "a", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    // 未 validate 也未 touched
    expect(result.current.getFieldError("username")).toBeNull();
  });

  it("getFieldError：touched 后返回错误消息", () => {
    const fields = {
      username: { value: "a", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    act(() => {
      result.current.setTouched("username");
    });
    expect(result.current.getFieldError("username")).toBe("太短");
  });

  it("setTouched：标记字段为 touched 并触发验证", () => {
    const fields = {
      email: { value: "invalid", rules: [(v: string) => (!v.includes("@") ? "格式错误" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    act(() => {
      result.current.setTouched("email");
    });
    expect(result.current.touched.email).toBe(true);
    expect(result.current.errors.email).toBe("格式错误");
  });

  it("hasErrors：有错误时返回 true，无错误时返回 false", () => {
    const fields = {
      username: { value: "a", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    // 初始无错误
    expect(result.current.hasErrors()).toBe(false);
    // 验证后产生错误
    act(() => {
      result.current.validateField("username");
    });
    expect(result.current.hasErrors()).toBe(true);
  });

  it("reset：清空所有错误和 touched 状态", () => {
    const fields = {
      username: { value: "a", rules: [(v: string) => (v.length < 2 ? "太短" : null)] },
    };
    const { result } = renderHook(() => useFormValidation(fields));
    act(() => {
      result.current.validateAll();
    });
    expect(result.current.hasErrors()).toBe(true);
    expect(result.current.touched.username).toBe(true);
    // 重置
    act(() => {
      result.current.reset();
    });
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.hasErrors()).toBe(false);
  });
});
