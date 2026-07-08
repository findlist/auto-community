/**
 * notification.service 单元测试
 *
 * 测试目标：
 * - createNotification：INSERT 参数透传、sendToUser 实时推送、dispatchExternalChannels 异步分发（catch 吞错）
 * - toNotification：read_at/content null→undefined 转换、read_at Date→ISO 转换
 * - getNotifications：Promise.all 并行查询、分页映射、totalPages 计算、offset 透传
 * - getUnreadCount：count string→number 转换
 * - markAsRead / markAllAsRead：rowCount 返回与 null 降级
 * - notifyOrderStatusChange：已知状态映射标题、未知状态默认标题、extraContent 透传
 * - notifyEmergencyResponse / notifyReportResult：通知标题与内容
 * - notifyFamilyBindingChange：4 种 action 标题/内容映射、otherNickname 默认值
 * - notifyTimeBankTransaction：transfer/donate 类型映射、fromNickname 默认值
 *
 * 测试策略：mock database query、websocket sendToUser、notification-channels dispatchExternalChannels，
 *           验证 service 层的 INSERT 参数、实时推送、异步分发、分页映射、标题映射逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock 3 个依赖模块：database（query）、websocket（sendToUser）、notification-channels（dispatchExternalChannels）
const { mockQuery, mockSendToUser, mockDispatchExternal } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSendToUser: vi.fn(),
  mockDispatchExternal: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

// 路径说明：notification.service.ts 位于 src/services/，导入 ../websocket/index 解析为 src/websocket/index；
// 测试文件位于 src/services/__tests__/，需用 ../../websocket/index 才能解析到同一模块
vi.mock('../../websocket/index', () => ({
  sendToUser: mockSendToUser,
}));

vi.mock('../notification-channels', () => ({
  dispatchExternalChannels: mockDispatchExternal,
}));

import { notificationService } from '../notification.service';

beforeEach(() => {
  mockQuery.mockReset();
  mockSendToUser.mockReset();
  mockDispatchExternal.mockReset();
  // dispatchExternalChannels 默认 resolve，catch 吞错不触发副作用
  mockDispatchExternal.mockResolvedValue(undefined);
});

// 构造通知行（减少重复代码）：nullable 字段默认 null
function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'n-1',
    user_id: 'u1',
    type: 'order_status',
    title: '订单已创建',
    content: null,
    reference_id: null,
    reference_type: null,
    read_at: null,
    created_at: new Date('2026-07-08T10:00:00Z'),
    ...overrides,
  };
}

describe('notification.service createNotification', () => {
  it('正常创建，INSERT 参数透传（可选字段为空时写 null）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'order_status',
      title: '订单已创建',
    });

    expect(result.id).toBe('n-1');
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('INSERT INTO notifications');
    // 可选字段为空时写 null（content || null）
    expect(call[1]).toEqual(['u1', 'order_status', '订单已创建', null, null, null]);
  });

  it('sendToUser 被调用推送通知', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '系统通知',
    });

    expect(mockSendToUser).toHaveBeenCalledTimes(1);
    expect(mockSendToUser).toHaveBeenCalledWith('u1', expect.objectContaining({
      type: 'notification',
    }));
  });

  it('dispatchExternalChannels 被异步调用且 catch 吞错不影响主流程', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });
    // 模拟外部通道失败，catch 应吞错不影响 createNotification 返回
    mockDispatchExternal.mockRejectedValueOnce(new Error('通道故障'));

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '系统通知',
    });

    expect(result.id).toBe('n-1');
    expect(mockDispatchExternal).toHaveBeenCalledTimes(1);
  });

  it('read_at 为 null 时 readAt 为 undefined', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ read_at: null })] });

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '通知',
    });

    expect(result.readAt).toBeUndefined();
  });

  it('read_at 为 Date 时 readAt 转为 ISO string', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRow({ read_at: new Date('2026-07-08T11:00:00Z') })],
    });

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '通知',
    });

    expect(result.readAt).toBe('2026-07-08T11:00:00.000Z');
  });

  it('content 为 null 时 content 为 undefined', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ content: null })] });

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '通知',
    });

    expect(result.content).toBeUndefined();
  });
});

describe('notification.service getNotifications', () => {
  it('正常分页查询，返回映射后的 list 与分页信息', async () => {
    // Promise.all 顺序：[count, list]
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '1' }] });
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ content: '内容' })] });

    const result = await notificationService.getNotifications('u1', 1, 10);

    expect(result.list).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(1);
    expect(result.list[0].id).toBe('n-1');
  });

  it('空结果返回空 list 与 total=0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await notificationService.getNotifications('u1', 1, 10);

    expect(result.list).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('totalPages 向上取整（total=25, pageSize=10 → 3）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await notificationService.getNotifications('u1', 1, 10);

    expect(result.totalPages).toBe(3);
  });

  it('page=2, pageSize=10 时 offset=10 透传到 list 查询', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '15' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await notificationService.getNotifications('u1', 2, 10);

    // list 查询是第2次调用（Promise.all 顺序 [count, list]）
    const listCall = mockQuery.mock.calls[1];
    expect(listCall[1]).toEqual(['u1', 10, 10]);
  });
});

describe('notification.service getUnreadCount', () => {
  it('count string→number 转换', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });

    const result = await notificationService.getUnreadCount('u1');

    expect(result).toBe(5);
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('read_at IS NULL');
  });
});

describe('notification.service markAsRead', () => {
  it('rowCount > 0 返回 true', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await notificationService.markAsRead('u1', 'n-1');

    expect(result).toBe(true);
  });

  it('rowCount = 0 返回 false', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await notificationService.markAsRead('u1', 'n-1');

    expect(result).toBe(false);
  });

  it('rowCount 为 null 返回 false', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null });

    const result = await notificationService.markAsRead('u1', 'n-1');

    expect(result).toBe(false);
  });
});

describe('notification.service markAllAsRead', () => {
  it('返回 rowCount', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 5 });

    const result = await notificationService.markAllAsRead('u1');

    expect(result).toBe(5);
  });

  it('rowCount 为 null 返回 0', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null });

    const result = await notificationService.markAllAsRead('u1');

    expect(result).toBe(0);
  });
});

describe('notification.service notifyOrderStatusChange', () => {
  it('已知状态使用映射标题', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ title: '订单已完成' })] });

    await notificationService.notifyOrderStatusChange('u1', 'o1', 'skill_order', 'completed');

    const call = mockQuery.mock.calls[0];
    // INSERT 第3参数为标题
    expect(call[1][2]).toBe('订单已完成');
    // referenceType 透传
    expect(call[1][5]).toBe('skill_order');
  });

  it('未知状态使用默认标题', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyOrderStatusChange('u1', 'o1', 'skill_order', 'custom_status');

    const call = mockQuery.mock.calls[0];
    expect(call[1][2]).toBe('订单状态更新：custom_status');
  });

  it('extraContent 透传到 content', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyOrderStatusChange(
      'u1', 'o1', 'skill_order', 'completed', '订单已超额完成',
    );

    const call = mockQuery.mock.calls[0];
    // INSERT 第4参数为 content
    expect(call[1][3]).toBe('订单已超额完成');
  });

  it('无 extraContent 时使用默认 content', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyOrderStatusChange('u1', 'o1', 'skill_order', 'completed');

    const call = mockQuery.mock.calls[0];
    expect(call[1][3]).toContain('订单状态已变更为「completed」');
  });
});

describe('notification.service notifyEmergencyResponse', () => {
  it('正常创建求助响应通知', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ title: '您的求助已有人响应' })] });

    await notificationService.notifyEmergencyResponse('u1', 'req-1', '张三');

    const call = mockQuery.mock.calls[0];
    expect(call[1][2]).toBe('您的求助已有人响应');
    expect(call[1][3]).toContain('张三');
    expect(call[1][5]).toBe('emergency_request');
  });
});

describe('notification.service notifyFamilyBindingChange', () => {
  it('request action 标题与内容正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'b-1', 'request', '李四');

    const call = mockQuery.mock.calls[0];
    expect(call[1][2]).toBe('收到新的亲情绑定请求');
    expect(call[1][3]).toContain('李四');
  });

  it('confirmed action 标题正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'b-1', 'confirmed', '李四');

    expect(mockQuery.mock.calls[0][1][2]).toBe('亲情绑定已确认');
  });

  it('rejected action 标题正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'b-1', 'rejected');

    expect(mockQuery.mock.calls[0][1][2]).toBe('亲情绑定被拒绝');
  });

  it('unbound action 标题正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'b-1', 'unbound');

    expect(mockQuery.mock.calls[0][1][2]).toBe('亲情绑定已解除');
  });

  it('otherNickname 缺失时使用默认值"一位用户"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'b-1', 'request');

    const content = mockQuery.mock.calls[0][1][3] as string;
    expect(content).toContain('一位用户');
  });
});

describe('notification.service notifyTimeBankTransaction', () => {
  it('transfer 类型标题与内容正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyTimeBankTransaction('u1', 't-1', 'transfer', 100, '王五');

    const call = mockQuery.mock.calls[0];
    expect(call[1][2]).toBe('收到时间币转赠');
    expect(call[1][3]).toContain('王五');
    expect(call[1][3]).toContain('100');
  });

  it('donate 类型标题正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyTimeBankTransaction('u1', 't-1', 'donate', 50);

    expect(mockQuery.mock.calls[0][1][2]).toBe('收到时间币捐赠');
  });

  it('transactionId 为 undefined 时 referenceId 写 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyTimeBankTransaction('u1', undefined, 'donate', 50);

    // INSERT 第5参数为 referenceId
    expect(mockQuery.mock.calls[0][1][4]).toBeNull();
  });

  it('fromNickname 缺失时使用默认值"一位用户"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyTimeBankTransaction('u1', 't-1', 'transfer', 100);

    const content = mockQuery.mock.calls[0][1][3] as string;
    expect(content).toContain('一位用户');
  });
});
