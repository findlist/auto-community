import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设计原因：redis.ts 在模块加载时调用 createClient 创建单例并注册事件监听器，
// 通过 vi.hoisted 提前创建 mock 引用，便于在 vi.mock 工厂内捕获实例并控制行为
const {
  mockRedisClient,
  mockCreateClient,
  mockLogger,
  eventHandlers,
} = vi.hoisted(() => {
  // eventHandlers 用于捕获 redisClient.on('xxx', cb) 注册的回调，便于测试事件触发
  const eventHandlers: Record<string, (...args: unknown[]) => void> = {};
  const mockRedisClient = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      eventHandlers[event] = cb;
      return mockRedisClient;
    }),
    connect: vi.fn(),
    quit: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    setEx: vi.fn(),
    del: vi.fn(),
    keys: vi.fn(),
    // scan 用于 clearCachePattern 替代 keys 命令的增量游标扫描
    scan: vi.fn(),
  };
  // 设计原因：声明参数类型为可选 unknown，使 mock.calls[0][0] 可索引访问，
  // 否则 vi.fn 推断为无参函数，calls 元组为 [] 无法访问索引 0
  const mockCreateClient = vi.fn<(opts?: unknown) => typeof mockRedisClient>(() => mockRedisClient);
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { mockRedisClient, mockCreateClient, mockLogger, eventHandlers };
});

