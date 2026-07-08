import { Router, Request, Response, NextFunction } from 'express';
import { uploadSingle, uploadMultiple, buildStorageKey } from '../middleware/upload';
import { authenticate } from '../middleware/auth';
import { success } from '../utils/response';
import { BadRequestError } from '../utils/errors';
import { getStorageAdapter, batchPutWithRollback } from '../services/storage-adapter';
import path from 'path';

const router = Router();

// 所有上传接口需要登录
router.use(authenticate);

/**
 * @swagger
 * /api/upload/image:
 *   post:
 *     summary: 上传单张图片
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: 图片文件（JPEG/PNG/GIF，最大 5MB）
 *     responses:
 *       200:
 *         description: 上传成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       description: 图片访问 URL
 *                     filename:
 *                       type: string
 *                       description: 文件名
 *                     size:
 *                       type: number
 *                       description: 文件大小（字节）
 *                     mimetype:
 *                       type: string
 *                       description: 文件 MIME 类型
 */
router.post('/image', (req: Request, res: Response, next: NextFunction) => {
  // multer 错误带 code 字段（如 LIMIT_FILE_SIZE），用 unknown + 类型断言访问 code
  uploadSingle(req, res, async (err: unknown) => {
    if (err) {
      // 处理 multer 错误
      if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') {
        return next(new BadRequestError('文件大小超过限制，最大允许 5MB'));
      }
      return next(err);
    }

    if (!req.file) {
      return next(new BadRequestError('请选择要上传的图片'));
    }

    // memoryStorage 下 file 仅含 buffer，统一通过 StorageAdapter.put 落地（本地磁盘或 OSS）
    const key = buildStorageKey(req.file.originalname);
    const adapter = getStorageAdapter();
    try {
      await adapter.put(key, req.file.buffer, req.file.mimetype);
      const url = adapter.getUrl(key);
      success(res, {
        url,
        filename: path.basename(key),
        size: req.file.size,
        mimetype: req.file.mimetype
      }, '上传成功');
    } catch (e) {
      next(e);
    }
  });
});

/**
 * @swagger
 * /api/upload/images:
 *   post:
 *     summary: 批量上传图片（最多 5 张）
 *     tags: [Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: 图片文件数组（JPEG/PNG/GIF，每个最大 5MB）
 *     responses:
 *       200:
 *         description: 上传成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 code:
 *                   type: string
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     images:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           url:
 *                             type: string
 *                           filename:
 *                             type: string
 *                           size:
 *                             type: number
 *                           mimetype:
 *                             type: string
 */
router.post('/images', (req: Request, res: Response, next: NextFunction) => {
  uploadMultiple(req, res, async (err: unknown) => {
    if (err) {
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') {
        return next(new BadRequestError('文件大小超过限制，最大允许 5MB'));
      }
      if (code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new BadRequestError('最多只能上传 5 张图片'));
      }
      return next(err);
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return next(new BadRequestError('请选择要上传的图片'));
    }

    // 批量落地 + 失败回滚：调用 batchPutWithRollback 串行落地，任一 put 失败时自动回滚已成功项
    // 设计原因见 storage-adapter.ts 的 batchPutWithRollback 函数注释
    const adapter = getStorageAdapter();
    const items = files.map((file) => ({
      key: buildStorageKey(file.originalname),
      buffer: file.buffer,
      mimetype: file.mimetype,
      size: file.size,
    }));
    try {
      const images = await batchPutWithRollback(adapter, items);
      success(res, { images }, '上传成功');
    } catch (e) {
      next(e);
    }
  });
});

export default router;