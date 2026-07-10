/**
 * time-bank.service donateTime 单元测试
 *
 * 测试目标：
 * - 校验失败场景（同 user / 非正整数 / 余额不足 / 用户不存在）
 * - 成功场景：双账户与双 users 余额更新、捐赠流水写入
 * - 语义差异：捐赠不计入 to_user 的 total_earned（避免污染 DAILY_EARN_LIMIT）
 *
 * 测试策略：mock database 模块，transaction 直接回调注入的 mock client，
 *           按 SQL 文本匹配返回值，验证调用顺序与参数正确性。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock client：在 transaction 回调内注入，记录所有 SQL 调用
const mockClient = {
  query: vi.fn(),
};

vi.mock('../../config/database', () => ({
  query: vi.fn(),
  // transaction 直接以 mockClient 回调，模拟事务执行
  transaction: vi.fn((cb: (client: typeof mockClient) => Promise<any>) => cb(mockClient)),
  pool: {},
}));

// mock reputation.service，避免 donateTime 间接依赖被触发
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
import { notificationService } from '../notification.service';
import { BadRequestError, ValidationError, InsufficientCreditError, NotFoundError } from '../../utils/errors';

const mockedNotifyTimeBankTransaction = vi.mocked(notificationService.notifyTimeBankTransaction);

beforeEach(() => {
  mockClient.query.mockReset();
  mockedNotifyTimeBankTransaction.mockReset();
  // mockResolvedValue 需要 NotificationData 形状，用双重断言替代裸 any 以满足类型约束
  mockedNotifyTimeBankTransaction.mockResolvedValue({} as unknown as Awaited<ReturnType<typeof notificationService.notifyTimeBankTransaction>>);
});

/**
 * 构造 mock client.query 实现：按 SQL 文本匹配返回相应数据。
 * - SELECT id, time_balance, nickname FROM users WHERE id = $1 FOR UPDATE → 返回用户余额+昵称行
 * - SELECT * FROM time_accounts WHERE user_id = $1 FOR UPDATE → 返回账户行
 * - 其余 UPDATE / INSERT 返回空 rows
 *
 * 通过 userState 控制加锁时的返回值，accountState 控制账户是否存在。
 * nickname 用于通知文案断言，未指定时默认为 '昵称-{id}'。
 */
function setupMockClient(opts: {
  users: Record<string, { timeBalance: number; exists: boolean; nickname?: string }>;
  accounts?: Record<string, { balance: number; exists: boolean }>;
}) {
  const userState: Record<string, number> = {};
  const userNicknames: Record<string, string> = {};
  for (const [id, info] of Object.entries(opts.users)) {
    if (info.exists) {
      userState[id] = info.timeBalance;
      // 昵称默认值便于通知断言，测试可显式传入覆盖
      userNicknames[id] = info.nickname ?? `昵称-${id}`;
    }
  }
  const accountState: Record<string, number> = {};
  for (const [id, info] of Object.entries(opts.accounts || {})) {
    if (info.exists) accountState[id] = info.balance;
  }

  mockClient.query.mockImplementation(async (text: string, params: any[] = []) => {
    // users 行锁查询：SELECT id, time_balance, nickname FROM users WHERE id = $1 FOR UPDATE
    if (text.includes('SELECT id, time_balance, nickname FROM users WHERE id = $1 FOR UPDATE')) {
      const id = params[0];
      if (userState[id] !== undefined) {
        return { rows: [{ id, time_balance: userState[id], nickname: userNicknames[id] }] };
      }
      return { rows: [] };
    }
    // time_accounts 行锁查询
    if (text.includes('SELECT * FROM time_accounts WHERE user_id = $1 FOR UPDATE')) {
      const userId = params[0];
      if (accountState[userId] !== undefined) {
        return { rows: [{ user_id: userId, balance: accountState[userId] }] };
      }
      return { rows: [] };
    }
    // getOrCreateAccount 在账户不存在时 INSERT，模拟返回新账户
    if (text.startsWith('INSERT INTO time_accounts')) {
      const userId = params[0];
      accountState[userId] = 0;
      return { rows: [{ user_id: userId, balance: 0 }] };
    }
    // from_user 扣减余额（users 表）
    if (text.startsWith('UPDATE users SET time_balance = time_balance - $1')) {
      const id = params[1];
      userState[id] = (userState[id] || 0) - params[0];
      return { rows: [] };
    }
    // to_user 增加余额（users 表）
    if (text.startsWith('UPDATE users SET time_balance = time_balance + $1')) {
      const id = params[1];
      userState[id] = (userState[id] || 0) + params[0];
      return { rows: [] };
    }
    // from_user 账户扣减
    if (text.startsWith('UPDATE time_accounts SET balance = balance - $1, total_spent')) {
      const userId = params[1];
      accountState[userId] = (accountState[userId] || 0) - params[0];
      return { rows: [] };
    }
    // to_user 账户增加（注意：donate 中不更新 total_earned）
    if (text.startsWith('UPDATE time_accounts SET balance = balance + $1, updated_at')) {
      const userId = params[1];
      accountState[userId] = (accountState[userId] || 0) + params[0];
      return { rows: [] };
    }
    // 流水插入
    if (text.startsWith('INSERT INTO time_transactions')) {
      return { rows: [] };
    }
    return { rows: [] };
  });

  return { userState, accountState, userNicknames };
}

