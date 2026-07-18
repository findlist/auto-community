/**
 * time-bank.service createService 单元测试
 *
 * 测试目标：
 * - 校验失败场景：非法 type、图片 URL 非法（非白名单域名/HTTP 协议/路径遍历）
 * - 成功场景：无 images、images 为空数组、images 含 /uploads/ 相对路径、images 含 HTTPS 白名单域名
 * - 入库参数正确性：images 数组原样传入 INSERT，certification 为 null 时不报错
 *
 * 测试策略：mock database 模块的 query 函数，按 SQL 文本匹配返回 INSERT 结果，
 *           验证 createService 入库参数与校验抛错行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：createService 仅使用 query（无事务），mock query 即可
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

// mock reputation.service，避免 createService 间接依赖被触发
vi.mock('../reputation.service', () => ({
  reputationService: {
    updateReputationScore: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock cache.service，避免 env 依赖
vi.mock('../cache.service', () => ({
  timeServiceCache: {
    get: vi.fn(),
    invalidate: vi.fn(),
  },
}));

// mock notification.service，避免通知调用触发真实数据库查询与 WebSocket 推送
vi.mock('../notification.service', () => ({
  notificationService: {
    notifyTimeBankTransaction: vi.fn().mockResolvedValue(undefined),
    notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
    createNotification: vi.fn().mockResolvedValue(undefined),
    notifyFamilyBindingChange: vi.fn().mockResolvedValue(undefined),
  },
}));

import { timeBankService } from '../time-bank.service';
import { BadRequestError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('time-bank.service createService', () => {
  it('type 非 provide/request 时抛 BadRequestError', async () => {
    await expect(
      timeBankService.createService('user-1', {
        type: 'invalid',
        category: '家政服务',
        title: '测试服务',
        duration_minutes: 60,
      }),
    ).rejects.toThrow(BadRequestError);
    // 校验失败不应触发数据库写入
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('images 含非白名单域名时抛 BadRequestError', async () => {
    await expect(
      timeBankService.createService('user-1', {
        type: 'provide',
        category: '家政服务',
        title: '测试服务',
        duration_minutes: 60,
        images: ['https://evil.com/image.png'],
      }),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('images 含 HTTP（非 HTTPS）协议时抛 BadRequestError', async () => {
    await expect(
      timeBankService.createService('user-1', {
        type: 'provide',
        category: '家政服务',
        title: '测试服务',
        duration_minutes: 60,
        images: ['http://trae-api-cn.mchost.guru/image.png'],
      }),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('images 含路径遍历（..）时抛 BadRequestError', async () => {
    await expect(
      timeBankService.createService('user-1', {
        type: 'provide',
        category: '家政服务',
        title: '测试服务',
        duration_minutes: 60,
        images: ['/uploads/../etc/passwd'],
      }),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('无 images 时正常入库，INSERT 参数 images 为空数组', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'svc-1', created_at: new Date() }] });

    const result = await timeBankService.createService('user-1', {
      type: 'provide',
      category: '家政服务',
      title: '保洁服务',
      description: '专业保洁',
      duration_minutes: 60,
    });

    expect(result.id).toBe('svc-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    // 第 1 参数为 SQL，第 2 参数为参数数组；images 应为空数组（兜底）
    expect(callArgs[1]).toContainEqual([]);
  });

  it('images 为空数组时正常入库', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'svc-2', created_at: new Date() }] });

    await timeBankService.createService('user-1', {
      type: 'request',
      category: '教育培训',
      title: '英语辅导',
      duration_minutes: 90,
      images: [],
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('images 含 /uploads/ 相对路径时正常入库', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'svc-3', created_at: new Date() }] });

    await timeBankService.createService('user-1', {
      type: 'provide',
      category: '家政服务',
      title: '搬家服务',
      duration_minutes: 120,
      images: ['/uploads/2026/07/photo1.jpg', '/uploads/2026/07/photo2.jpg'],
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContainEqual(['/uploads/2026/07/photo1.jpg', '/uploads/2026/07/photo2.jpg']);
  });

  it('images 含 HTTPS 白名单域名时正常入库', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'svc-4', created_at: new Date() }] });

    await timeBankService.createService('user-1', {
      type: 'provide',
      category: '家政服务',
      title: '管道维修',
      duration_minutes: 45,
      images: ['https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=fix'],
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('title 含 XSS 片段时被清洗后入库，原样脚本标签不进入 SQL 参数', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'svc-5', created_at: new Date() }] });

    await timeBankService.createService('user-1', {
      type: 'provide',
      category: '家政服务',
      title: '<script>alert(1)</script>保洁',
      duration_minutes: 60,
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    // 清洗后的 title 不应包含 <script> 标签
    const titleArg = callArgs[1].find((v: unknown) => typeof v === 'string' && v.includes('保洁'));
    expect(titleArg).not.toContain('<script>');
  });

  // XSS 不变式：address 字段必须被 sanitizeObject 包含在清洗字段列表
  // 设计原因：address 落库后写入 time_services.address，跨用户在详情/列表渲染，
  // 未清洗会触发存储型 XSS。此测试锁定清洗行为，避免后续重构不慎移除 address
  it('address 含 XSS 片段时被清洗后入库，原样脚本标签不进入 SQL 参数', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'svc-6', created_at: new Date() }] });

    await timeBankService.createService('user-1', {
      type: 'provide',
      category: '家政服务',
      title: '保洁服务',
      duration_minutes: 60,
      address: '<script>alert(1)</script>北京市朝阳区',
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    // 清洗后的 address 不应包含 <script> 标签，但保留正常地址字符
    const addressArg = callArgs[1].find((v: unknown) => typeof v === 'string' && v.includes('北京市朝阳区'));
    expect(addressArg).not.toContain('<script>');
  });
});
