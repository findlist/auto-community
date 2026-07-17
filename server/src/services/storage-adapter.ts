/**
 * 存储适配层：统一抽象本地磁盘存储与云存储（OSS/COS/S3）
 *
 * 设计目的：
 * 1. LocalStorage 沿用本地磁盘存储逻辑（写入 uploads/ 目录，由 express.static 提供访问）
 * 2. OssStorage 接入阿里云 OSS（ali-oss SDK），支持云存储与 CDN 域名
 * 3. 业务侧（middleware/upload.ts、routes/upload.ts）通过 getStorageAdapter() 获取实例，
 *    无需感知底层存储介质，实现"无缝切换"的规范要求
 *
 * 降级策略（符合规范第六章）：
 * - OSS_ENABLED=true 但凭证不完整时，降级到 LocalStorage 并输出 warn 日志
 * - 保证服务可用性优先，不因配置缺失阻塞启动
 */
import fs from 'fs';
import path from 'path';
import OSS from 'ali-oss';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * 上传结果：业务侧统一消费的数据结构
 * - url：访问 URL（本地为相对路径 /uploads/...，OSS 为完整 HTTPS URL）
 * - key：存储键（本地为 日期目录/文件名，OSS 为 object key）
 */
export interface UploadResult {
  url: string;
  key: string;
  filename: string;
  size: number;
  mimetype: string;
}

/**
 * 批量上传输入项：调用方负责生成 key 与提取文件元数据，batchPutWithRollback 负责落地与回滚
 */
export interface BatchPutItem {
  key: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * 批量上传 + 失败回滚：串行落地所有 item，任一 put 失败时回滚已成功项
 *
 * 设计原因：
 * 1. 串行落地牺牲少量性能换取可预期的回滚语义（最多 5 张图片，性能影响可忽略）
 * 2. 任一 put 失败时，遍历已成功 key 调用 adapter.delete 回滚，保证存储状态一致
 * 3. 回滚并发执行（删除操作互不影响），allSettled 吞掉单个 delete 错误，避免掩盖原始上传错误
 * 4. 提取为独立函数便于单元测试覆盖回滚逻辑（符合项目 service 层测试惯例）
 */
export async function batchPutWithRollback(
  adapter: StorageAdapter,
  items: BatchPutItem[],
): Promise<UploadResult[]> {
  const uploadedKeys: string[] = [];
  const results: UploadResult[] = [];
  try {
    for (const item of items) {
      await adapter.put(item.key, item.buffer, item.mimetype);
      // 落地成功后记录 key，用于失败时回滚
      uploadedKeys.push(item.key);
      results.push({
        url: adapter.getUrl(item.key),
        key: item.key,
        filename: path.basename(item.key),
        size: item.size,
        mimetype: item.mimetype,
      });
    }
    return results;
  } catch (e) {
    // 上传失败时回滚已成功落地的文件，避免存储残留
    // 设计原因：allSettled 默认会吞掉单个 delete 的失败，需手动检查 rejected 项并记 warn 日志，
    // 否则会产生孤儿文件且无任何可观测信号，运维侧难以发现和清理
    const rollbackResults = await Promise.allSettled(uploadedKeys.map((key) => adapter.delete(key)));
    rollbackResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.warn(
          { key: uploadedKeys[index], err: result.reason },
          '[storage] 批量上传回滚失败，可能产生孤儿文件，需人工清理',
        );
      }
    });
    throw e;
  }
}

/**
 * 存储适配器接口：统一抽象本地与云存储能力
 * put 由路由层在 multer.memoryStorage 接收 buffer 后调用，统一本地与 OSS 落地路径
 */
export interface StorageAdapter {
  readonly type: 'local' | 'oss';
  /** 根据 key 生成访问 URL */
  getUrl(key: string): string;
  /** 将文件 buffer 写入存储（本地磁盘或 OSS），key 由调用方生成 */
  put(key: string, buffer: Buffer, mimetype: string): Promise<void>;
  /** 删除指定 key 的文件，文件不存在视为成功避免重复清理报错 */
  delete(key: string): Promise<void>;
}

/**
 * 本地磁盘存储适配器
 * put 将 buffer 写入 uploads/key，getUrl 返回 /uploads/key 相对路径，由 express.static 提供静态访问
 */
