/**
 * public 路由集成测试
 *
 * 测试目标：
 * - GET /stats：聚合统计用户数与互助订单数，sum 为 null 时兜底 0，含 60s Redis 缓存
 * - GET /homepage-image：获取首页展示图，未配置时 url 为 null
 *
 * 测试策略：
 * - mock config/database 的 query（public.ts 直接调用 query 执行两段 SQL）
 * - mock config/redis 的 getCache/setCache（验证缓存命中与未命中两条路径）
 * - mock services/admin.service 的 getHomepageImage（避免真实 DB 查询）
 * - 挂载 errorHandler 中间件验证错误分支返回 500
 * - 设计原因：路由集成测试覆盖完整中间件链路（asyncHandler→handler→errorHandler），
 *   验证异常被 next 转发到 errorHandler 并返回标准化错误响应
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// vi.hoisted 提前创建 mock 引用，避免 vi.mock 工厂内 TDZ 问题
const { mockQuery, mockGetHomepageImage, mockGetCache, mockSetCache } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetHomepageImage: vi.fn(),
  mockGetCache: vi.fn(),
  mockSetCache: vi.fn(),
}));

vi.mock('../../config/database', () => ({ query: mockQuery }));
vi.mock('../../config/redis', () => ({
  getCache: mockGetCache,
  setCache: mockSetCache,
}));
vi.mock('../../services/admin.service', () => ({
  adminService: { getHomepageImage: mockGetHomepageImage },
}));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import publicRouter from '../public';
import { errorHandler } from '../../middleware/errorHandler';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突；
 * 挂载 errorHandler 捕获 asyncHandler 转发的异常，验证错误响应标准化逻辑
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(publicRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** 关闭服务器，避免句柄泄漏导致测试进程无法退出 */
async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('public 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认缓存未命中：强制走 DB 查询路径，单测可按需覆盖为命中
    mockGetCache.mockResolvedValue(null);
    mockGetHomepageImage.mockResolvedValue('https://example.com/banner.jpg');
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /stats', () => {
    it('正常返回 totalUsers 与 totalMutualAids（缓存未命中走 DB 并写缓存）', async () => {
      // Promise.all 内按数组顺序消费：先 users 查询，再 mutualAids 查询
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '128' }] } as never)
        .mockResolvedValueOnce({ rows: [{ sum: '256' }] } as never);

      const res = await fetch(`${baseUrl}/stats`);
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).totalUsers).toBe(128);
      expect((data.data as Record<string, unknown>).totalMutualAids).toBe(256);
      // 验证两段 SQL 均被调用
      expect(mockQuery).toHaveBeenCalledTimes(2);
      // 验证写入缓存：缓存键 'public:stats'，TTL 60s
      expect(mockSetCache).toHaveBeenCalledWith(
        'public:stats',
        { totalUsers: 128, totalMutualAids: 256 },
        60,
      );
    });

    it('缓存命中时直接返回，不触发 DB 查询', async () => {
      // 缓存命中场景：高 QPS 下避免每次请求都打 DB
      mockGetCache.mockResolvedValue({ totalUsers: 99, totalMutualAids: 11 });

      const res = await fetch(`${baseUrl}/stats`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).totalUsers).toBe(99);
      expect((data.data as Record<string, unknown>).totalMutualAids).toBe(11);
      // 缓存命中时不应触发 DB 查询
      expect(mockQuery).not.toHaveBeenCalled();
      // 缓存命中时也不应再次写入缓存（避免无谓的 Redis 写）
      expect(mockSetCache).not.toHaveBeenCalled();
    });

    it('sum 为 null 时 totalMutualAids 兜底为 0', async () => {
      // 边界场景：UNION ALL 三表查询可能全为 NULL，需要 || '0' 兜底避免 parseInt(null) 返回 NaN
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as never)
        .mockResolvedValueOnce({ rows: [{ sum: null }] } as never);

      const res = await fetch(`${baseUrl}/stats`);
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).totalUsers).toBe(0);
      expect((data.data as Record<string, unknown>).totalMutualAids).toBe(0);
    });

    it('query 抛错时由 errorHandler 返回 500', async () => {
      mockQuery.mockRejectedValue(new Error('数据库连接失败'));
      const res = await fetch(`${baseUrl}/stats`);
      expect(res.status).toBe(500);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      // errorHandler 未知错误分支：code 为 INTERNAL_SERVER_ERROR，message 在非 production 环境为原始错误
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(data.message).toBe('数据库连接失败');
      expect(data.requestId).toBeTypeOf('string');
    });
  });

  describe('GET /homepage-image', () => {
    it('已配置时返回 url', async () => {
      mockGetHomepageImage.mockResolvedValue('https://cdn.example.com/home.jpg');
      const res = await fetch(`${baseUrl}/homepage-image`);
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).url).toBe('https://cdn.example.com/home.jpg');
      expect(mockGetHomepageImage).toHaveBeenCalledTimes(1);
    });

    it('未配置时 url 为 null（前端使用默认图）', async () => {
      mockGetHomepageImage.mockResolvedValue(null);
      const res = await fetch(`${baseUrl}/homepage-image`);
      expect(res.status).toBe(200);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).url).toBeNull();
    });

    it('getHomepageImage 抛错时由 errorHandler 返回 500', async () => {
      mockGetHomepageImage.mockRejectedValue(new Error('查询失败'));
      const res = await fetch(`${baseUrl}/homepage-image`);
      expect(res.status).toBe(500);
      // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, unknown> 便于字段访问
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_SERVER_ERROR');
      expect(data.message).toBe('查询失败');
    });
  });
});
