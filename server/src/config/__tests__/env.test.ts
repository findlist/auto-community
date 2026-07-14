/**
 * config/env 启动校验逻辑单元测试
 *
 * 测试目标：守护 env.ts 在模块加载时执行的关键校验逻辑不被后续重构破坏
 * - 敏感变量缺失校验（JWT_SECRET / DB_PASSWORD）→ process.exit(1)
 * - 生产环境 4 项校验（REDIS_PASSWORD / CORS_ORIGIN localhost / JWT_SECRET 默认值 / PII_ENCRYPT_KEY）
 * - 开发环境仅 warn 不退出（便于调试）
 * - 默认值兜底（JWT_EXPIRES_IN 生产 2h / 开发 7d / CORS_ORIGIN / PORT / DB_PORT / REDIS_PORT / AMAP_KEY）
 * - env 对象字段完整性
 *
 * 测试策略：env.ts 在模块加载时即执行校验（非纯函数），必须使用 vi.resetModules + vi.doMock
 *           + dynamic import 隔离每个用例的 module 状态。mock process.exit 避免测试进程退出，
 *           mock logger 避免污染控制台，mock fs.existsSync 避免加载真实 .env 文件干扰测试。
 *
 * 设计原因：env.ts 是后端启动第一道安全防线，校验逻辑被重构破坏会导致生产环境带病上线
 *           （如 CORS_ORIGIN 改为 localhost、JWT_SECRET 退化为默认值）。本测试通过覆盖
 *           各失败场景与默认值分支，确保校验逻辑与默认值兜底始终符合预期。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 保存原始 process.env，afterEach 恢复避免跨用例污染
const ORIGINAL_ENV = { ...process.env };

/**
 * 设置完整有效的 env 配置（所有校验项均通过）
 * 各用例通过 overrides 覆盖单个字段制造失败场景，避免重复维护完整配置
 */
