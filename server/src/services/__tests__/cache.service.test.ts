/**
 * cache.service 单元测试
 *
 * 测试目标：
 * - getOrSetCache（通过 userCache.get 间接测试）：缓存命中/未命中/不缓存空值
 * - 四个缓存对象（userCache/skillPostCache/kitchenPostCache/timeServiceCache）的
 *   getKey 生成规则、get 缓存读写流程、invalidate 清除调用
 *
 * 测试策略：
 * - mock redis 的 getCache/setCache/deleteCache，避免真实 Redis 依赖
 * - mock logger，避免依赖日志输出环境
 * - 通过 userCache.get 间接覆盖未导出的 getOrSetCache 内部分支
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock redis：getCache 默认返回 null（缓存未命中），setCache/deleteCache 直接 resolve
const { mockGetCache, mockSetCache, mockDeleteCache } = vi.hoisted(() => ({
  mockGetCache: vi.fn(),
  mockSetCache: vi.fn(),
  mockDeleteCache: vi.fn(),
}));

vi.mock('../../config/redis', () => ({
  getCache: mockGetCache,
  setCache: mockSetCache,
  deleteCache: mockDeleteCache,
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

import { userCache, skillPostCache, kitchenPostCache, timeServiceCache } from '../cache.service';

describe('cache.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认缓存未命中
    mockGetCache.mockResolvedValue(null);
    mockSetCache.mockResolvedValue(undefined);
    mockDeleteCache.mockResolvedValue(undefined);
  });

  describe('userCache', () => {
    describe('getKey', () => {
      it('应生成 user: 前缀的 key', () => {
        // 设计原因：key 命名规则是缓存隔离的基础，变更会导致缓存失效
        expect(userCache.getKey('u123')).toBe('user:u123');
      });
    });

    describe('get', () => {
      it('缓存命中时直接返回缓存值，不调用 fetchFn', async () => {
        // 设计原因：缓存命中的核心价值是跳过数据源查询，必须验证 fetchFn 未被调用
        const cached = { id: 'u123', nickname: 'Alice' };
        mockGetCache.mockResolvedValueOnce(cached);
        const fetchFn = vi.fn();

        const result = await userCache.get('u123', fetchFn);

        expect(result).toEqual(cached);
        expect(mockGetCache).toHaveBeenCalledWith('user:u123');
        expect(fetchFn).not.toHaveBeenCalled();
        // 缓存命中不应触发 setCache
        expect(mockSetCache).not.toHaveBeenCalled();
      });

      it('缓存未命中时调用 fetchFn 并写入缓存', async () => {
        // 设计原因：缓存未命中时必须回源并回填缓存，否则缓存形同虚设
        const data = { id: 'u123', nickname: 'Alice' };
        const fetchFn = vi.fn().mockResolvedValue(data);

        const result = await userCache.get('u123', fetchFn);

        expect(result).toEqual(data);
        expect(fetchFn).toHaveBeenCalledOnce();
        // 默认 TTL 为 300 秒
        expect(mockSetCache).toHaveBeenCalledWith('user:u123', data, 300);
      });

      it('fetchFn 返回 null 时不写入缓存（防止缓存穿透）', async () => {
        // 设计原因：缓存 null 值会导致后续请求持续命中空缓存，掩盖数据源故障
        const fetchFn = vi.fn().mockResolvedValue(null);

        const result = await userCache.get('u123', fetchFn);

        expect(result).toBeNull();
        expect(mockSetCache).not.toHaveBeenCalled();
      });

      it('fetchFn 返回 undefined 时不写入缓存', async () => {
        // 设计原因：undefined 同样代表无效数据，与 null 一致处理避免缓存污染
        const fetchFn = vi.fn().mockResolvedValue(undefined);

        const result = await userCache.get('u123', fetchFn);

        expect(result).toBeUndefined();
        expect(mockSetCache).not.toHaveBeenCalled();
      });
    });

    describe('invalidate', () => {
      it('应调用 deleteCache 清除对应 key', async () => {
        // 设计原因：缓存失效必须真实删除 key，否则脏数据会持续被读取
        await userCache.invalidate('u123');

        expect(mockDeleteCache).toHaveBeenCalledWith('user:u123');
      });
    });
  });

  describe('skillPostCache', () => {
    it('getKey 应生成 skill_post: 前缀的 key', () => {
      expect(skillPostCache.getKey('p1')).toBe('skill_post:p1');
    });

    it('缓存命中时直接返回，不调用 fetchFn', async () => {
      // 设计原因：验证不同缓存对象共享同一套 getOrSetCache 逻辑，key 前缀正确隔离
      const cached = { id: 'p1', title: '技能帖' };
      mockGetCache.mockResolvedValueOnce(cached);
      const fetchFn = vi.fn();

      const result = await skillPostCache.get('p1', fetchFn);

      expect(result).toEqual(cached);
      expect(mockGetCache).toHaveBeenCalledWith('skill_post:p1');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('invalidate 应清除 skill_post: 前缀的 key', async () => {
      await skillPostCache.invalidate('p1');

      expect(mockDeleteCache).toHaveBeenCalledWith('skill_post:p1');
    });
  });

  describe('kitchenPostCache', () => {
    it('getKey 应生成 kitchen_post: 前缀的 key', () => {
      expect(kitchenPostCache.getKey('k1')).toBe('kitchen_post:k1');
    });

    it('缓存未命中时回源并写入缓存', async () => {
      const data = { id: 'k1', title: '美食帖' };
      const fetchFn = vi.fn().mockResolvedValue(data);

      const result = await kitchenPostCache.get('k1', fetchFn);

      expect(result).toEqual(data);
      expect(mockGetCache).toHaveBeenCalledWith('kitchen_post:k1');
      expect(mockSetCache).toHaveBeenCalledWith('kitchen_post:k1', data, 300);
    });

    it('invalidate 应清除 kitchen_post: 前缀的 key', async () => {
      await kitchenPostCache.invalidate('k1');

      expect(mockDeleteCache).toHaveBeenCalledWith('kitchen_post:k1');
    });
  });

  describe('timeServiceCache', () => {
    it('getKey 应生成 time_service: 前缀的 key', () => {
      expect(timeServiceCache.getKey('t1')).toBe('time_service:t1');
    });

    it('缓存未命中时回源并写入缓存', async () => {
      const data = { id: 't1', name: '保洁服务' };
      const fetchFn = vi.fn().mockResolvedValue(data);

      const result = await timeServiceCache.get('t1', fetchFn);

      expect(result).toEqual(data);
      expect(mockGetCache).toHaveBeenCalledWith('time_service:t1');
      expect(mockSetCache).toHaveBeenCalledWith('time_service:t1', data, 300);
    });

    it('invalidate 应清除 time_service: 前缀的 key', async () => {
      await timeServiceCache.invalidate('t1');

      expect(mockDeleteCache).toHaveBeenCalledWith('time_service:t1');
    });
  });
});
