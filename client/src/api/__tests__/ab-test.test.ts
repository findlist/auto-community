/**
 * api/ab-test AB 测试 API 层单元测试
 *
 * 测试目标：覆盖 5 个导出函数（getAllTests/getTestConfig/assignVariant/recordEvent/
 *           getTestResults）
 *           验证 HTTP 方法、URL 路径、body 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post，断言调用参数与返回值
 *
 * 设计原因：ab-test API 用于运营实验，URL/方法错误会导致变体分配错乱或事件统计丢失，
 * 影响实验结论可信度，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse } from '@/types';
import {
  getAllTests,
  getTestConfig,
  assignVariant,
  recordEvent,
  getTestResults,
  type ABTestConfig,
  type VariantAssignment,
  type TestResults,
} from '../ab-test';

// mock client 模块，覆盖 get/post 2 种方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单个 AB 测试配置
const mockConfig: ABTestConfig = {
  id: 1,
  testName: 'home_button_color',
  description: '首页主按钮颜色对比实验',
  variants: { control: 50, variant_a: 50 },
  status: 'running',
  startDate: '2026-07-01T00:00:00.000Z',
  endDate: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

// 测试用 fixture：变体分配
const mockAssignment: VariantAssignment = {
  variant: 'variant_a',
  testName: 'home_button_color',
};

// 测试用 fixture：测试结果
const mockResults: TestResults = {
  testName: 'home_button_color',
  variants: [
    { variant: 'control', eventCounts: { click: 100, convert: 5 }, totalEvents: 100, conversionRate: 0.05 },
    { variant: 'variant_a', eventCounts: { click: 120, convert: 12 }, totalEvents: 120, conversionRate: 0.1 },
  ],
  totalParticipants: 220,
};

describe('api/ab-test - AB 测试 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllTests - 获取全部 AB 测试配置', () => {
    it('应使用 GET /ab-tests 返回数组', async () => {
      const mockRes: ApiResponse<ABTestConfig[]> = { code: 0, message: 'ok', data: [mockConfig] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getAllTests();

      expect(client.get).toHaveBeenCalledWith('/ab-tests');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.testName).toBe('home_button_color');
    });
  });

  describe('getTestConfig - 获取单个测试配置', () => {
    it('应使用 GET /ab-tests/:testName/config', async () => {
      // 设计原因：getTestConfig 通过 URL 路径参数定位测试，testName 是字符串而非 id
      const mockRes: ApiResponse<ABTestConfig> = { code: 0, message: 'ok', data: mockConfig };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getTestConfig('home_button_color');

      expect(client.get).toHaveBeenCalledWith('/ab-tests/home_button_color/config');
      expect(result.data.status).toBe('running');
    });
  });

  describe('assignVariant - 分配变体', () => {
    it('应使用 POST /ab-tests/:testName/assign 且无 body', async () => {
      // 设计原因：assignVariant 由后端根据用户标识 + testName 哈希决定变体，
      // 保证同一用户多次访问获得相同变体（sticky assignment）
      const mockRes: ApiResponse<VariantAssignment> = { code: 0, message: '已分配', data: mockAssignment };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await assignVariant('home_button_color');

      expect(client.post).toHaveBeenCalledWith('/ab-tests/home_button_color/assign');
      expect(result.data.variant).toBe('variant_a');
    });
  });

  describe('recordEvent - 记录转化事件', () => {
    it('应使用 POST /ab-tests/:testName/event 且透传 eventType/variant/metadata', async () => {
      // 设计原因：recordEvent 上报用户行为（如 click/convert），后端按 testName+variant 分组统计
      const mockRes: ApiResponse<null> = { code: 0, message: '已记录', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await recordEvent('home_button_color', 'click', 'variant_a', { page: '/home' });

      expect(client.post).toHaveBeenCalledWith('/ab-tests/home_button_color/event', {
        eventType: 'click',
        variant: 'variant_a',
        metadata: { page: '/home' },
      });
      expect(result.data).toBeNull();
    });

    it('metadata 省略时应传 undefined', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: 'ok', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await recordEvent('home_button_color', 'convert', 'control');

      const body = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(body.metadata).toBeUndefined();
    });
  });

  describe('getTestResults - 获取测试结果', () => {
    it('应使用 GET /ab-tests/:testName/results 返回统计数据', async () => {
      // 设计原因：getTestResults 返回各变体的事件计数与转化率，
      // 前端按 conversionRate 高低展示胜出变体
      const mockRes: ApiResponse<TestResults> = { code: 0, message: 'ok', data: mockResults };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getTestResults('home_button_color');

      expect(client.get).toHaveBeenCalledWith('/ab-tests/home_button_color/results');
      expect(result.data.totalParticipants).toBe(220);
      expect(result.data.variants[0]!.conversionRate).toBe(0.05);
      expect(result.data.variants[1]!.conversionRate).toBe(0.1);
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 get/post 各 1 次，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: [mockConfig] });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: mockAssignment });

      await getAllTests();
      await assignVariant('home_button_color');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
    });
  });
});