// mock 'redis' 模块，使 createClient 返回 mock 实例；mock logger 避免真实日志输出干扰测试
vi.mock('redis', () => ({
  createClient: mockCreateClient,
}));
vi.mock('../env', () => ({
  env: {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: mockLogger,
  default: mockLogger,
}));

// 导入被测模块：触发 createClient 调用与事件监听器注册
import {
  redisClient,
  connectRedis,
  disconnectRedis,
  getCache,
  setCache,
  deleteCache,
  clearCachePattern,
} from '../redis';

describe('redis 配置模块', () => {
  beforeEach(() => {
    // 设计原因：模块加载时 createClient 与 on 已被调用并注册事件监听器，
    // 不能用 vi.clearAllMocks() 清除这些"已发生"的调用记录，否则验证模块加载行为的测试会失败；
    // 仅清理运行时方法的调用记录，保留 mockCreateClient 与 mockRedisClient.on 的初始调用
    mockRedisClient.connect.mockClear();
    mockRedisClient.quit.mockClear();
    mockRedisClient.get.mockClear();
    mockRedisClient.set.mockClear();
    mockRedisClient.setEx.mockClear();
    mockRedisClient.del.mockClear();
    mockRedisClient.keys.mockClear();
    mockRedisClient.scan.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  describe('redisClient 单例创建', () => {
    it('应通过 createClient 创建客户端实例并返回', () => {
      // 设计原因：redis.ts 模块加载即调用 createClient，验证单例已创建且与返回值一致
      expect(mockCreateClient).toHaveBeenCalledTimes(1);
      expect(redisClient).toBe(mockRedisClient);
    });

    it('应配置 host/port/password 与重连策略', () => {
      // 设计原因：连接配置从 env 读取，重连策略需要超限返回 Error 避免无限重连
      const callArgs = mockCreateClient.mock.calls[0][0] as {
        socket: { host: string; port: number; reconnectStrategy: (r: number) => unknown };
        password: string | undefined;
      };
      expect(callArgs.socket.host).toBe('localhost');
      expect(callArgs.socket.port).toBe(6379);
      expect(callArgs.password).toBeUndefined();

      // 重连次数超 10 返回 Error 终止重连
      expect(callArgs.socket.reconnectStrategy(11)).toBeInstanceOf(Error);
      // 重连次数 5 返回 1500ms（5*300）
      expect(callArgs.socket.reconnectStrategy(5)).toBe(1500);
      // 重连次数 10 为不超限的最大值，Math.min(10*300, 5000) = 3000
      // 设计原因：5000ms 上限是安全网，但因 retries>10 时直接返回 Error，5000 上限实际不可达
      expect(callArgs.socket.reconnectStrategy(10)).toBe(3000);
    });

    it('应注册 connect/ready/error/end 四个事件监听器', () => {
      // 设计原因：连接状态变化需通过 logger 输出便于排查，验证四个事件均挂载监听器
      expect(mockRedisClient.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('ready', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisClient.on).toHaveBeenCalledWith('end', expect.any(Function));
    });
  });

  describe('事件监听器回调', () => {
    it('connect 事件应输出 debug 日志', () => {
      // 设计原因：连接中状态为低级别日志，便于调试但不影响生产日志量
      eventHandlers.connect();
      expect(mockLogger.debug).toHaveBeenCalledWith('Redis客户端连接中');
    });

    it('ready 事件应输出 info 日志', () => {
      // 设计原因：就绪状态为关键事件，使用 info 级别记录
      eventHandlers.ready();
      expect(mockLogger.info).toHaveBeenCalledWith('Redis客户端就绪');
    });

    it('error 事件应输出 error 日志并携带错误对象', () => {
      // 设计原因：错误事件必须详细记录以便排查，验证 err 字段透传
      const err = new Error('连接失败');
      eventHandlers.error(err);
      expect(mockLogger.error).toHaveBeenCalledWith({ err }, 'Redis客户端错误');
    });

    it('end 事件应输出 debug 日志', () => {
      // 设计原因：连接关闭为低级别日志
      eventHandlers.end();
      expect(mockLogger.debug).toHaveBeenCalledWith('Redis客户端连接关闭');
    });
  });

  describe('connectRedis', () => {
    it('连接成功应调用 redisClient.connect 并输出 info 日志', async () => {
      // 设计原因：正常路径需验证 connect 调用与成功日志输出
      mockRedisClient.connect.mockResolvedValue(undefined);
      await connectRedis();
      expect(mockRedisClient.connect).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith('Redis连接成功');
    });

    it('连接失败应 catch 吞错并输出 warn 日志，不抛出', async () => {
      // 设计原因：Redis 非核心依赖，连接失败需降级为内存模式而非崩溃进程
      const err = new Error('连接超时');
      mockRedisClient.connect.mockRejectedValue(err);
      await expect(connectRedis()).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith({ err }, 'Redis连接失败，将使用内存降级模式');
    });
  });

  describe('disconnectRedis', () => {
    it('关闭成功应调用 redisClient.quit 并输出 info 日志', async () => {
      mockRedisClient.quit.mockResolvedValue(undefined);
      await disconnectRedis();
      expect(mockRedisClient.quit).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith('Redis连接已关闭');
    });

    it('关闭失败应 catch 吞错并输出 error 日志，不抛出', async () => {
      // 设计原因：关闭异常不应阻塞应用退出流程，需 catch 吞错
      const err = new Error('关闭异常');
      mockRedisClient.quit.mockRejectedValue(err);
      await expect(disconnectRedis()).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith({ err }, 'Redis关闭错误');
    });
  });

  describe('getCache', () => {
    it('应返回 JSON.parse 后的值', async () => {
      // 设计原因：缓存存储为 JSON 字符串，读取时需 JSON.parse 还原
      mockRedisClient.get.mockResolvedValue('{"name":"test"}');
      const result = await getCache<{ name: string }>('user:1');
      expect(mockRedisClient.get).toHaveBeenCalledWith('user:1');
      expect(result).toEqual({ name: 'test' });
    });

    it('缓存不存在时应返回 null', async () => {
      // 设计原因：redis get 返回 null 表示键不存在，需直接透传 null
      mockRedisClient.get.mockResolvedValue(null);
      const result = await getCache('user:1');
      expect(result).toBeNull();
    });

    it('空字符串应返回 null', async () => {
      // 设计原因：空字符串为 falsy，需按"无缓存"处理返回 null
      mockRedisClient.get.mockResolvedValue('');
      const result = await getCache('user:1');
      expect(result).toBeNull();
    });

    it('JSON.parse 异常应 catch 吞错并返回 null', async () => {
      // 设计原因：缓存被污染为非法 JSON 时不能抛错导致业务崩溃，需降级返回 null
      mockRedisClient.get.mockResolvedValue('not-json');
      const result = await getCache('user:1');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: expect.any(Error), key: 'user:1' },
        'Redis获取缓存错误',
      );
    });

    it('redisClient.get 抛错应 catch 吞错并返回 null', async () => {
      // 设计原因：Redis 连接异常时 get 会 reject，需 catch 吞错避免业务请求失败
      const err = new Error('Redis 不可用');
      mockRedisClient.get.mockRejectedValue(err);
      const result = await getCache('user:1');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err, key: 'user:1' },
        'Redis获取缓存错误',
      );
    });
  });

  describe('setCache', () => {
    it('无 ttl 应调用 redisClient.set 传 JSON.stringify 后的字符串', async () => {
      // 设计原因：无过期时间的缓存直接 set，需 JSON.stringify 保证可序列化
      await setCache('user:1', { name: 'test' });
      expect(mockRedisClient.set).toHaveBeenCalledWith('user:1', '{"name":"test"}');
      expect(mockRedisClient.setEx).not.toHaveBeenCalled();
    });

    it('有 ttl 应调用 redisClient.setEx 传 ttl 与字符串', async () => {
      // 设计原因：有过期时间的缓存用 setEx，验证 ttl 透传
      await setCache('user:1', { name: 'test' }, 300);
      expect(mockRedisClient.setEx).toHaveBeenCalledWith('user:1', 300, '{"name":"test"}');
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('redisClient.set 异常应 catch 吞错并输出 error 日志', async () => {
      // 设计原因：缓存写入失败不应影响业务主流程，需 catch 吞错
      const err = new Error('写入失败');
      mockRedisClient.set.mockRejectedValue(err);
      await expect(setCache('user:1', 'val')).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err, key: 'user:1' },
        'Redis设置缓存错误',
      );
    });

    it('redisClient.setEx 异常应 catch 吞错并输出 error 日志', async () => {
      const err = new Error('写入失败');
      mockRedisClient.setEx.mockRejectedValue(err);
      await expect(setCache('user:1', 'val', 60)).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err, key: 'user:1' },
        'Redis设置缓存错误',
      );
    });
  });

  describe('deleteCache', () => {
    it('应调用 redisClient.del 删除指定 key', async () => {
      await deleteCache('user:1');
      expect(mockRedisClient.del).toHaveBeenCalledWith('user:1');
    });

    it('redisClient.del 异常应 catch 吞错并输出 error 日志', async () => {
      const err = new Error('删除失败');
      mockRedisClient.del.mockRejectedValue(err);
      await expect(deleteCache('user:1')).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err, key: 'user:1' },
        'Redis删除缓存错误',
      );
    });
  });

  describe('clearCachePattern', () => {
    beforeEach(() => {
      // 重置 scan 和 del mock 的 implementation 与返回值队列，避免前一个用例的
      // mockResolvedValue/mockRejectedValue 残留影响当前用例
      // 设计原因：mockClear() 仅清除调用记录，不清除 implementation；
      // 前一用例设置的 mockResolvedValue({ cursor: '0' }) 或 mockRejectedValue 会持续，
      // 导致当前用例的 mockResolvedValueOnce 优先级被默认值覆盖的假象
      mockRedisClient.scan.mockReset();
      mockRedisClient.del.mockReset();
    });

    it('匹配到 keys 应调用 del 批量删除', async () => {
      // scan 返回 cursor=0（终止游标）+ keys 列表，模拟一轮扫描即完成
      mockRedisClient.scan.mockResolvedValue({ cursor: '0', keys: ['user:1', 'user:2'] });
      await clearCachePattern('user:*');
      expect(mockRedisClient.scan).toHaveBeenCalledWith(0, { MATCH: 'user:*', COUNT: 100 });
      expect(mockRedisClient.del).toHaveBeenCalledWith(['user:1', 'user:2']);
    });

    it('未匹配到 keys 不应调用 del', async () => {
      mockRedisClient.scan.mockResolvedValue({ cursor: '0', keys: [] });
      await clearCachePattern('user:*');
      expect(mockRedisClient.del).not.toHaveBeenCalled();
    });

    it('多轮扫描应循环调用 scan 直到 cursor=0', async () => {
      // 设计原因：scan 是增量游标扫描，cursor 非 0 表示还有未扫描的 keys，需循环调用
      // 第 1 轮返回 cursor=100 + keys=['user:1']，第 2 轮返回 cursor=0 + keys=['user:2']
      mockRedisClient.scan
        .mockResolvedValueOnce({ cursor: '100', keys: ['user:1'] })
        .mockResolvedValueOnce({ cursor: '0', keys: ['user:2'] });
      await clearCachePattern('user:*');
      // scan 被调用 2 次（第 1 次游标 0，第 2 次游标 100）
      expect(mockRedisClient.scan).toHaveBeenCalledTimes(2);
      expect(mockRedisClient.scan).toHaveBeenNthCalledWith(1, 0, { MATCH: 'user:*', COUNT: 100 });
      expect(mockRedisClient.scan).toHaveBeenNthCalledWith(2, 100, { MATCH: 'user:*', COUNT: 100 });
      // del 被调用 2 次（每轮各一次）
      expect(mockRedisClient.del).toHaveBeenCalledTimes(2);
      expect(mockRedisClient.del).toHaveBeenNthCalledWith(1, ['user:1']);
      expect(mockRedisClient.del).toHaveBeenNthCalledWith(2, ['user:2']);
    });

    it('redisClient.scan 异常应 catch 吞错并输出 error 日志', async () => {
      const err = new Error('scan 失败');
      mockRedisClient.scan.mockRejectedValue(err);
      await expect(clearCachePattern('user:*')).resolves.toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err, pattern: 'user:*' },
        'Redis清除缓存错误',
      );
    });
  });
});
