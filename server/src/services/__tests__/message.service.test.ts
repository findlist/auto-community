/**
 * message.service 单元测试
 *
 * 测试目标：
 * - sendMessage：INSERT 参数透传、toMessage 映射（read_at/created_at Date→ISO 转换）
 * - getMessages：getOrderParticipants 4 种 orderType 权限校验、订单不存在拦截、非双方用户拦截、
 *                无效 orderType 拦截、cursor 有/无两种 SQL 分支、游标分页 hasMore 计算
 * - markAsRead：UPDATE 透传、rowCount 返回、null 时降级为 0
 * - getUnreadCount：有/无 orderType 过滤两种 SQL 分支、count string→number 转换
 *
 * 测试策略：mock database 的 query，按调用顺序用 mockResolvedValueOnce 模拟权限校验与主查询，
 *           验证 service 层的权限校验逻辑、SQL 分支选择、响应映射正确性。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：message.service 使用 query
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: vi.fn(),
  pool: {},
}));

import { messageService } from '../message.service';
import { ForbiddenError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('message.service sendMessage', () => {
  it('正常发送消息（默认 type=text, orderType=skill），INSERT 参数透传', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'msg-1',
        sender_id: 'u1',
        receiver_id: 'u2',
        order_id: 'o1',
        order_type: 'skill',
        content: '你好',
        type: 'text',
        read_at: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    const result = await messageService.sendMessage('u1', 'u2', 'o1', '你好');

    // 验证 INSERT 参数透传
    const call = mockQuery.mock.calls[0];
    expect(call[1]).toEqual(['u1', 'u2', 'o1', 'skill', '你好', 'text']);
    // 验证 toMessage 映射
    expect(result.id).toBe('msg-1');
    expect(result.content).toBe('你好');
    expect(result.readAt).toBeNull();
    expect(result.createdAt).toBe('2026-07-08T10:00:00.000Z');
  });

  it('orderId 为 null 时透传到 INSERT 参数', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'msg-2',
        sender_id: 'u1',
        receiver_id: 'u2',
        order_id: null,
        order_type: 'skill',
        content: '系统消息',
        type: 'system',
        read_at: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    const result = await messageService.sendMessage('u1', 'u2', null, '系统消息', 'system');

    expect(mockQuery.mock.calls[0][1][2]).toBeNull();
    expect(result.orderId).toBeNull();
  });

  it('read_at 为 Date 时 readAt 转为 ISO string', async () => {
    const readAt = new Date('2026-07-08T11:00:00Z');
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'msg-3',
        sender_id: 'u1',
        receiver_id: 'u2',
        order_id: 'o1',
        order_type: 'skill',
        content: '已读消息',
        type: 'text',
        read_at: readAt,
        created_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    const result = await messageService.sendMessage('u1', 'u2', 'o1', '已读消息');

    expect(result.readAt).toBe('2026-07-08T11:00:00.000Z');
  });

  it('XSS 防御纵深：消息含 <script> 标签时被 sanitizeXss 清洗后再写入数据库', async () => {
    // 设计原因：message.service.sendMessage 在 SQL 参数化前调用 sanitizeXss 清洗 content，
    // 防御纵深守护未来非 React 渲染场景（如导出聊天记录、邮件预览）触发存储型 XSS。
    // 现有纯文本测试无法触发 sanitizeXss 实际清洗行为，需显式构造含 <script> 的输入验证不变式
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'msg-xss',
        sender_id: 'u1',
        receiver_id: 'u2',
        order_id: null,
        order_type: 'skill',
        content: '&lt;script&gt;alert(1)&lt;/script&gt;',
        type: 'text',
        read_at: null,
        created_at: new Date('2026-07-08T10:00:00Z'),
      }],
    });

    await messageService.sendMessage('u1', 'u2', null, '<script>alert(1)</script>');

    // 断言 SQL 参数中 content 已被清洗：<script> 转义为 &lt;script&gt;，alert(1) 文本保留
    const sqlParams = mockQuery.mock.calls[0][1] as unknown[];
    const contentParam = sqlParams[4] as string;
    expect(contentParam).not.toContain('<script>');
    expect(contentParam).toContain('&lt;script&gt;');
    expect(contentParam).toContain('alert(1)');
  });
});

describe('message.service getMessages 权限校验', () => {
  it('skill 类型订单权限通过（buyer_id=userId）', async () => {
    // 第1次：权限校验查询；第2次：主查询
    mockQuery.mockResolvedValueOnce({ rows: [{ buyer_id: 'u1', seller_id: 'u2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await messageService.getMessages('o1', 'u1', undefined, 20, 'skill');

    expect(result.list).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('skill 类型订单权限通过（seller_id=userId）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ buyer_id: 'u1', seller_id: 'u2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await messageService.getMessages('o1', 'u2', undefined, 20, 'skill');

    expect(result.list).toEqual([]);
  });

  it('skill 类型订单权限失败（非双方用户）抛 ForbiddenError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ buyer_id: 'other', seller_id: 'other2' }] });

    await expect(
      messageService.getMessages('o1', 'u1', undefined, 20, 'skill'),
    ).rejects.toThrow(ForbiddenError);
  });

  it('kitchen 类型订单权限通过（user_id=userId）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', seller_id: 'u2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await messageService.getMessages('o1', 'u1', undefined, 20, 'kitchen');

    expect(result.list).toEqual([]);
  });

  it('time 类型订单权限通过（provider_id=userId）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ provider_id: 'u1', requester_id: 'u2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await messageService.getMessages('o1', 'u1', undefined, 20, 'time');

    expect(result.list).toEqual([]);
  });

  it('emergency 类型订单权限通过（responder_id=userId）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ responder_id: 'u1', user_id: 'u2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await messageService.getMessages('o1', 'u1', undefined, 20, 'emergency');

    expect(result.list).toEqual([]);
  });

  it('无效 orderType 抛 ForbiddenError', async () => {
    await expect(
      messageService.getMessages('o1', 'u1', undefined, 20, 'invalid' as unknown as Parameters<typeof messageService.getMessages>[4]),
    ).rejects.toThrow('无效的订单类型');
    // 无效类型不应触发 query
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('订单不存在（rows.length=0）抛 ForbiddenError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      messageService.getMessages('o1', 'u1', undefined, 20, 'skill'),
    ).rejects.toThrow('无权查看此聊天记录');
    // 仅触发权限校验 query，不应触发主查询
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('message.service getMessages 游标分页', () => {
  it('无 cursor 时 SQL 不含 AND id < $4', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ buyer_id: 'u1', seller_id: 'u2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await messageService.getMessages('o1', 'u1', undefined, 20, 'skill');

    const mainQueryCall = mockQuery.mock.calls[1];
    const sql = mainQueryCall[0] as string;
    expect(sql).not.toContain('AND id < $4');
    // 参数为 [orderId, orderType, limit]
    expect(mainQueryCall[1]).toEqual(['o1', 'skill', 20]);
  });

  it('有 cursor 时 SQL 含 AND id < $4 且 cursor 作为第4参数', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ buyer_id: 'u1', seller_id: 'u2' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await messageService.getMessages('o1', 'u1', 'cursor-id', 20, 'skill');

    const mainQueryCall = mockQuery.mock.calls[1];
    const sql = mainQueryCall[0] as string;
    expect(sql).toContain('AND id < $4');
    // 参数为 [orderId, orderType, limit, cursor]
    expect(mainQueryCall[1]).toEqual(['o1', 'skill', 20, 'cursor-id']);
  });

  it('hasMore=true 当 list.length >= limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ buyer_id: 'u1', seller_id: 'u2' }] });
    // 返回 20 条记录等于 limit，hasMore 应为 true
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `msg-${i}`,
      sender_id: 'u1',
      receiver_id: 'u2',
      order_id: 'o1',
      order_type: 'skill',
      content: `消息${i}`,
      type: 'text',
      read_at: null,
      created_at: new Date('2026-07-08T10:00:00Z'),
    }));
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await messageService.getMessages('o1', 'u1', undefined, 20, 'skill');

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('msg-19');
  });

  it('hasMore=false 当 list.length < limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ buyer_id: 'u1', seller_id: 'u2' }] });
    // 返回 5 条记录小于 limit=20，hasMore 应为 false
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `msg-${i}`,
      sender_id: 'u1',
      receiver_id: 'u2',
      order_id: 'o1',
      order_type: 'skill',
      content: `消息${i}`,
      type: 'text',
      read_at: null,
      created_at: new Date('2026-07-08T10:00:00Z'),
    }));
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await messageService.getMessages('o1', 'u1', undefined, 20, 'skill');

    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

describe('message.service markAsRead', () => {
  it('正常标记已读，返回 rowCount', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 5 });

    const result = await messageService.markAsRead('o1', 'u1', 'skill');

    expect(result).toBe(5);
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('UPDATE messages SET read_at = NOW()');
    expect(call[1]).toEqual(['o1', 'skill', 'u1']);
  });

  it('rowCount 为 null 时返回 0', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null });

    const result = await messageService.markAsRead('o1', 'u1', 'skill');

    expect(result).toBe(0);
  });

  it('默认 orderType=skill', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });

    await messageService.markAsRead('o1', 'u1');

    expect(mockQuery.mock.calls[0][1]).toEqual(['o1', 'skill', 'u1']);
  });
});

describe('message.service getUnreadCount', () => {
  it('不带 orderType 过滤，SQL 不含 order_type 条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '3' }] });

    const result = await messageService.getUnreadCount('u1');

    expect(result).toEqual({ unreadCount: 3 });
    const call = mockQuery.mock.calls[0];
    expect(call[0]).not.toContain('order_type');
    expect(call[1]).toEqual(['u1']);
  });

  it('带 orderType 过滤，SQL 含 order_type 条件', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const result = await messageService.getUnreadCount('u1', 'kitchen');

    expect(result).toEqual({ unreadCount: 2 });
    const call = mockQuery.mock.calls[0];
    expect(call[0]).toContain('order_type = $2');
    expect(call[1]).toEqual(['u1', 'kitchen']);
  });

  it('count string→number 转换（parseInt base 10）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '012' }] });

    const result = await messageService.getUnreadCount('u1');

    expect(result.unreadCount).toBe(12);
  });
});
