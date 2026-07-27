/**
 * tokenBlacklist 单元测试（vitest）
 *
 * 测试目标：JWT 登出黑名单工具的写入与查询逻辑，覆盖正常路径、边界情况、降级容错
 * 测试策略：mock redisClient（setEx/get）与 logger，隔离真实 Redis 依赖，纳入 CI 套件
 *
 * 设计原因：
 * - tokenBlacklist 是安全模块（登出后令牌拉黑），其正确性直接影响会话失效机制
 * - 原实现为 node:assert 自执行脚本，依赖真实 Redis 实例，无法在 CI 中运行
 * - 改用 vitest + mock 后，每次提交均会校验该模块逻辑，防止回归
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret-for-blacklist';
process.env.DB_PASSWORD = 'test-db-password';

// mock redisClient：tokenBlacklist 直接调用 redisClient.setEx / redisClient.get
// mock logger：需断言降级时 warn 被调用，故提取 mockLoggerWarn 引用
// 使用 vi.hoisted 确保 mock 函数在 vi.mock 工厂执行前已创建（vi.mock 会被提升到文件顶部）
const { mockSetEx, mockGet, mockLoggerWarn } = vi.hoisted(() => ({
  mockSetEx: vi.fn(),
  mockGet: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('../../config/redis', () => ({
  redisClient: {
    setEx: mockSetEx,
    get: mockGet,
  },
}));

vi.mock('../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
  },
}));

import { tokenBlacklist } from '../tokenBlacklist';

describe('tokenBlacklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 resolve，避免每个用例重复设置
    mockSetEx.mockResolvedValue(undefined);
    mockGet.mockResolvedValue(null);
  });

  describe('addToBlacklist', () => {
    it('未过期的 token 应调用 setEx 写入黑名单，key 含 blacklist:token: 前缀，value 为 1', async () => {
      // 设计原因：key 前缀是 Redis 命名空间隔离的基础，value 固定为 '1' 仅作存在性标记
      const token = 'test-token-abc';
      const exp = Math.floor(Date.now() / 1000) + 60; // 60 秒后过期

      await tokenBlacklist.addToBlacklist(token, exp);

      expect(mockSetEx).toHaveBeenCalledOnce();
      const [key, ttl, value] = mockSetEx.mock.calls[0];
      expect(key).toBe(`blacklist:token:${token}`);
      // ttl = exp - now，因调用存在毫秒级延迟，容忍 5 秒误差
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
      expect(value).toBe('1');
    });

    it('已过期的 token（ttl <= 0）应跳过写入，不调用 setEx', async () => {
      // 设计原因：过期 token 写入黑名单无意义（JWT 本身已失效），跳过避免无谓的 Redis 写入
      const token = 'expired-token';
      const exp = Math.floor(Date.now() / 1000) - 10; // 10 秒前已过期

      await tokenBlacklist.addToBlacklist(token, exp);

      expect(mockSetEx).not.toHaveBeenCalled();
    });

    it('Redis 不可用时应捕获异常并记录 warn，不向上抛出（降级不阻塞登出流程）', async () => {
      // 设计原因：登出不应因 Redis 故障而失败，降级后仅依赖 JWT 自身过期，warn 便于安全审计
      mockSetEx.mockRejectedValueOnce(new Error('Redis 连接失败'));
      const token = 'test-token-degrade';
      const exp = Math.floor(Date.now() / 1000) + 60;

      await expect(tokenBlacklist.addToBlacklist(token, exp)).resolves.toBeUndefined();
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    });
  });

  describe('isBlacklisted', () => {
    it('Redis 命中（返回非 null）应返回 true', async () => {
      mockGet.mockResolvedValueOnce('1');
      const token = 'blacklisted-token';

      const result = await tokenBlacklist.isBlacklisted(token);

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith(`blacklist:token:${token}`);
    });

    it('Redis 未命中（返回 null）应返回 false', async () => {
      mockGet.mockResolvedValueOnce(null);
      const token = 'clean-token';

      const result = await tokenBlacklist.isBlacklisted(token);

      expect(result).toBe(false);
      expect(mockGet).toHaveBeenCalledWith(`blacklist:token:${token}`);
    });

    it('Redis 不可用时应捕获异常、记录 warn 并返回 false（降级放行，依赖 JWT 过期）', async () => {
      // 设计原因：Redis 故障时放行避免阻断正常认证，warn 标记安全隐患供运维排查
      mockGet.mockRejectedValueOnce(new Error('Redis 连接失败'));
      const token = 'test-token-degrade';

      const result = await tokenBlacklist.isBlacklisted(token);

      expect(result).toBe(false);
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    });
  });
});
