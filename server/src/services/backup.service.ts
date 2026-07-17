import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// 备份文件保留天数
const BACKUP_RETENTION_DAYS = 7;

// 单次备份命令最长执行时间（毫秒）
// 设计原因：pg_dump 通常 1-2 分钟内完成，5 分钟超时阈值预留充裕缓冲；
// 超时后强制 SIGKILL 终止子进程，避免 pg_dump 挂起（如等待远程 DB 响应）导致
// 定时备份任务积压、Promise 永不 resolve 占用 scheduler 单线程
const BACKUP_TIMEOUT_MS = 5 * 60 * 1000;

// 备份服务配置
interface BackupConfig {
  backupDir: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
}

// 备份结果
interface BackupResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
  duration?: number;
}

// 获取备份配置
// 设计原因：BACKUP_DIR 统一从 env.BACKUP_DIR 读取，避免与 env.ts 中的默认值逻辑重复，
// 后续 env.ts 调整默认值或增加校验时此处自动生效，杜绝配置入口分裂
function getBackupConfig(): BackupConfig {
  return {
    backupDir: env.BACKUP_DIR,
    dbHost: env.DB_HOST,
    dbPort: env.DB_PORT,
    dbName: env.DB_NAME,
    dbUser: env.DB_USER,
    dbPassword: env.DB_PASSWORD,
  };
}

// 确保备份目录存在
function ensureBackupDir(backupDir: string): void {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    logger.info({ backupDir }, '[备份] 创建备份目录');
  }
}

// 生成备份文件名：backup_YYYYMMDD_HHMMSS.sql.gz
function generateBackupFileName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `backup_${year}${month}${day}_${hour}${minute}${second}.sql.gz`;
}

