/**
 * 技能订单并发下单测试用例
 *
 * 注意：本测试依赖 vitest 运行时与可用的测试数据库。
 * 当前项目尚未安装 vitest，请先执行以下命令安装依赖后再运行：
 *   cd server && npm install -D vitest
 *   cd server && npx vitest run src/services/__tests__/skill-order.concurrent.test.ts
 *
 * 测试目标：验证 createOrder 在并发场景下不会发生双花（余额超扣）。
 * 修复前：余额检查在事务外执行，并发请求可绕过校验导致超扣。
 * 修复后：余额检查移入事务并对买家行加 FOR UPDATE 行锁，并发请求串行化校验。
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool } from '../../config/database';
import { skillOrderService } from '../skill-order.service';
import { BadRequestError } from '../../utils/errors';

const TEST_BUYER_PHONE = '13900000001';
const TEST_SELLER_PHONE = '13900000002';
const TEST_PASSWORD_HASH = '$2a$10$testhashplaceholderforconcurrenttest';

describe('skill-order createOrder 并发防双花', () => {
  let buyerId: string;
  let sellerId: string;
  let postId: string;

  beforeAll(async () => {
    // 准备买家、卖家、技能帖子
    const buyer = await pool.query(
      `INSERT INTO users (phone, password_hash, nickname, credit_balance)
       VALUES ($1, $2, '并发测试买家', 100) RETURNING id`,
      [TEST_BUYER_PHONE, TEST_PASSWORD_HASH],
    );
    buyerId = buyer.rows[0].id;

    const seller = await pool.query(
      `INSERT INTO users (phone, password_hash, nickname, credit_balance)
       VALUES ($1, $2, '并发测试卖家', 100) RETURNING id`,
      [TEST_SELLER_PHONE, TEST_PASSWORD_HASH],
    );
    sellerId = seller.rows[0].id;

    const post = await pool.query(
      `INSERT INTO skill_posts (user_id, category, type, title, credit_price, status)
       VALUES ($1, '测试类目', 'offer', '并发测试帖子', 80, 'active') RETURNING id`,
      [sellerId],
    );
    postId = post.rows[0].id;
  });

  afterAll(async () => {
    // 清理测试数据
    await pool.query('DELETE FROM credit_transactions WHERE user_id = $1 OR user_id = $2', [buyerId, sellerId]);
    await pool.query('DELETE FROM skill_orders WHERE buyer_id = $1', [buyerId]);
    await pool.query('DELETE FROM skill_posts WHERE user_id = $1', [sellerId]);
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [buyerId, sellerId]);
    await pool.end();
  });

  beforeEach(async () => {
    // 每个用例前重置买家余额为 100（MIN_BALANCE=10，单价 80，仅够下一单：100-80=20>=10）
    await pool.query('UPDATE users SET credit_balance = 100 WHERE id = $1', [buyerId]);
  });

  it('并发发起 2 个订单时，仅 1 个成功，余额不超扣', async () => {
    // 买家余额 100，单价 80，扣减后 20 >= MIN_BALANCE(10)，仅允许一单
    // 第二单扣减后 20-80=-60 < MIN_BALANCE，应被拒绝
    const results = await Promise.allSettled([
      skillOrderService.createOrder(buyerId, postId),
      skillOrderService.createOrder(buyerId, postId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].reason).toBeInstanceOf(BadRequestError);

    // 校验最终余额：仅扣减一次
    const balanceResult = await pool.query(
      'SELECT credit_balance FROM users WHERE id = $1',
      [buyerId],
    );
    expect(balanceResult.rows[0].credit_balance).toBe(20);
  });

  it('并发发起 5 个订单时，至多 1 个成功，余额不为负', async () => {
    const results = await Promise.allSettled([
      skillOrderService.createOrder(buyerId, postId),
      skillOrderService.createOrder(buyerId, postId),
      skillOrderService.createOrder(buyerId, postId),
      skillOrderService.createOrder(buyerId, postId),
      skillOrderService.createOrder(buyerId, postId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(4);

    const balanceResult = await pool.query(
      'SELECT credit_balance FROM users WHERE id = $1',
      [buyerId],
    );
    // 余额应等于 100 - 80 = 20，不为负
    expect(balanceResult.rows[0].credit_balance).toBe(20);
    expect(balanceResult.rows[0].credit_balance).toBeGreaterThanOrEqual(0);
  });

  it('余额刚好满足时，并发下单仅 1 个成功', async () => {
    // 设置余额为 90：90-80=10 >= MIN_BALANCE(10)，仅允许一单
    await pool.query('UPDATE users SET credit_balance = 90 WHERE id = $1', [buyerId]);

    const results = await Promise.allSettled([
      skillOrderService.createOrder(buyerId, postId),
      skillOrderService.createOrder(buyerId, postId),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const balanceResult = await pool.query(
      'SELECT credit_balance FROM users WHERE id = $1',
      [buyerId],
    );
    expect(balanceResult.rows[0].credit_balance).toBe(10);
  });
});
