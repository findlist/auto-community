/**
 * api/admin 管理后台 API 层单元测试
 *
 * 测试目标：覆盖 30+ 个导出函数，分 12 个模块组织：
 *   1. Dashboard 仪表盘统计（4+4 趋势/信誉/模块/系统）
 *   2. Users 用户管理（ban/unban/role/batch）
 *   3. Content 内容管理（list/status/detail/update/batch）
 *   4. HomepageImage 首页图片
 *   5. Settings 系统配置（CRUD）
 *   6. AuditLogs 审计日志
 *   7. Orders 订单管理
 *   8. Reports 举报管理
 *   9. Verifications 实名认证审核
 *  10. SystemMetrics 系统指标
 *  11. MetricsDashboard 效果度量
 *  12. Export 数据导出（Blob 下载）
 *
 * 测试策略：vi.mock 拦截 client.get/post/put/delete，断言调用参数与返回值
 * 设计原因：admin API 是管理后台核心，涉及用户封禁/内容下架/订单取消/认证审核等
 * 敏感操作，方法/URL 错误会导致数据误操作，本测试作为契约守护
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ApiResponse, PaginatedResponse } from '@/types';
import {
  // Dashboard
  getDashboard, getDashboardTrend, getDashboardReputation, getDashboardModules, getDashboardSystem,
  // Users
  getUsers, banUser, unbanUser, updateUserRole, batchBanUsers, batchUnbanUsers,
  // Content
  getContent, updateContentStatus, getContentDetail, updateContent, batchUpdateContentStatus,
  // Homepage Image
  getHomepageImage, setHomepageImage,
  // Settings
  getSettings, getSettingDetail, setSetting, deleteSetting,
  // Audit Logs
  getAuditLogs,
  // Orders
  getOrders, forceCancelOrder,
  // Reports
  getReports, handleReport, createReport,
  // Verifications
  getVerificationRequests, reviewVerification,
  // System Metrics
  getSystemMetrics, clearAlertLogs,
  // Metrics Dashboard
  getMetricsDashboard, getMetricSummary, getMetricTrend,
  // Export
  exportData,
  // Types
  type DashboardData, type AdminUser, type AdminContentItem, type ContentDetail,
  type SystemSetting, type AuditLog, type AuditLogQuery, type AdminOrderItem,
  type Report, type VerificationRequest, type MetricsResponse, type DashboardMetric,
  type MetricSummary, type MetricTrendItem, type BatchBanResult, type BatchResult,
  type ExportType, type ExportFormat, type ExportParams,
} from '../admin';

// mock client 模块，覆盖 get/post/put/delete 4 种方法
vi.mock('../client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import client from '../client';

// mock 浏览器 DOM API（用于 exportData 测试）
// 设计原因：exportData 通过 document.createElement('a') + URL.createObjectURL 触发下载，
// jsdom 环境下 URL.createObjectURL 默认不存在，需手动 mock
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
Object.defineProperty(globalThis.URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
Object.defineProperty(globalThis.URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });

import client from '../client';

describe('api/admin - 管理后台 API 层', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectURL.mockClear();
    mockRevokeObjectURL.mockClear();
  });

  // ==================== Dashboard 仪表盘统计 ====================
  describe('Dashboard 仪表盘统计', () => {
    it('getDashboard 应使用 GET /admin/dashboard', async () => {
      const mockData: DashboardData = {
        totalUsers: 100, todayNewUsers: 5, skillOrders: 50, kitchenOrders: 30,
        timeBankOrders: 20, emergencyRequests: 10, pendingReports: 3,
      };
      const mockRes: ApiResponse<DashboardData> = { code: 0, message: 'ok', data: mockData };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getDashboard();

      expect(client.get).toHaveBeenCalledWith('/admin/dashboard');
      expect(result.data.totalUsers).toBe(100);
    });

    it('getDashboardTrend 应使用 GET /admin/dashboard/trend 且透传 type/days', async () => {
      const mockRes: ApiResponse<{ date: string; count: number }[]> = { code: 0, message: 'ok', data: [] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await getDashboardTrend('registration', 30);

      expect(client.get).toHaveBeenCalledWith('/admin/dashboard/trend', {
        params: { type: 'registration', days: 30 },
      });
    });

    it('getDashboardReputation 应使用 GET /admin/dashboard/reputation', async () => {
      const mockRes: ApiResponse<{ label: string; count: number }[]> = { code: 0, message: 'ok', data: [] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await getDashboardReputation();

      expect(client.get).toHaveBeenCalledWith('/admin/dashboard/reputation');
    });

    it('getDashboardModules 应使用 GET /admin/dashboard/modules', async () => {
      const mockRes: ApiResponse<{ name: string; posts: number; orders: number }[]> = { code: 0, message: 'ok', data: [] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await getDashboardModules();

      expect(client.get).toHaveBeenCalledWith('/admin/dashboard/modules');
    });

    it('getDashboardSystem 应使用 GET /admin/dashboard/system', async () => {
      const mockRes: ApiResponse<{ pendingReports: number; todayActiveUsers: number; totalMutualAids: number; monthNewUsers: number }> = {
        code: 0, message: 'ok', data: { pendingReports: 0, todayActiveUsers: 0, totalMutualAids: 0, monthNewUsers: 0 },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await getDashboardSystem();

      expect(client.get).toHaveBeenCalledWith('/admin/dashboard/system');
    });
  });

  // ==================== Users 用户管理 ====================
  describe('Users 用户管理', () => {
    it('getUsers 应使用 GET /admin/users 且透传 page/pageSize/search', async () => {
      const mockPage: ApiResponse<PaginatedResponse<AdminUser>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getUsers(1, 20, 'keyword');

      expect(client.get).toHaveBeenCalledWith('/admin/users', {
        params: { page: 1, pageSize: 20, search: 'keyword' },
      });
    });

    it('banUser 应使用 PUT /admin/users/:id/ban 且无 body', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: '已封禁', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await banUser('user-uuid-001');

      expect(client.put).toHaveBeenCalledWith('/admin/users/user-uuid-001/ban');
    });

    it('unbanUser 应使用 PUT /admin/users/:id/unban 且无 body', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: '已解封', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await unbanUser('user-uuid-001');

      expect(client.put).toHaveBeenCalledWith('/admin/users/user-uuid-001/unban');
    });

    it('updateUserRole 应使用 PUT /admin/users/:id/role 且透传 role', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: '已更新', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateUserRole('user-uuid-001', 'admin');

      expect(client.put).toHaveBeenCalledWith('/admin/users/user-uuid-001/role', { role: 'admin' });
    });

    it('batchBanUsers 应使用 POST /admin/users/batch-ban 且透传 userIds', async () => {
      // 设计原因：batchBanUsers 返回 BatchBanResult（含 successful/skipped/failed 三类明细），
      // 前端按明细生成汇总提示（如「成功 3 个，跳过管理员 1 个，失败 1 个」）
      const mockResult: BatchBanResult = {
        successfulIds: ['u1', 'u2'], skippedAdminIds: ['u3'], skippedSelfId: [], failedIds: ['u4'],
      };
      const mockRes: ApiResponse<BatchBanResult> = { code: 0, message: 'ok', data: mockResult };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await batchBanUsers(['u1', 'u2', 'u3', 'u4']);

      expect(client.post).toHaveBeenCalledWith('/admin/users/batch-ban', {
        userIds: ['u1', 'u2', 'u3', 'u4'],
      });
      expect(result.data.successfulIds).toHaveLength(2);
      expect(result.data.skippedAdminIds).toHaveLength(1);
    });

    it('batchUnbanUsers 应使用 POST /admin/users/batch-unban 且透传 userIds', async () => {
      const mockResult: BatchResult = { successfulIds: ['u1'], failedIds: [] };
      const mockRes: ApiResponse<BatchResult> = { code: 0, message: 'ok', data: mockResult };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await batchUnbanUsers(['u1']);

      expect(client.post).toHaveBeenCalledWith('/admin/users/batch-unban', { userIds: ['u1'] });
    });
  });

  // ==================== Content 内容管理 ====================
  describe('Content 内容管理', () => {
    it('getContent 应使用 GET /admin/content 且透传 type/status/page/pageSize', async () => {
      const mockPage: ApiResponse<PaginatedResponse<AdminContentItem>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getContent('skill', 'active', 1, 20);

      expect(client.get).toHaveBeenCalledWith('/admin/content', {
        params: { type: 'skill', status: 'active', page: 1, pageSize: 20 },
      });
    });

    it('updateContentStatus 应使用 PUT /admin/content/:type/:id/status 且透传 status', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: '已更新', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateContentStatus('skill', 'post-001', 'closed');

      expect(client.put).toHaveBeenCalledWith('/admin/content/skill/post-001/status', { status: 'closed' });
    });

    it('batchUpdateContentStatus 应使用 POST /admin/content/:type/batch-status 且透传 ids/status', async () => {
      const mockResult: BatchResult = { successfulIds: ['p1'], failedIds: ['p2'] };
      const mockRes: ApiResponse<BatchResult> = { code: 0, message: 'ok', data: mockResult };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await batchUpdateContentStatus('kitchen', ['p1', 'p2'], 'closed');

      expect(client.post).toHaveBeenCalledWith('/admin/content/kitchen/batch-status', {
        ids: ['p1', 'p2'], status: 'closed',
      });
    });

    it('getContentDetail 应使用 GET /admin/content/:type/:id', async () => {
      const mockDetail: ContentDetail = {
        id: 'post-001', title: '钢琴教学', status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z', creditPrice: 50,
      };
      const mockRes: ApiResponse<ContentDetail> = { code: 0, message: 'ok', data: mockDetail };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getContentDetail('skill', 'post-001');

      expect(client.get).toHaveBeenCalledWith('/admin/content/skill/post-001');
      expect(result.data.creditPrice).toBe(50);
    });

    it('updateContent 应使用 PUT /admin/content/:type/:id 且透传 body', async () => {
      const mockDetail: ContentDetail = {
        id: 'post-001', title: '钢琴教学（更新）', status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
      };
      const mockRes: ApiResponse<ContentDetail> = { code: 0, message: 'ok', data: mockDetail };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await updateContent('skill', 'post-001', { title: '钢琴教学（更新）' });

      expect(client.put).toHaveBeenCalledWith('/admin/content/skill/post-001', { title: '钢琴教学（更新）' });
    });
  });

  // ==================== Homepage Image 首页图片 ====================
  describe('Homepage Image 首页图片', () => {
    it('getHomepageImage 应使用 GET /admin/homepage-image 返回 url 或 null', async () => {
      // 设计原因：后端返回 { url: string | null }，null 表示未设置首页图片
      const mockRes: ApiResponse<{ url: string | null }> = {
        code: 0, message: 'ok', data: { url: '/uploads/homepage.png' },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getHomepageImage();

      expect(client.get).toHaveBeenCalledWith('/admin/homepage-image');
      expect(result.data.url).toBe('/uploads/homepage.png');
    });

    it('setHomepageImage 应使用 PUT /admin/homepage-image 且透传 url', async () => {
      const mockRes: ApiResponse<{ url: string; updatedBy: string }> = {
        code: 0, message: 'ok', data: { url: '/uploads/new.png', updatedBy: 'admin-001' },
      };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await setHomepageImage('/uploads/new.png');

      expect(client.put).toHaveBeenCalledWith('/admin/homepage-image', { url: '/uploads/new.png' });
    });
  });

  // ==================== Settings 系统配置 ====================
  describe('Settings 系统配置', () => {
    it('getSettings 应使用 GET /admin/settings 返回数组', async () => {
      const mockSetting: SystemSetting = {
        key: 'max_upload_size', value: '10485760', valueType: 'int',
        description: '上传文件大小上限（字节）', updatedBy: 'admin-001',
        updatedAt: '2026-07-28T10:00:00.000Z',
      };
      const mockRes: ApiResponse<SystemSetting[]> = { code: 0, message: 'ok', data: [mockSetting] };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getSettings();

      expect(client.get).toHaveBeenCalledWith('/admin/settings');
      expect(result.data[0]!.valueType).toBe('int');
    });

    it('getSettingDetail 应使用 GET /admin/settings/:key', async () => {
      const mockSetting: SystemSetting = {
        key: 'max_upload_size', value: '10485760', valueType: 'int',
        description: '上传文件大小上限', updatedBy: null, updatedAt: '2026-07-28T10:00:00.000Z',
      };
      const mockRes: ApiResponse<SystemSetting> = { code: 0, message: 'ok', data: mockSetting };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await getSettingDetail('max_upload_size');

      expect(client.get).toHaveBeenCalledWith('/admin/settings/max_upload_size');
    });

    it('setSetting 应使用 PUT /admin/settings/:key 且透传 value/description/valueType', async () => {
      // 设计原因：setSetting 是 upsert，description/valueType 省略时后端用 COALESCE 保留原值
      const mockSetting: SystemSetting = {
        key: 'max_upload_size', value: '20971520', valueType: 'int',
        description: '更新后上限', updatedBy: 'admin-001', updatedAt: '2026-07-28T11:00:00.000Z',
      };
      const mockRes: ApiResponse<SystemSetting> = { code: 0, message: 'ok', data: mockSetting };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await setSetting('max_upload_size', '20971520', '更新后上限', 'int');

      expect(client.put).toHaveBeenCalledWith('/admin/settings/max_upload_size', {
        value: '20971520', description: '更新后上限', valueType: 'int',
      });
    });

    it('deleteSetting 应使用 DELETE /admin/settings/:key', async () => {
      // 设计原因：受保护键后端会拒绝删除，返回错误码，前端按 code 显示提示
      const mockRes: ApiResponse<{ key: string }> = { code: 0, message: '已删除', data: { key: 'test_key' } };
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await deleteSetting('test_key');

      expect(client.delete).toHaveBeenCalledWith('/admin/settings/test_key');
      expect(result.data.key).toBe('test_key');
    });
  });

  // ==================== Audit Logs 审计日志 ====================
  describe('Audit Logs 审计日志', () => {
    it('getAuditLogs 应使用 GET /admin/audit-logs 且透传筛选 params', async () => {
      // 设计原因：getAuditLogs 支持按 userId/action/status/startDate/endDate/page/pageSize 筛选
      const mockPage: ApiResponse<PaginatedResponse<AuditLog>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      const params: AuditLogQuery = {
        userId: 'u1', action: 'login', status: 'success',
        startDate: '2026-07-01', endDate: '2026-07-28', page: 1, pageSize: 20,
      };
      await getAuditLogs(params);

      expect(client.get).toHaveBeenCalledWith('/admin/audit-logs', { params });
    });
  });

  // ==================== Orders 订单管理 ====================
  describe('Orders 订单管理', () => {
    it('getOrders 应使用 GET /admin/orders/:type 且透传 status/page/pageSize', async () => {
      const mockPage: ApiResponse<PaginatedResponse<AdminOrderItem>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getOrders('skill', 'pending', 1, 20);

      expect(client.get).toHaveBeenCalledWith('/admin/orders/skill', {
        params: { status: 'pending', page: 1, pageSize: 20 },
      });
    });

    it('forceCancelOrder 应使用 PUT /admin/orders/:type/:id/cancel 且透传 reason', async () => {
      // 设计原因：forceCancelOrder 是管理员强制取消订单，需附 reason 用于审计日志
      const mockRes: ApiResponse<null> = { code: 0, message: '已取消', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await forceCancelOrder('kitchen', 'order-001', '违反平台规则');

      expect(client.put).toHaveBeenCalledWith('/admin/orders/kitchen/order-001/cancel', {
        reason: '违反平台规则',
      });
    });
  });

  // ==================== Reports 举报管理 ====================
  describe('Reports 举报管理', () => {
    it('getReports 应使用 GET /admin/reports 且透传 page/pageSize/status', async () => {
      const mockPage: ApiResponse<PaginatedResponse<Report>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getReports(1, 20, 'pending');

      expect(client.get).toHaveBeenCalledWith('/admin/reports', {
        params: { page: 1, pageSize: 20, status: 'pending' },
      });
    });

    it('handleReport 应使用 PUT /admin/reports/:id 且透传 status/handleNote', async () => {
      // 设计原因：handleReport 是管理员处理举报，status 为 'approved'/'rejected'，
      // handleNote 是处理备注（必填，用于审计）
      const mockRes: ApiResponse<null> = { code: 0, message: '已处理', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await handleReport('report-001', 'approved', '举报属实');

      expect(client.put).toHaveBeenCalledWith('/admin/reports/report-001', {
        status: 'approved', handleNote: '举报属实',
      });
    });

    it('createReport 应使用 POST /reports 且透传 targetType/targetId/reason', async () => {
      // 设计原因：createReport 是用户举报内容，URL 是 /reports 而非 /admin/reports，
      // 因为举报接口对所有用户开放（非管理员专属）
      const mockRes: ApiResponse<null> = { code: 0, message: '已提交', data: null };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await createReport('post', 'post-001', '内容违规');

      expect(client.post).toHaveBeenCalledWith('/reports', {
        targetType: 'post', targetId: 'post-001', reason: '内容违规',
      });
    });
  });

  // ==================== Verifications 实名认证审核 ====================
  describe('Verifications 实名认证审核', () => {
    it('getVerificationRequests 应使用 GET /admin/verifications 且透传筛选', async () => {
      const mockPage: ApiResponse<PaginatedResponse<VerificationRequest>> = {
        code: 0, message: 'ok',
        data: { list: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false },
      };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockPage);

      await getVerificationRequests(1, 20, 'pending');

      expect(client.get).toHaveBeenCalledWith('/admin/verifications', {
        params: { page: 1, pageSize: 20, status: 'pending' },
      });
    });

    it('reviewVerification approve 应使用 PUT /admin/verifications/:id 且透传 action', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: '已通过', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await reviewVerification('ver-001', 'approve');

      expect(client.put).toHaveBeenCalledWith('/admin/verifications/ver-001', {
        action: 'approve', rejectReason: undefined,
      });
    });

    it('reviewVerification reject 应透传 rejectReason', async () => {
      // 设计原因：reject 操作需附 rejectReason，用于申请人查看拒绝原因
      const mockRes: ApiResponse<null> = { code: 0, message: '已拒绝', data: null };
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await reviewVerification('ver-001', 'reject', '证件不清晰');

      expect(client.put).toHaveBeenCalledWith('/admin/verifications/ver-001', {
        action: 'reject', rejectReason: '证件不清晰',
      });
    });
  });

  // ==================== System Metrics 系统指标 ====================
  describe('System Metrics 系统指标', () => {
    it('getSystemMetrics 应使用 GET /health/metrics 返回系统健康状态', async () => {
      const mockData: MetricsResponse = {
        metrics: {
          database: { status: 'healthy', poolSize: 10, idleConnections: 5, waitingCount: 0 },
          redis: { status: 'healthy', connected: true, memoryUsage: '2.5M' },
          server: {
            uptime: 3600,
            memoryUsage: { heapUsed: 50, heapTotal: 100, rss: 80 },
            requestQueueLength: 0,
          },
        },
        alerts: [],
      };
      const mockRes: ApiResponse<MetricsResponse> = { code: 0, message: 'ok', data: mockData };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getSystemMetrics();

      expect(client.get).toHaveBeenCalledWith('/health/metrics');
      expect(result.data.metrics.database.status).toBe('healthy');
    });

    it('clearAlertLogs 应使用 DELETE /health/metrics/alerts', async () => {
      const mockRes: ApiResponse<null> = { code: 0, message: '已清除', data: null };
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await clearAlertLogs();

      expect(client.delete).toHaveBeenCalledWith('/health/metrics/alerts');
    });
  });

  // ==================== Metrics Dashboard 效果度量 ====================
  describe('Metrics Dashboard 效果度量', () => {
    it('getMetricsDashboard 应使用 GET /metrics/dashboard', async () => {
      const mockData: DashboardMetric[] = [{
        name: 'request_count', value: 1000,
        tags: { endpoint: '/api/users' }, recordedAt: '2026-07-28T10:00:00.000Z',
      }];
      const mockRes: ApiResponse<DashboardMetric[]> = { code: 0, message: 'ok', data: mockData };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getMetricsDashboard();

      expect(client.get).toHaveBeenCalledWith('/metrics/dashboard');
      expect(result.data[0]!.value).toBe(1000);
    });

    it('getMetricSummary 应使用 GET /metrics/:name/summary 且透传 startDate/endDate', async () => {
      const mockData: MetricSummary = { name: 'request_count', avg: 100, min: 50, max: 200, count: 30 };
      const mockRes: ApiResponse<MetricSummary> = { code: 0, message: 'ok', data: mockData };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      await getMetricSummary('request_count', '2026-07-01', '2026-07-28');

      expect(client.get).toHaveBeenCalledWith('/metrics/request_count/summary', {
        params: { startDate: '2026-07-01', endDate: '2026-07-28' },
      });
    });

    it('getMetricTrend 应使用 GET /metrics/:name/trend 且透传 granularity', async () => {
      const mockData: MetricTrendItem[] = [
        { date: '2026-07-01', value: 100 },
        { date: '2026-07-02', value: 110 },
      ];
      const mockRes: ApiResponse<MetricTrendItem[]> = { code: 0, message: 'ok', data: mockData };
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockRes);

      const result = await getMetricTrend('request_count', '2026-07-01', '2026-07-28', 'week');

      expect(client.get).toHaveBeenCalledWith('/metrics/request_count/trend', {
        params: { startDate: '2026-07-01', endDate: '2026-07-28', granularity: 'week' },
      });
      expect(result.data).toHaveLength(2);
    });
  });

  // ==================== Export 数据导出 ====================
  describe('Export 数据导出', () => {
    it('应使用 GET /admin/export/:type 且 responseType=blob 触发下载', async () => {
      // 设计原因：exportData 用 responseType: 'blob' 接收二进制流，
      // 通过 URL.createObjectURL + <a download> 触发浏览器下载
      const mockBlob = new Blob(['mock,csv,content'], { type: 'text/csv' });
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockBlob);

      await exportData('users', {}, 'csv');

      // 验证 GET 请求参数
      expect(client.get).toHaveBeenCalledWith('/admin/export/users', {
        params: { format: 'csv' },
        responseType: 'blob',
      });
      // 验证触发下载链路
      expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(mockRevokeObjectURL).toHaveBeenCalledTimes(1);
    });

    it('应透传 orderType/status/startDate/endDate params', async () => {
      const mockBlob = new Blob(['mock'], { type: 'text/csv' });
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockBlob);

      const params: ExportParams = {
        orderType: 'kitchen', status: 'completed',
        startDate: '2026-07-01', endDate: '2026-07-28',
      };
      await exportData('orders', params, 'xlsx');

      const [url, config] = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(url).toBe('/admin/export/orders');
      expect(config.params).toEqual({
        orderType: 'kitchen', status: 'completed',
        startDate: '2026-07-01', endDate: '2026-07-28', format: 'xlsx',
      });
    });

    it('默认 format 应为 csv', async () => {
      const mockBlob = new Blob(['mock'], { type: 'text/csv' });
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockBlob);

      await exportData('reports');

      const config = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![1];
      expect(config.params.format).toBe('csv');
    });
  });

  describe('函数间 mock 隔离', () => {
    it('连续调用不应相互污染（验证 clearAllMocks 生效）', async () => {
      // 设计原因：验证 clearAllMocks 生效，连续调用 4 种方法各 1 次，不累积
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });
      (client.put as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ code: 0, message: 'ok', data: null });

      await getDashboard();
      await batchBanUsers([]);
      await banUser('u1');
      await deleteSetting('k1');

      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.put).toHaveBeenCalledTimes(1);
      expect(client.delete).toHaveBeenCalledTimes(1);
    });
  });
});