// 执行命令并返回结果
// 设计原因：spawn 子进程必须设置超时保护，避免 pg_dump 挂起（如远程 DB 不可达）
// 导致定时备份任务积压、Promise 永不 resolve 占用 scheduler 单线程
function executeCommand(command: string, args: string[], envVars: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, ...envVars };
    const child = spawn(command, args, {
      env: childEnv,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // 超时定时器：达到 BACKUP_TIMEOUT_MS 阈值后强制 SIGKILL 终止子进程
    // 设计原因：SIGKILL 不可被捕获，确保子进程必然退出；SIGTERM 可能被子进程忽略或处理不及时
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`备份命令超时（${BACKUP_TIMEOUT_MS / 1000}秒），已强制终止`));
    }, BACKUP_TIMEOUT_MS);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`命令执行失败: ${error.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`命令退出码 ${code}: ${stderr || stdout}`));
      }
    });
  });
}

// 执行 pg_dump 并压缩备份
async function executeBackup(config: BackupConfig): Promise<BackupResult> {
  const startTime = Date.now();
  const fileName = generateBackupFileName();
  const filePath = path.join(config.backupDir, fileName);

  try {
    ensureBackupDir(config.backupDir);

    // 构建 pg_dump 命令参数
    // 使用 pg_dump 导出整个数据库，通过管道传递给 gzip 压缩
    const pgDumpArgs = [
      '-h', config.dbHost,
      '-p', String(config.dbPort),
      '-U', config.dbUser,
      '-d', config.dbName,
      '--no-owner',      // 不导出所有者信息，便于恢复时兼容不同用户
      '--no-acl',        // 不导出访问权限
      '--clean',         // 添加 DROP 语句
      '--if-exists',     // 使用 IF EXISTS 避免删除不存在的对象时报错
      '-F', 'p',         // 输出格式为纯 SQL 文本
    ];

    logger.info({ fileName, dbName: config.dbName }, '[备份] 开始执行数据库备份');

    // Windows 下使用 PowerShell 管道，Unix 下使用 shell 管道
    const isWindows = process.platform === 'win32';
    let command: string;
    let args: string[];
    const envVars: Record<string, string> = {
      PGPASSWORD: config.dbPassword, // 通过环境变量传递密码，避免命令行泄露
    };

    if (isWindows) {
      // Windows: 使用 PowerShell 管道
      // PGPASSWORD 已通过 envVars 注入子进程环境，不再拼入命令字符串，避免密码含特殊字符导致命令注入或命令异常
      command = 'powershell';
      args = [
        '-Command',
        `& { pg_dump ${pgDumpArgs.join(' ')} | gzip > "${filePath}" }`,
      ];
    } else {
      // Unix/Linux: 使用 shell 管道
      // PGPASSWORD 已通过 envVars 注入子进程环境，不再拼入命令字符串，避免密码含特殊字符导致命令注入或命令异常
      command = 'sh';
      args = [
        '-c',
        `pg_dump ${pgDumpArgs.join(' ')} | gzip > "${filePath}"`,
      ];
    }

    await executeCommand(command, args, envVars);

    // 检查备份文件是否创建成功
    if (!fs.existsSync(filePath)) {
      throw new Error('备份文件创建失败');
    }

    const stats = fs.statSync(filePath);
    const duration = Date.now() - startTime;

    logger.info({
      fileName,
      filePath,
      fileSize: stats.size,
      durationMs: duration,
    }, '[备份] 数据库备份完成');

    return {
      success: true,
      filePath,
      fileName,
      fileSize: stats.size,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error({
      fileName,
      error: errorMessage,
      durationMs: duration,
    }, '[备份] 数据库备份失败');

    // 清理可能存在的部分备份文件
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // 忽略清理失败
      }
    }

    return {
      success: false,
      error: errorMessage,
      duration,
    };
  }
}

// 清理过期备份文件
async function cleanupOldBackups(backupDir: string): Promise<number> {
  try {
    if (!fs.existsSync(backupDir)) {
      return 0;
    }

    const files = fs.readdirSync(backupDir);
    const backupFiles = files.filter(f => f.startsWith('backup_') && f.endsWith('.sql.gz'));
    const now = Date.now();
    const retentionMs = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of backupFiles) {
      const filePath = path.join(backupDir, file);
      try {
        const stats = fs.statSync(filePath);
        const fileAge = now - stats.mtimeMs;

        if (fileAge > retentionMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
          logger.info({ file, ageDays: Math.floor(fileAge / (24 * 60 * 60 * 1000)) }, '[备份] 删除过期备份文件');
        }
      } catch (error) {
        logger.warn({ file, error }, '[备份] 无法处理备份文件');
      }
    }

    if (deletedCount > 0) {
      logger.info({ deletedCount, retentionDays: BACKUP_RETENTION_DAYS }, '[备份] 过期备份清理完成');
    }

    return deletedCount;
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, '[备份] 清理过期备份失败');
    return 0;
  }
}

// 获取备份目录信息
function getBackupDirInfo(backupDir: string): { totalFiles: number; totalSize: number; oldestFile?: string; newestFile?: string } {
  try {
    if (!fs.existsSync(backupDir)) {
      return { totalFiles: 0, totalSize: 0 };
    }

    const files = fs.readdirSync(backupDir);
    const backupFiles = files.filter(f => f.startsWith('backup_') && f.endsWith('.sql.gz'));

    if (backupFiles.length === 0) {
      return { totalFiles: 0, totalSize: 0 };
    }

    let totalSize = 0;
    let oldestFile = backupFiles[0];
    let newestFile = backupFiles[0];
    let oldestTime = Infinity;
    let newestTime = 0;

    for (const file of backupFiles) {
      const filePath = path.join(backupDir, file);
      try {
        const stats = fs.statSync(filePath);
        totalSize += stats.size;

        if (stats.mtimeMs < oldestTime) {
          oldestTime = stats.mtimeMs;
          oldestFile = file;
        }
        if (stats.mtimeMs > newestTime) {
          newestTime = stats.mtimeMs;
          newestFile = file;
        }
      } catch {
        // 忽略无法访问的文件
      }
    }

    return {
      totalFiles: backupFiles.length,
      totalSize,
      oldestFile,
      newestFile,
    };
  } catch {
    return { totalFiles: 0, totalSize: 0 };
  }
}

// 执行完整备份流程
export async function performBackup(): Promise<BackupResult> {
  const config = getBackupConfig();

  logger.info({
    backupDir: config.backupDir,
    dbName: config.dbName,
    dbHost: config.dbHost,
  }, '[备份] 开始执行备份任务');

  // 1. 执行备份
  const result = await executeBackup(config);

  if (!result.success) {
    return result;
  }

  // 2. 清理过期备份
  const deletedCount = await cleanupOldBackups(config.backupDir);

  // 3. 记录备份统计信息
  const dirInfo = getBackupDirInfo(config.backupDir);
  logger.info({
    totalFiles: dirInfo.totalFiles,
    totalSizeMB: Math.round(dirInfo.totalSize / 1024 / 1024 * 100) / 100,
    newestFile: dirInfo.newestFile,
    oldestFile: dirInfo.oldestFile,
    deletedCount,
  }, '[备份] 备份任务完成');

  return result;
}

// 获取备份状态
export function getBackupStatus(): {
  backupDir: string;
  retentionDays: number;
  files: Array<{ name: string; size: number; createdAt: Date }>;
} {
  const config = getBackupConfig();
  const files: Array<{ name: string; size: number; createdAt: Date }> = [];

  try {
    if (fs.existsSync(config.backupDir)) {
      const fileNames = fs.readdirSync(config.backupDir);
      const backupFiles = fileNames.filter(f => f.startsWith('backup_') && f.endsWith('.sql.gz'));

      for (const name of backupFiles) {
        const filePath = path.join(config.backupDir, name);
        try {
          const stats = fs.statSync(filePath);
          files.push({
            name,
            size: stats.size,
            createdAt: stats.mtime,
          });
        } catch {
          // 忽略无法访问的文件
        }
      }

      // 按创建时间降序排序
      files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, '[备份] 获取备份状态失败');
  }

  return {
    backupDir: config.backupDir,
    retentionDays: BACKUP_RETENTION_DAYS,
    files,
  };
}

// 导出备份服务
export const backupService = {
  performBackup,
  getBackupStatus,
};