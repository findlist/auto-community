import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import axios from "axios";
import { setupMockInterceptor } from "@/utils/mockInterceptor";
import { mockSkillPosts, mockTimeServices } from "@/utils/mockData";
import useAuthStore from "@/stores/authStore";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";

// 构造可控的 axios 请求配置，供 mockAdapter 直接调用
const buildConfig = (
  url: string,
  overrides: Partial<InternalAxiosRequestConfig> = {}
): InternalAxiosRequestConfig => ({
  url,
  method: "get",
  headers: {} as InternalAxiosRequestConfig["headers"],
  ...overrides,
} as InternalAxiosRequestConfig);

// 构造可控的 fallbackAdapter，用于验证透传逻辑
const buildFallbackAdapter = () =>
  vi.fn(async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
    data: { fallback: true },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
    request: {},
  }));

beforeEach(() => {
  // 每个测试前清空 localStorage 与 zustand store，确保无 token
  // 设计原因：token 已统一存储在 zustand store，需同时重置内存状态与 persist 持久化
  localStorage.clear();
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
});

describe("mockInterceptor - setupMockInterceptor 环境判断", () => {
  it("DEV 环境且无 token 时设置 mockAdapter（client.defaults.adapter 被替换为函数）", () => {
    // vitest 默认 import.meta.env.DEV = true
    const client = axios.create();
    expect(typeof client.defaults.adapter).not.toBe("function");
    setupMockInterceptor(client);
    // setupMockInterceptor 调用后 adapter 应为 mockAdapter 函数
    expect(typeof client.defaults.adapter).toBe("function");
  });

  it("DEV 环境但 zustand store 存在 token 时不设置 mockAdapter（已登录用户走真实接口）", () => {
    // 通过 store 写入 token，与生产路径一致
    useAuthStore.setState({ token: "fake-token" });
    const client = axios.create();
    const originalAdapter = client.defaults.adapter;
    setupMockInterceptor(client);
    // 未设置 adapter，保持原值
    expect(client.defaults.adapter).toBe(originalAdapter);
  });

  it("非 DEV 环境直接 return（生产环境不启用 mock）", async () => {
    // 通过 vi.stubEnv 修改 import.meta.env.DEV 为 false
    // 注：vitest 中 import.meta.env.DEV 可通过 vi.stubEnv 修改
    vi.stubEnv("DEV", false);
    const client = axios.create();
    const originalAdapter = client.defaults.adapter;
    setupMockInterceptor(client);
    // 非 DEV 环境 setupMockInterceptor 直接 return，adapter 未被替换
    expect(client.defaults.adapter).toBe(originalAdapter);
    // 恢复环境
    vi.stubEnv("DEV", true);
  });
});

