/**
 * time-bank.service updateService 单元测试
 *
 * 测试目标：
 * - images 校验：非法域名/路径遍历抛 BadRequestError，不触发 UPDATE
 * - images 合法：/uploads/ 相对路径、空数组正常更新
 * - 权限校验：非服务发布者抛 PermissionDeniedError
 * - 状态校验：completed/closed 状态抛 OrderStatusInvalidError
 * - 服务不存在抛 NotFoundError
 *
 * 测试策略：mock database 的 query，按调用顺序（SELECT → UPDATE）返回不同结果，
 *           验证 updateService 的校验与入库行为。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryResultRow } from 'pg';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

vi.mock('../reputation.service', () => ({
  reputationService: {
    updateReputationScore: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../cache.service', () => ({
  timeServiceCache: {
    get: vi.fn(),
    invalidate: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../notification.service', () => ({
  notificationService: {
    notifyTimeBankTransaction: vi.fn().mockResolvedValue(undefined),
    notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
    createNotification: vi.fn().mockResolvedValue(undefined),
    notifyFamilyBindingChange: vi.fn().mockResolvedValue(undefined),
  },
}));

import { timeBankService } from '../time-bank.service';
import { BadRequestError, NotFoundError, PermissionDeniedError, OrderStatusInvalidError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
});

// time_services 表行类型：与 time-bank.service.ts 中 TimeServiceRow 对齐，
// 继承 QueryResultRow 以兼容 pg 查询返回类型
interface TimeServiceRow extends QueryResultRow {
  id: string;
  user_id: string;
  type: string;
  category: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  location: string | null;
  address: string | null;
  certification: unknown;
  images: string[];
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * 构造 mock query 实现：
 * - 第一次调用（SELECT * FROM time_services）→ 返回 service 行
 * - 后续调用（UPDATE）→ 返回更新后的行
 */
function setupMockQuery(serviceRow: TimeServiceRow, updatedRow?: TimeServiceRow) {
  mockQuery.mockImplementationOnce(async () => ({ rows: [serviceRow] }));
  if (updatedRow) {
    mockQuery.mockImplementationOnce(async () => ({ rows: [updatedRow] }));
  }
}

describe('time-bank.service updateService images 校验', () => {
  const baseService = {
    id: 'svc-1',
    user_id: 'user-1',
    type: 'provide',
    category: '家政服务',
    title: '保洁服务',
    description: '专业保洁',
    duration_minutes: 60,
    location: null,
    address: null,
    certification: null,
    images: [],
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };

  it('images 含非白名单域名时抛 BadRequestError，不触发 UPDATE', async () => {
    setupMockQuery(baseService);

    await expect(
      timeBankService.updateService('svc-1', 'user-1', { images: ['https://evil.com/img.png'] }),
    ).rejects.toThrow(BadRequestError);

    // 仅 SELECT 被调用，UPDATE 不应触发
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('images 含路径遍历时抛 BadRequestError，不触发 UPDATE', async () => {
    setupMockQuery(baseService);

    await expect(
      timeBankService.updateService('svc-1', 'user-1', { images: ['/uploads/../etc/passwd'] }),
    ).rejects.toThrow(BadRequestError);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('images 含 /uploads/ 合法路径时正常更新', async () => {
    setupMockQuery(baseService, { ...baseService, images: ['/uploads/photo.jpg'] });

    const result = await timeBankService.updateService('svc-1', 'user-1', {
      images: ['/uploads/photo.jpg'],
    });

    // SELECT + UPDATE 两次调用
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result.images).toEqual(['/uploads/photo.jpg']);
    // 验证 UPDATE 参数包含 images 数组
    const updateCallArgs = mockQuery.mock.calls[1];
    expect(updateCallArgs[1]).toContainEqual(['/uploads/photo.jpg']);
  });

  it('images 为空数组时正常更新（清空配图）', async () => {
    setupMockQuery({ ...baseService, images: ['/uploads/old.jpg'] }, { ...baseService, images: [] });

    await timeBankService.updateService('svc-1', 'user-1', { images: [] });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const updateCallArgs = mockQuery.mock.calls[1];
    expect(updateCallArgs[1]).toContainEqual([]);
  });

  it('不传 images 时跳过校验，仅更新其他字段', async () => {
    setupMockQuery(baseService, { ...baseService, title: '新标题' });

    await timeBankService.updateService('svc-1', 'user-1', { title: '新标题' });

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('服务不存在时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(
      timeBankService.updateService('svc-x', 'user-1', { title: '新标题' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('非服务发布者抛 PermissionDeniedError', async () => {
    setupMockQuery({ ...baseService, user_id: 'user-other' });

    await expect(
      timeBankService.updateService('svc-1', 'user-1', { title: '新标题' }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('completed 状态的服务抛 OrderStatusInvalidError', async () => {
    setupMockQuery({ ...baseService, status: 'completed' });

    await expect(
      timeBankService.updateService('svc-1', 'user-1', { title: '新标题' }),
    ).rejects.toThrow(OrderStatusInvalidError);
  });
});

// XSS 不变式：updateService 入口必须清洗 address 字段
// 设计原因：address 落库后跨用户可见，与 createService 入口清洗行为对齐避免遗漏
describe('time-bank.service updateService address XSS 清洗', () => {
  const baseService = {
    id: 'svc-1',
    user_id: 'user-1',
    type: 'provide',
    category: '家政服务',
    title: '保洁服务',
    description: '专业保洁',
    duration_minutes: 60,
    location: null,
    address: null,
    certification: null,
    images: [],
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };

  it('address 含 XSS 片段时被清洗后入库，原样脚本标签不进入 SQL 参数', async () => {
    setupMockQuery(baseService, { ...baseService, address: '北京市朝阳区' });

    await timeBankService.updateService('svc-1', 'user-1', {
      address: '<script>alert(1)</script>北京市朝阳区',
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const updateCallArgs = mockQuery.mock.calls[1];
    // UPDATE 参数中应能找到含"北京市朝阳区"的字符串，但不包含 <script> 标签
    const addressArg = updateCallArgs[1].find((v: unknown) => typeof v === 'string' && v.includes('北京市朝阳区'));
    expect(addressArg).not.toContain('<script>');
  });
});
