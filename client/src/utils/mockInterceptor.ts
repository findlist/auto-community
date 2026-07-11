import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type {
  ApiResponse,
  PaginatedResponse,
  SkillPost,
  KitchenPost,
  TimeService,
  EmergencyRequest,
} from "@/types";
import {
  mockSkillPosts,
  mockKitchenPosts,
  mockGroupOrders,
  mockTimeServices,
  mockEmergencyRequests,
  mockNotifications,
} from "./mockData";

// 查询参数类型（宽松处理，避免类型冲突）
type QueryParams = Record<string, unknown>;

// 构造分页响应数据
function paginate<T>(list: T[], params: QueryParams): PaginatedResponse<T> {
  const page = Number(params.page ?? 1);
  const pageSize = Number(params.pageSize ?? 20);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const pageList = list.slice(start, start + pageSize);
  return {
    list: pageList,
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
  };
}

// 构造统一 API 响应
function apiOk<T>(data: T): ApiResponse<T> {
  return { code: 0, message: "ok", data };
}

// 构造 axios 响应对象
function buildResponse(
  config: InternalAxiosRequestConfig,
  payload: unknown
): AxiosResponse {
  return {
    data: payload,
    status: 200,
    statusText: "OK",
    headers: {},
    config,
    request: {},
  };
}

// 根据查询参数过滤技能帖子
function filterSkillPosts(params: QueryParams): PaginatedResponse<SkillPost> {
  let list = [...mockSkillPosts];
  if (params.type) {
    list = list.filter((p) => p.type === params.type);
  }
  if (params.category) {
    list = list.filter((p) => p.category === params.category);
  }
  if (params.keyword) {
    const kw = String(params.keyword).toLowerCase();
    list = list.filter(
      (p) =>
        p.title.toLowerCase().includes(kw) ||
        p.description.toLowerCase().includes(kw)
    );
  }
  // mockSkillPosts 已使用 SkillPost 类型（creditPrice 字段），无需转换
  return paginate(list, params);
}

// 根据查询参数过滤厨房帖子
function filterKitchenPosts(params: QueryParams): PaginatedResponse<KitchenPost> {
  let list = [...mockKitchenPosts];
  if (params.type) {
    list = list.filter((p) => p.type === params.type);
  }
  if (params.category) {
    list = list.filter((p) => p.category === params.category);
  }
  return paginate(list, params);
}

// 根据查询参数过滤时间银行服务
function filterTimeServices(params: QueryParams): PaginatedResponse<TimeService> {
  let list = [...mockTimeServices];
  if (params.type) {
    list = list.filter((s) => s.type === params.type);
  }
  return paginate(list, params);
}

// 根据查询参数过滤应急请求
function filterEmergencyRequests(
  params: QueryParams
): PaginatedResponse<EmergencyRequest> {
  let list = [...mockEmergencyRequests];
  if (params.type) {
    list = list.filter((r) => r.type === params.type);
  }
  return paginate(list, params);
}

// 根据 id 从列表中查找单条数据，找不到返回 null（详情页据此显示「已删除/不存在」）
function findById<T extends { id: string }>(list: T[], id: string | undefined): T | null {
  if (!id) return null;
  return list.find((item) => item.id === id) ?? null;
}

// 路由匹配表：URL → mock 响应构造函数
// handler 第二个参数为正则匹配结果，用于从 URL 中提取 id 等路径参数
const mockRoutes: Array<{
  pattern: RegExp;
  handler: (params: QueryParams, match: RegExpExecArray | null) => unknown;
}> = [
  // 技能：列表 + 详情（API 路径为 skills/posts/...）
  { pattern: /^skills\/posts\/?$/, handler: (p) => apiOk(filterSkillPosts(p)) },
  { pattern: /^skills\/posts\/([^/]+)\/?$/, handler: (_p, m) => apiOk(findById(mockSkillPosts, m![1])) },

  // 共享厨房：列表 + 详情
  { pattern: /^kitchen\/posts\/?$/, handler: (p) => apiOk(filterKitchenPosts(p)) },
  { pattern: /^kitchen\/posts\/([^/]+)\/?$/, handler: (_p, m) => apiOk(findById(mockKitchenPosts, m![1])) },

  // 拼单：列表 + 详情
  { pattern: /^kitchen\/group-orders\/?$/, handler: (p) => apiOk(paginate(mockGroupOrders, p)) },
  { pattern: /^kitchen\/group-orders\/([^/]+)\/?$/, handler: (_p, m) => apiOk(findById(mockGroupOrders, m![1])) },

  // 时间银行：列表 + 详情
  { pattern: /^time-bank\/services\/?$/, handler: (p) => apiOk(filterTimeServices(p)) },
  { pattern: /^time-bank\/services\/([^/]+)\/?$/, handler: (_p, m) => apiOk(findById(mockTimeServices, m![1])) },

  // 应急：列表 + 详情
  { pattern: /^emergency\/requests\/?$/, handler: (p) => apiOk(filterEmergencyRequests(p)) },
  { pattern: /^emergency\/requests\/([^/]+)\/?$/, handler: (_p, m) => apiOk(findById(mockEmergencyRequests, m![1])) },

  { pattern: /^notifications\/?$/, handler: (p) => apiOk(paginate(mockNotifications, p)) },
];

// 尝试匹配 mock 路由，命中则返回响应数据
function matchMockRoute(url: string, params: QueryParams): unknown | null {
  for (const route of mockRoutes) {
    const match = route.pattern.exec(url);
    if (match) {
      return route.handler(params, match);
    }
  }
  return null;
}

/**
 * 在开发环境下为 axios 实例设置 mock 拦截器。
 * 仅当处于开发环境且 localStorage 中不存在 token 时启用，
 * 避免影响已登录用户的真实请求。
 */
export function setupMockInterceptor(client: AxiosInstance): void {
  // 仅开发环境启用
  if (!import.meta.env.DEV) return;
  // 已登录用户不启用 mock，使用真实接口
  if (localStorage.getItem("token")) return;

  // 保存默认适配器，用于未匹配路由的透传
  const fallbackAdapter = axios.getAdapter(
    client.defaults.adapter ?? axios.defaults.adapter
  );

  const mockAdapter = async (
    config: InternalAxiosRequestConfig
  ): Promise<AxiosResponse> => {
    const method = (config.method ?? "get").toLowerCase();

    // 仅拦截 GET 请求，其他方法透传给默认适配器
    if (method !== "get") {
      return fallbackAdapter(config);
    }

    // 规范化 URL：去除前导斜杠，便于匹配
    const url = (config.url ?? "").replace(/^\/+/, "");
    const params: QueryParams = config.params ?? {};

    const mockPayload = matchMockRoute(url, params);
    if (mockPayload !== null) {
      return buildResponse(config, mockPayload);
    }

    // 未命中 mock 路由，透传给默认适配器
    return fallbackAdapter(config);
  };

  client.defaults.adapter = mockAdapter;
}
