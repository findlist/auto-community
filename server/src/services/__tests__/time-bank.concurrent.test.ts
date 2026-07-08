/**
 * 时间银行 transferTime 并发防超扣测试用例
 *
 * 注意：本测试依赖 vitest 运行时与可用的测试数据库。
 * 当前项目尚未安装 vitest，请先执行以下命令安装依赖后再运行：
 *   cd server && npm install -D vitest
 *   cd server && npx vitest run src/services/__tests__/time-bank.concurrent.test.ts
 *
 * 测试目标：验证 transferTime 在并发场景下不会发生超扣（time_balance 不为负）。
 * 修复前：users.time_balance 行未加 FOR UPDATE 行锁，并发请求可绕过余额校验导致超扣。
 * 修复后：事务内对双方 users 行按 id 排序加 FOR UPDATE 行锁，并发请求串行化校验。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { pool } from '../../config/database';
import { timeBankService } from '../time-bank.service';
import { BadRequestError } from '../../utils/errors';

const TEST_FROM_PHONE = '13900001001';
const TEST_TO_PHONE_PREFIX = '139000010';
const TEST_PASSWORD_HASH = '$2a$10$testhashplaceholderforconcurrenttest';

describe('time-bank transferTime 并发防超扣', () => {
  let fromUserId: string;
  const toUserIds: string[] = [];

  beforeAll(async () => {
    // 准备转账发起人：初始 time_balance = 100
    const fromUser = await pool.query(
      `INSERT INTO users (phone, password_hash, nickname, time_balance)
       VALUES ($1, $2, '并发测试发起人', 100) RETURNING id`,
      [TEST_FROM_PHONE, TEST_PASSWORD_HASH],
    );
    fromUserId = fromUser.rows[0].id;

    // 准备 5 个接收人
    for (let i = 2; i <= 6; i++) {
      const phone = `${TEST_TO_PHONE_PREFIX}${i}`;
      const toUser = await pool.query(
        `INSERT INTO users (phone, password_hash, nickname, time_balance)
         VALUES ($1, $2, $3, 0) RETURNING id`,
        [phone, TEST_PASSWORD_HASH, `并发测试接收人${i}`],
      );
      toUserIds.push(toUser.rows[0].id);
    }
  });

  afterAll(async () => {
    // 清理测试数据：按外键依赖顺序删除
    const allUserIds = [fromUserId, ...toUserIds];
    await pool.query('DELETE FROM time_transactions WHERE from_user_id = ANY($1) OR to_user_id = ANY($1)', [allUserIds]);
    await pool.query('DELETE FROM time_accounts WHERE user_id = ANY($1)', [allUserIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [allUserIds]);
    await pool.end();
  });

  beforeEach(async () => {
    // 每个用例前重置发起人 time_balance 为 100
    await pool.query('UPDATE users SET time_balance = 100 WHERE id = $1', [fromUserId]);
    // 重置接收人 time_balance 为 0
    await pool.query('UPDATE users SET time_balance = 0 WHERE id = ANY($1)', [toUserIds]);
    // 同步重置 time_accounts
    await pool.query('UPDATE time_accounts SET balance = 100, total_earned = 0, total_spent = 0 WHERE user_id = $1', [fromUserId]);
    await pool.query('UPDATE time_accounts SET balance = 0, total_earned = 0, total_spent = 0 WHERE user_id = ANY($1)', [toUserIds]);
  });

  it('并发发起 3 笔转账（每笔 60），余额 100，仅 1 个成功，余额不超扣', async () => {
    // 发起人余额 100，每笔转 60，仅第一笔能成功（100-60=40 < 60）
    const results = await Promise.allSettled([
      timeBankService.transferTime(fromUserId, toUserIds[0], 60, '并发转账1'),
      timeBankService.transferTime(fromUserId, toUserIds[1], 60, '并发转账2'),
      timeBankService.transferTime(fromUserId, toUserIds[2], 60, '并发转账3'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestError);

    // 校验最终 users.time_balance：仅扣减一次，不为负
    const balanceResult = await pool.query(
      'SELECT time_balance FROM users WHERE id = $1',
      [fromUserId],
    );
    expect(balanceResult.rows[0].time_balance).toBe(40);
    expect(balanceResult.rows[0].time_balance).toBeGreaterThanOrEqual(0);
  });

  it('并发发起 2 笔转账（每笔 50），余额 100，2 个均成功，余额为 0', async () => {
    // 发起人余额 100，每笔转 50，两笔都能成功（100-50-50=0）
    const results = await Promise.allSettled([
      timeBankService.transferTime(fromUserId, toUserIds[0], 50, '并发转账A'),
      timeBankService.transferTime(fromUserId, toUserIds[1], 50, '并发转账B'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(0);

    const balanceResult = await pool.query(
      'SELECT time_balance FROM users WHERE id = $1',
      [fromUserId],
    );
    expect(balanceResult.rows[0].time_balance).toBe(0);
  });

  it('并发发起 5 笔转账（每笔 30），余额 100，至多 3 个成功，余额不为负', async () => {
    // 发起人余额 100，每笔转 30，最多 3 笔成功（100-30*3=10 < 30）
    const results = await Promise.allSettled([
      timeBankService.transferTime(fromUserId, toUserIds[0], 30, '并发转账T1'),
      timeBankService.transferTime(fromUserId, toUserIds[1], 30, '并发转账T2'),
      timeBankService.transferTime(fromUserId, toUserIds[2], 30, '并发转账T3'),
      timeBankService.transferTime(fromUserId, toUserIds[3], 30, '并发转账T4'),
      timeBankService.transferTime(fromUserId, toUserIds[4], 30, '并发转账T5'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // 至多 3 个成功（100/30=3 余 10），至少 2 个失败
    expect(fulfilled.length).toBeLessThanOrEqual(3);
    expect(rejected.length).toBeGreaterThanOrEqual(2);

    const balanceResult = await pool.query(
      'SELECT time_balance FROM users WHERE id = $1',
      [fromUserId],
    );
    // 余额应等于 100 - 30 * fulfilled.length，且不为负
    const expectedBalance = 100 - 30 * fulfilled.length;
    expect(balanceResult.rows[0].time_balance).toBe(expectedBalance);
    expect(balanceResult.rows[0].time_balance).toBeGreaterThanOrEqual(0);
  });

  it('并发对同一接收人转账 2 笔（每笔 60），余额 100，仅 1 个成功', async () => {
    // 发起人余额 100，向同一接收人转 60，仅第一笔能成功
    const results = await Promise.allSettled([
      timeBankService.transferTime(fromUserId, toUserIds[0], 60, '同接收人转账1'),
      timeBankService.transferTime(fromUserId, toUserIds[0], 60, '同接收人转账2'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const balanceResult = await pool.query(
      'SELECT time_balance FROM users WHERE id = $1',
      [fromUserId],
    );
    expect(balanceResult.rows[0].time_balance).toBe(40);

    // 接收人仅收到一笔 60
    const toBalanceResult = await pool.query(
      'SELECT time_balance FROM users WHERE id = $1',
      [toUserIds[0]],
    );
    expect(toBalanceResult.rows[0].time_balance).toBe(60);
  });
});
