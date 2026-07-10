/**
 * storage-adapter 存储适配层单元测试
 *
 * 测试目标：覆盖 LocalStorage 的 URL 生成/写入/删除、OssStorage 的 put/getUrl/delete、
 *           工厂函数的降级策略与缓存机制
 * 测试策略：mock env/logger/fs/ali-oss 模块，不依赖真实文件系统、真实环境变量与真实 OSS 凭证
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 使用 vi.hoisted 提升 mock 对象，避免 TDZ（临时死区）导致引用失败
const { mockEnv, mockLogger, mockFs, mockOssClient, mockOssConstructor } = vi.hoisted(() => ({
  mockEnv: {
    OSS_ENABLED: false,
    OSS_ENDPOINT: '',
    OSS_ACCESS_KEY_ID: '',
    OSS_ACCESS_KEY_SECRET: '',
    OSS_BUCKET: '',
    OSS_CUSTOM_DOMAIN: '',
  },
  mockLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  mockFs: {
    promises: {
      unlink: vi.fn(),
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    },
  },
  // mock ali-oss 客户端实例，由工厂创建时返回
  mockOssClient: {
    put: vi.fn(),
    delete: vi.fn(),
  },
  // 记录 new OSS(config) 的构造参数，便于断言工厂传参正确性
  mockOssConstructor: vi.fn(),
}));

// mock 环境变量模块：避免触发 env.ts 的生产环境校验逻辑（process.exit）
vi.mock('../../config/env', () => ({ env: mockEnv }));

// mock logger：避免测试输出污染控制台
vi.mock('../../utils/logger', () => ({ logger: mockLogger }));

// mock fs：避免真实文件系统操作，通过 mockFs 验证调用
vi.mock('fs', () => ({ default: mockFs }));

// mock ali-oss：避免真实创建 OSS 客户端（会校验凭证/发起网络请求）
// 注意：必须用普通 function 而非箭头函数，因为 storage-adapter.ts 用 new OSS(...) 调用，
// 箭头函数没有 [[Construct]] 内部方法不能用 new 调用
vi.mock('ali-oss', () => ({
  default: vi.fn(function (this: unknown, config: unknown) {
    mockOssConstructor(config);
    // 构造函数显式返回对象时，new 表达式返回该对象（替代默认 this）
    return mockOssClient;
  }),
}));

import {
  getStorageAdapter,
  __resetStorageAdapterForTest,
  StorageAdapter,
  OssStorage,
  batchPutWithRollback,
} from '../storage-adapter';

// 局部类型别名：OssStorage 构造函数首参为 OSS 客户端实例，测试 mock 只需 put/delete 方法
// 用 as unknown as OssClient 替代显式 any 断言以消除 no-explicit-any warning
type OssClient = ConstructorParameters<typeof OssStorage>[0];

beforeEach(() => {
  // 每个用例重置适配器缓存，避免单例污染跨用例
  __resetStorageAdapterForTest();
  mockEnv.OSS_ENABLED = false;
  mockEnv.OSS_ACCESS_KEY_ID = '';
  mockEnv.OSS_ACCESS_KEY_SECRET = '';
  mockEnv.OSS_BUCKET = '';
  mockEnv.OSS_ENDPOINT = '';
  mockEnv.OSS_CUSTOM_DOMAIN = '';
  mockLogger.warn.mockClear();
  mockLogger.info.mockClear();
  mockFs.promises.unlink.mockReset();
  mockFs.promises.mkdir.mockReset();
  mockFs.promises.writeFile.mockReset();
  mockOssClient.put.mockReset();
  mockOssClient.delete.mockReset();
  mockOssConstructor.mockClear();
});

describe('LocalStorage.getUrl', () => {
  it('返回 /uploads/ 前缀的相对路径，由 express.static 提供访问', () => {
    const adapter = getStorageAdapter();
    expect(adapter.type).toBe('local');
    expect(adapter.getUrl('2026-07-04/abc123.jpg')).toBe(
      '/uploads/2026-07-04/abc123.jpg',
    );
  });

  it('不同 key 返回不同 URL，不污染原 key', () => {
    const adapter = getStorageAdapter();
    expect(adapter.getUrl('a/b.png')).toBe('/uploads/a/b.png');
    expect(adapter.getUrl('c/d.gif')).toBe('/uploads/c/d.gif');
  });
});

describe('LocalStorage.put', () => {
  it('先递归创建目录再写入 buffer 到 uploads/key 路径', async () => {
    mockFs.promises.mkdir.mockResolvedValue(undefined);
    mockFs.promises.writeFile.mockResolvedValue(undefined);
    const adapter = getStorageAdapter();
    const buffer = Buffer.from('image-bytes');
    await adapter.put('2026-07-06/abc.jpg', buffer, 'image/jpeg');
    // mkdir 应被调用以创建日期目录
    expect(mockFs.promises.mkdir).toHaveBeenCalledTimes(1);
    // writeFile 应被调用以写入文件 buffer
    expect(mockFs.promises.writeFile).toHaveBeenCalledTimes(1);
    // writeFile 第一参数应包含目标文件完整路径
    const writePath = mockFs.promises.writeFile.mock.calls[0][0] as string;
    expect(writePath).toContain('2026-07-06');
    // writeFile 第二参数应为原始 buffer
    expect(mockFs.promises.writeFile.mock.calls[0][1]).toBe(buffer);
  });
});

describe('LocalStorage.delete', () => {
  it('文件存在时调用 fs.promises.unlink 删除', async () => {
    mockFs.promises.unlink.mockResolvedValue(undefined);
    const adapter = getStorageAdapter();
    await expect(adapter.delete('2026-07-04/old.jpg')).resolves.toBeUndefined();
    expect(mockFs.promises.unlink).toHaveBeenCalledTimes(1);
  });

  it('文件不存在（ENOENT）视为已删除，不抛错', async () => {
    const notFoundError = Object.assign(new Error('not found'), {
      code: 'ENOENT',
    });
    mockFs.promises.unlink.mockRejectedValue(notFoundError);
    const adapter = getStorageAdapter();
    await expect(adapter.delete('missing.png')).resolves.toBeUndefined();
  });

  it('其他错误（如权限不足）正常抛出，不吞错', async () => {
    const permError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    });
    mockFs.promises.unlink.mockRejectedValue(permError);
    const adapter = getStorageAdapter();
    await expect(adapter.delete('locked.png')).rejects.toThrow(
      'permission denied',
    );
  });
});

describe('OssStorage', () => {
  it('put 调用 client.put 传入 key 和 buffer', async () => {
    const mockClient = { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn() };
    const storage = new OssStorage(mockClient as unknown as OssClient, 'bucket', 'oss-cn-hangzhou.aliyuncs.com', '');
    const buffer = Buffer.from('test');
    await storage.put('2026-07-06/abc.jpg', buffer);
    expect(mockClient.put).toHaveBeenCalledWith('2026-07-06/abc.jpg', buffer);
  });

  it('getUrl 优先使用 customDomain 拼接 CDN 域名', () => {
    const storage = new OssStorage({} as unknown as OssClient, 'bucket', 'oss-cn-hangzhou.aliyuncs.com', 'cdn.example.com');
    expect(storage.getUrl('abc.jpg')).toBe('https://cdn.example.com/abc.jpg');
  });

  it('getUrl 无 customDomain 时拼接 bucket.endpoint 默认域名', () => {
    const storage = new OssStorage({} as unknown as OssClient, 'my-bucket', 'oss-cn-hangzhou.aliyuncs.com', '');
    expect(storage.getUrl('abc.jpg')).toBe('https://my-bucket.oss-cn-hangzhou.aliyuncs.com/abc.jpg');
  });

  it('getUrl 去除 endpoint 的 https:// 前缀，统一拼 HTTPS', () => {
    const storage = new OssStorage({} as unknown as OssClient, 'my-bucket', 'https://oss-cn-hangzhou.aliyuncs.com', '');
    expect(storage.getUrl('abc.jpg')).toBe('https://my-bucket.oss-cn-hangzhou.aliyuncs.com/abc.jpg');
  });

  it('delete 调用 client.delete 传入 key', async () => {
    const mockClient = { put: vi.fn(), delete: vi.fn().mockResolvedValue(undefined) };
    const storage = new OssStorage(mockClient as unknown as OssClient, 'bucket', 'endpoint', '');
    await storage.delete('abc.jpg');
    expect(mockClient.delete).toHaveBeenCalledWith('abc.jpg');
  });

  it('delete 遇到 NoSuchKey 视为成功（幂等清理）', async () => {
    const mockClient = {
      put: vi.fn(),
      delete: vi.fn().mockRejectedValue({ code: 'NoSuchKey' }),
    };
    const storage = new OssStorage(mockClient as unknown as OssClient, 'bucket', 'endpoint', '');
    await expect(storage.delete('missing.jpg')).resolves.toBeUndefined();
  });

  it('delete 其他错误正常抛出，不吞错', async () => {
    const mockClient = {
      put: vi.fn(),
      delete: vi.fn().mockRejectedValue(new Error('network error')),
    };
    const storage = new OssStorage(mockClient as unknown as OssClient, 'bucket', 'endpoint', '');
    await expect(storage.delete('abc.jpg')).rejects.toThrow('network error');
  });
});

describe('getStorageAdapter 工厂降级策略', () => {
  it('OSS 未启用时返回 LocalStorage', () => {
    mockEnv.OSS_ENABLED = false;
    const adapter = getStorageAdapter();
    expect(adapter.type).toBe('local');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('OSS 启用但凭证不全（缺 BUCKET）时降级到 LocalStorage 并输出 warn', () => {
    mockEnv.OSS_ENABLED = true;
    mockEnv.OSS_ACCESS_KEY_ID = 'ak';
    mockEnv.OSS_ACCESS_KEY_SECRET = 'sk';
    // 缺少 OSS_BUCKET
    const adapter = getStorageAdapter();
    expect(adapter.type).toBe('local');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('凭证不完整'),
    );
  });

  it('OSS 启用且凭证完整时创建 OssStorage 实例并输出 info', () => {
    mockEnv.OSS_ENABLED = true;
    mockEnv.OSS_ACCESS_KEY_ID = 'ak';
    mockEnv.OSS_ACCESS_KEY_SECRET = 'sk';
    mockEnv.OSS_BUCKET = 'my-bucket';
    mockEnv.OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
    const adapter = getStorageAdapter();
    // 凭证齐全时应返回 OssStorage 实例（mock ali-oss 后不会真实发起请求）
    expect(adapter.type).toBe('oss');
    // 验证 new OSS(config) 构造参数正确
    expect(mockOssConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        bucket: 'my-bucket',
        endpoint: 'oss-cn-hangzhou.aliyuncs.com',
        // secure 强制 HTTPS
        secure: true,
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith('OSS 存储已启用');
  });
});

describe('getStorageAdapter 缓存机制', () => {
  it('多次调用返回同一实例（单例缓存）', () => {
    const a1 = getStorageAdapter();
    const a2 = getStorageAdapter();
    expect(a1).toBe(a2);
  });

  it('__resetStorageAdapterForTest 重置后返回新实例', () => {
    const a1 = getStorageAdapter();
    __resetStorageAdapterForTest();
    const a2 = getStorageAdapter();
    expect(a1).not.toBe(a2);
  });

  it('重置后切换配置生效（本地 → OSS）', () => {
    mockEnv.OSS_ENABLED = false;
    const a1 = getStorageAdapter();
    expect(a1.type).toBe('local');

    __resetStorageAdapterForTest();
    mockEnv.OSS_ENABLED = true;
    mockEnv.OSS_ACCESS_KEY_ID = 'ak';
    mockEnv.OSS_ACCESS_KEY_SECRET = 'sk';
    mockEnv.OSS_BUCKET = 'bucket';
    mockEnv.OSS_ENDPOINT = 'oss-cn-hangzhou.aliyuncs.com';
    const a2 = getStorageAdapter();
    // 配置变更后应切换到 OssStorage（新实例）
    expect(a2).not.toBe(a1);
    expect(a2.type).toBe('oss');
  });
});

describe('StorageAdapter 接口契约', () => {
  it('返回的适配器包含 type/getUrl/put/delete 四要素', () => {
    const adapter: StorageAdapter = getStorageAdapter();
    expect(typeof adapter.type).toBe('string');
    expect(typeof adapter.getUrl).toBe('function');
    expect(typeof adapter.put).toBe('function');
    expect(typeof adapter.delete).toBe('function');
  });
});

// ==================== batchPutWithRollback 测试 ====================

describe('batchPutWithRollback - 批量上传与失败回滚', () => {
  // 构造可控的 mock adapter，验证 put/delete 调用次数与顺序
  function createMockAdapter(): { adapter: StorageAdapter; putMock: ReturnType<typeof vi.fn>; deleteMock: ReturnType<typeof vi.fn>; getUrlMock: ReturnType<typeof vi.fn> } {
    const putMock = vi.fn();
    const deleteMock = vi.fn();
    const getUrlMock = vi.fn((key: string) => `/uploads/${key}`);
    const adapter = {
      type: 'local' as const,
      put: putMock,
      delete: deleteMock,
      getUrl: getUrlMock,
    };
    return { adapter, putMock, deleteMock, getUrlMock };
  }

  it('全部 put 成功时返回所有 item 的 UploadResult，不调用 delete', async () => {
    const { adapter, putMock, deleteMock } = createMockAdapter();
    const items = [
      { key: '2026-07-06/a.jpg', buffer: Buffer.from('a'), mimetype: 'image/jpeg', size: 1 },
      { key: '2026-07-06/b.jpg', buffer: Buffer.from('b'), mimetype: 'image/jpeg', size: 1 },
    ];

    const results = await batchPutWithRollback(adapter, items);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ key: '2026-07-06/a.jpg', filename: 'a.jpg', size: 1 });
    expect(results[1]).toMatchObject({ key: '2026-07-06/b.jpg', filename: 'b.jpg', size: 1 });
    // 全部成功时不应触发回滚
    expect(putMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('空 items 数组返回空结果，不调用 put/delete', async () => {
    const { adapter, putMock, deleteMock } = createMockAdapter();

    const results = await batchPutWithRollback(adapter, []);

    expect(results).toEqual([]);
    expect(putMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('中途 put 失败时回滚已成功项，并向上抛出原始错误', async () => {
    const { adapter, putMock, deleteMock } = createMockAdapter();
    // 第 1 个成功，第 2 个失败，第 3 个不应被调用
    putMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('OSS put 失败'));

    const items = [
      { key: '2026-07-06/a.jpg', buffer: Buffer.from('a'), mimetype: 'image/jpeg', size: 1 },
      { key: '2026-07-06/b.jpg', buffer: Buffer.from('b'), mimetype: 'image/jpeg', size: 1 },
      { key: '2026-07-06/c.jpg', buffer: Buffer.from('c'), mimetype: 'image/jpeg', size: 1 },
    ];

    // 失败时应向上抛出原始错误
    await expect(batchPutWithRollback(adapter, items)).rejects.toThrow('OSS put 失败');

    // 第 1 个已成功，应被回滚删除；第 2 个失败不删除；第 3 个未落地不删除
    expect(putMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith('2026-07-06/a.jpg');
  });

  it('第一个 item 就失败时，不调用 delete（无已成功项可回滚）', async () => {
    const { adapter, putMock, deleteMock } = createMockAdapter();
    putMock.mockRejectedValueOnce(new Error('首次 put 失败'));

    const items = [
      { key: '2026-07-06/a.jpg', buffer: Buffer.from('a'), mimetype: 'image/jpeg', size: 1 },
    ];

    await expect(batchPutWithRollback(adapter, items)).rejects.toThrow('首次 put 失败');
    expect(putMock).toHaveBeenCalledTimes(1);
    // 无已成功项，不应调用 delete
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('回滚过程中 delete 失败不影响原始错误抛出（allSettled 吞掉 delete 错误）', async () => {
    const { adapter, putMock, deleteMock } = createMockAdapter();
    // 第 1 个 put 成功，第 2 个 put 失败；回滚时 delete 也失败
    putMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('put 失败'));
    deleteMock.mockRejectedValueOnce(new Error('delete 失败'));

    const items = [
      { key: '2026-07-06/a.jpg', buffer: Buffer.from('a'), mimetype: 'image/jpeg', size: 1 },
      { key: '2026-07-06/b.jpg', buffer: Buffer.from('b'), mimetype: 'image/jpeg', size: 1 },
    ];

    // 应抛出原始 put 错误，而非 delete 错误
    await expect(batchPutWithRollback(adapter, items)).rejects.toThrow('put 失败');
    // 回滚 delete 被调用（虽然失败）
    expect(deleteMock).toHaveBeenCalledWith('2026-07-06/a.jpg');
  });
});
