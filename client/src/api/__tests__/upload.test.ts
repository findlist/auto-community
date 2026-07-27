/**
 * api/upload 文件上传 API 层单元测试
 *
 * 测试目标：覆盖 uploadImage/uploadImages 2 个导出函数
 *           验证 FormData 构造、Content-Type 头、返回值取 .data 行为、错误处理
 * 测试策略：vi.mock 拦截 client.post 与 ApiError，构造 mock File 对象
 *
 * 设计原因：upload API 涉及 FormData 与 multipart/form-data 头，与普通 JSON 请求不同；
 * 函数内部有 try/catch 包装非 ApiError 为 500 错误，需独立验证错误处理逻辑
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse } from '@/types';
import { uploadImage, uploadImages, type UploadResult, type MultiUploadResult } from '../upload';
import { ApiError } from '../client';

// mock client 模块的 post 方法与 ApiError 类
// 设计原因：upload 函数内部 catch 块依赖 instanceof ApiError 判断错误类型，
// 必须 mock ApiError 类（而非仅 mock post），否则 instanceof 检查会失败
vi.mock('../client', () => ({
  default: {
    post: vi.fn(),
  },
  // 保留真实的 ApiError 类，使 instanceof 检查生效
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly code: number,
      public readonly fieldErrors?: Array<{ field: string; message: string }>
    ) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import client from '../client';

// 构造 mock File 对象：jsdom 环境下 File 构造器可用
function createMockFile(name: string, content: string = 'mock-content', type: string = 'image/png'): File {
  return new File([content], name, { type });
}

describe('api/upload - 文件上传 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadImage - 单张图片上传', () => {
    it('应使用 POST /upload/image 且 FormData 包含 file 字段', async () => {
      // 设计原因：后端 multer.single('file') 按 'file' 字段名解析，
      // 字段名错误会导致后端取不到文件返回 400
      const mockResult: ApiResponse<UploadResult> = {
        code: 0,
        message: '上传成功',
        data: {
          url: '/uploads/test.png',
          filename: 'test.png',
          size: 1024,
          mimetype: 'image/png',
        },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const file = createMockFile('avatar.png');
      const result = await uploadImage(file);

      expect(client.post).toHaveBeenCalledTimes(1);
      const [url, formData, config] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/upload/image');
      // 验证 FormData 包含 file 字段
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get('file')).toBe(file);
      // 验证 Content-Type 头设置为 multipart/form-data
      expect(config.headers['Content-Type']).toBe('multipart/form-data');
      // 验证返回值已取 .data（uploadImage 内部做了 res.data 解包）
      expect(result.url).toBe('/uploads/test.png');
      expect(result.filename).toBe('test.png');
      expect(result.size).toBe(1024);
    });

    it('ApiError 错误应原样透传不包装', async () => {
      // 设计原因：client 拦截器已将 HTTP 错误转为 ApiError，
      // uploadImage 内部 if (error instanceof ApiError) throw error 直接透传，
      // 保留原始 code 与 message 让前端能按状态码做差异化提示（如 413 文件过大）
      const apiError = new ApiError('文件大小超过限制', 413);
      (client.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(apiError);

      await expect(uploadImage(createMockFile('big.png'))).rejects.toMatchObject({
        name: 'ApiError',
        code: 413,
        message: '文件大小超过限制',
      });
    });

    it('非 ApiError 错误应包装为 500 ApiError', async () => {
      // 设计原因：网络错误或其他未知错误不是 ApiError 实例，
      // uploadImage 内部 catch 包装为 ApiError('上传失败，请稍后重试', 500)，
      // 统一错误类型避免调用方需处理多种错误类型
      const genericError = new Error('Network Error');
      (client.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(genericError);

      await expect(uploadImage(createMockFile('test.png'))).rejects.toMatchObject({
        name: 'ApiError',
        code: 500,
        message: '上传失败，请稍后重试',
      });
    });
  });

  describe('uploadImages - 批量图片上传', () => {
    it('应使用 POST /upload/images 且 FormData 包含多个 files 字段', async () => {
      // 设计原因：后端 multer.array('files', 5) 按 'files' 字段名解析多个文件，
      // 每个文件都 append 到同一字段名 'files'，FormData.get('files') 只返回第一个，
      // 需用 getAll('files') 验证全部文件
      const mockResult: ApiResponse<MultiUploadResult> = {
        code: 0,
        message: '上传成功',
        data: {
          images: [
            { url: '/uploads/a.png', filename: 'a.png', size: 100, mimetype: 'image/png' },
            { url: '/uploads/b.png', filename: 'b.png', size: 200, mimetype: 'image/png' },
          ],
        },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const files = [createMockFile('a.png', 'a'), createMockFile('b.png', 'b')];
      const result = await uploadImages(files);

      expect(client.post).toHaveBeenCalledTimes(1);
      const [url, formData, config] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/upload/images');
      expect(formData).toBeInstanceOf(FormData);
      // 验证所有文件都 append 到 'files' 字段
      expect(formData.getAll('files')).toHaveLength(2);
      expect(formData.getAll('files')[0]).toBe(files[0]);
      expect(formData.getAll('files')[1]).toBe(files[1]);
      expect(config.headers['Content-Type']).toBe('multipart/form-data');
      // 验证返回值已取 .data
      expect(result.images).toHaveLength(2);
      expect(result.images[0]!.url).toBe('/uploads/a.png');
      expect(result.images[1]!.filename).toBe('b.png');
    });

    it('空数组上传应正常调用（边界场景）', async () => {
      // 设计原因：uploadImages 未做空数组校验，空数组会构造空 FormData 调用 post，
      // 后端 multer.array('files', 5) 收到空数组时返回 400，由调用方自行处理
      const mockResult: ApiResponse<MultiUploadResult> = {
        code: 0,
        message: 'ok',
        data: { images: [] },
      };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

      const result = await uploadImages([]);

      expect(client.post).toHaveBeenCalledTimes(1);
      const [, formData] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(formData.getAll('files')).toHaveLength(0);
      expect(result.images).toHaveLength(0);
    });

    it('ApiError 错误应原样透传不包装', async () => {
      // 设计原因：与 uploadImage 错误处理逻辑一致，ApiError 透传保留原始 code
      const apiError = new ApiError('服务器存储空间不足', 507);
      (client.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(apiError);

      await expect(uploadImages([createMockFile('x.png')])).rejects.toMatchObject({
        name: 'ApiError',
        code: 507,
        message: '服务器存储空间不足',
      });
    });

    it('非 ApiError 错误应包装为 500 ApiError', async () => {
      // 设计原因：与 uploadImage 错误处理逻辑一致，统一为 500 ApiError
      (client.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('timeout'));

      await expect(uploadImages([createMockFile('x.png')])).rejects.toMatchObject({
        name: 'ApiError',
        code: 500,
        message: '上传失败，请稍后重试',
      });
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续上传不应相互污染', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 uploadImage 与 uploadImages
      // 时 post 调用次数应分别为 1，不累积
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: 0,
        message: 'ok',
        data: { url: '/uploads/x.png', filename: 'x.png', size: 1, mimetype: 'image/png' },
      });

      await uploadImage(createMockFile('a.png'));
      await uploadImages([createMockFile('b.png')]);

      expect(client.post).toHaveBeenCalledTimes(2);
      const calls = (client.post as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]![0]).toBe('/upload/image');
      expect(calls[1]![0]).toBe('/upload/images');
    });
  });
});
