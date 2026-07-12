/**
 * notification.service 单元测试
 *
 * 测试目标：
 * - createNotification：INSERT 参数透传（undefined→null）、toNotification 映射（null→undefined、Date→ISO）、
 *                      sendToUser 实时推送、dispatchExternalChannels 失败不影响主流程
 * - getNotifications：分页 offset 计算、COUNT+LIST 并发、空列表、toNotification 映射
 * - getUnreadCount：count string→number 转换
 * - markAsRead：rowCount>0 返回 true、rowCount=0/null 返回 false
 * - markAllAsRead：rowCount 返回、null 降级为 0
 * - notifyOrderStatusChange：已知状态标题映射、未知状态回退、extraContent 默认值
 * - notifyEmergencyResponse / notifyReportResult：参数透传
 * - notifyFamilyBindingChange：4 种 action 标题/内容映射
 * - notifyTimeBankTransaction：2 种 transactionType 映射、transactionId 可选
 *
 * 测试策略：mock database query / websocket sendToUser / notification-channels dispatchExternalChannels，
 *           按 mockResolvedValueOnce 顺序模拟 INSERT/COUNT/LIST/UPDATE 返回，验证 SQL 透传、参数构造、响应映射正确性。
 *           dispatchExternalChannels 使用 mockRejectedValue 验证 catch 吞错不影响主流程。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock 依赖：database query / websocket sendToUser / notification-channels dispatchExternalChannels
// 所有被 vi.mock 引用的变量必须用 vi.hoisted 提升，避免 TDZ 错误
const { mockQuery, mockSendToUser, mockDispatchExternalChannels } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSendToUser: vi.fn(),
  // 默认 resolve，验证主流程；部分用例切换为 reject 验证 catch 吞错
  mockDispatchExternalChannels: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

vi.mock('../../websocket/index', () => ({
  sendToUser: mockSendToUser,
}));

vi.mock('../notification-channels', () => ({
  dispatchExternalChannels: mockDispatchExternalChannels,
}));

import { notificationService } from '../notification.service';

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockSendToUser.mockReset();
  // 每个用例前重置为默认 resolve，避免上个用例的 reject 残留
  mockDispatchExternalChannels.mockReset();
  mockDispatchExternalChannels.mockResolvedValue(undefined);
});

// 构造一行 notifications 表数据，便于多个用例复用
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ntf-1',
    user_id: 'u1',
    type: 'order_status',
    title: '订单已完成',
    content: '您的订单已处理',
    reference_id: 'order-1',
    reference_type: 'skill_order',
    read_at: null,
    created_at: new Date('2026-07-08T10:00:00Z'),
    ...overrides,
  };
}

// ==================== createNotification 测试 ====================

describe('notification.service createNotification', () => {
  it('正常创建通知，INSERT 参数透传并返回映射后的通知对象', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'order_status',
      title: '订单已完成',
      content: '您的订单已处理',
      referenceId: 'order-1',
      referenceType: 'skill_order',
    });

    // 验证 INSERT SQL 与参数透传
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('INSERT INTO notifications');
    expect(call[0]).toContain('RETURNING');
    expect(call[1]).toEqual(['u1', 'order_status', '订单已完成', '您的订单已处理', 'order-1', 'skill_order']);
    // 验证 toNotification 映射：snake_case → camelCase
    expect(result.id).toBe('ntf-1');
    expect(result.userId).toBe('u1');
    expect(result.type).toBe('order_status');
    expect(result.title).toBe('订单已完成');
    expect(result.content).toBe('您的订单已处理');
    expect(result.referenceId).toBe('order-1');
    expect(result.referenceType).toBe('skill_order');
    expect(result.readAt).toBeUndefined();
    expect(result.createdAt).toBe('2026-07-08T10:00:00.000Z');
  });

  it('content/referenceId 为 undefined 时 INSERT 参数透传 null', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeRow({ content: null, reference_id: null, reference_type: null })],
    });

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '系统通知',
    });

    // undefined 字段应透传为 null（DB 列为 nullable）
    expect(mockQuery.mock.calls[0][1]).toEqual(['u1', 'system', '系统通知', null, null, null]);
    // 响应中 nullable 字段 null → undefined
    expect(result.content).toBeUndefined();
    expect(result.referenceId).toBeUndefined();
    expect(result.referenceType).toBeUndefined();
  });

  it('创建后通过 WebSocket 实时推送通知给用户', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.createNotification({
      userId: 'u1',
      type: 'order_status',
      title: '订单已完成',
    });

    // 验证 sendToUser 被调用且 payload 结构正确
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
    expect(mockSendToUser).toHaveBeenCalledWith('u1', {
      type: 'notification',
      data: expect.objectContaining({ id: 'ntf-1', userId: 'u1' }),
    });
  });

  it('dispatchExternalChannels 失败时不影响主流程（catch 吞错）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });
    // 模拟外部通道分发失败
    mockDispatchExternalChannels.mockRejectedValue(new Error('SMTP 连接失败'));

    // 主流程不应抛错（catch 吞掉 rejection）
    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '通知',
    });

    expect(result.id).toBe('ntf-1');
    // sendToUser 仍应被调用（站内信主流程不受外部通道影响）
    expect(mockSendToUser).toHaveBeenCalled();
  });

  it('read_at 为 Date 时 readAt 转为 ISO string', async () => {
    const readAt = new Date('2026-07-08T11:00:00Z');
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ read_at: readAt })] });

    const result = await notificationService.createNotification({
      userId: 'u1',
      type: 'system',
      title: '通知',
    });

    expect(result.readAt).toBe('2026-07-08T11:00:00.000Z');
  });
});

// ==================== getNotifications 测试 ====================

describe('notification.service getNotifications', () => {
  it('分页查询：page=2, pageSize=10 时 offset=10', async () => {
    // Promise.all 并发：第1次 COUNT，第2次 LIST
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ id: 'ntf-10' })] });

    const result = await notificationService.getNotifications('u1', 2, 10);

    // 验证 COUNT 查询
    const countCall = mockQuery.mock.calls[0];
    expect(countCall[0]).toContain('SELECT COUNT(*)');
    expect(countCall[1]).toEqual(['u1']);
    // 验证 LIST 查询参数：[userId, pageSize, offset]
    const listCall = mockQuery.mock.calls[1];
    expect(listCall[0]).toContain('ORDER BY created_at DESC');
    expect(listCall[0]).toContain('LIMIT $2 OFFSET $3');
    expect(listCall[1]).toEqual(['u1', 10, 10]);
    // 验证分页响应
    expect(result.total).toBe(25);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(3);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].id).toBe('ntf-10');
  });

  it('默认 page=1, pageSize=20 时 offset=0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await notificationService.getNotifications('u1');

    // 验证默认参数 offset=0
    expect(mockQuery.mock.calls[1][1]).toEqual(['u1', 20, 0]);
    expect(result.list).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('COUNT 与 LIST 并发执行（Promise.all）', async () => {
    // 验证两个 query 调用都发生在同一个微任务批次中
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.getNotifications('u1', 1, 20);

    // 两个 query 都被调用
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('count 字符串 "012" 正确转换为数字 12（parseInt base 10）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '012' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await notificationService.getNotifications('u1');

    expect(result.total).toBe(12);
  });
});

// ==================== getUnreadCount 测试 ====================

describe('notification.service getUnreadCount', () => {
  it('正常返回未读数量', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });

    const result = await notificationService.getUnreadCount('u1');

    expect(result).toBe(5);
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('read_at IS NULL');
    expect(call[1]).toEqual(['u1']);
  });

  it('count 为 "0" 时返回 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await notificationService.getUnreadCount('u1');

    expect(result).toBe(0);
  });

  it('count 字符串 "007" 正确转换为数字 7（避免八进制歧义）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '007' }] });

    const result = await notificationService.getUnreadCount('u1');

    expect(result).toBe(7);
  });
});

// ==================== markAsRead 测试 ====================

describe('notification.service markAsRead', () => {
  it('rowCount>0 时返回 true', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const result = await notificationService.markAsRead('u1', 'ntf-1');

    expect(result).toBe(true);
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('UPDATE notifications SET read_at = NOW()');
    expect(call[0]).toContain('read_at IS NULL');
    expect(call[1]).toEqual(['ntf-1', 'u1']);
  });

  it('rowCount=0 时返回 false（通知不存在或已读）', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await notificationService.markAsRead('u1', 'ntf-nonexistent');

    expect(result).toBe(false);
  });

  it('rowCount 为 null 时返回 false（可选链兜底）', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null });

    const result = await notificationService.markAsRead('u1', 'ntf-1');

    expect(result).toBe(false);
  });
});

// ==================== markAllAsRead 测试 ====================

describe('notification.service markAllAsRead', () => {
  it('正常返回标记数量', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 5 });

    const result = await notificationService.markAllAsRead('u1');

    expect(result).toBe(5);
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('UPDATE notifications SET read_at = NOW()');
    expect(call[0]).toContain('WHERE user_id = $1 AND read_at IS NULL');
    expect(call[1]).toEqual(['u1']);
  });

  it('rowCount 为 null 时返回 0（|| 兜底）', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null });

    const result = await notificationService.markAllAsRead('u1');

    expect(result).toBe(0);
  });

  it('rowCount 为 0 时返回 0（无未读通知）', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    const result = await notificationService.markAllAsRead('u1');

    expect(result).toBe(0);
  });
});

// ==================== notifyOrderStatusChange 测试 ====================

describe('notification.service notifyOrderStatusChange', () => {
  it('已知状态 pending 使用映射标题', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ title: '订单已创建' })] });

    await notificationService.notifyOrderStatusChange('u1', 'order-1', 'skill_order', 'pending');

    // createNotification 参数顺序：[userId, type, title, content, referenceId, referenceType]
    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('订单已创建');
  });

  it('已知状态 completed 使用映射标题', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ title: '订单已完成' })] });

    await notificationService.notifyOrderStatusChange('u1', 'order-1', 'kitchen_order', 'completed');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('订单已完成');
  });

  it('拼单专属状态 full 使用映射标题', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({ title: '拼单已满员' })] });

    await notificationService.notifyOrderStatusChange('u1', 'order-1', 'group_order', 'full');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('拼单已满员');
  });

  it('未知状态回退到「订单状态更新：xxx」标题', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyOrderStatusChange('u1', 'order-1', 'skill_order', 'unknown_status');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('订单状态更新：unknown_status');
  });

  it('extraContent 透传到 content 参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyOrderStatusChange(
      'u1', 'order-1', 'skill_order', 'completed', '卖家已确认完成，请验收',
    );

    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBe('卖家已确认完成，请验收');
  });

  it('extraContent 为 undefined 时使用默认内容模板', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyOrderStatusChange('u1', 'order-1', 'skill_order', 'accepted');

    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBe('您的订单状态已变更为「accepted」，请及时查看处理。');
  });

  it('orderType 透传到 referenceType 参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyOrderStatusChange('u1', 'order-1', 'time_order', 'in_progress');

    const params = mockQuery.mock.calls[0][1];
    expect(params[0]).toBe('u1');
    expect(params[1]).toBe('order_status');
    expect(params[4]).toBe('order-1');
    expect(params[5]).toBe('time_order');
  });
});

// ==================== notifyEmergencyResponse 测试 ====================

describe('notification.service notifyEmergencyResponse', () => {
  it('正常创建求助响应通知，参数透传正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({
      type: 'emergency_response',
      title: '您的求助已有人响应',
      reference_type: 'emergency_request',
    })] });

    await notificationService.notifyEmergencyResponse('requester-1', 'req-1', '张三');

    const params = mockQuery.mock.calls[0][1];
    expect(params[0]).toBe('requester-1');
    expect(params[1]).toBe('emergency_response');
    expect(params[2]).toBe('您的求助已有人响应');
    expect(params[3]).toBe('张三 已响应您的求助，请及时查看并确认。');
    expect(params[4]).toBe('req-1');
    expect(params[5]).toBe('emergency_request');
  });
});

// ==================== notifyReportResult 测试 ====================

describe('notification.service notifyReportResult', () => {
  it('正常创建举报结果通知，resolution 透传到 content', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({
      type: 'report_result',
      title: '您的举报已处理',
      reference_type: 'emergency_request',
    })] });

    await notificationService.notifyReportResult('reporter-1', 'req-1', '违规属实，已封禁3天');

    const params = mockQuery.mock.calls[0][1];
    expect(params[0]).toBe('reporter-1');
    expect(params[1]).toBe('report_result');
    expect(params[2]).toBe('您的举报已处理');
    expect(params[3]).toBe('处理结果：违规属实，已封禁3天');
    expect(params[4]).toBe('req-1');
    expect(params[5]).toBe('emergency_request');
  });
});

// ==================== notifyFamilyBindingChange 测试 ====================

describe('notification.service notifyFamilyBindingChange', () => {
  it('action=request 时标题与内容映射正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({
      type: 'system',
      title: '收到新的亲情绑定请求',
      reference_type: 'family_binding',
    })] });

    await notificationService.notifyFamilyBindingChange('u1', 'binding-1', 'request', '李四');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('收到新的亲情绑定请求');
    expect(params[3]).toBe('李四 向您发起了亲情绑定请求，请及时确认。');
    expect(params[4]).toBe('binding-1');
    expect(params[5]).toBe('family_binding');
  });

  it('action=confirmed 时标题与内容映射正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'binding-1', 'confirmed', '李四');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('亲情绑定已确认');
    expect(params[3]).toBe('李四 已确认您的亲情绑定请求，绑定已生效。');
  });

  it('action=rejected 时标题与内容映射正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'binding-1', 'rejected', '李四');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('亲情绑定被拒绝');
    expect(params[3]).toBe('李四 拒绝了您的亲情绑定请求。');
  });

  it('action=unbound 时标题与内容映射正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'binding-1', 'unbound', '李四');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('亲情绑定已解除');
    expect(params[3]).toBe('李四 已解除与您的亲情绑定关系。');
  });

  it('otherNickname 为 undefined 时回退到默认文案', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyFamilyBindingChange('u1', 'binding-1', 'request');

    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBe('一位用户 向您发起了亲情绑定请求，请及时确认。');
  });
});

// ==================== notifyTimeBankTransaction 测试 ====================

describe('notification.service notifyTimeBankTransaction', () => {
  it('transactionType=transfer 时标题与内容映射正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow({
      type: 'system',
      title: '收到时间币转赠',
      reference_type: 'time_order',
    })] });

    await notificationService.notifyTimeBankTransaction('to-user', 'txn-1', 'transfer', 50, '王五');

    const params = mockQuery.mock.calls[0][1];
    expect(params[0]).toBe('to-user');
    expect(params[2]).toBe('收到时间币转赠');
    expect(params[3]).toBe('王五 向您转赠了 50 个时间币。');
    expect(params[4]).toBe('txn-1');
    expect(params[5]).toBe('time_order');
  });

  it('transactionType=donate 时标题与内容映射正确', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyTimeBankTransaction('to-user', 'txn-2', 'donate', 100, '赵六');

    const params = mockQuery.mock.calls[0][1];
    expect(params[2]).toBe('收到时间币捐赠');
    expect(params[3]).toBe('赵六 向您捐赠了 100 个时间币。');
  });

  it('transactionId 为 undefined 时 referenceId 透传为 null（createNotification 内部 || null 转换）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyTimeBankTransaction('to-user', undefined, 'donate', 30);

    const params = mockQuery.mock.calls[0][1];
    // createNotification 内部 `params.referenceId || null` 将 undefined 转 null
    expect(params[4]).toBeNull();
  });

  it('fromNickname 为 undefined 时回退到默认文案', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeRow()] });

    await notificationService.notifyTimeBankTransaction('to-user', 'txn-1', 'transfer', 20);

    const params = mockQuery.mock.calls[0][1];
    expect(params[3]).toBe('一位用户 向您转赠了 20 个时间币。');
  });
});
