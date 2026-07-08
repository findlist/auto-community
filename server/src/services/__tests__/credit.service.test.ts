/**
 * credit.service 单元测试
 *
 * 测试目标：覆盖 freezeCredits / settleCredits / unfreezeCredits / deductCredits / earnCredits
 * 测试策略：使用 vitest mock 替换 database 模块（避免触发 env 校验与真实 DB 连接），
 *           事务内函数接收的 client 参数也以 mock 对象注入，验证 SQL 与余额计算逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块：query 用于 checkBalance/getCreditBalance，transaction 在本测试中不直接使用
vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: {},
}));

import { creditService } from '../credit.service';
import { query } from '../../config/database';
import { InsufficientCreditError } from '../../utils/errors';

// 构造一个 mock 事务 client：query 返回值可按需配置
function createMockClient(initialBalance: number) {
  let balance = initialBalance;
  const calls: string[] = [];
  const client = {
    balance,
    // 记录所有 SQL 调用，便于断言
    async query(text: string, params: any[] = []) {
      calls.push(text);
      // SELECT ... FOR UPDATE 返回当前余额
      if (text.includes('SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE')) {
        return { rows: [{ credit_balance: balance }] };
      }
      // SELECT credit_balance（settleCredits 中读取买家余额）
      if (text.includes('SELECT credit_balance FROM users WHERE id = $1')) {
        return { rows: [{ credit_balance: balance }] };
      }
      // UPDATE 扣减
      if (text.startsWith('UPDATE users SET credit_balance = credit_balance - $1')) {
        balance = balance - params[0];
        return { rows: [] };
      }
      // UPDATE 增加（带 RETURNING）
      if (text.startsWith('UPDATE users SET credit_balance = credit_balance + $1')) {
        balance = balance + params[0];
        return { rows: [{ credit_balance: balance }] };
      }
      // INSERT 流水
      if (text.startsWith('INSERT INTO credit_transactions')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    getCalls() {
      return calls;
    },
    getBalance() {
      return balance;
    },
    setBalance(v: number) {
      balance = v;
    },
  };
  return client;
}

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('credit.service - freezeCredits', () => {
  it('余额充足时扣减并记录 freeze 流水', async () => {
    const client = createMockClient(100);
    const result = await creditService.freezeCredits(
      client as any,
      'user-1',
      30,
      '测试冻结',
      'order-1',
      'skill_order',
    );

    // 返回扣减后的余额
    expect(result.balance).toBe(70);
    // 内部余额应同步更新
    expect(client.getBalance()).toBe(70);
    // 应包含 SELECT FOR UPDATE / UPDATE / INSERT 三类语句
    const calls = client.getCalls();
    expect(calls.some((s) => s.includes('FOR UPDATE'))).toBe(true);
    expect(calls.some((s) => s.startsWith('UPDATE users SET credit_balance = credit_balance - $1'))).toBe(true);
    expect(calls.some((s) => s.startsWith('INSERT INTO credit_transactions'))).toBe(true);
  });

  it('扣减后低于 MIN_BALANCE 应抛 InsufficientCreditError', async () => {
    // 余额 30，冻结 30 后 = 0 < MIN_BALANCE(10)
    const client = createMockClient(30);
    await expect(
      creditService.freezeCredits(client as any, 'user-1', 30, '测试冻结'),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
  });

  it('冻结金额超过余额应抛 InsufficientCreditError', async () => {
    const client = createMockClient(20);
    await expect(
      creditService.freezeCredits(client as any, 'user-1', 50, '测试冻结'),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
  });

  it('未传 relatedOrderId 时 INSERT 流水中 reference_id 应为 null', async () => {
    const client = createMockClient(100);
    // 通过 spy 拦截 INSERT 调用，校验参数
    const insertSpy = vi.spyOn(client, 'query');
    await creditService.freezeCredits(client as any, 'user-1', 30, '无订单关联');
    const insertCall = insertSpy.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.startsWith('INSERT INTO credit_transactions'),
    );
    expect(insertCall).toBeDefined();
    // 参数顺序：[userId, -amount, newBalance, relatedOrderId, referenceType, reason]
    // insertCall[1] 是 params 数组（可选参数，需断言非空）
    const insertParams = insertCall![1] as any[];
    expect(insertParams[3]).toBeNull();
  });
});

describe('credit.service - unfreezeCredits', () => {
  it('解冻应增加余额并记录 unfreeze 流水', async () => {
    const client = createMockClient(70);
    const result = await creditService.unfreezeCredits(
      client as any,
      'user-1',
      30,
      '测试解冻',
      'order-1',
    );

    expect(result.balance).toBe(100);
    expect(client.getBalance()).toBe(100);
    // INSERT 流水中 type 应为 unfreeze
    const calls = client.getCalls();
    const insertSql = calls.find((s) => s.startsWith('INSERT INTO credit_transactions'));
    expect(insertSql).toContain("'unfreeze'");
  });
});

describe('credit.service - settleCredits', () => {
  it('结算：买家记录 spend 流水，卖家余额增加并记录 earn 流水', async () => {
    // 用两个独立 client 模拟事务中分别对 buyer / seller 的查询
    // settleCredits 内部使用同一 client 顺序执行，需根据 SQL 区分返回值
    const buyerBalance = 70;
    let sellerBalance = 50;
    const calls: string[] = [];
    const client = {
      async query(text: string, params: any[] = []) {
        calls.push(text);
        // 读取买家余额
        if (text === 'SELECT credit_balance FROM users WHERE id = $1' && params[0] === 'buyer-1') {
          return { rows: [{ credit_balance: buyerBalance }] };
        }
        // 卖家余额增加（带 RETURNING）
        if (text.startsWith('UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2 RETURNING credit_balance')) {
          sellerBalance = sellerBalance + params[0];
          return { rows: [{ credit_balance: sellerBalance }] };
        }
        return { rows: [] };
      },
      getCalls() {
        return calls;
      },
      getBuyerBalance() {
        return buyerBalance;
      },
      getSellerBalance() {
        return sellerBalance;
      },
    };

    const result = await creditService.settleCredits(
      client as any,
      'buyer-1',
      'seller-1',
      30,
      'order-1',
      'order',
    );

    // 卖家余额应增加 30
    expect(result.sellerBalance).toBe(80);
    expect(client.getSellerBalance()).toBe(80);
    // 应包含 spend 与 earn 两类流水
    const insertSqls = calls.filter((s) => s.startsWith('INSERT INTO credit_transactions'));
    expect(insertSqls.some((s) => s.includes("'spend'"))).toBe(true);
    expect(insertSqls.some((s) => s.includes("'earn'"))).toBe(true);
  });
});

describe('credit.service - deductCredits', () => {
  it('余额充足时扣减并记录 spend 流水', async () => {
    const client = createMockClient(100);
    const result = await creditService.deductCredits(
      client as any,
      'user-1',
      30,
      '测试扣减',
      'order-1',
    );
    expect(result.balance).toBe(70);
  });

  it('余额不足且不允许负数时应抛 InsufficientCreditError', async () => {
    const client = createMockClient(20);
    await expect(
      creditService.deductCredits(client as any, 'user-1', 50, '测试扣减'),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
  });

  it('allowNegative=true 时允许扣到负数（用于卖家负债扣回）', async () => {
    const client = createMockClient(20);
    const result = await creditService.deductCredits(
      client as any,
      'user-1',
      50,
      '负债扣回',
      'order-1',
      'skill_order',
      true,
    );
    expect(result.balance).toBe(-30);
  });
});

describe('credit.service - earnCredits', () => {
  it('增加余额并记录 earn 流水', async () => {
    const client = createMockClient(100);
    const result = await creditService.earnCredits(
      client as any,
      'user-1',
      50,
      '测试增加',
      'group-order-1',
      'group_order',
    );
    expect(result.balance).toBe(150);
  });
});

describe('credit.service - checkBalance / getCreditBalance', () => {
  it('checkBalance 返回余额与充足性标志', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ credit_balance: 100 }] } as any);
    const result = await creditService.checkBalance('user-1', 30);
    expect(result.available).toBe(100);
    // 100 - 30 = 70 >= MIN_BALANCE(10)
    expect(result.sufficient).toBe(true);
  });

  it('checkBalance 扣减后低于 MIN_BALANCE 时 sufficient=false', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ credit_balance: 30 }] } as any);
    const result = await creditService.checkBalance('user-1', 30);
    // 30 - 30 = 0 < MIN_BALANCE(10)
    expect(result.sufficient).toBe(false);
  });

  it('getCreditBalance 返回当前积分余额', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ credit_balance: 250 }] } as any);
    const result = await creditService.getCreditBalance('user-1');
    expect(result.creditBalance).toBe(250);
  });
});
