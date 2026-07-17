/**
 * upload 路由集成测试
 *
 * 测试目标：覆盖 upload.ts 的 2 个路由
 * - POST /image：单图上传，串联 authenticate→uploadSingle(multer)→storageAdapter.put
 * - POST /images：批量上传，串联 authenticate→uploadMultiple(multer)→batchPutWithRollback
 *
 * 测试策略：
 * - mock middleware/auth 的 authenticate（全局 router.use 生效）
 * - mock middleware/upload 的 uploadSingle/uploadMultiple/buildStorageKey
 *   uploadSingle/uploadMultiple 是 multer 中间件，在路由内手动调用 (req, res, cb)；
 *   mock 时模拟 multer 回调模式：设置 req.file/req.files 后调用 cb
 * - mock services/storage-adapter 的 getStorageAdapter/batchPutWithRollback 避免真实文件落地
 * - 真实挂载 errorHandler 验证 BadRequestError 标准化为 400
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Request, Response, NextFunction } from 'express';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

const {
  mockAuthenticate,
  mockAuditMiddleware,
  mockUploadSingle,
  mockUploadMultiple,
  mockBuildStorageKey,
  mockGetStorageAdapter,
  mockBatchPutWithRollback,
  mockPut,
  mockGetUrl,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  // auditMiddleware 为高阶函数（调用后返回中间件），mock 为返回 pass-through 的工厂
  // 设计原因：mockAuditMiddleware 直接作为 auditMiddleware 工厂，便于不变式测试断言 toHaveBeenCalledWith(action, options)
  mockAuditMiddleware: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  mockUploadSingle: vi.fn(),
  mockUploadMultiple: vi.fn(),
  mockBuildStorageKey: vi.fn(),
  mockGetStorageAdapter: vi.fn(),
  mockBatchPutWithRollback: vi.fn(),
  mockPut: vi.fn(),
  mockGetUrl: vi.fn(),
}));

vi.mock('../../middleware/auth', () => ({ authenticate: mockAuthenticate }));
vi.mock('../../middleware/auditLog', () => ({ auditMiddleware: mockAuditMiddleware }));
vi.mock('../../middleware/upload', () => ({
  uploadSingle: mockUploadSingle,
  uploadMultiple: mockUploadMultiple,
  buildStorageKey: mockBuildStorageKey,
}));
vi.mock('../../services/storage-adapter', () => ({
  getStorageAdapter: mockGetStorageAdapter,
  batchPutWithRollback: mockBatchPutWithRollback,
}));

import uploadRouter from '../upload';
import { errorHandler } from '../../middleware/errorHandler';

async function startServer(): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(uploadRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('upload 路由集成测试', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockAuthenticate.mockImplementation((req: Request, _res: Response, next: NextFunction) => {
      req.user = { id: 'user-001', nickname: 'tester' };
      next();
    });
    // storageAdapter 默认返回 mock 实例
    mockGetStorageAdapter.mockReturnValue({ put: mockPut, getUrl: mockGetUrl });
    mockPut.mockResolvedValue(undefined);
    mockGetUrl.mockImplementation((key: string) => `https://cdn.example.com/${key}`);
    mockBuildStorageKey.mockImplementation((name: string) => `2026-07-08/${name}`);
    ({ server, baseUrl } = await startServer());
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('POST /image', () => {
    it('上传成功返回 url 与文件信息', async () => {
      // 模拟 multer 回调：设置 req.file 后调用 cb(null)
      mockUploadSingle.mockImplementation((req: Request, _res: Response, cb: (err: unknown) => void) => {
        req.file = {
          buffer: Buffer.from('fake-image'),
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 100,
        } as Express.Multer.File;
        cb(null);
      });

      const res = await fetch(`${baseUrl}/image`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).url).toBe('https://cdn.example.com/2026-07-08/photo.jpg');
      expect((data.data as Record<string, unknown>).filename).toBe('photo.jpg');
      expect((data.data as Record<string, unknown>).size).toBe(100);
      expect((data.data as Record<string, unknown>).mimetype).toBe('image/jpeg');
      // 验证 adapter.put 收到 buffer 与 mimetype
      expect(mockPut).toHaveBeenCalledWith('2026-07-08/photo.jpg', expect.any(Buffer), 'image/jpeg');
    });

    it('multer LIMIT_FILE_SIZE 错误返回 400', async () => {
      // 模拟 multer 抛出 LIMIT_FILE_SIZE 错误
      mockUploadSingle.mockImplementation((_req: Request, _res: Response, cb: (err: unknown) => void) => {
        cb({ code: 'LIMIT_FILE_SIZE' });
      });

      const res = await fetch(`${baseUrl}/image`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(400);
    });

    it('未选择文件返回 400', async () => {
      // multer 通过但 req.file 为空
      mockUploadSingle.mockImplementation((req: Request, _res: Response, cb: (err: unknown) => void) => {
        req.file = undefined;
        cb(null);
      });

      const res = await fetch(`${baseUrl}/image`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(400);
    });

    it('adapter.put 失败转发错误', async () => {
      mockUploadSingle.mockImplementation((req: Request, _res: Response, cb: (err: unknown) => void) => {
        req.file = {
          buffer: Buffer.from('fake'),
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 10,
        } as Express.Multer.File;
        cb(null);
      });
      mockPut.mockRejectedValue(new Error('OSS 写入失败'));

      const res = await fetch(`${baseUrl}/image`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      // 未知错误通过 errorHandler 兜底为 500
      expect(res.status).toBe(500);
    });
  });

  describe('POST /images', () => {
    it('批量上传成功返回图片数组', async () => {
      mockUploadMultiple.mockImplementation((req: Request, _res: Response, cb: (err: unknown) => void) => {
        req.files = [
          { buffer: Buffer.from('img1'), originalname: 'a.jpg', mimetype: 'image/jpeg', size: 10 },
          { buffer: Buffer.from('img2'), originalname: 'b.jpg', mimetype: 'image/png', size: 20 },
        ] as Express.Multer.File[];
        cb(null);
      });
      // batchPutWithRollback 返回图片信息数组
      mockBatchPutWithRollback.mockResolvedValue([
        { url: 'https://cdn.example.com/a.jpg', filename: 'a.jpg', size: 10, mimetype: 'image/jpeg' },
        { url: 'https://cdn.example.com/b.jpg', filename: 'b.jpg', size: 20, mimetype: 'image/png' },
      ]);

      const res = await fetch(`${baseUrl}/images`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Record<string, unknown>;
      expect((data.data as Record<string, unknown>).images).toHaveLength(2);
      // 验证 batchPutWithRollback 收到 items 数组（含 key/buffer/mimetype/size）
      expect(mockBatchPutWithRollback).toHaveBeenCalled();
      const arg = mockBatchPutWithRollback.mock.calls[0][1] as Array<Record<string, unknown>>;
      expect(arg).toHaveLength(2);
      expect(arg[0].key).toBe('2026-07-08/a.jpg');
    });

    it('LIMIT_FILE_SIZE 错误返回 400', async () => {
      mockUploadMultiple.mockImplementation((_req: Request, _res: Response, cb: (err: unknown) => void) => {
        cb({ code: 'LIMIT_FILE_SIZE' });
      });

      const res = await fetch(`${baseUrl}/images`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(400);
    });

    it('LIMIT_UNEXPECTED_FILE 错误返回 400', async () => {
      mockUploadMultiple.mockImplementation((_req: Request, _res: Response, cb: (err: unknown) => void) => {
        cb({ code: 'LIMIT_UNEXPECTED_FILE' });
      });

      const res = await fetch(`${baseUrl}/images`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(400);
    });

    it('未选择文件返回 400', async () => {
      mockUploadMultiple.mockImplementation((req: Request, _res: Response, cb: (err: unknown) => void) => {
        req.files = [];
        cb(null);
      });

      const res = await fetch(`${baseUrl}/images`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('审计接入不变式（全量）', () => {
    it('2 处上传路由以正确 action 与 resourceType 调用 auditMiddleware', async () => {
      // 守护审计接入不变式：路由加载时 auditMiddleware 以正确 action 与 resourceType 调用
      // 设计原因：beforeEach 的 vi.clearAllMocks 会清除路由加载时的调用记录，需重新加载路由模块以重新触发 auditMiddleware 调用
      // 覆盖范围：2 处本轮新增（CREATE_UPLOAD_IMAGE/CREATE_UPLOAD_IMAGES）
      vi.resetModules();
      await import('../upload');

      // 期望的 action 与 resourceType 映射表（数据驱动断言，新增接入只需在此追加一行）
      const expected: Array<{ action: string; resourceType: string }> = [
        { action: 'CREATE_UPLOAD_IMAGE', resourceType: 'upload' },
        { action: 'CREATE_UPLOAD_IMAGES', resourceType: 'upload' },
      ];

      // 验证 auditMiddleware 被调用 2 次
      expect(mockAuditMiddleware).toHaveBeenCalledTimes(expected.length);

      // 逐项验证 action 与 resourceType 参数完整
      for (const item of expected) {
        expect(mockAuditMiddleware).toHaveBeenCalledWith(item.action, expect.objectContaining({ resourceType: item.resourceType }));
      }
    });
  });
});
