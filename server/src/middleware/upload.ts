import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import crypto from 'crypto';
import { Request } from 'express';
import { BadRequestError } from '../utils/errors';

// 允许的文件类型
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif'];

// 文件大小限制：5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// 生成随机文件名，防止路径遍历攻击
function generateRandomFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const randomName = crypto.randomBytes(16).toString('hex');
  return `${randomName}${ext}`;
}

// 按日期生成存储目录，避免单目录文件过多影响性能
function getDateDir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 生成存储 key（日期目录 + 随机文件名）
 * 设计原因：统一本地与 OSS 的 key 生成逻辑，路由层调用 adapter.put(key, buffer) 落地
 */
export function buildStorageKey(originalName: string): string {
  return `${getDateDir()}/${generateRandomFilename(originalName)}`;
}

// 文件过滤器
function fileFilter(
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
): void {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError(
      `不支持的文件类型: ${file.mimetype}，仅支持 JPEG、PNG、GIF 格式图片`
    ));
  }
}

// 使用 memoryStorage 接收 buffer，统一由 StorageAdapter.put 落地（本地磁盘或 OSS）
// 设计原因：diskStorage 只能写本地，memoryStorage 让业务层决定落地介质，实现本地与 OSS 无缝切换
const storage = multer.memoryStorage();

// 创建 multer 实例
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

// 单文件上传中间件
export const uploadSingle = uploadMiddleware.single('file');

// 多文件上传中间件（最多 5 个）
export const uploadMultiple = uploadMiddleware.array('files', 5);
