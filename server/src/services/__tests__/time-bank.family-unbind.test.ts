/**
 * time-bank.service unbindFamilyBinding 单元测试
 *
 * 测试目标：
 * - 校验失败场景（绑定不存在 / 非双方当事人 / 非 confirmed 状态）
 * - 成功场景：状态更新为 unbound、通知另一方
 * - 权限场景：发起方(user_id)与家长(parent_id)均可解绑
 *
 * 测试策略：mock database 模块的 query 函数，按 SQL 文本匹配返回相应数据，
 *           验证调用参数与通知触发正确性。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 的 query 函数（unbindFamilyBinding 不使用 transaction，仅用 query）
// 用 vi.hoisted 提升变量，避免 vi.mock 工厂函数引用未初始化变量导致 TDZ
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));
vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

// mock reputation.service，避免间接依赖被触发
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
    notifyFamilyBindingChange: vi.fn().mockResolvedValue(undefined),
    notifyTimeBankTransaction: vi.fn().mockResolvedValue(undefined),
    notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
    createNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

import { timeBankService } from '../time-bank.service';
import { notificationService } from '../notification.service';
import { NotFoundError, PermissionDeniedError, OrderStatusInvalidError } from '../../utils/errors';

const mockedNotifyFamilyBindingChange = vi.mocked(notificationService.notifyFamilyBindingChange);

beforeEach(() => {
  mockQuery.mockReset();
  mockedNotifyFamilyBindingChange.mockReset();
  mockedNotifyFamilyBindingChange.mockResolvedValue({} as any);
});

/**
 * 构造绑定记录 mock 数据：第一次 query（SELECT）返回绑定记录，
 * 最后一次 query（SELECT 更新后）返回更新后的记录，中间的 UPDATE 返回空 rows。
 */
function setupBindingMock(binding: {
  id: string;
  user_id: string;
  parent_id: string;
  status: string;
  exists?: boolean;
}) {
  const record = {
    id: binding.id,
    user_id: binding.user_id,
    parent_id: binding.parent_id,
    relationship: 'father',
    status: binding.status,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const exists = binding.exists !== false;
  // 用 selectCount 区分首次查询（返回原记录）与更新后查询（返回 unbound 记录）
  let selectCount = 0;

  mockQuery.mockImplementation(async (text: string) => {
    if (text.includes('SELECT * FROM family_bindings WHERE id = $1')) {
      selectCount++;
      // 首次查询返回原记录（含存在性判断）；更新后第二次查询返回 unbound 记录
      if (selectCount === 1) {
        return { rows: exists ? [record] : [] };
      }
      return { rows: [{ ...record, status: 'unbound' }] };
    }
    // UPDATE 语句：返回空 rows
    if (text.includes('UPDATE family_bindings')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe('timeBankService.unbindFamilyBinding', () => {
  it('绑定不存在时抛出 NotFoundError', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'confirmed', exists: false });

    await expect(timeBankService.unbindFamilyBinding('b1', 'u1')).rejects.toThrow(NotFoundError);
    expect(mockedNotifyFamilyBindingChange).not.toHaveBeenCalled();
  });

  it('非绑定当事人抛出 PermissionDeniedError', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'confirmed' });

    // u3 既不是 user_id 也不是 parent_id
    await expect(timeBankService.unbindFamilyBinding('b1', 'u3')).rejects.toThrow(PermissionDeniedError);
    expect(mockedNotifyFamilyBindingChange).not.toHaveBeenCalled();
  });

  it('pending 状态抛出 OrderStatusInvalidError', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'pending' });

    await expect(timeBankService.unbindFamilyBinding('b1', 'u1')).rejects.toThrow(OrderStatusInvalidError);
    expect(mockedNotifyFamilyBindingChange).not.toHaveBeenCalled();
  });

  it('rejected 状态抛出 OrderStatusInvalidError', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'rejected' });

    await expect(timeBankService.unbindFamilyBinding('b1', 'u1')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('unbound 状态抛出 OrderStatusInvalidError（避免重复解绑）', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'unbound' });

    await expect(timeBankService.unbindFamilyBinding('b1', 'u1')).rejects.toThrow(OrderStatusInvalidError);
  });

  it('发起方（user_id）解绑成功：状态更新为 unbound 并通知家长', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'confirmed' });

    const result = await timeBankService.unbindFamilyBinding('b1', 'u1');

    expect(result.status).toBe('unbound');
    // 验证 UPDATE 语句被调用
    const updateCall = mockQuery.mock.calls.find(c => String(c[0]).includes('UPDATE family_bindings SET status'));
    expect(updateCall).toBeDefined();
    // 通知应发送给另一方（家长 u2）
    expect(mockedNotifyFamilyBindingChange).toHaveBeenCalledWith('u2', 'b1', 'unbound');
  });

  it('家长（parent_id）解绑成功：状态更新为 unbound 并通知发起方', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'confirmed' });

    const result = await timeBankService.unbindFamilyBinding('b1', 'u2');

    expect(result.status).toBe('unbound');
    // 通知应发送给另一方（发起方 u1）
    expect(mockedNotifyFamilyBindingChange).toHaveBeenCalledWith('u1', 'b1', 'unbound');
  });

  it('通知失败不阻塞解绑主流程', async () => {
    setupBindingMock({ id: 'b1', user_id: 'u1', parent_id: 'u2', status: 'confirmed' });
    // 通知抛错，但 unbindFamilyBinding 内部 catch 了，不应传播
    mockedNotifyFamilyBindingChange.mockRejectedValue(new Error('通知发送失败'));

    const result = await timeBankService.unbindFamilyBinding('b1', 'u1');

    expect(result.status).toBe('unbound');
  });
});