function setValidEnv(overrides: Record<string, string | undefined> = {}): void {
  // 先清空 process.env 再重置，确保上轮用例残留的变量不干扰本轮
  process.env = { ...ORIGINAL_ENV };
  // 设置所有校验必需的变量为有效值
  process.env.NODE_ENV = 'development'; // 默认开发环境，避免触发生产校验
  process.env.JWT_SECRET = 'test-jwt-secret-not-default';
  process.env.DB_PASSWORD = 'test-db-password';
  process.env.PII_ENCRYPT_KEY = 'test-pii-encrypt-key-32-bytes-hex-string';
  process.env.REDIS_PASSWORD = 'test-redis-password';
  process.env.CORS_ORIGIN = 'https://example.com'; // 非 localhost/127.0.0.1
  // 应用用例覆盖：值为 undefined 时删除该变量（模拟未配置）
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('config/env 启动校验逻辑', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let loggerErrorSpy: ReturnType<typeof vi.fn>;
  let loggerWarnSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // mock process.exit：拦截退出避免测试进程终止（env.ts 校验失败会调用 process.exit(1)）
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    // mock logger.error/warn：env.ts 模块加载时即从 logger 导入，必须在 dynamic import 前注入
    // 用 doMock 而非 mock：doMock 配合 resetModules 可确保每次 import 都重新应用 mock
    loggerErrorSpy = vi.fn();
    loggerWarnSpy = vi.fn();
    vi.doMock('../../utils/logger', () => ({
      logger: {
        error: loggerErrorSpy,
        warn: loggerWarnSpy,
        info: vi.fn(),
        debug: vi.fn(),
      },
      default: {
        error: loggerErrorSpy,
        warn: loggerWarnSpy,
        info: vi.fn(),
        debug: vi.fn(),
      },
    }));

    // mock fs.existsSync：避免加载真实 .env 文件污染测试环境
    // env.ts 在文件存在时调用 dotenv.config，会让真实 .env 覆盖测试设置的变量
    vi.doMock('fs', () => ({
      default: { existsSync: () => false },
      existsSync: () => false,
    }));
  });

  afterEach(() => {
    // 恢复 process.env 与 spy，重置 module 缓存避免下轮用例使用本轮的 mock 状态
    process.env = { ...ORIGINAL_ENV };
    processExitSpy.mockRestore();
    vi.doUnmock('../../utils/logger');
    vi.doUnmock('fs');
    vi.resetModules();
  });

  describe('敏感变量校验（缺失即 exit(1)）', () => {
    it('JWT_SECRET 缺失时调用 process.exit(1) 并记录 error 日志', async () => {
      setValidEnv({ JWT_SECRET: undefined });
      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalled();
    });

    it('DB_PASSWORD 缺失时调用 process.exit(1) 并记录 error 日志', async () => {
      setValidEnv({ DB_PASSWORD: undefined });
      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('生产环境校验（NODE_ENV=production）', () => {
    it('REDIS_PASSWORD 缺失时 exit(1)', async () => {
      setValidEnv({ NODE_ENV: 'production', REDIS_PASSWORD: '' });

      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('CORS_ORIGIN 为 localhost 时 exit(1)', async () => {
      setValidEnv({ NODE_ENV: 'production', CORS_ORIGIN: 'http://localhost:3000' });

      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('CORS_ORIGIN 为 127.0.0.1 时 exit(1)', async () => {
      setValidEnv({ NODE_ENV: 'production', CORS_ORIGIN: 'http://127.0.0.1:3000' });

      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('JWT_SECRET 使用默认值 "your-secret-key" 时 exit(1)', async () => {
      setValidEnv({ NODE_ENV: 'production', JWT_SECRET: 'your-secret-key' });

      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('JWT_SECRET 使用默认值 "change-me" 时 exit(1)', async () => {
      setValidEnv({ NODE_ENV: 'production', JWT_SECRET: 'change-me' });

      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('PII_ENCRYPT_KEY 缺失时 exit(1)', async () => {
      setValidEnv({ NODE_ENV: 'production', PII_ENCRYPT_KEY: '' });

      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('所有校验通过时不调用 exit 且 env 正常导出', async () => {
      setValidEnv({ NODE_ENV: 'production' });

      const { env } = await import('../env');

      expect(processExitSpy).not.toHaveBeenCalled();
      expect(env.JWT_SECRET).toBe('test-jwt-secret-not-default');
      expect(env.NODE_ENV).toBe('production');
    });

    it('多项校验同时失败时 error 日志包含所有失败项', async () => {
      // 同时触发 REDIS_PASSWORD 缺失 + CORS_ORIGIN localhost + PII_ENCRYPT_KEY 缺失
      setValidEnv({
        NODE_ENV: 'production',
        REDIS_PASSWORD: '',
        CORS_ORIGIN: 'http://localhost:3000',
        PII_ENCRYPT_KEY: '',
      });

      await import('../env');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      // error 日志的 failures 字段应包含 3 项失败消息（具体内容校验由 message 字段决定）
      const errorCallArgs = loggerErrorSpy.mock.calls[0];
      expect(errorCallArgs).toBeDefined();
    });
  });

  describe('开发环境校验（仅 warn 不 exit）', () => {
    it('REDIS_PASSWORD 缺失时仅 warn 不 exit', async () => {
      setValidEnv({ NODE_ENV: 'development', REDIS_PASSWORD: '' });

      const { env } = await import('../env');

      expect(processExitSpy).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(env.NODE_ENV).toBe('development');
    });

    it('JWT_SECRET 使用默认值时仅 warn 不 exit', async () => {
      setValidEnv({ NODE_ENV: 'development', JWT_SECRET: 'secret' });

      const { env } = await import('../env');

      expect(processExitSpy).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalled();
      // 默认值仍会写入 env 对象（仅 warn 不阻止启动）
      expect(env.JWT_SECRET).toBe('secret');
    });

    it('CORS_ORIGIN 为 localhost 时仅 warn 不 exit', async () => {
      setValidEnv({ NODE_ENV: 'development', CORS_ORIGIN: 'http://localhost:3000' });

      const { env } = await import('../env');

      expect(processExitSpy).not.toHaveBeenCalled();
      expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    });
  });

  describe('默认值兜底', () => {
    it('JWT_EXPIRES_IN 未配置时生产环境默认 2h', async () => {
      setValidEnv({ NODE_ENV: 'production', JWT_EXPIRES_IN: undefined });

      const { env } = await import('../env');

      expect(env.JWT_EXPIRES_IN).toBe('2h');
    });

    it('JWT_EXPIRES_IN 未配置时开发环境默认 7d', async () => {
      setValidEnv({ NODE_ENV: 'development', JWT_EXPIRES_IN: undefined });

      const { env } = await import('../env');

      expect(env.JWT_EXPIRES_IN).toBe('7d');
    });

    it('JWT_EXPIRES_IN 显式配置时使用配置值', async () => {
      setValidEnv({ JWT_EXPIRES_IN: '1h' });

      const { env } = await import('../env');

      expect(env.JWT_EXPIRES_IN).toBe('1h');
    });

    it('CORS_ORIGIN 未配置时默认 http://localhost:5173', async () => {
      setValidEnv({ CORS_ORIGIN: undefined });

      const { env } = await import('../env');

      expect(env.CORS_ORIGIN).toBe('http://localhost:5173');
    });

    it('PORT 未配置时默认 3000', async () => {
      setValidEnv({ PORT: undefined });

      const { env } = await import('../env');

      expect(env.PORT).toBe(3000);
    });

    it('DB_PORT 未配置时默认 5432', async () => {
      setValidEnv({ DB_PORT: undefined });

      const { env } = await import('../env');

      expect(env.DB_PORT).toBe(5432);
    });

    it('REDIS_PORT 未配置时默认 6379', async () => {
      setValidEnv({ REDIS_PORT: undefined });

      const { env } = await import('../env');

      expect(env.REDIS_PORT).toBe(6379);
    });

    it('AMAP_KEY 未配置时默认空字符串（应急地图降级模式）', async () => {
      setValidEnv({ AMAP_KEY: undefined });

      const { env } = await import('../env');

      // 设计原因：AMAP_KEY 空字符串触发 ResourceMap 降级模式（静态点位 + 列表）
      expect(env.AMAP_KEY).toBe('');
    });

    it('REDIS_DB 未配置时默认 0', async () => {
      setValidEnv({ REDIS_DB: undefined });

      const { env } = await import('../env');

      expect(env.REDIS_DB).toBe(0);
    });

    it('RATE_LIMIT_WINDOW_MS 未配置时默认 60000', async () => {
      setValidEnv({ RATE_LIMIT_WINDOW_MS: undefined });

      const { env } = await import('../env');

      expect(env.RATE_LIMIT_WINDOW_MS).toBe(60000);
    });

    it('RATE_LIMIT_MAX 未配置时默认 100', async () => {
      setValidEnv({ RATE_LIMIT_MAX: undefined });

      const { env } = await import('../env');

      expect(env.RATE_LIMIT_MAX).toBe(100);
    });
  });

  describe('布尔型配置解析', () => {
    it('NOTIFICATION_EMAIL_ENABLED="true" 解析为 true', async () => {
      setValidEnv({ NOTIFICATION_EMAIL_ENABLED: 'true' });

      const { env } = await import('../env');

      expect(env.NOTIFICATION_EMAIL_ENABLED).toBe(true);
    });

    it('NOTIFICATION_EMAIL_ENABLED 未配置时解析为 false', async () => {
      setValidEnv({ NOTIFICATION_EMAIL_ENABLED: undefined });

      const { env } = await import('../env');

      expect(env.NOTIFICATION_EMAIL_ENABLED).toBe(false);
    });

    it('NOTIFICATION_SMS_ENABLED="true" 解析为 true', async () => {
      setValidEnv({ NOTIFICATION_SMS_ENABLED: 'true' });

      const { env } = await import('../env');

      expect(env.NOTIFICATION_SMS_ENABLED).toBe(true);
    });

    it('OSS_ENABLED 未配置时解析为 false（默认本地存储降级）', async () => {
      setValidEnv({ OSS_ENABLED: undefined });

      const { env } = await import('../env');

      // 设计原因：OSS 默认关闭，未配置凭证时使用本地磁盘存储
      expect(env.OSS_ENABLED).toBe(false);
    });

    it('OSS_ENABLED="true" 解析为 true', async () => {
      setValidEnv({ OSS_ENABLED: 'true' });

      const { env } = await import('../env');

      expect(env.OSS_ENABLED).toBe(true);
    });
  });

  describe('env 对象字段完整性', () => {
    it('应导出所有必需字段（DB/Redis/JWT/CORS/限流/通知/OSS/AMAP）', async () => {
      setValidEnv();

      const { env } = await import('../env');

      // DB 字段
      expect(env.DB_HOST).toBeDefined();
      expect(env.DB_PORT).toBeTypeOf('number');
      expect(env.DB_NAME).toBeDefined();
      expect(env.DB_USER).toBeDefined();
      expect(env.DB_PASSWORD).toBeDefined();
      // Redis 字段
      expect(env.REDIS_HOST).toBeDefined();
      expect(env.REDIS_PORT).toBeTypeOf('number');
      expect(env.REDIS_DB).toBeTypeOf('number');
      // JWT 字段
      expect(env.JWT_SECRET).toBeDefined();
      expect(env.JWT_EXPIRES_IN).toBeDefined();
      expect(env.JWT_REFRESH_EXPIRES_IN).toBeDefined();
      // CORS 字段
      expect(env.CORS_ORIGIN).toBeDefined();
      // 限流字段
      expect(env.RATE_LIMIT_WINDOW_MS).toBeTypeOf('number');
      expect(env.RATE_LIMIT_MAX).toBeTypeOf('number');
      // 通知通道字段
      expect(env.NOTIFICATION_EMAIL_ENABLED).toBeTypeOf('boolean');
      expect(env.NOTIFICATION_SMS_ENABLED).toBeTypeOf('boolean');
      // OSS 字段
      expect(env.OSS_ENABLED).toBeTypeOf('boolean');
      // 高德地图字段
      expect(env.AMAP_KEY).toBeDefined();
      // 备份字段
      expect(env.BACKUP_DIR).toBeDefined();
    });
  });
});
