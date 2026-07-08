import { PoolClient } from 'pg';
import { query } from '../config/database';
import { InsufficientCreditError } from '../utils/errors';
import { MIN_BALANCE } from '../config/constants';

// 设计原因：原 client: any 让调用方误传 pool/普通对象都能编译通过，
// 收紧为 PoolClient 后，编译期即可校验 client 具有 query 方法及事务语义，
// 与 database.ts 中 transaction(callback: (client: PoolClient) => Promise<T>) 签名对齐
/**
 * 冻结积分（在调用方事务内执行）
 * 行锁防双花：通过 SELECT ... FOR UPDATE 锁定用户行，确保并发请求串行化校验余额
 *
 * @param client 调用方事务中的 pg client
 * @param userId 用户 id
 * @param amount 冻结金额（正数）
 * @param reason 流水描述
 * @param relatedOrderId 关联订单 id（可选）
 * @param referenceType 流水关联类型（可选，默认 'skill_order'）
 */
async function freezeCredits(
  client: PoolClient,
  userId: string,
  amount: number,
  reason: string,
  relatedOrderId?: string,
  referenceType: string = 'skill_order',
) {
  // 行锁防双花：加 FOR UPDATE 锁定买家行，确保并发请求串行化校验余额
  const { rows } = await client.query(
    'SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );

  const creditBalance = rows[0].credit_balance;
  // 事务内重新校验余额：扣减后不得低于保护余额
  if (creditBalance < amount || creditBalance - amount < MIN_BALANCE) {
    throw new InsufficientCreditError('积分余额不足');
  }

  const newBalance = creditBalance - amount;
  await client.query(
    'UPDATE users SET credit_balance = credit_balance - $1 WHERE id = $2',
    [amount, userId],
  );
  await client.query(
    `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
     VALUES ($1, 'freeze', $2, $3, $4, $5, $6)`,
    [userId, -amount, newBalance, relatedOrderId ?? null, referenceType, reason],
  );

  return { balance: newBalance };
}

/**
 * 解冻积分（在调用方事务内执行）
 * 用于订单取消/拒绝等场景，将冻结的积分退还给用户
 *
 * @param client 调用方事务中的 pg client
 * @param userId 用户 id
 * @param amount 解冻金额（正数）
 * @param reason 流水描述
 * @param relatedOrderId 关联订单 id（可选）
 * @param referenceType 流水关联类型（可选，默认 'skill_order'）
 */
async function unfreezeCredits(
  client: PoolClient,
  userId: string,
  amount: number,
  reason: string,
  relatedOrderId?: string,
  referenceType: string = 'skill_order',
) {
  // 行锁：退款前锁定用户行，确保退款操作在事务内串行化
  const { rows } = await client.query(
    'SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );

  const newBalance = rows[0].credit_balance + amount;
  await client.query(
    'UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2',
    [amount, userId],
  );
  await client.query(
    `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
     VALUES ($1, 'unfreeze', $2, $3, $4, $5, $6)`,
    [userId, amount, newBalance, relatedOrderId ?? null, referenceType, reason],
  );

  return { balance: newBalance };
}

/**
 * 结算积分（在调用方事务内执行）
 * 用于订单完成场景：买家记录支出流水，卖家增加余额并记录收入流水
 * 注意：买家余额在 freeze 阶段已扣减，此处不再扣减买家余额，仅记录 spend 流水
 *
 * @param client 调用方事务中的 pg client
 * @param buyerId 买家 id
 * @param sellerId 卖家 id
 * @param amount 结算金额（正数）
 * @param referenceId 关联订单 id
 * @param referenceType 流水关联类型（可选，默认 'order'）
 */
async function settleCredits(
  client: PoolClient,
  buyerId: string,
  sellerId: string,
  amount: number,
  referenceId: string,
  referenceType: string = 'order',
) {
  // buyer 余额在 freeze 时已扣减，此处仅记录支出流水
  const buyerBalanceResult = await client.query(
    'SELECT credit_balance FROM users WHERE id = $1',
    [buyerId],
  );
  await client.query(
    `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
     VALUES ($1, 'spend', $2, $3, $4, $5, $6)`,
    [buyerId, -amount, buyerBalanceResult.rows[0].credit_balance, referenceId, referenceType, '订单支付'],
  );

  // seller 增加余额并记录收入流水
  const { rows } = await client.query(
    'UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2 RETURNING credit_balance',
    [amount, sellerId],
  );
  const sellerNewBalance = rows[0].credit_balance;
  await client.query(
    `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
     VALUES ($1, 'earn', $2, $3, $4, $5, $6)`,
    [sellerId, amount, sellerNewBalance, referenceId, referenceType, '订单收入'],
  );

  return { sellerBalance: sellerNewBalance };
}

/**
 * 扣减积分（在调用方事务内执行）
 * 用于订单取消后扣回卖家已收入积分等场景
 *
 * @param client 调用方事务中的 pg client
 * @param userId 用户 id
 * @param amount 扣减金额（正数）
 * @param reason 流水描述
 * @param relatedOrderId 关联订单 id（可选）
 * @param referenceType 流水关联类型（可选，默认 'skill_order'）
 * @param allowNegative 是否允许余额为负（可选，默认 false）
 */
async function deductCredits(
  client: PoolClient,
  userId: string,
  amount: number,
  reason: string,
  relatedOrderId?: string,
  referenceType: string = 'skill_order',
  allowNegative: boolean = false,
) {
  // 行锁：扣减前锁定用户行，确保操作在事务内串行化
  const { rows } = await client.query(
    'SELECT credit_balance FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );

  const currentBalance = rows[0].credit_balance;
  // 不允许负余额时，校验扣减后余额是否足够
  if (!allowNegative && currentBalance < amount) {
    throw new InsufficientCreditError('积分余额不足');
  }

  const newBalance = currentBalance - amount;
  await client.query(
    'UPDATE users SET credit_balance = credit_balance - $1 WHERE id = $2',
    [amount, userId],
  );
  await client.query(
    `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
     VALUES ($1, 'spend', $2, $3, $4, $5, $6)`,
    [userId, -amount, newBalance, relatedOrderId ?? null, referenceType, reason],
  );

  return { balance: newBalance };
}

/**
 * 增加积分（在调用方事务内执行）
 * 用于拼单结算等场景：仅给目标用户增加余额并记录 earn 流水，不涉及买家扣减
 *
 * @param client 调用方事务中的 pg client
 * @param userId 用户 id
 * @param amount 增加金额（正数）
 * @param reason 流水描述
 * @param relatedOrderId 关联订单 id（可选）
 * @param referenceType 流水关联类型（可选，默认 'group_order'）
 */
async function earnCredits(
  client: PoolClient,
  userId: string,
  amount: number,
  reason: string,
  relatedOrderId?: string,
  referenceType: string = 'group_order',
) {
  const { rows } = await client.query(
    'UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2 RETURNING credit_balance',
    [amount, userId],
  );
  const newBalance = rows[0].credit_balance;
  await client.query(
    `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
     VALUES ($1, 'earn', $2, $3, $4, $5, $6)`,
    [userId, amount, newBalance, relatedOrderId ?? null, referenceType, reason],
  );

  return { balance: newBalance };
}

async function checkBalance(userId: string, amount: number) {
  const { rows } = await query(
    'SELECT credit_balance FROM users WHERE id = $1',
    [userId],
  );

  const creditBalance = rows[0].credit_balance;
  return {
    available: creditBalance,
    sufficient: creditBalance >= amount && creditBalance - amount >= MIN_BALANCE,
  };
}

async function getCreditBalance(userId: string) {
  const { rows } = await query(
    'SELECT credit_balance FROM users WHERE id = $1',
    [userId],
  );

  return { creditBalance: rows[0].credit_balance };
}

export const creditService = {
  freezeCredits,
  unfreezeCredits,
  settleCredits,
  deductCredits,
  earnCredits,
  checkBalance,
  getCreditBalance,
};
