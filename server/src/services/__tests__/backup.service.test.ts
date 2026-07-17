import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 用 vi.hoisted 提前创建 mock 引用，确保 vi.mock 工厂内能安全访问（vi.mock 是 hoisted 的）
// 设计原因：spawn 返回的 child 对象需要在测试中触发 close/error 事件，必须提前创建引用
// kill 方法用于模拟超时强制终止子进程的真实接口
const { mockSpawn, mockChild, mockFs, mockLogger } = vi.hoisted(() => {
  const mockChild = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
  const mockSpawn = vi.fn(() => mockChild);
  const mockFs = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { mockSpawn, mockChild, mockFs, mockLogger };
});

// mock child_process：备份服务通过 spawn 执行 pg_dump | gzip 管道命令
vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

// mock fs：备份服务大量使用文件系统操作（创建目录、检查文件、读取目录、清理过期备份）
// 用 default 导出形式，因源码使用 `import fs from 'fs'` 默认导入
vi.mock('fs', () => ({
  default: mockFs,
}));

// mock env：提供固定的数据库配置与备份目录，避免依赖真实环境变量与 .env 加载
// 设计原因：backup.service 的 getBackupConfig 统一从 env 读取配置（含 BACKUP_DIR），
// mock 需覆盖所有被读取字段，否则 backupDir 为 undefined 导致 path.join 抛错
vi.mock('../../config/env', () => ({
  env: {
    DB_HOST: 'localhost',
    DB_PORT: 5432,
    DB_NAME: 'testdb',
    DB_USER: 'testuser',
    DB_PASSWORD: 'testpass',
    BACKUP_DIR: '/tmp/test-backups',
  },
}));

// mock logger：备份服务全程记录日志，测试中仅验证不抛错不输出真实日志
vi.mock('../../utils/logger', () => ({
  logger: mockLogger,
}));

// 导入被测模块（必须在所有 vi.mock 之后，确保 mock 生效）
import { performBackup, getBackupStatus, backupService } from '../backup.service';

