/**
 * api/ai AI 智能匹配 API 层单元测试
 *
 * 测试目标：覆盖 2 个导出函数（matchSkill/matchTimeService）
 *           验证 HTTP 方法、URL 路径与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get，断言调用参数与返回值
 *
 * 设计原因：ai API 函数内部对响应数据做了 res.data?.data || [] 兜底处理，
 * 当后端返回 null/undefined 时应回退为空数组，本测试验证兜底逻辑
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  matchSkill,
  matchTimeService,
  type MatchCandidate,
} from '../ai';

// mock client 模块，仅用 get 方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单条匹配候选
const mockCandidate: MatchCandidate = {
  userId: 'user-uuid-002',
  nickname: '匹配用户',
  reputationScore: 85,
  matchScore: 0.92,
  distance: 500,
  post: { id: 'post-uuid-001', title: '钢琴教学', category: '音乐' },
};

describe('api/ai - AI 智能匹配 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('matchSkill - 技能帖子 AI 推荐', () => {
    it('应使用 GET /ai/match/skills/:postId 且返回候选数组', async () => {
      // 设计原因：matchSkill 内部取 res.data?.data 做兜底，正常响应应返回候选数组
      const mockRes = { data: { data: [mockCandidate] } };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await matchSkill('post-uuid-001');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/ai/match/skills/post-uuid-001');
      expect(result).toHaveLength(1);
      expect(result[0]!.matchScore).toBe(0.92);
    });

    it('后端返回空数组时应返回 []', async () => {
      const mockRes = { data: { data: [] } };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await matchSkill('post-uuid-002');

      expect(result).toEqual([]);
    });

    it('后端返回 null/undefined 时应兜底为 []', async () => {
      // 设计原因：res.data?.data || [] 兜底逻辑，避免 null/undefined 污染下游
      const mockRes = { data: { data: null } };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await matchSkill('post-uuid-003');

      expect(result).toEqual([]);
    });

    it('res.data 为 undefined 时应兜底为 []', async () => {
      // 设计原因：极端场景 res 整个 data 字段为 undefined，?.data 兜底
      const mockRes = { data: undefined };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await matchSkill('post-uuid-004');

      expect(result).toEqual([]);
    });
  });

  describe('matchTimeService - 时间银行服务 AI 推荐', () => {
    it('应使用 GET /ai/match/time-bank/:serviceId 且返回候选数组', async () => {
      const mockRes = { data: { data: [mockCandidate] } };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await matchTimeService('svc-uuid-001');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/ai/match/time-bank/svc-uuid-001');
      expect(result).toHaveLength(1);
      expect(result[0]!.distance).toBe(500);
    });

    it('后端返回 null 时应兜底为 []', async () => {
      const mockRes = { data: { data: null } };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await matchTimeService('svc-uuid-002');

      expect(result).toEqual([]);
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 2 次 get 不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { data: [] } });

      await matchSkill('p1');
      await matchTimeService('s1');

      expect(client.get).toHaveBeenCalledTimes(2);
    });
  });
});