describe('time-bank.service - donateTime', () => {
  it('不能向自己捐赠 → BadRequestError', async () => {
    await expect(
      timeBankService.donateTime('user-a', 'user-a', 10),
    ).rejects.toThrow(BadRequestError);
  });

  it('捐赠金额为 0 → ValidationError', async () => {
    await expect(
      timeBankService.donateTime('user-a', 'user-b', 0),
    ).rejects.toThrow(ValidationError);
  });

  it('捐赠金额为负数 → ValidationError', async () => {
    await expect(
      timeBankService.donateTime('user-a', 'user-b', -5),
    ).rejects.toThrow(ValidationError);
  });

  it('捐赠金额为浮点数 → ValidationError', async () => {
    await expect(
      timeBankService.donateTime('user-a', 'user-b', 10.5),
    ).rejects.toThrow(ValidationError);
  });

  it('from_user 不存在 → NotFoundError', async () => {
    setupMockClient({
      users: {
        'user-a': { timeBalance: 100, exists: false },
        'user-b': { timeBalance: 0, exists: true },
      },
    });
    await expect(
      timeBankService.donateTime('user-a', 'user-b', 10),
    ).rejects.toThrow(NotFoundError);
  });

  it('to_user 不存在 → NotFoundError', async () => {
    setupMockClient({
      users: {
        'user-a': { timeBalance: 100, exists: true },
        'user-b': { timeBalance: 0, exists: false },
      },
    });
    await expect(
      timeBankService.donateTime('user-a', 'user-b', 10),
    ).rejects.toThrow(NotFoundError);
  });

  it('users.time_balance 余额不足 → InsufficientCreditError', async () => {
    setupMockClient({
      users: {
        'user-a': { timeBalance: 5, exists: true },
        'user-b': { timeBalance: 0, exists: true },
      },
      accounts: {
        'user-a': { balance: 100, exists: true },
        'user-b': { balance: 0, exists: true },
      },
    });
    await expect(
      timeBankService.donateTime('user-a', 'user-b', 10),
    ).rejects.toThrow(InsufficientCreditError);
  });

  it('time_accounts.balance 余额不足 → InsufficientCreditError', async () => {
    // users.time_balance 充足，但 time_accounts.balance 不足（双账本不一致场景）
    setupMockClient({
      users: {
        'user-a': { timeBalance: 100, exists: true },
        'user-b': { timeBalance: 0, exists: true },
      },
      accounts: {
        'user-a': { balance: 5, exists: true },
        'user-b': { balance: 0, exists: true },
      },
    });
    await expect(
      timeBankService.donateTime('user-a', 'user-b', 10),
    ).rejects.toThrow(InsufficientCreditError);
  });

  it('捐赠成功：from_user 扣减、to_user 增加、流水写入 type=donate', async () => {
    const { userState, accountState } = setupMockClient({
      users: {
        'user-a': { timeBalance: 100, exists: true },
        'user-b': { timeBalance: 0, exists: true },
      },
      accounts: {
        'user-a': { balance: 100, exists: true },
        'user-b': { balance: 0, exists: true },
      },
    });

    const result = await timeBankService.donateTime('user-a', 'user-b', 30, '感谢帮助');

    expect(result).toEqual({ fromUserId: 'user-a', toUserId: 'user-b', amount: 30 });
    // 双账本一致：from_user 减 30、to_user 加 30
    expect(userState['user-a']).toBe(70);
    expect(userState['user-b']).toBe(30);
    expect(accountState['user-a']).toBe(70);
    expect(accountState['user-b']).toBe(30);

    // 验证流水写入：INSERT INTO time_transactions ... 'donate' ...
    const insertCall = mockClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].startsWith('INSERT INTO time_transactions') && call[0].includes("'donate'"),
    );
    expect(insertCall).toBeDefined();
    // 参数顺序：from_user_id, to_user_id, amount, type, status, remark → $1..$4 对应前 4 个
    expect(insertCall![1]).toEqual(['user-a', 'user-b', 30, '感谢帮助']);

    // 验证通知调用：应携带发送方昵称，让接收方知道是谁捐赠的
    // 昵称复用 lockUsersForUpdate 的锁查询，零额外查库
    expect(mockedNotifyTimeBankTransaction).toHaveBeenCalledWith(
      'user-b',           // toUserId
      undefined,          // transactionId（不查流水，落 null）
      'donate',           // transactionType
      30,                 // amount
      '昵称-user-a',      // fromNickname（默认值，测试未显式传入）
    );
  });

  it('捐赠成功：from_user 昵称为空字符串时通知传 undefined（兜底"一位用户"）', async () => {
    setupMockClient({
      users: {
        // nickname 显式传空字符串，模拟用户未设置昵称
        'user-a': { timeBalance: 100, exists: true, nickname: '' },
        'user-b': { timeBalance: 0, exists: true },
      },
      accounts: {
        'user-a': { balance: 100, exists: true },
        'user-b': { balance: 0, exists: true },
      },
    });

    await timeBankService.donateTime('user-a', 'user-b', 10);

    // 空昵称应转为 undefined，由通知服务层兜底为"一位用户"
    expect(mockedNotifyTimeBankTransaction).toHaveBeenCalledWith(
      'user-b',
      undefined,
      'donate',
      10,
      undefined,
    );
  });

  it('捐赠成功：to_user 的账户更新 SQL 不包含 total_earned（不污染日收益上限）', async () => {
    setupMockClient({
      users: {
        'user-a': { timeBalance: 100, exists: true },
        'user-b': { timeBalance: 0, exists: true },
      },
      accounts: {
        'user-a': { balance: 100, exists: true },
        'user-b': { balance: 0, exists: true },
      },
    });

    await timeBankService.donateTime('user-a', 'user-b', 20);

    // 找到更新 to_user 账户的 SQL（balance + $1 但不含 total_earned）
    const toUserUpdateCall = mockClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].startsWith('UPDATE time_accounts SET balance = balance + $1, updated_at'),
    );
    expect(toUserUpdateCall).toBeDefined();
    expect(toUserUpdateCall![0]).not.toContain('total_earned');
  });

  it('捐赠成功：from_user 的账户更新 SQL 包含 total_spent', async () => {
    setupMockClient({
      users: {
        'user-a': { timeBalance: 100, exists: true },
        'user-b': { timeBalance: 0, exists: true },
      },
      accounts: {
        'user-a': { balance: 100, exists: true },
        'user-b': { balance: 0, exists: true },
      },
    });

    await timeBankService.donateTime('user-a', 'user-b', 20);

    const fromUserUpdateCall = mockClient.query.mock.calls.find(
      (call: any[]) => typeof call[0] === 'string' && call[0].startsWith('UPDATE time_accounts SET balance = balance - $1, total_spent'),
    );
    expect(fromUserUpdateCall).toBeDefined();
  });

  it('捐赠成功：双方 users 行按 id 排序加锁（避免死锁）', async () => {
    // fromUserId='user-b', toUserId='user-a'，但加锁顺序应为 ['user-a', 'user-b']
    setupMockClient({
      users: {
        'user-a': { timeBalance: 0, exists: true },
        'user-b': { timeBalance: 100, exists: true },
      },
      accounts: {
        'user-a': { balance: 0, exists: true },
        'user-b': { balance: 100, exists: true },
      },
    });

    await timeBankService.donateTime('user-b', 'user-a', 20);

    // 找到两次 FOR UPDATE 加锁调用的参数顺序
    const lockCalls = mockClient.query.mock.calls.filter(
      (call: any[]) => typeof call[0] === 'string' && call[0].includes('SELECT id, time_balance, nickname FROM users WHERE id = $1 FOR UPDATE'),
    );
    expect(lockCalls.length).toBe(2);
    // 排序后应为 user-a 在前、user-b 在后
    expect(lockCalls[0][1]).toEqual(['user-a']);
    expect(lockCalls[1][1]).toEqual(['user-b']);
  });
});