class LocalStorage implements StorageAdapter {
  readonly type = 'local' as const;

  // 本地存储返回相对路径，由 express.static 中间件提供静态访问
  getUrl(key: string): string {
    return `/uploads/${key}`;
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    const filePath = path.resolve(__dirname, '../../uploads', key);
    // key 含日期目录（如 2026-07-06/xxx.jpg），需先递归创建目录再写文件
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.resolve(__dirname, '../../uploads', key);
    try {
      await fs.promises.unlink(filePath);
    } catch (err: unknown) {
      // 文件不存在视为已删除，避免重复清理时抛错
      // Node.js fs 错误为 ErrnoException，含 code 字段，用类型断言访问
      // 设计原因：补 debug 日志便于排查重复删除场景（如批量回滚与异步清理任务并发）
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ key }, '[storage.local] 文件不存在，跳过删除');
        return;
      }
      throw err;
    }
  }
}

/**
 * 阿里云 OSS 存储适配器
 * 接收外部传入的 OSS 客户端实例，便于测试注入 mock；生产环境由工厂创建真实客户端
 */
class OssStorage implements StorageAdapter {
  readonly type = 'oss' as const;

  constructor(
    private client: OSS,
    private bucket: string,
    private endpoint: string,
    private customDomain: string,
  ) {}

  async put(key: string, buffer: Buffer): Promise<void> {
    // ali-oss put 第二参数支持 Buffer/Stream，直接传入内存 buffer
    await this.client.put(key, buffer);
  }

  getUrl(key: string): string {
    // 自定义域名（CDN）优先，未配置时拼默认 OSS 公网访问域名
    if (this.customDomain) {
      return `https://${this.customDomain}/${key}`;
    }
    // endpoint 可能带 https:// 前缀，统一去除后拼接 bucket.endpoint
    const host = this.endpoint.replace(/^https?:\/\//, '');
    return `https://${this.bucket}.${host}/${key}`;
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (err: unknown) {
      // OSS 删除不存在的对象理论上幂等，但仍兜底处理 NoSuchKey 避免重复清理报错
      // ali-oss 错误对象含 code 字段，用类型断言访问
      // 设计原因：补 debug 日志便于排查 OSS 侧重复删除场景，与 LocalStorage 行为对齐
      if ((err as { code?: string }).code === 'NoSuchKey') {
        logger.debug({ key }, '[storage.oss] 对象不存在，跳过删除');
        return;
      }
      throw err;
    }
  }
}

let cachedAdapter: StorageAdapter | null = null;

/**
 * 获取存储适配器单例
 * 缓存设计避免每次上传都重复校验配置与创建客户端，提升性能
 */
export function getStorageAdapter(): StorageAdapter {
  if (cachedAdapter) return cachedAdapter;

  if (env.OSS_ENABLED) {
    // 凭证完整性校验：缺少任一必要凭证即降级到本地，避免运行时崩溃
    const hasFullCredentials =
      env.OSS_ACCESS_KEY_ID &&
      env.OSS_ACCESS_KEY_SECRET &&
      env.OSS_BUCKET;
    if (!hasFullCredentials) {
      logger.warn(
        'OSS 已启用但凭证不完整（缺 OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET/OSS_BUCKET），降级使用本地存储',
      );
      cachedAdapter = new LocalStorage();
    } else {
      // 凭证齐全：创建 ali-oss 客户端并启用 OSS 存储
      const client = new OSS({
        accessKeyId: env.OSS_ACCESS_KEY_ID,
        accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
        bucket: env.OSS_BUCKET,
        endpoint: env.OSS_ENDPOINT,
        // secure 强制 HTTPS，避免明文传输凭证与图片数据
        secure: true,
      });
      logger.info('OSS 存储已启用');
      cachedAdapter = new OssStorage(
        client,
        env.OSS_BUCKET,
        env.OSS_ENDPOINT,
        env.OSS_CUSTOM_DOMAIN,
      );
    }
  } else {
    cachedAdapter = new LocalStorage();
  }

  return cachedAdapter;
}

/**
 * 供测试重置缓存，避免单例污染跨用例
 */
export function __resetStorageAdapterForTest(): void {
  cachedAdapter = null;
}

// 供测试直接构造 OssStorage 并注入 mock 客户端，无需真实凭证
export { OssStorage };
