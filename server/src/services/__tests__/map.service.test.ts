/**
 * map.service 单元测试
 *
 * 测试目标：
 * - geocode：AMAP_KEY 未配置降级 / 空地址降级 / 成功解析经纬度 / 响应状态异常降级 / fetch 抛错降级
 * - regeo：AMAP_KEY 未配置降级 / 零坐标降级 / 成功解析地址 / fetch 抛错降级
 * - calculateDistance：相同点距离为 0 / 已知两点近似值 / Haversine 公式正确性
 *
 * 测试策略：
 * - mock env 的 AMAP_KEY 字段，通过 Object.defineProperty 动态切换，验证降级路径
 * - mock 全局 fetch，模拟高德 API 响应
 * - calculateDistance 为纯函数，无需 mock，直接验证数学正确性
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock env：提供可动态修改的 AMAP_KEY
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { AMAP_KEY: 'test-amap-key' },
}));

vi.mock('../../config/env', () => ({
  env: mockEnv,
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

// mock 全局 fetch：默认返回成功响应，具体行为在用例中覆盖
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { geocode, regeo, calculateDistance, mapService } from '../map.service';

describe('map.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 AMAP_KEY 已配置
    mockEnv.AMAP_KEY = 'test-amap-key';
  });

  afterEach(() => {
    // 恢复 AMAP_KEY 默认值，避免用例间状态泄漏
    mockEnv.AMAP_KEY = 'test-amap-key';
  });

  describe('geocode', () => {
    it('AMAP_KEY 未配置时返回 null', async () => {
      // 设计原因：第三方依赖缺失时降级返回 null，不阻塞主流程，符合规范第六章降级策略
      mockEnv.AMAP_KEY = '';

      const result = await geocode('北京市朝阳区');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('空地址或纯空白地址时返回 null', async () => {
      // 设计原因：空地址无意义，直接降级避免无效 API 调用
      const result = await geocode('   ');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('成功时返回 {lng, lat} 坐标对象', async () => {
      // 设计原因：高德返回的 location 格式为 "经度,纬度"，需正确拆分并转 number
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          status: '1',
          info: 'OK',
          infocode: '10000',
          geocodes: [{ formatted_address: '北京市朝阳区', location: '116.481028,39.990989', level: 'street' }],
        }),
      });

      const result = await geocode('北京市朝阳区');

      expect(result).toEqual({ lng: 116.481028, lat: 39.990989 });
    });

    it('响应 status 非 1 时返回 null', async () => {
      // 设计原因：高德 status=0 表示业务失败，需降级处理
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }),
      });

      const result = await geocode('北京市朝阳区');

      expect(result).toBeNull();
    });

    it('geocodes 为空数组时返回 null', async () => {
      // 设计原因：status=1 但无结果，同样需降级
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: '1', info: 'OK', infocode: '10000', geocodes: [] }),
      });

      const result = await geocode('不存在的地址');

      expect(result).toBeNull();
    });

    it('fetch 抛错时 catch 吞错返回 null', async () => {
      // 设计原因：网络异常不应抛出到上层导致主流程中断，降级返回 null
      mockFetch.mockRejectedValueOnce(new Error('网络超时'));

      const result = await geocode('北京市朝阳区');

      expect(result).toBeNull();
    });
  });

  describe('regeo', () => {
    it('AMAP_KEY 未配置时返回 null', async () => {
      mockEnv.AMAP_KEY = '';

      const result = await regeo(116.481028, 39.990989);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('经度或纬度为 0 时返回 null', async () => {
      // 设计原因：源码用 !lng || !lat 判断，0 会被视为 falsy 而降级
      // 这是已知的边界行为，测试锁定以防止回归
      const result = await regeo(0, 39.990989);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('成功时返回格式化地址字符串', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({
          status: '1',
          info: 'OK',
          infocode: '10000',
          regeocode: {
            formatted_address: '北京市朝阳区望京街道',
            addressComponent: {
              province: '北京市', city: '', district: '朝阳区', township: '望京街道', street: '', streetNumber: '',
            },
          },
        }),
      });

      const result = await regeo(116.481028, 39.990989);

      expect(result).toBe('北京市朝阳区望京街道');
    });

    it('响应 status 非 1 时返回 null', async () => {
      mockFetch.mockResolvedValueOnce({
        json: async () => ({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }),
      });

      const result = await regeo(116.481028, 39.990989);

      expect(result).toBeNull();
    });

    it('fetch 抛错时 catch 吞错返回 null', async () => {
      mockFetch.mockRejectedValueOnce(new Error('网络超时'));

      const result = await regeo(116.481028, 39.990989);

      expect(result).toBeNull();
    });
  });

  describe('calculateDistance', () => {
    it('相同点距离为 0', () => {
      // 设计原因：Haversine 公式对相同点应返回 0，验证边界条件
      const distance = calculateDistance(116.481028, 39.990989, 116.481028, 39.990989);

      expect(distance).toBe(0);
    });

    it('已知两点距离应大于 0 且在合理范围内', () => {
      // 设计原因：北京到上海直线距离约 1000km，验证计算结果在合理量级
      // 北京 116.40, 39.90；上海 121.47, 31.23
      const distance = calculateDistance(116.40, 39.90, 121.47, 31.23);

      // 约 1067km，允许 ±50km 误差（球面距离近似）
      expect(distance).toBeGreaterThan(1_000_000);
      expect(distance).toBeLessThan(1_150_000);
    });

    it('交换起点终点距离不变（对称性）', () => {
      // 设计原因：Haversine 公式具有对称性，交换两端点结果应一致
      const d1 = calculateDistance(116.40, 39.90, 121.47, 31.23);
      const d2 = calculateDistance(121.47, 31.23, 116.40, 39.90);

      expect(d1).toBeCloseTo(d2, 6);
    });
  });

  describe('mapService 聚合导出', () => {
    it('应包含 geocode/regeo/calculateDistance 三个方法', () => {
      // 设计原因：聚合导出是路由层依赖的统一入口，结构变更需测试锁定
      expect(mapService).toHaveProperty('geocode');
      expect(mapService).toHaveProperty('regeo');
      expect(mapService).toHaveProperty('calculateDistance');
      expect(typeof mapService.geocode).toBe('function');
      expect(typeof mapService.regeo).toBe('function');
      expect(typeof mapService.calculateDistance).toBe('function');
    });
  });
});
