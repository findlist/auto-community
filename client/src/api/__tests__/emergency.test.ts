/**
 * api/emergency 应急资源 API 层单元测试
 *
 * 测试目标：覆盖 10 个导出函数（getRequests/getRequest/createRequest/respondToRequest/
 *           updateResponseStatus/submitFalseReport/getResources/getResource/geocode/regeo）
 *           验证 HTTP 方法、URL 路径、params/body 透传与返回值是否符合预期
 * 测试策略：vi.mock 拦截 client.get/post/put，断言调用参数与返回值
 *
 * 设计原因：emergency API 涉及应急求助（救援安全关键）与资源地图（位置服务），
 * URL/方法/参数错误可能导致救援延误或地理信息丢失，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  ApiResponse,
  PaginatedResponse,
  EmergencyRequest,
  EmergencyResponse,
  EmergencyResource,
} from '@/types';
import {
  getRequests,
  getRequest,
  createRequest,
  respondToRequest,
  updateResponseStatus,
  submitFalseReport,
  getResources,
  getResource,
  geocode,
  regeo,
  type CreateRequestParams,
} from '../emergency';

// mock client 模块，覆盖 get/post/put 3 种方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

import client from '../client';

// 测试用 fixture：单条应急请求
const mockRequest: EmergencyRequest = {
  id: 'req-uuid-001',
  userId: 'user-uuid-001',
  type: 'emergency',
  category: 'medical',
  title: '突发疾病需要送医',
  description: '老人在家中晕倒，需要协助送医',
  urgency: 'critical',
  address: '北京市朝阳区某小区',
  contactPhone: '13800138000',
  isAnonymous: false,
  images: [],
  status: 'open',
  responses: [],
  reviews: [],
  createdAt: '2026-07-28T10:00:00.000Z',
  updatedAt: '2026-07-28T10:00:00.000Z',
};

// 测试用 fixture：单条应急响应
const mockResponse: EmergencyResponse = {
  id: 'resp-uuid-001',
  requestId: 'req-uuid-001',
  userId: 'user-uuid-002',
  message: '我已出发，预计 5 分钟到达',
  eta: 5,
  status: 'accepted',
  createdAt: '2026-07-28T10:01:00.000Z',
};

// 测试用 fixture：单条应急资源
const mockResource: EmergencyResource = {
  id: 'res-uuid-001',
  type: 'aed',
  name: 'AED 除颤仪',
  description: '一楼大厅入口左侧',
  address: '小区物业中心',
  status: 'available',
  createdAt: '2026-07-01T00:00:00.000Z',
};

describe('api/emergency - 应急资源 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRequests - 获取应急请求列表', () => {
    it('应使用 GET /emergency/requests 且透传筛选 params', async () => {
      // 设计原因：getRequests 支持按 type/status/page/pageSize 筛选，
      // 后端按 params 过滤返回分页结果
      const mockPage: ApiResponse<PaginatedResponse<EmergencyRequest>> = {
        code: 0,
        message: 'ok',
        data: { list: [mockRequest], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getRequests({ type: 'emergency', status: 'open', page: 2, pageSize: 10 });

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/emergency/requests', {
        params: { type: 'emergency', status: 'open', page: 2, pageSize: 10 },
      });
      expect(result.data.list[0]!.id).toBe('req-uuid-001');
    });

    it('params 省略时应传 undefined（后端按默认值返回）', async () => {
      // 设计原因：getRequests 不传 params 时返回全量第一页（后端默认 page=1/pageSize=20）
      const mockPage: ApiResponse<PaginatedResponse<EmergencyRequest>> = {
        code: 0,
        message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getRequests();

      const [url, config] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/emergency/requests');
      expect(config.params).toBeUndefined();
    });
  });

  describe('getRequest - 获取单条应急请求', () => {
    it('应使用 GET /emergency/requests/:id 且无 params', async () => {
      // 设计原因：getRequest 通过 URL 路径参数定位请求详情，无 query/body
      const mockRes: ApiResponse<EmergencyRequest> = { code: 0, message: 'ok', data: mockRequest };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getRequest('req-uuid-001');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/emergency/requests/req-uuid-001');
      expect(result.data.title).toBe('突发疾病需要送医');
    });
  });

  describe('createRequest - 创建应急请求', () => {
    it('应使用 POST /emergency/requests 且透传 body', async () => {
      // 设计原因：createRequest 创建求助，body 含 type/category/title/description/urgency 等，
      // 后端会校验至少传 category+title+description，urgency 默认 'medium'
      const params: CreateRequestParams = {
        type: 'emergency',
        category: 'medical',
        title: '突发疾病需要送医',
        description: '老人在家中晕倒',
        urgency: 'critical',
        address: '北京市朝阳区',
        isAnonymous: false,
      };
      const mockRes: ApiResponse<EmergencyRequest> = { code: 0, message: '创建成功', data: mockRequest };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await createRequest(params);

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/emergency/requests', params);
      expect(result.data.id).toBe('req-uuid-001');
    });

    it('location 嵌套对象应原样透传到 body', async () => {
      // 设计原因：location 是 { lng, lat } 嵌套对象，前端不做扁平化，
      // 后端 PostGIS 按 ST_SetSRID(ST_MakePoint(lng, lat), 4326) 写入
      const params: CreateRequestParams = {
        category: 'rescue',
        title: '需要救援',
        description: '被困电梯',
        location: { lng: 116.404, lat: 39.915 },
      };
      const mockRes: ApiResponse<EmergencyRequest> = { code: 0, message: 'ok', data: mockRequest };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await createRequest(params);

      const [url, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/emergency/requests');
      expect(body.location).toEqual({ lng: 116.404, lat: 39.915 });
    });
  });

  describe('respondToRequest - 响应应急请求', () => {
    it('应使用 POST /emergency/requests/:id/respond 且透传 message/eta', async () => {
      // 设计原因：respondToRequest 通过 URL 路径定位请求，body 含响应消息与预计到达时间
      const mockRes: ApiResponse<EmergencyResponse> = { code: 0, message: '响应成功', data: mockResponse };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await respondToRequest('req-uuid-001', { message: '我已出发', eta: 10 });

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/emergency/requests/req-uuid-001/respond', {
        message: '我已出发',
        eta: 10,
      });
      expect(result.data.status).toBe('accepted');
    });
  });

  describe('updateResponseStatus - 更新响应状态', () => {
    it('应使用 PUT /emergency/responses/:id/status 且透传 status', async () => {
      // 设计原因：updateResponseStatus 用 PUT 全量更新状态字段，
      // status 仅允许 'arrived'/'completed'，rating/review 在 completed 时必填
      const mockRes: ApiResponse<EmergencyResponse> = {
        code: 0,
        message: '已更新',
        data: { ...mockResponse, status: 'arrived', arrivedAt: '2026-07-28T10:05:00.000Z' },
      };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await updateResponseStatus('resp-uuid-001', { status: 'arrived' });

      expect(client.put).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledWith('/emergency/responses/resp-uuid-001/status', { status: 'arrived' });
      expect(result.data.status).toBe('arrived');
    });

    it('completed 状态应透传 rating/review', async () => {
      // 设计原因：completed 状态需附 rating（1-5）+ review（评价内容），后端校验非空
      const mockRes: ApiResponse<EmergencyResponse> = {
        code: 0,
        message: 'ok',
        data: { ...mockResponse, status: 'completed', completedAt: '2026-07-28T10:30:00.000Z' },
      };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateResponseStatus('resp-uuid-001', { status: 'completed', rating: 5, review: '非常感谢' });

      const [url, body] = (client.put as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/emergency/responses/resp-uuid-001/status');
      expect(body).toEqual({ status: 'completed', rating: 5, review: '非常感谢' });
    });
  });

  describe('submitFalseReport - 提交误报标记', () => {
    it('应使用 POST /emergency/false-reports 且透传 requestId/reason', async () => {
      // 设计原因：submitFalseReport 是举报虚假求助，body 含 requestId + reason，
      // 后端会写入 false_reports 表并触发审核流程
      const mockRes: ApiResponse<null> = { code: 0, message: '已提交', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await submitFalseReport('req-uuid-001', '内容描述夸大');

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/emergency/false-reports', {
        requestId: 'req-uuid-001',
        reason: '内容描述夸大',
      });
      expect(result.data).toBeNull();
    });
  });

  describe('getResources - 获取应急资源列表', () => {
    it('应使用 GET /emergency/resources 且透传筛选 params', async () => {
      // 设计原因：getResources 支持按 type/page/pageSize 筛选，用于资源地图筛选
      const mockPage: ApiResponse<PaginatedResponse<EmergencyResource>> = {
        code: 0,
        message: 'ok',
        data: { list: [mockResource], total: 1, page: 1, pageSize: 20, totalPages: 1, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const result = await getResources({ type: 'aed', page: 1, pageSize: 10 });

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/emergency/resources', {
        params: { type: 'aed', page: 1, pageSize: 10 },
      });
      expect(result.data.list[0]!.type).toBe('aed');
    });
  });

  describe('getResource - 获取单条应急资源', () => {
    it('应使用 GET /emergency/resources/:id 且无 params', async () => {
      const mockRes: ApiResponse<EmergencyResource> = { code: 0, message: 'ok', data: mockResource };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getResource('res-uuid-001');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/emergency/resources/res-uuid-001');
      expect(result.data.name).toBe('AED 除颤仪');
    });
  });

  describe('geocode - 地址转经纬度', () => {
    it('应使用 GET /emergency/map/geocode 且透传 address', async () => {
      // 设计原因：geocode 用于地址解析（地址 → lng/lat），驱动应急请求定位地图标记；
      // 后端通过高德地图 API 查询，返回 { lng, lat } 或 null（地址无法解析）
      const mockRes: ApiResponse<{ lng: number; lat: number } | null> = {
        code: 0,
        message: 'ok',
        data: { lng: 116.404, lat: 39.915 },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await geocode('北京市朝阳区');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/emergency/map/geocode', {
        params: { address: '北京市朝阳区' },
      });
      expect(result.data?.lng).toBe(116.404);
    });

    it('地址无法解析时应返回 null', async () => {
      // 设计原因：后端无法解析地址时返回 null，前端需显示「地址无法定位」提示
      const mockRes: ApiResponse<{ lng: number; lat: number } | null> = {
        code: 0,
        message: 'ok',
        data: null,
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await geocode('无效地址测试');

      expect(result.data).toBeNull();
    });
  });

  describe('regeo - 经纬度转地址', () => {
    it('应使用 GET /emergency/map/regeo 且透传 lng/lat', async () => {
      // 设计原因：regeo 用于逆地址解析（经纬度 → 地址字符串），驱动资源地图点击反查地址；
      // 与 geocode 对称，后端通过高德地图 API 查询
      const mockRes: ApiResponse<string | null> = {
        code: 0,
        message: 'ok',
        data: '北京市朝阳区某小区',
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await regeo(116.404, 39.915);

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.get).toHaveBeenCalledWith('/emergency/map/regeo', {
        params: { lng: 116.404, lat: 39.915 },
      });
      expect(result.data).toBe('北京市朝阳区某小区');
    });

    it('经纬度无法解析时应返回 null', async () => {
      const mockRes: ApiResponse<string | null> = { code: 0, message: 'ok', data: null };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await regeo(0, 0);

      expect(result.data).toBeNull();
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：vi.clearAllMocks 在 beforeEach 调用，确保用例间调用记录隔离；
      // 此用例显式验证：连续调用 get/post/put 各 1 次，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: 0, message: 'ok', data: mockRequest,
      });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: 0, message: 'ok', data: mockResponse,
      });
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({
        code: 0, message: 'ok', data: mockResponse,
      });

      await getRequest('req-001');
      await respondToRequest('req-001', { message: 'ok' });
      await updateResponseStatus('resp-001', { status: 'arrived' });

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledTimes(1);
    });
  });
});