describe("mockInterceptor - mockAdapter 方法判断", () => {
  it("GET 请求走 mock 逻辑（命中路由返回 mock 数据）", async () => {
    const client = axios.create();
    setupMockInterceptor(client);
    const adapter = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;

    const response = await adapter(buildConfig("skills/posts"));
    // 命中 skills/posts 列表路由，返回 mock 数据
    expect(response.status).toBe(200);
    const payload = response.data as { code: number; data: { list: unknown[] } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBe(mockSkillPosts.length);
  });

  it("POST 请求透传给 fallbackAdapter（mock 仅拦截 GET）", async () => {
    const client = axios.create();
    const fallbackAdapter = buildFallbackAdapter();
    // 手动设置 adapter 作为 fallback，axios.getAdapter 会返回它
    client.defaults.adapter = fallbackAdapter as unknown as InternalAxiosRequestConfig["adapter"];
    setupMockInterceptor(client);
    const adapter = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;

    await adapter(buildConfig("skills/posts", { method: "post" }));
    // POST 请求应透传给 fallbackAdapter
    expect(fallbackAdapter).toHaveBeenCalledTimes(1);
  });
});

describe("mockInterceptor - 路由匹配", () => {
  let adapter: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

  beforeEach(() => {
    const client = axios.create();
    setupMockInterceptor(client);
    adapter = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;
  });

  it("GET skills/posts 返回技能帖子分页列表", async () => {
    const res = await adapter(buildConfig("skills/posts"));
    const payload = res.data as { code: number; data: { list: unknown[]; total: number } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBe(mockSkillPosts.length);
    expect(payload.data.total).toBe(mockSkillPosts.length);
  });

  it("GET skills/posts/:id 返回单条帖子详情", async () => {
    const res = await adapter(buildConfig("skills/posts/sp1"));
    const payload = res.data as { code: number; data: { id: string } | null };
    expect(payload.code).toBe(0);
    expect(payload.data?.id).toBe("sp1");
  });

  it("GET skills/posts/不存在的id 返回 null", async () => {
    const res = await adapter(buildConfig("skills/posts/not-exist"));
    const payload = res.data as { code: number; data: unknown };
    expect(payload.code).toBe(0);
    expect(payload.data).toBeNull();
  });

  it("GET kitchen/posts 返回厨房帖子分页列表", async () => {
    const res = await adapter(buildConfig("kitchen/posts"));
    const payload = res.data as { code: number; data: { list: unknown[] } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBeGreaterThan(0);
  });

  it("GET kitchen/posts/:id 返回单条详情", async () => {
    const res = await adapter(buildConfig("kitchen/posts/kp1"));
    const payload = res.data as { code: number; data: { id: string } | null };
    expect(payload.data?.id).toBe("kp1");
  });

  it("GET kitchen/group-orders 返回拼单分页列表", async () => {
    const res = await adapter(buildConfig("kitchen/group-orders"));
    const payload = res.data as { code: number; data: { list: unknown[] } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBeGreaterThan(0);
  });

  it("GET kitchen/group-orders/:id 返回拼单详情", async () => {
    const res = await adapter(buildConfig("kitchen/group-orders/go1"));
    const payload = res.data as { code: number; data: { id: string } | null };
    expect(payload.data?.id).toBe("go1");
  });

  it("GET time-bank/services 返回时间银行服务分页列表", async () => {
    const res = await adapter(buildConfig("time-bank/services"));
    const payload = res.data as { code: number; data: { list: unknown[]; total: number } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBe(mockTimeServices.length);
    expect(payload.data.total).toBe(mockTimeServices.length);
  });

  it("GET time-bank/services/:id 返回服务详情", async () => {
    const res = await adapter(buildConfig("time-bank/services/ts1"));
    const payload = res.data as { code: number; data: { id: string } | null };
    expect(payload.data?.id).toBe("ts1");
  });

  it("GET emergency/requests 返回应急请求分页列表", async () => {
    const res = await adapter(buildConfig("emergency/requests"));
    const payload = res.data as { code: number; data: { list: unknown[] } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBeGreaterThan(0);
  });

  it("GET emergency/requests/:id 返回应急请求详情", async () => {
    const res = await adapter(buildConfig("emergency/requests/er1"));
    const payload = res.data as { code: number; data: { id: string } | null };
    expect(payload.data?.id).toBe("er1");
  });

  it("GET notifications 返回通知分页列表", async () => {
    const res = await adapter(buildConfig("notifications"));
    const payload = res.data as { code: number; data: { list: unknown[] } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBeGreaterThan(0);
  });

  it("未命中 mock 路由时透传给 fallbackAdapter", async () => {
    // 重新设置 client，注入可控 fallbackAdapter
    const client = axios.create();
    const fallbackAdapter = buildFallbackAdapter();
    client.defaults.adapter = fallbackAdapter as unknown as InternalAxiosRequestConfig["adapter"];
    setupMockInterceptor(client);
    const ad = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;

    // /auth/login 不在 mock 路由表，应透传
    await ad(buildConfig("auth/login"));
    expect(fallbackAdapter).toHaveBeenCalledTimes(1);
  });

  it("URL 含前导斜杠时正常匹配（规范化处理）", async () => {
    const res = await adapter(buildConfig("/skills/posts"));
    const payload = res.data as { code: number; data: { list: unknown[] } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBe(mockSkillPosts.length);
  });

  it("URL 含多斜杠前缀时正常匹配", async () => {
    const res = await adapter(buildConfig("///skills/posts"));
    const payload = res.data as { code: number; data: { list: unknown[] } };
    expect(payload.code).toBe(0);
    expect(payload.data.list.length).toBe(mockSkillPosts.length);
  });
});

describe("mockInterceptor - 分页逻辑", () => {
  let adapter: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

  beforeEach(() => {
    const client = axios.create();
    setupMockInterceptor(client);
    adapter = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;
  });

  it("默认 page=1/pageSize=20，返回首页数据", async () => {
    const res = await adapter(buildConfig("skills/posts", { params: {} }));
    const payload = res.data as { code: number; data: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean } };
    expect(payload.data.page).toBe(1);
    expect(payload.data.pageSize).toBe(20);
    expect(payload.data.total).toBe(mockSkillPosts.length);
    // totalPages = max(1, ceil(total/pageSize))
    expect(payload.data.totalPages).toBe(Math.max(1, Math.ceil(mockSkillPosts.length / 20)));
  });

  it("自定义 page=2/pageSize=2 时返回第二页数据", async () => {
    const res = await adapter(buildConfig("skills/posts", { params: { page: 2, pageSize: 2 } }));
    const payload = res.data as { code: number; data: { list: unknown[]; page: number; pageSize: number; hasNext: boolean } };
    expect(payload.data.page).toBe(2);
    expect(payload.data.pageSize).toBe(2);
    // 第二页应返回 2 条（假设总数 > 2）
    expect(payload.data.list.length).toBe(Math.min(2, Math.max(0, mockSkillPosts.length - 2)));
    // hasNext = page < totalPages
    const totalPages = Math.max(1, Math.ceil(mockSkillPosts.length / 2));
    expect(payload.data.hasNext).toBe(2 < totalPages);
  });

  it("pageSize 超过总数时 hasNext=false（无下一页）", async () => {
    const res = await adapter(buildConfig("skills/posts", { params: { page: 1, pageSize: 1000 } }));
    const payload = res.data as { code: number; data: { hasNext: boolean; totalPages: number } };
    // 总数远小于 1000，只有 1 页，hasNext=false
    expect(payload.data.hasNext).toBe(false);
    expect(payload.data.totalPages).toBe(1);
  });

  it("空列表数据 totalPages 兜底为 1（Math.max(1, ...)）", async () => {
    // 通过过滤条件使结果为空：type=不存在的值
    const res = await adapter(buildConfig("skills/posts", { params: { type: "nonexistent-type" } }));
    const payload = res.data as { code: number; data: { list: unknown[]; total: number; totalPages: number } };
    expect(payload.data.list.length).toBe(0);
    expect(payload.data.total).toBe(0);
    // Math.max(1, Math.ceil(0/20)) = Math.max(1, 0) = 1
    expect(payload.data.totalPages).toBe(1);
  });
});

describe("mockInterceptor - 过滤逻辑", () => {
  let adapter: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>;

  beforeEach(() => {
    const client = axios.create();
    setupMockInterceptor(client);
    adapter = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;
  });

  it("skills/posts 按 type=offer 过滤（仅返回 offer 类型）", async () => {
    const res = await adapter(buildConfig("skills/posts", { params: { type: "offer" } }));
    const payload = res.data as { code: number; data: { list: Array<{ type: string }> } };
    // 所有返回项 type 应为 offer
    expect(payload.data.list.every((p) => p.type === "offer")).toBe(true);
    // mockData 中 offer 类型的数量
    const expectedCount = mockSkillPosts.filter((p) => p.type === "offer").length;
    expect(payload.data.list.length).toBe(expectedCount);
  });

  it("skills/posts 按 category 过滤", async () => {
    // noUncheckedIndexedAccess 模式下索引访问返回 T | undefined，用 ! 断言非空
    const targetCategory = mockSkillPosts[0]!.category;
    const res = await adapter(buildConfig("skills/posts", { params: { category: targetCategory } }));
    const payload = res.data as { code: number; data: { list: Array<{ category: string }> } };
    expect(payload.data.list.every((p) => p.category === targetCategory)).toBe(true);
  });

  it("skills/posts 按 keyword 过滤（title/description 模糊匹配，不区分大小写）", async () => {
    // 用 mockData 第一条标题的关键词
    const keyword = mockSkillPosts[0]!.title.slice(0, 2);
    const res = await adapter(buildConfig("skills/posts", { params: { keyword } }));
    const payload = res.data as { code: number; data: { list: Array<{ title: string; description: string }> } };
    // 返回项应包含关键词（title 或 description）
    const kw = keyword.toLowerCase();
    expect(
      payload.data.list.every(
        (p) => p.title.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw)
      )
    ).toBe(true);
  });

  it("time-bank/services 按 type=provide 过滤", async () => {
    const res = await adapter(buildConfig("time-bank/services", { params: { type: "provide" } }));
    const payload = res.data as { code: number; data: { list: Array<{ type: string }> } };
    expect(payload.data.list.every((s) => s.type === "provide")).toBe(true);
    const expectedCount = mockTimeServices.filter((s) => s.type === "provide").length;
    expect(payload.data.list.length).toBe(expectedCount);
  });

  it("emergency/requests 按 type 过滤", async () => {
    // 先获取所有 emergency 的 type 类型
    const allRes = await adapter(buildConfig("emergency/requests"));
    const allPayload = allRes.data as { code: number; data: { list: Array<{ type: string }> } };
    // noUncheckedIndexedAccess 模式下索引访问返回 T | undefined，用 ! 断言非空
    const firstType = allPayload.data.list[0]!.type;

    const res = await adapter(buildConfig("emergency/requests", { params: { type: firstType } }));
    const payload = res.data as { code: number; data: { list: Array<{ type: string }> } };
    expect(payload.data.list.every((r) => r.type === firstType)).toBe(true);
  });
});

describe("mockInterceptor - 响应结构", () => {
  it("mock 响应 status=200/statusText=OK/headers={}/config 透传", async () => {
    const client = axios.create();
    setupMockInterceptor(client);
    const adapter = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;

    const config = buildConfig("skills/posts");
    const res = await adapter(config);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.headers).toEqual({});
    // config 应透传原 config 对象
    expect(res.config).toBe(config);
  });

  it("mock 响应 data 结构为 { code: 0, message: 'ok', data: ... }", async () => {
    const client = axios.create();
    setupMockInterceptor(client);
    const adapter = client.defaults.adapter as unknown as (
      config: InternalAxiosRequestConfig
    ) => Promise<AxiosResponse>;

    const res = await adapter(buildConfig("skills/posts"));
    const payload = res.data as { code: number; message: string; data: unknown };
    expect(payload.code).toBe(0);
    expect(payload.message).toBe("ok");
    expect(payload.data).toBeDefined();
  });
});
