/**
 * index 路由集成测试
 *
 * 测试目标：
 * - GET /：返回 API 版本信息与所有可用端点列表
 *
 * 测试策略：
 * - mock 所有子路由模块为空 Router（避免触发子路由依赖加载，聚焦测试 index.ts 的聚合逻辑）
 * - 设计原因：index.ts 仅做路由聚合与版本信息返回，无业务逻辑；
 *   GET / 端点返回 SUCCESS_CODE + 端点字典，验证结构完整性
 * - 注：vi.mock 工厂被提升到文件顶部，不能引用外部顶层变量，
 *   故在每个工厂内直接 require('express').Router() 创建空 Router
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock 所有子路由为空 Router，避免触发子路由模块的真实加载
// 设计原因：index.ts 仅聚合路由，测试聚焦 GET / 端点结构，无需加载 16 个子路由及其依赖
// 注：工厂内直接 require('express').Router()，不引用外部变量避免 TDZ 问题
vi.mock('../auth', () => ({ default: require('express').Router() }));
vi.mock('../users', () => ({ default: require('express').Router() }));
vi.mock('../skills', () => ({ default: require('express').Router() }));
vi.mock('../kitchen', () => ({ default: require('express').Router() }));
vi.mock('../time-bank', () => ({ default: require('express').Router() }));
vi.mock('../emergency', () => ({ default: require('express').Router() }));
vi.mock('../messages', () => ({ default: require('express').Router() }));
vi.mock('../notifications', () => ({ default: require('express').Router() }));
vi.mock('../admin', () => ({ default: require('express').Router() }));
vi.mock('../reports', () => ({ default: require('express').Router() }));
vi.mock('../upload', () => ({ default: require('express').Router() }));
vi.mock('../address', () => ({ default: require('express').Router() }));
vi.mock('../ai', () => ({ default: require('express').Router() }));
vi.mock('../ab-test', () => ({ default: require('express').Router() }));
vi.mock('../metrics', () => ({ default: require('express').Router() }));
vi.mock('../public', () => ({ default: require('express').Router() }));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import indexRouter from '../index';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(indexRouter);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('index 路由集成测试', () => {
  it('GET / 返回 API 版本信息与端点字典', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    // fetch.Response.json() 返回 Promise<unknown>，断言为 Record<string, any> 便于字段访问
    const data = (await res.json()) as Record<string, any>;
    expect(data.code).toBe('SUCCESS');
    expect(data.message).toBe('邻里圈API v1.0');
    // 验证端点字典包含核心模块
    expect(data.endpoints).toBeTypeOf('object');
    expect(data.endpoints.auth).toBe('/api/auth');
    expect(data.endpoints.users).toBe('/api/users');
    expect(data.endpoints.skills).toBe('/api/skills');
    expect(data.endpoints.kitchen).toBe('/api/kitchen');
    expect(data.endpoints.ai).toBe('/api/ai');
    expect(data.endpoints.abTests).toBe('/api/ab-tests');
  });
});
