/**
 * 文件上传中间件单元测试
 *
 * 测试目标：buildStorageKey（随机文件名+日期目录）、fileFilter（MIME 白名单）、limits（5MB）
 * 测试策略：mock multer 模块捕获 fileFilter/limits 配置项，直接调用 fileFilter 验证白名单逻辑；
 *           buildStorageKey 使用真实 crypto/path，验证 key 格式与随机性
 *
 * 注意：multer 配置项的调用发生在 import 阶段（upload.ts 模块加载时），故在顶层捕获后不在
 *       beforeEach 中 clearAllMocks，避免清空 import 时的调用记录。
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';
import type { FileFilterCallback } from 'multer';

// hoisted mock multer：捕获 multer(opts) 的配置项（fileFilter/limits），并提供 single/array 桩
const { mockMulter, mockMulterInstance } = vi.hoisted(() => {
  const mockMulterInstance = {
    single: vi.fn().mockReturnValue(vi.fn()),
    array: vi.fn().mockReturnValue(vi.fn()),
  };
  // multer 既是函数又挂载 memoryStorage 方法
  const mockMulter = vi.fn().mockReturnValue(mockMulterInstance) as unknown as {
    (opts: unknown): typeof mockMulterInstance;
    memoryStorage: ReturnType<typeof vi.fn>;
  };
  mockMulter.memoryStorage = vi.fn().mockReturnValue({});
  return { mockMulter, mockMulterInstance };
});

vi.mock('multer', () => ({ default: mockMulter }));

import { buildStorageKey, uploadMiddleware, uploadSingle, uploadMultiple } from '../upload';
import { BadRequestError } from '../../utils/errors';

// import 触发 upload.ts 执行 multer(opts)，此时 mockMulter 已记录调用，捕获配置项供后续测试复用
const multerCallOpts = (mockMulter as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
  fileFilter: (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => void;
  limits: { fileSize: number };
};
const fileFilter = multerCallOpts.fileFilter;

describe('buildStorageKey - 存储 key 生成', () => {
  it('应生成 "YYYY-MM-DD/32位hex.扩展名" 格式的 key', () => {
    const key = buildStorageKey('photo.jpg');
    // 日期目录 + 16字节随机hex(32字符) + 小写扩展名
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\.jpg$/);
  });

  it('扩展名应转小写（防止大小写不一致）', () => {
    const key = buildStorageKey('IMAGE.PNG');
    expect(key).toMatch(/\.png$/);
  });

  it('无扩展名文件应生成无扩展名的 key', () => {
    // path.extname('noext') 返回空字符串
    const key = buildStorageKey('noext');
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}$/);
    expect(key).not.toContain('.');
  });

  it('多次调用应生成不同的随机文件名（防碰撞）', () => {
    const key1 = buildStorageKey('a.png');
    const key2 = buildStorageKey('a.png');
    // 随机部分不同，日期部分可能相同
    expect(key1).not.toBe(key2);
  });

  it('日期目录应为当天日期', () => {
    const key = buildStorageKey('a.png');
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    expect(key.startsWith(`${yyyy}-${mm}-${dd}/`)).toBe(true);
  });
});

describe('fileFilter - MIME 类型白名单校验', () => {
  it('image/jpeg 应通过校验', () => {
    const cb = vi.fn() as unknown as FileFilterCallback;
    fileFilter({} as Request, { mimetype: 'image/jpeg' } as Express.Multer.File, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('image/png 应通过校验', () => {
    const cb = vi.fn() as unknown as FileFilterCallback;
    fileFilter({} as Request, { mimetype: 'image/png' } as Express.Multer.File, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('image/gif 应通过校验', () => {
    const cb = vi.fn() as unknown as FileFilterCallback;
    fileFilter({} as Request, { mimetype: 'image/gif' } as Express.Multer.File, cb);
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('application/pdf 应拒绝并抛出 BadRequestError', () => {
    const cb = vi.fn() as unknown as FileFilterCallback;
    fileFilter({} as Request, { mimetype: 'application/pdf' } as Express.Multer.File, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    const err = (cb as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(err).toBeInstanceOf(BadRequestError);
    expect((err as BadRequestError).message).toContain('application/pdf');
  });

  it('video/mp4 应拒绝（仅允许图片类型）', () => {
    const cb = vi.fn() as unknown as FileFilterCallback;
    fileFilter({} as Request, { mimetype: 'video/mp4' } as Express.Multer.File, cb);
    expect((cb as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBeInstanceOf(BadRequestError);
  });
});

describe('multer 配置 - limits 与中间件导出', () => {
  it('文件大小限制应为 5MB', () => {
    expect(multerCallOpts.limits.fileSize).toBe(5 * 1024 * 1024);
  });

  it('storage 应使用 memoryStorage（便于业务层统一落地）', () => {
    expect(mockMulter.memoryStorage).toHaveBeenCalled();
  });

  it('uploadMiddleware 应为 multer 实例', () => {
    expect(uploadMiddleware).toBe(mockMulterInstance);
  });

  it('uploadSingle 应调用 multer.single("file")', () => {
    expect(mockMulterInstance.single).toHaveBeenCalledWith('file');
  });

  it('uploadMultiple 应调用 multer.array("files", 5)', () => {
    expect(mockMulterInstance.array).toHaveBeenCalledWith('files', 5);
  });
});
