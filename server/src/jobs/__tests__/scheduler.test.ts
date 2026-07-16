/**
 * jobs/scheduler 定时任务处理函数单元测试
 *
 * 测试目标：覆盖 14 个导出的处理函数的核心业务逻辑
 * - 空数据路径：无超时数据时提前返回，不触发后续操作
 * - 有数据路径：SQL 执行、事务调用、日志记录
 * - 错误路径：事务失败时的 catch 处理
 * - 关键业务：handleDeferredTimeEarn 的日上限与部分发放、handleKitchenOrderTimeout 的双路处理
 *
 * 测试策略：mock database (query/transaction)、4 个 service (groupOrder/credit/backup/dataDeletion)、
 *           logger 与 node-cron，直接调用导出的处理函数验证行为。
 *           transaction 回调注入 mockClient，便于测试事务内多条 SQL。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

const { mockQuery, mockTransaction, mockClient, mockGroupOrderCheckExpired, mockCreditSettleCredits, mockBackupPerformBackup, mockDataDeletionCleanup, mockRecordAllMetrics, mockLoggerInfo, mockLoggerWarn, mockLoggerError, mockCronSchedule, mockCronCallbacks } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockClient: { query: vi.fn() },
  mockGroupOrderCheckExpired: vi.fn(),
  mockCreditSettleCredits: vi.fn(),
  mockBackupPerformBackup: vi.fn(),
  mockDataDeletionCleanup: vi.fn(),
  mockRecordAllMetrics: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  // node-cron mock：schedule 调用时捕获回调与 stop 函数，便于 initScheduler 测试触发回调
  mockCronSchedule: vi.fn(),
  mockCronCallbacks: [] as Array<{ expr: string; callback: () => Promise<void> | void; stop: ReturnType<typeof vi.fn> }>,
}));

// mock database：transaction 回调注入 mockClient
vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
  pool: {},
}));

vi.mock('../../services/group-order.service', () => ({
  groupOrderService: { checkExpired: mockGroupOrderCheckExpired },
}));

vi.mock('../../services/credit.service', () => ({
  creditService: { settleCredits: mockCreditSettleCredits },
}));

vi.mock('../../services/backup.service', () => ({
  backupService: { performBackup: mockBackupPerformBackup },
}));

vi.mock('../../services/data-deletion.service', () => ({
  dataDeletionService: { cleanupSoftDeletedData: mockDataDeletionCleanup },
}));

// mock metrics-calculation.service：隔离 recordAllMetrics 便于断言调度层行为
// 设计原因：scheduler 只需验证 handleMetricsCollection 是否正确调用 recordAllMetrics 并处理结果，
// 无需关心具体的指标计算逻辑（已在 metrics-calculation.service.test.ts 中覆盖）
vi.mock('../../services/metrics-calculation.service', () => ({
  recordAllMetrics: mockRecordAllMetrics,
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

// mock node-cron：schedule 调用时捕获回调与 stop 函数，便于 initScheduler 测试触发回调
// 设计原因：initScheduler 内部注册多个 cron.schedule，需捕获回调以验证 try/catch 分支
vi.mock('node-cron', () => ({
  default: {
    schedule: mockCronSchedule.mockImplementation((expr: string, callback: () => Promise<void> | void) => {
      const stop = vi.fn();
      mockCronCallbacks.push({ expr, callback, stop });
      return { stop };
    }),
  },
}));

import {
  handleSkillOrderTimeout,
  handleSkillOrderAcceptReminder,
  handleSkillOrderInProgressTimeout,
  handleKitchenOrderTimeout,
  handleTimeOrderTimeout,
  handleTimeBankOrderTimeout,
  handleEmergencyTimeout,
  handleEmergencyRequestTimeout,
  handleGroupOrderTimeout,
  handleEmergencyResourceCheck,
  handleAutoUnban,
  reconcileCreditBalance,
  handleSkillPostExpiry,
  handleDeferredTimeEarn,
  handleMetricsCollection,
  initScheduler,
} from '../scheduler';

beforeEach(() => {
  mockQuery.mockReset();
  mockClient.query.mockReset();
  mockTransaction.mockReset();
  // transaction 默认实现：执行回调并传入 mockClient
  mockTransaction.mockImplementation(async (cb: (c: typeof mockClient) => Promise<unknown>) => cb(mockClient));
  mockGroupOrderCheckExpired.mockReset();
  mockCreditSettleCredits.mockReset();
  mockBackupPerformBackup.mockReset();
  mockDataDeletionCleanup.mockReset();
  mockRecordAllMetrics.mockReset();
  mockLoggerInfo.mockClear();
  mockLoggerWarn.mockClear();
  mockLoggerError.mockClear();
  // 清空 cron 回调捕获数组，避免测试间污染
  mockCronCallbacks.length = 0;
  mockCronSchedule.mockClear();
});

// ===================== 技能订单超时处理 =====================

describe('scheduler - handleSkillOrderTimeout', () => {
  it('无超时订单时提前返回且不触发事务', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleSkillOrderTimeout();

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('有超时订单时事务内批量更新状态与解冻积分', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'o1', buyer_id: 'b1', credit_amount: 100 },
        { id: 'o2', buyer_id: 'b2', credit_amount: 0 }, // amount=0 不解冻
      ],
    });
    // UPDATE...RETURNING 返回实际被取消的订单 ID（模拟 status='pending' 过滤后命中）
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'o1' }, { id: 'o2' }] });
    mockClient.query.mockResolvedValue({ rows: [] });

    await handleSkillOrderTimeout();

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 1 条批量 UPDATE...RETURNING + 2 条解冻 SQL（o1 解冻 credit_balance + 更新 credit_transactions，o2 amount=0 跳过）
    expect(mockClient.query).toHaveBeenCalledTimes(3);
    // 验证批量更新订单状态
    expect(mockClient.query.mock.calls[0][0]).toContain("status = 'cancelled'");
    expect(mockClient.query.mock.calls[0][1]).toEqual([['o1', 'o2']]);
    // 验证逐条记录日志
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1' }),
      expect.stringContaining('自动取消'),
    );
  });

  it('事务失败时 catch 记录 error 日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1', buyer_id: 'b1', credit_amount: 50 }] });
    mockTransaction.mockRejectedValueOnce(new Error('事务连接失败'));

    await handleSkillOrderTimeout();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), count: 1 }),
      expect.stringContaining('批量自动取消失败'),
    );
  });
});

// ===================== 技能订单 accepted 提醒 =====================

describe('scheduler - handleSkillOrderAcceptReminder', () => {
  it('无 accepted 7天订单时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleSkillOrderAcceptReminder();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('有订单时逐条记录提醒日志', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o1', buyer_id: 'b1', seller_id: 's1' }],
    });

    await handleSkillOrderAcceptReminder();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', buyerId: 'b1', sellerId: 's1' }),
      expect.stringContaining('提醒买家确认完成'),
    );
    // 完成汇总日志
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('提醒完成'),
    );
  });
});

// ===================== 技能订单 in_progress 超时 =====================

describe('scheduler - handleSkillOrderInProgressTimeout', () => {
  it('无超时订单时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleSkillOrderInProgressTimeout();

    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('有超时订单时逐条记录 warn 日志', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o1', buyer_id: 'b1', seller_id: 's1' }],
    });

    await handleSkillOrderInProgressTimeout();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1' }),
      expect.stringContaining('需处理'),
    );
  });
});

// ===================== 厨房订单超时处理（pending + confirmed 双路） =====================

describe('scheduler - handleKitchenOrderTimeout', () => {
  it('无超时订单时不触发事务', async () => {
    // 两次 query：pending 查询 + confirmed 查询
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleKitchenOrderTimeout();

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('有 pending 超时订单时事务内取消+恢复库存+退款', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o1', user_id: 'b1', post_id: 'p1', portions: 2, credit_amount: 30 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // confirmed 查询为空
    // UPDATE...RETURNING 返回实际被取消的订单 ID（模拟 status='pending' 过滤后命中）
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'o1' }] });
    mockClient.query.mockResolvedValue({ rows: [] });

    await handleKitchenOrderTimeout();

    // pending 路径触发事务：1 批量UPDATE...RETURNING状态 + 1 恢复库存 + 2 退款(credit_balance+credit_transactions) = 4
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledTimes(4);
    // 验证恢复库存
    const restoreCall = mockClient.query.mock.calls[1];
    expect(restoreCall[0]).toContain('remaining_portions = remaining_portions + $1');
    expect(restoreCall[1]).toEqual([2, 'p1']);
  });

  it('有 confirmed 超时订单时事务内完成+结算积分', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pending 为空
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o2', user_id: 'b1', seller_id: 's1', credit_amount: 50 }],
    });
    // 锁定查询返回有效订单
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'o2' }] });
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // 批量 UPDATE completed
    mockCreditSettleCredits.mockResolvedValue(undefined);

    await handleKitchenOrderTimeout();

    // confirmed 路径触发事务
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 验证 settleCredits 被调用（buyer→seller 结算）
    expect(mockCreditSettleCredits).toHaveBeenCalledWith(
      expect.anything(), // client
      'b1', 's1', 50, 'o2', 'kitchen_order',
    );
  });

  it('confirmed 锁定后无有效订单时提前返回不结算', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pending 为空
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o2', user_id: 'b1', seller_id: 's1', credit_amount: 50 }],
    });
    // 锁定查询返回空（状态已变更）
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    await handleKitchenOrderTimeout();

    expect(mockCreditSettleCredits).not.toHaveBeenCalled();
  });

  // 覆盖 line 168 catch 分支：pending 路径事务抛错时记录 error 日志
  it('pending 路径事务抛错时 catch 记录 error 日志', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o1', user_id: 'b1', post_id: 'p1', portions: 2, credit_amount: 30 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // confirmed 为空
    // transaction 抛错触发 pending 路径 catch
    mockTransaction.mockRejectedValueOnce(new Error('pending 事务失败'));

    await handleKitchenOrderTimeout();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), count: 1 }),
      expect.stringContaining('厨房订单批量自动取消失败'),
    );
  });

  // 覆盖 line 224 catch 分支：confirmed 路径事务抛错时记录 error 日志
  it('confirmed 路径事务抛错时 catch 记录 error 日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // pending 为空
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o2', user_id: 'b1', seller_id: 's1', credit_amount: 50 }],
    });
    // transaction 抛错触发 confirmed 路径 catch
    mockTransaction.mockRejectedValueOnce(new Error('confirmed 事务失败'));

    await handleKitchenOrderTimeout();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), count: 1 }),
      expect.stringContaining('厨房订单批量自动完成失败'),
    );
  });
});

// ===================== 时间银行订单超时 =====================

describe('scheduler - handleTimeOrderTimeout', () => {
  it('无超时订单时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleTimeOrderTimeout();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('有超时订单时记录取消日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'o1' }, { id: 'o2' }] });

    await handleTimeOrderTimeout();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
      expect.stringContaining('自动取消'),
    );
  });
});

// ===================== 时间银行订单超时检查 =====================

describe('scheduler - handleTimeBankOrderTimeout', () => {
  it('无超时订单时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleTimeBankOrderTimeout();

    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('有超时订单时逐条记录 warn 日志', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'o1', status: 'accepted', provider_id: 'p1', requester_id: 'r1' }],
    });

    await handleTimeBankOrderTimeout();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'o1', status: 'accepted' }),
      expect.stringContaining('需处理'),
    );
  });
});

// ===================== 应急响应超时 =====================

describe('scheduler - handleEmergencyTimeout', () => {
  it('无超时响应与回退时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleEmergencyTimeout();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('有超时响应与回退时分别记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] }); // 超时响应
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1' }] }); // 回退求助

    await handleEmergencyTimeout();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('应急响应超时处理完成'),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('应急求助状态回退完成'),
    );
  });
});

// ===================== 应急求助超时 =====================

describe('scheduler - handleEmergencyRequestTimeout', () => {
  it('无超时求助时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleEmergencyRequestTimeout();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('有超时求助时记录 expired 日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'e1' }] });

    await handleEmergencyRequestTimeout();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('应急求助超时处理完成'),
    );
  });
});

// ===================== 拼单过期处理 =====================

describe('scheduler - handleGroupOrderTimeout', () => {
  it('checkExpired 返回 0 时不记录日志', async () => {
    mockGroupOrderCheckExpired.mockResolvedValueOnce(0);

    await handleGroupOrderTimeout();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('checkExpired 返回 N 时记录处理日志', async () => {
    mockGroupOrderCheckExpired.mockResolvedValueOnce(5);

    await handleGroupOrderTimeout();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5 }),
      expect.stringContaining('拼单过期处理完成'),
    );
  });
});

// ===================== 应急资源巡检 =====================

describe('scheduler - handleEmergencyResourceCheck', () => {
  it('无可用资源与 stale 资源时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleEmergencyResourceCheck();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('有可用资源时记录巡检日志，有 stale 资源时记录 warn', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] }); // 可用资源
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r2' }] }); // stale 资源

    await handleEmergencyResourceCheck();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('应急资源巡检完成'),
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('needs_check'),
    );
  });
});

// ===================== 用户自动解封 =====================

describe('scheduler - handleAutoUnban', () => {
  it('无到期封禁用户时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleAutoUnban();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('有到期封禁用户时记录解封日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1' }, { id: 'u2' }] });

    await handleAutoUnban();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
      expect.stringContaining('自动解封'),
    );
  });
});

// ===================== 积分对账 =====================

describe('scheduler - reconcileCreditBalance', () => {
  it('无不一致时返回 0 且不记录 error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await reconcileCreditBalance();

    expect(result).toBe(0);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('有不一致时逐条记录 error 并返回数量', async () => {
    // pg DECIMAL/INTEGER 解析为 string，验证 Number() 转换逻辑
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'u1', credit_balance: '100', computed_balance: '80' },
        { id: 'u2', credit_balance: '50', computed_balance: '50' }, // 一致但被 HAVING 选中说明查询逻辑
      ],
    });

    const result = await reconcileCreditBalance();

    expect(result).toBe(2);
    // 验证逐条记录 diff（Number 转换：100-80=20）
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', diff: 20 }),
      expect.stringContaining('积分对账异常'),
    );
    // 验证汇总日志
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
      expect.stringContaining('余额不一致'),
    );
  });
});

// ===================== 技能帖子过期 =====================

describe('scheduler - handleSkillPostExpiry', () => {
  it('无过期帖子时不记录日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleSkillPostExpiry();

    expect(mockLoggerInfo).not.toHaveBeenCalled();
  });

  it('有过期帖子时记录处理日志', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });

    await handleSkillPostExpiry();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('技能帖子过期处理完成'),
    );
  });
});

// ===================== 延迟时间收益发放（核心业务逻辑） =====================

describe('scheduler - handleDeferredTimeEarn', () => {
  it('无 pending 流水时返回 0', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const result = await handleDeferredTimeEarn();

    expect(result).toBe(0);
  });

  it('当日已达上限时跳过发放保持 pending', async () => {
    // pending 流水查询
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 't1', to_user_id: 'p1', amount: 60, type: 'earn', service_id: 's1', from_user_id: 'u1', remark: '服务完成' }],
    });
    // 当日已发放查询：已达 480 上限
    mockClient.query.mockResolvedValueOnce({ rows: [{ total: '480' }] });

    const result = await handleDeferredTimeEarn();

    expect(result).toBe(0);
    // 不应触发 UPDATE 流水状态
    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it('全额发放：remaining >= amount 时 UPDATE status=completed', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 't1', to_user_id: 'p1', amount: 60, type: 'earn', service_id: 's1', from_user_id: 'u1', remark: '服务完成' }],
    });
    // 当日已发放 100，剩余 380 >= 60
    mockClient.query.mockResolvedValueOnce({ rows: [{ total: '100' }] });
    // UPDATE 流水状态
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // UPDATE users time_balance
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // UPDATE time_accounts
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const result = await handleDeferredTimeEarn();

    expect(result).toBe(1);
    // 验证 UPDATE status=completed
    const updateStatusCall = mockClient.query.mock.calls[2];
    expect(updateStatusCall[0]).toContain("status = 'completed'");
    expect(updateStatusCall[1]).toEqual(['t1']);
    // 验证发放金额写入 time_balance
    expect(mockClient.query.mock.calls[3][1]).toEqual([60, 'p1']);
  });

  it('部分发放：remaining < amount 时拆分流水', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 't1', to_user_id: 'p1', amount: 100, type: 'bonus', service_id: 's1', from_user_id: 'u1', remark: '奖励' }],
    });
    // 当日已发放 450，剩余 30 < 100
    mockClient.query.mockResolvedValueOnce({ rows: [{ total: '450' }] });
    // UPDATE 原流水 amount=30 且 status=completed
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // INSERT 剩余 70 为新 pending 流水
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // UPDATE users time_balance (+30)
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // UPDATE time_accounts (+30)
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const result = await handleDeferredTimeEarn();

    expect(result).toBe(1);
    // 验证 UPDATE 原流水 amount=30
    const updateCall = mockClient.query.mock.calls[2];
    expect(updateCall[0]).toContain('amount = $1');
    expect(updateCall[1]).toEqual([30, 't1']);
    // 验证 INSERT 剩余 pending 流水 amount=70
    const insertCall = mockClient.query.mock.calls[3];
    expect(insertCall[0]).toContain('INSERT INTO time_transactions');
    expect(insertCall[1]).toEqual(['s1', 'u1', 'p1', 70, 'bonus', '奖励']);
    // 验证 time_balance 增加 30（部分发放金额）
    expect(mockClient.query.mock.calls[4][1]).toEqual([30, 'p1']);
  });
});

// ===================== initScheduler 调度器初始化 =====================
// 设计原因：initScheduler 内部注册 7 个 cron.schedule 回调，每个回调包含多个 try/catch 隔离的 handler 调用。
// 通过 mockCronCallbacks 数组捕获 schedule 调用的回调，手动触发以覆盖各 try/catch 分支与 stop 方法。
describe('scheduler - initScheduler', () => {
  it('注册 7 个定时任务并返回带 stop 方法的句柄', () => {
    const handle = initScheduler();

    // 7 个 cron.schedule 调用：5分钟超时处理 / 每小时帖子过期 / 每日0:01收益发放 / 每日3:00积分对账 / 每日2:00备份 / 每日4:00软删除清理 / 每小时第5分钟指标采集
    expect(mockCronSchedule).toHaveBeenCalledTimes(7);
    expect(mockCronCallbacks).toHaveLength(7);
    // 验证 cron 表达式
    expect(mockCronCallbacks[0].expr).toBe('*/5 * * * *');
    expect(mockCronCallbacks[1].expr).toBe('0 * * * *');
    expect(mockCronCallbacks[2].expr).toBe('1 0 * * *');
    expect(mockCronCallbacks[3].expr).toBe('0 3 * * *');
    expect(mockCronCallbacks[4].expr).toBe('0 2 * * *');
    expect(mockCronCallbacks[5].expr).toBe('0 4 * * *');
    expect(mockCronCallbacks[6].expr).toBe('5 * * * *');
    // 返回句柄包含 stop 方法
    expect(typeof handle.stop).toBe('function');
  });

  it('5 分钟回调所有 handler 成功执行时记录完成日志', async () => {
    // 所有 query 返回空数组，各 handler 提前返回不触发事务
    mockQuery.mockResolvedValue({ rows: [] });

    initScheduler();
    const fiveMinCallback = mockCronCallbacks[0];
    await fiveMinCallback.callback();

    // 验证开始与完成日志
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('开始执行超时订单处理'));
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('超时订单处理完成'));
  });

  it('5 分钟回调单个 handler 抛错时其他 handler 仍执行（try/catch 隔离）', async () => {
    // 让 handleSkillOrderTimeout 抛错（query 抛错），其他 handler 正常
    let callCount = 0;
    mockQuery.mockImplementation(async () => {
      callCount++;
      // 第 1 次调用为 handleSkillOrderTimeout 的 query，抛错
      if (callCount === 1) throw new Error('skill timeout 查询失败');
      return { rows: [] };
    });

    initScheduler();
    const fiveMinCallback = mockCronCallbacks[0];
    await fiveMinCallback.callback();

    // 验证 handleSkillOrderTimeout 的 error 日志被记录
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('技能订单超时处理异常'),
    );
    // 验证后续 handler 仍执行（完成日志仍记录）
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('超时订单处理完成'));
  });

  it('每小时回调 handleSkillPostExpiry 抛错时记录异常日志', async () => {
    mockQuery.mockRejectedValue(new Error('帖子过期查询失败'));

    initScheduler();
    const hourlyCallback = mockCronCallbacks[1];
    await hourlyCallback.callback();

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('开始执行技能帖子过期处理'));
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('技能帖子过期处理异常'),
    );
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('技能帖子过期处理结束'));
  });

  it('每日 0:01 回调 handleDeferredTimeEarn 有处理结果时记录 count 日志', async () => {
    // handleDeferredTimeEarn 内部 transaction 调用 mockClient.query
    // 第 1 次：查询 pending 流水返回 1 条
    mockClient.query.mockResolvedValueOnce({
      rows: [{ id: 't1', to_user_id: 'p1', amount: 60, type: 'earn', service_id: 's1', from_user_id: 'u1', remark: '服务完成' }],
    });
    // 第 2 次：当日已发放 100，剩余 380 >= 60
    mockClient.query.mockResolvedValueOnce({ rows: [{ total: '100' }] });
    // 第 3-5 次：UPDATE 流水状态 / users time_balance / time_accounts
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    initScheduler();
    const dailyEarnCallback = mockCronCallbacks[2];
    await dailyEarnCallback.callback();

    // 有处理结果时记录 count 日志
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.stringContaining('延迟时间收益发放完成'),
    );
  });

  it('每日 0:01 回调 handleDeferredTimeEarn 无处理结果时记录无 pending 日志', async () => {
    // pending 流水查询返回空
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    initScheduler();
    const dailyEarnCallback = mockCronCallbacks[2];
    await dailyEarnCallback.callback();

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('无 pending 流水需处理'));
  });

  it('每日 0:01 回调 handleDeferredTimeEarn 抛错时记录异常日志', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('收益发放事务失败'));

    initScheduler();
    const dailyEarnCallback = mockCronCallbacks[2];
    await dailyEarnCallback.callback();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('延迟时间收益发放异常'),
    );
  });

  it('每日 3:00 回调 reconcileCreditBalance 无不一致时记录所有用户余额一致', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    initScheduler();
    const reconcileCallback = mockCronCallbacks[3];
    await reconcileCallback.callback();

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('所有用户余额一致'));
  });

  it('每日 3:00 回调 reconcileCreditBalance 抛错时记录异常日志', async () => {
    mockQuery.mockRejectedValueOnce(new Error('对账查询失败'));

    initScheduler();
    const reconcileCallback = mockCronCallbacks[3];
    await reconcileCallback.callback();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('积分对账异常'),
    );
  });

  it('每日 2:00 回调 backupService 成功时记录备份完成日志', async () => {
    mockBackupPerformBackup.mockResolvedValueOnce({
      success: true,
      fileName: 'backup-2026.tar.gz',
      fileSize: 1024,
      duration: 500,
    });

    initScheduler();
    const backupCallback = mockCronCallbacks[4];
    await backupCallback.callback();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'backup-2026.tar.gz', fileSize: 1024, durationMs: 500 }),
      expect.stringContaining('数据库备份完成'),
    );
  });

  it('每日 2:00 回调 backupService 返回失败时记录 error 日志', async () => {
    mockBackupPerformBackup.mockResolvedValueOnce({
      success: false,
      error: '磁盘空间不足',
    });

    initScheduler();
    const backupCallback = mockCronCallbacks[4];
    await backupCallback.callback();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ error: '磁盘空间不足' }),
      expect.stringContaining('数据库备份失败'),
    );
  });

  it('每日 2:00 回调 backupService 抛错时记录异常日志', async () => {
    mockBackupPerformBackup.mockRejectedValueOnce(new Error('备份进程崩溃'));

    initScheduler();
    const backupCallback = mockCronCallbacks[4];
    await backupCallback.callback();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('数据库备份异常'),
    );
  });

  it('每日 4:00 回调 cleanupSoftDeletedData 有清理结果时记录 count 日志', async () => {
    mockDataDeletionCleanup.mockResolvedValueOnce(5);

    initScheduler();
    const cleanupCallback = mockCronCallbacks[5];
    await cleanupCallback.callback();

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ count: 5 }),
      expect.stringContaining('软删除数据清理完成'),
    );
  });

  it('每日 4:00 回调 cleanupSoftDeletedData 无清理结果时记录无过期数据日志', async () => {
    mockDataDeletionCleanup.mockResolvedValueOnce(0);

    initScheduler();
    const cleanupCallback = mockCronCallbacks[5];
    await cleanupCallback.callback();

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('无过期数据'));
  });

  it('每日 4:00 回调 cleanupSoftDeletedData 抛错时记录异常日志', async () => {
    mockDataDeletionCleanup.mockRejectedValueOnce(new Error('清理失败'));

    initScheduler();
    const cleanupCallback = mockCronCallbacks[5];
    await cleanupCallback.callback();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('软删除数据清理异常'),
    );
  });

  it('stop 方法调用所有 task.stop() 并记录停止日志', () => {
    const handle = initScheduler();

    handle.stop();

    // 验证所有 7 个 task.stop 被调用
    expect(mockCronCallbacks[0].stop).toHaveBeenCalled();
    expect(mockCronCallbacks[1].stop).toHaveBeenCalled();
    expect(mockCronCallbacks[2].stop).toHaveBeenCalled();
    expect(mockCronCallbacks[3].stop).toHaveBeenCalled();
    expect(mockCronCallbacks[4].stop).toHaveBeenCalled();
    expect(mockCronCallbacks[5].stop).toHaveBeenCalled();
    expect(mockCronCallbacks[6].stop).toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('调度器已停止'));
  });

  it('stop 方法单个 task.stop 抛错时其他 task 仍停止（try/catch 隔离）', () => {
    // 让第 1 个 task.stop 抛错，其他正常
    mockCronCallbacks.length = 0; // 清空后再 initScheduler
    const handle = initScheduler();
    mockCronCallbacks[0].stop.mockImplementationOnce(() => {
      throw new Error('stop 失败');
    });

    handle.stop();

    // 验证抛错的 task 记录 error 日志
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('停止任务失败'),
    );
    // 验证其他 task.stop 仍被调用
    expect(mockCronCallbacks[1].stop).toHaveBeenCalled();
    expect(mockCronCallbacks[6].stop).toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('调度器已停止'));
  });

  it('每小时第 5 分钟回调 handleMetricsCollection 全部成功时记录完成日志', async () => {
    // 设计原因：指标采集任务在 initScheduler 末尾注册（index 6），回调内部仅 try/catch 包裹 handleMetricsCollection
    mockRecordAllMetrics.mockResolvedValueOnce({ recorded: 5, failed: 0, failedNames: [] });

    initScheduler();
    const metricsCallback = mockCronCallbacks[6];
    await metricsCallback.callback();

    expect(mockRecordAllMetrics).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ recorded: 5 }),
      expect.stringContaining('指标采集完成'),
    );
  });

  it('每小时第 5 分钟回调 handleMetricsCollection 部分失败时记录 warn 日志', async () => {
    mockRecordAllMetrics.mockResolvedValueOnce({
      recorded: 3,
      failed: 2,
      failedNames: ['emergency_response_time', 'match_success_rate'],
    });

    initScheduler();
    const metricsCallback = mockCronCallbacks[6];
    await metricsCallback.callback();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        recorded: 3,
        failed: 2,
        failedNames: ['emergency_response_time', 'match_success_rate'],
      }),
      expect.stringContaining('指标采集部分失败'),
    );
  });

  it('每小时第 5 分钟回调 handleMetricsCollection 抛错时记录异常日志', async () => {
    mockRecordAllMetrics.mockRejectedValueOnce(new Error('指标采集内部错误'));

    initScheduler();
    const metricsCallback = mockCronCallbacks[6];
    await metricsCallback.callback();

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('指标采集异常'),
    );
  });
});

// ===================== handleMetricsCollection 专项测试 =====================

describe('scheduler - handleMetricsCollection', () => {
  it('全部成功时记录 info 日志', async () => {
    mockRecordAllMetrics.mockResolvedValueOnce({ recorded: 5, failed: 0, failedNames: [] });

    await handleMetricsCollection();

    expect(mockRecordAllMetrics).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ recorded: 5 }),
      expect.stringContaining('指标采集完成'),
    );
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('部分失败时记录 warn 日志含失败指标名', async () => {
    mockRecordAllMetrics.mockResolvedValueOnce({
      recorded: 3,
      failed: 2,
      failedNames: ['order_completion_rate', 'ai_recommendation_accuracy'],
    });

    await handleMetricsCollection();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        recorded: 3,
        failed: 2,
        failedNames: ['order_completion_rate', 'ai_recommendation_accuracy'],
      }),
      expect.stringContaining('指标采集部分失败'),
    );
  });

  it('recordAllMetrics 抛错时向上抛出（由 cron 回调的 try/catch 兜底）', async () => {
    mockRecordAllMetrics.mockRejectedValueOnce(new Error('DB 连接失败'));

    await expect(handleMetricsCollection()).rejects.toThrow('DB 连接失败');
  });
});
