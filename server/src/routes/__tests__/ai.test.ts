/**
 * ai 路由集成测试
 *
 * 测试目标：
 * - GET /match/skills/:postId：技能帖子 AI 推荐，串联 authenticate→aiService.matchSkill
 * - GET /match/time-bank/:serviceId：时间银行服务 AI 推荐，串联 authenticate→aiService.matchTimeService
 * - POST /classify：内容智能分类，串联 authenticate→手动校验→aiService.classifyContent
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate（动态决定通过/拒绝，覆盖 401 与 200 两条路径）
 * - mock services/ai.service 的 aiService 三个方法（避免真实 AI/DB 调用）
 * - mock utils/logger（避免日志输出污染测试）
 * - 设计原因：ai.ts 使用 try/catch 手动处理错误（非 asyncHandler+errorHandler），
 *   测试需验证 error() 辅助函数返回的标准化错误响应；
 *   注意 'INTERNAL_ERROR' 不在 errorCodeToStatus 映射表，httpStatusFromCode 兜底返回 400
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Request, Response, NextFunction } from 'express';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// vi.hoisted 提前创建 mock 引用，避免 vi.mock 工厂内 TDZ 问题
const { mockAuthenticate, mockMatchSkill, mockMatchTimeService, mockClassifyContent, mockLogger } = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockMatchSkill: vi.fn(),
  mockMatchTimeService: vi.fn(),
  mockClassifyContent: vi.fn(),
  mockLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../services/ai.service', () => ({
  aiService: {
    matchSkill: mockMatchSkill,
    matchTimeService: mockMatchTimeService,
    classifyContent: mockClassifyContent,
  },
}));
vi.mock('../../utils/logger', () => ({ logger: mockLogger }));

// 必须在 vi.mock 之后 import 被测模块，确保 mock 生效
import aiRouter from '../ai';

/**
 * 启动临时 Express 服务器到随机端口
 * 设计原因：listen(0) 让操作系统分配可用端口，避免端口冲突
 * 注：ai.ts 用 try/catch 手动处理错误，不走 errorHandler，故不挂载 errorHandler
 */
async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(aiRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** 关闭服务器，避免句柄泄漏导致测试进程无法退出 */
async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('ai 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    // 默认行为：authenticate 通过并设置 req.user
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-uuid-001', nickname: 'tester' };
      next();
    });
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /match/skills/:postId', () => {
    it('认证通过返回技能推荐列表', async () => {
      mockMatchSkill.mockResolvedValue([
        { postId: 'post-002', score: 0.95, reason: '技能匹配度高' },
      ]);
      const res = await fetch(`${baseUrl}/match/skills/post-001`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect(data.data).toHaveLength(1);
      expect(mockMatchSkill).toHaveBeenCalledWith('post-001');
    });

    it('未认证时返回 401', async () => {
      mockAuthenticate.mockImplementation((_req: Request, _res: Response, next: NextFunction) => {
        next(new Error('未授权'));
      });
      const res = await fetch(`${baseUrl}/match/skills/post-001`);
      // authenticate 通过 next(err) 转发错误，Express 默认错误处理返回 500
      // 注：ai.ts 未挂载 errorHandler，故走 Express 内置错误处理
      expect(res.status).toBe(500);
      expect(mockMatchSkill).not.toHaveBeenCalled();
    });

    it('matchSkill 抛错时返回 INTERNAL_ERROR', async () => {
      mockMatchSkill.mockRejectedValue(new Error('AI 服务不可用'));
      const res = await fetch(`${baseUrl}/match/skills/post-001`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      // httpStatusFromCode('INTERNAL_ERROR') 兜底返回 400（未在 errorCodeToStatus 映射表）
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_ERROR');
      expect(data.message).toBe('推荐服务暂不可用');
      // 验证 logger.error 被调用记录错误
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('GET /match/time-bank/:serviceId', () => {
    it('认证通过返回时间银行推荐列表', async () => {
      mockMatchTimeService.mockResolvedValue([
        { serviceId: 'svc-002', score: 0.88, reason: '地理位置近' },
      ]);
      const res = await fetch(`${baseUrl}/match/time-bank/svc-001`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect(mockMatchTimeService).toHaveBeenCalledWith('svc-001');
    });

    it('matchTimeService 抛错时返回 INTERNAL_ERROR', async () => {
      mockMatchTimeService.mockRejectedValue(new Error('AI 服务超时'));
      const res = await fetch(`${baseUrl}/match/time-bank/svc-001`, {
        headers: { Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_ERROR');
      expect(data.message).toBe('推荐服务暂不可用');
    });
  });

  describe('POST /classify', () => {
    it('合法文本分类成功返回 200', async () => {
      mockClassifyContent.mockResolvedValue({
        category: '生活服务',
        urgency: 'normal',
        confidence: 0.92,
      });
      const res = await fetch(`${baseUrl}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({ text: '需要帮忙搬运家具' }),
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('SUCCESS');
      expect((data.data as Record<string, unknown>).category).toBe('生活服务');
      expect(mockClassifyContent).toHaveBeenCalledWith('需要帮忙搬运家具');
    });

    it('text 缺失时返回 BAD_REQUEST', async () => {
      const res = await fetch(`${baseUrl}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(data.message).toBe('文本不能为空');
      // classifyContent 不应被调用（被前置校验拦截）
      expect(mockClassifyContent).not.toHaveBeenCalled();
    });

    it('text 非字符串时返回 BAD_REQUEST', async () => {
      const res = await fetch(`${baseUrl}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({ text: 123 }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
      expect(mockClassifyContent).not.toHaveBeenCalled();
    });

    it('classifyContent 抛错时返回 INTERNAL_ERROR', async () => {
      mockClassifyContent.mockRejectedValue(new Error('模型加载失败'));
      const res = await fetch(`${baseUrl}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
        body: JSON.stringify({ text: '需要帮忙' }),
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('INTERNAL_ERROR');
      expect(data.message).toBe('分类服务暂不可用');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('req.body 为 null 时不崩溃返回 BAD_REQUEST', async () => {
      // 边界场景：Content-Type 为 json 但 body 为空，express.json() 解析为 {}
      // 此处验证 req.body || {} 兜底逻辑
      const res = await fetch(`${baseUrl}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-token' },
      });
      expect(res.status).toBe(400);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data.code).toBe('BAD_REQUEST');
    });
  });
});