describe('backup.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // 默认行为：目录存在、目录为空、文件大小为 0
    mockFs.existsSync.mockReturnValue(true);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.readdirSync.mockReturnValue([]);
    mockFs.statSync.mockReturnValue({ size: 0, mtime: new Date(), mtimeMs: Date.now() });
    mockFs.unlinkSync.mockReturnValue(undefined);
    // 默认 stdout/stderr on 不触发（避免干扰 spawn 事件模拟）
    mockChild.stdout.on.mockReturnValue(undefined);
    mockChild.stderr.on.mockReturnValue(undefined);
    // 默认 kill 不触发副作用（超时专项测试用例会显式覆盖）
    mockChild.kill.mockReturnValue(true);
  });

  // fake timers 守护：超时专项测试用例使用 vi.useFakeTimers 模拟 5 分钟超时
  // 必须在 afterEach 中恢复真实 timers，避免影响后续测试用例的真实 setTimeout/setInterval
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('performBackup', () => {
    it('备份成功：spawn close code=0 且文件存在，返回 success:true 与文件信息', async () => {
      // 模拟 spawn 成功完成（close code=0）
      mockChild.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 1024, mtime: new Date(), mtimeMs: Date.now() });

      const result = await performBackup();

      expect(result.success).toBe(true);
      expect(result.fileSize).toBe(1024);
      // 文件名格式：backup_YYYYMMDD_HHMMSS.sql.gz
      expect(result.fileName).toMatch(/^backup_\d{8}_\d{6}\.sql\.gz$/);
      expect(result.filePath).toContain('.sql.gz');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      // 验证 spawn 被调用（Windows 走 PowerShell 分支，Unix 走 sh 分支）
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('备份失败：spawn error 事件触发，返回 success:false 并清理部分文件', async () => {
      // 模拟 spawn error 事件（如命令不存在 ENOENT）
      mockChild.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'error') {
          setTimeout(() => cb(new Error('spawn ENOENT')), 0);
        }
        // 不触发 close 事件，避免 Promise 双重 settle
      });
      // catch 中检查部分文件是否存在并清理
      mockFs.existsSync.mockReturnValue(true);

      const result = await performBackup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('spawn ENOENT');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      // 验证 catch 中清理部分备份文件（existsSync 在 catch 中被调用）
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('备份失败：spawn close code!=0，返回 success:false 含退出码信息', async () => {
      mockChild.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(1), 0);
        }
      });

      const result = await performBackup();

      expect(result.success).toBe(false);
      expect(result.error).toContain('命令退出码 1');
    });

    it('备份文件创建失败：spawn 成功但文件不存在，返回 success:false', async () => {
      mockChild.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });
      // ensureBackupDir 检查目录存在返回 true，备份文件检查返回 false
      // 设计原因：existsSync 被多次调用，目录检查与文件检查需区分返回值
      mockFs.existsSync.mockImplementation((p: unknown) => {
        // 备份目录存在（不含 .sql.gz），备份文件不存在（含 .sql.gz）
        return !String(p).includes('.sql.gz');
      });

      const result = await performBackup();

      expect(result.success).toBe(false);
      expect(result.error).toBe('备份文件创建失败');
    });

    it('备份成功后清理过期备份：删除超过 7 天保留期的文件', async () => {
      mockChild.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });
      mockFs.existsSync.mockReturnValue(true);
      // 过期文件时间戳：8 天前（超过 7 天保留期）
      const oldTime = Date.now() - 8 * 24 * 60 * 60 * 1000;
      mockFs.statSync.mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        // 过期文件返回旧时间，新备份文件返回当前时间
        if (p.includes('20260101')) {
          return { size: 500, mtime: new Date(oldTime), mtimeMs: oldTime };
        }
        return { size: 2048, mtime: new Date(), mtimeMs: Date.now() };
      });
      // cleanupOldBackups 读取目录，返回一个过期备份文件
      mockFs.readdirSync.mockReturnValue(['backup_20260101_000000.sql.gz']);

      const result = await performBackup();

      expect(result.success).toBe(true);
      expect(result.fileSize).toBe(2048);
      // 验证过期文件被删除（unlinkSync 在 cleanupOldBackups 中被调用）
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('backup_20260101_000000.sql.gz'));
    });

    it('备份成功且无过期备份：不删除任何文件', async () => {
      mockChild.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockReturnValue({ size: 1024, mtime: new Date(), mtimeMs: Date.now() });
      // 目录为空，无过期文件需清理
      mockFs.readdirSync.mockReturnValue([]);

      const result = await performBackup();

      expect(result.success).toBe(true);
      // 成功路径 + 空目录，unlinkSync 不应被调用
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('备份成功但 cleanupOldBackups 中 statSync 抛错：跳过该文件不阻塞流程', async () => {
      mockChild.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
        if (event === 'close') {
          setTimeout(() => cb(0), 0);
        }
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFs.statSync.mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        // 新备份文件正常返回
        if (!p.includes('20260101')) {
          return { size: 2048, mtime: new Date(), mtimeMs: Date.now() };
        }
        // 过期文件 statSync 抛错（模拟文件被外部删除）
        throw new Error('ENOENT');
      });
      mockFs.readdirSync.mockReturnValue(['backup_20260101_000000.sql.gz']);

      const result = await performBackup();

      // 备份仍成功（cleanup 失败不影响主流程）
      expect(result.success).toBe(true);
      // statSync 抛错的文件不会被删除（catch 中 logger.warn 后继续）
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('备份超时：5 分钟内 spawn 未触发 close 事件，强制 kill 子进程并返回超时错误', async () => {
      // 设计原因：pg_dump 挂起（如远程 DB 不可达）时 spawn 既不触发 close 也不触发 error，
      // 必须依赖超时机制强制 kill 子进程避免 Promise 永不 resolve 占用 scheduler 单线程
      // 使用 fake timers 加速 5 分钟超时场景，避免真实等待
      vi.useFakeTimers();

      // spawn 不触发任何事件，模拟子进程挂起
      mockChild.on.mockImplementation(() => undefined);
      // existsSync 在 catch 中检查部分文件是否存在并清理
      mockFs.existsSync.mockReturnValue(true);

      // 启动备份（不 await，让其在后台挂起）
      const backupPromise = performBackup();

      // 推进 5 分钟 + 1ms，触发 setTimeout 超时回调
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      const result = await backupPromise;

      // 验证超时后返回失败结果
      expect(result.success).toBe(false);
      expect(result.error).toContain('备份命令超时');
      // 验证子进程被强制 SIGKILL 终止
      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
      // 验证 catch 中清理部分备份文件
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });
  });

  describe('getBackupStatus', () => {
    it('备份目录不存在：返回空文件列表与默认保留天数', () => {
      mockFs.existsSync.mockReturnValue(false);

      const status = getBackupStatus();

      expect(status.backupDir).toBeDefined();
      expect(status.retentionDays).toBe(7);
      expect(status.files).toEqual([]);
    });

    it('目录存在但无备份文件：返回空文件列表', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['other.txt', 'readme.md', 'log.txt']);

      const status = getBackupStatus();

      expect(status.files).toEqual([]);
    });

    it('目录存在有备份文件：按创建时间降序排序（最新在前）', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'backup_20260101_000000.sql.gz',
        'backup_20260103_000000.sql.gz',
        'backup_20260102_000000.sql.gz',
      ]);
      const time1 = new Date('2026-01-01').getTime();
      const time2 = new Date('2026-01-02').getTime();
      const time3 = new Date('2026-01-03').getTime();
      mockFs.statSync.mockImplementation((filePath: unknown) => {
        const p = String(filePath);
        if (p.includes('20260101')) return { size: 100, mtime: new Date(time1), mtimeMs: time1 };
        if (p.includes('20260102')) return { size: 200, mtime: new Date(time2), mtimeMs: time2 };
        if (p.includes('20260103')) return { size: 300, mtime: new Date(time3), mtimeMs: time3 };
        return { size: 0, mtime: new Date(), mtimeMs: Date.now() };
      });

      const status = getBackupStatus();

      expect(status.files).toHaveLength(3);
      // 降序：最新的 20260103 在前
      expect(status.files[0].name).toBe('backup_20260103_000000.sql.gz');
      expect(status.files[0].size).toBe(300);
      expect(status.files[1].name).toBe('backup_20260102_000000.sql.gz');
      expect(status.files[2].name).toBe('backup_20260101_000000.sql.gz');
    });

    it('statSync 抛错：跳过无法访问的文件，仅返回可访问的文件', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'backup_20260101_000000.sql.gz',
        'backup_20260102_000000.sql.gz',
      ]);
      mockFs.statSync.mockImplementation((filePath: unknown) => {
        if (String(filePath).includes('20260101')) {
          throw new Error('EACCES');
        }
        return { size: 200, mtime: new Date(), mtimeMs: Date.now() };
      });

      const status = getBackupStatus();

      // 20260101 抛错被跳过，仅剩 20260102
      expect(status.files).toHaveLength(1);
      expect(status.files[0].name).toBe('backup_20260102_000000.sql.gz');
    });

    it('readdirSync 抛错：catch 返回空文件列表不向上抛出', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('EIO');
      });

      const status = getBackupStatus();

      expect(status.files).toEqual([]);
    });
  });

  describe('backupService 聚合导出', () => {
    it('包含 performBackup 与 getBackupStatus 方法', () => {
      expect(backupService.performBackup).toBeDefined();
      expect(backupService.getBackupStatus).toBeDefined();
      expect(typeof backupService.performBackup).toBe('function');
      expect(typeof backupService.getBackupStatus).toBe('function');
    });
  });
});
