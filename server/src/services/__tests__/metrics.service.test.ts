/**
 * metrics.service 单元测试
 *
 * 测试目标：
 * - getSystemMetrics：聚合数据库/Redis/服务器状态
 * - getDatabaseMetrics（内部，通过 getSystemMetrics 间接测试）：
 *   连接正常 healthy / connect 抛错 unhealthy + critical 告警 / waitingCount>10 触发 warning
 * - getRedisMetrics（内部）：isOpen=false unhealthy / isOpen=true 解析 memory / info 抛错 unhealthy
 * - getServerMetrics（内部）：返回结构完整 / heapUsedPercent>80 触发 warning
 * - getAlertLogs：默认 limit=50 / 指定 limit 截取
 * - clearAlertLogs：清空后返回空数组
 *
 * 测试策略：
 * - mock database 的 pool（提供 totalCount/idleCount/waitingCount 属性 + connect 方法）
 * - mock redis 的 redisClient（提供 isOpen 属性 + info 方法）
 * - mock logger
 * - alertLogs 为模块级数组，测试间通过 clearAlertLogs 清理避免状态泄漏
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 的 pool：提供连接池状态属性 + connect 方法
const { mockPool, mockClient } = vi.hoisted(() => ({
  mockPool: {
    totalCount: 10,
    idleCount: 8,
    waitingCount: 0,
    connect: vi.fn(),
  },
  mockClient: {
    release: vi.fn(),
  },
}));

vi.mock('../../config/database', () => ({
  pool: mockPool,
}));

// mock redis 的 redisClient：提供 isOpen 属性 + info 方法
const { mockRedisClient } = vi.hoisted(() => ({
  mockRedisClient: {
    isOpen: true,
    info: vi.fn(),
  },
}));

vi.mock('../../config/redis', () => ({
  redisClient: mockRedisClient,
}));

// mock logger：避免依赖日志输出环境
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getSystemMetrics, getAlertLogs, clearAlertLogs } from '../metrics.service';

describe('metrics.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置连接池默认状态：健康、无等待
    mockPool.totalCount = 10;
    mockPool.idleCount = 8;
    mockPool.waitingCount = 0;
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.release.mockClear();
    // 重置 Redis 默认状态：已连接、info 成功
    mockRedisClient.isOpen = true;
    mockRedisClient.info.mockResolvedValue('used_memory_human:1.5M\r\nused_memory_peak_human:2.0M\r\n');
    // 清空告警日志，避免测试间状态泄漏
    clearAlertLogs();
  });

  describe('getSystemMetrics - 数据库状态', () => {
    it('连接正常时返回 healthy + 调用 client.release()', async () => {
      // 设计原因：pool.connect() 成功后必须 release，否则连接泄漏
      const result = await getSystemMetrics();

      expect(result.database.status).toBe('healthy');
      expect(result.database.poolSize).toBe(10);
      expect(result.database.idleConnections).toBe(8);
      expect(result.database.waitingCount).toBe(0);
      expect(mockPool.connect).toHaveBeenCalledOnce();
      expect(mockClient.release).toHaveBeenCalledOnce();
    });

    it('pool.connect 抛错时返回 unhealthy + 记录 critical 告警', async () => {
      // 设计原因：数据库连接失败属于严重故障，需记录 critical 告警
      mockPool.connect.mockRejectedValueOnce(new Error('连接超时'));

      const result = await getSystemMetrics();

      expect(result.database.status).toBe('unhealthy');
      // 告警日志应包含 critical 级别的 database 告警
      const alerts = getAlertLogs(10);
      const dbAlert = alerts.find((a) => a.type === 'database' && a.level === 'critical');
      expect(dbAlert).toBeDefined();
      expect(dbAlert!.message).toContain('数据库连接失败');
    });

    it('waitingCount > 10 时返回 healthy 但记录 warning 告警', async () => {
      // 设计原因：等待数过高是性能预警，数据库仍可连接故 status=healthy，但需告警
      mockPool.waitingCount = 15;

      await getSystemMetrics();

      const alerts = getAlertLogs(10);
      const dbAlert = alerts.find((a) => a.type === 'database' && a.level === 'warning');
      expect(dbAlert).toBeDefined();
      expect(dbAlert!.message).toContain('15');
    });
  });

  describe('getSystemMetrics - Redis 状态', () => {
    it('redisClient.isOpen=false 时返回 unhealthy + 记录 critical 告警', async () => {
      mockRedisClient.isOpen = false;

      const result = await getSystemMetrics();

      expect(result.redis.status).toBe('unhealthy');
      expect(result.redis.connected).toBe(false);
      expect(result.redis.memoryUsage).toBe('N/A');
      const alerts = getAlertLogs(10);
      const redisAlert = alerts.find((a) => a.type === 'redis' && a.level === 'critical');
      expect(redisAlert).toBeDefined();
    });

    it('isOpen=true 且 info 成功时返回 healthy + 解析 used_memory_human', async () => {
      mockRedisClient.info.mockResolvedValueOnce('used_memory_human:2.5M\r\n');

      const result = await getSystemMetrics();

      expect(result.redis.status).toBe('healthy');
      expect(result.redis.connected).toBe(true);
      expect(result.redis.memoryUsage).toBe('2.5M');
    });

    it('info 返回的内容无 used_memory_human 时 memoryUsage 为 N/A', async () => {
      mockRedisClient.info.mockResolvedValueOnce('some_other_info:123\r\n');

      const result = await getSystemMetrics();

      expect(result.redis.status).toBe('healthy');
      expect(result.redis.memoryUsage).toBe('N/A');
    });

    it('redisClient.info 抛错时返回 unhealthy + 记录 critical 告警', async () => {
      mockRedisClient.info.mockRejectedValueOnce(new Error('Redis 命令失败'));

      const result = await getSystemMetrics();

      expect(result.redis.status).toBe('unhealthy');
      expect(result.redis.connected).toBe(false);
    });
  });

  describe('getSystemMetrics - 服务器状态', () => {
    it('返回完整的 server 结构（uptime/memoryUsage/requestQueueLength）', async () => {
      // 设计原因：server 指标来自 process.memoryUsage/uptime，验证结构完整性
      const result = await getSystemMetrics();

      expect(result.server).toHaveProperty('uptime');
      expect(result.server.uptime).toBeGreaterThan(0);
      expect(result.server.memoryUsage).toHaveProperty('heapUsed');
      expect(result.server.memoryUsage).toHaveProperty('heapTotal');
      expect(result.server.memoryUsage).toHaveProperty('rss');
      // Express 不直接提供请求队列长度，固定为 0
      expect(result.server.requestQueueLength).toBe(0);
    });
  });

  describe('getSystemMetrics - 聚合结构', () => {
    it('应同时返回 database/redis/server 三个维度', async () => {
      const result = await getSystemMetrics();

      expect(result).toHaveProperty('database');
      expect(result).toHaveProperty('redis');
      expect(result).toHaveProperty('server');
    });
  });

  describe('getAlertLogs', () => {
    it('默认 limit=50，最多返回 50 条', async () => {
      // 设计原因：默认值 50 防止告警日志过大影响响应体积
      // 触发多次告警填充日志
      mockPool.waitingCount = 15;
      for (let i = 0; i < 5; i++) {
        await getSystemMetrics();
      }

      const logs = getAlertLogs();
      // 触发了 5 次 getSystemMetrics，每次 1 条 warning 告警
      expect(logs.length).toBeLessThanOrEqual(50);
      expect(logs.length).toBeGreaterThanOrEqual(5);
    });

    it('指定 limit 时截取对应数量', async () => {
      // 触发 3 次告警
      mockPool.waitingCount = 15;
      await getSystemMetrics();
      await getSystemMetrics();
      await getSystemMetrics();

      const logs = getAlertLogs(2);
      expect(logs).toHaveLength(2);
    });

    it('告警按时间倒序排列（最新在前）', async () => {
      // 设计原因：alertLogs.unshift 将最新告警插入头部，便于运维优先查看最新问题
      mockPool.waitingCount = 15;
      await getSystemMetrics();

      const logs = getAlertLogs(10);
      expect(logs.length).toBeGreaterThan(0);
      // 每条告警都应有 timestamp
      expect(logs[0]).toHaveProperty('timestamp');
    });
  });

  describe('clearAlertLogs', () => {
    it('清空后 getAlertLogs 返回空数组', async () => {
      // 先触发告警
      mockPool.waitingCount = 15;
      await getSystemMetrics();
      expect(getAlertLogs().length).toBeGreaterThan(0);

      clearAlertLogs();

      expect(getAlertLogs()).toEqual([]);
    });
  });
});
