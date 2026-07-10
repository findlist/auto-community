import { query, transaction, SqlParam } from '../config/database';
import { PoolClient, QueryResultRow } from 'pg';
import {
  BadRequestError,
  NotFoundError,
  ValidationError,
  InsufficientCreditError,
  OrderStatusInvalidError,
  PermissionDeniedError,
} from '../utils/errors';
import { idempotency } from '../utils/idempotency';
import { createPaginatedResponse, createCursorPaginatedResponse, CursorPaginatedResponse } from '../utils/pagination';
import { reputationService } from './reputation.service';
import { logger } from '../utils/logger';
import { timeServiceCache } from './cache.service';
import { notificationService } from './notification.service';
import { sanitizeObject, validateImageUrls } from '../utils/sanitize';

const DAILY_EARN_LIMIT = 480;
const FIRST_SERVICE_BONUS = 30;
const FIVE_STAR_BONUS = 10;

// scheduler.ts 需新增 handleDeferredTimeEarn，由统一任务处理：
// - 功能：每日凌晨发放 pending 状态的时间收益（time_transactions.status='pending'）
// - 建议执行频率：每日凌晨 0:01（cron: '1 0 * * *'）
// - 发放时需将 status 从 'pending' 更新为 'completed'，并写入 completed_at
// - 同时更新 time_accounts.balance / total_earned 与 users.time_balance

// time_services 表行类型：与数据库列结构对齐，避免 row: any 逃逸类型检查
// 设计原因：原 toService(row: any) 导致字段名拼写错误无法在编译期暴露，
// 列变更（如新增/重命名）也不会触发类型告警。此处仅声明 toService 实际读取的列，
// JOIN users 后多出的 nickname/avatar/reputation_score 列声明为可选
interface TimeServiceRow extends QueryResultRow {
  id: string;
  user_id: string;
  category: string;
  type: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  certification: unknown | null;
  location: string | null;
  address: string | null;
  images: string[] | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  // JOIN users 后的发布者字段（可选，仅列表/详情查询携带）
  nickname?: string | null;
  avatar?: string | null;
  reputation_score?: string | null;
}

// time_orders 表行类型：与数据库列结构对齐
interface TimeOrderRow extends QueryResultRow {
  id: string;
  service_id: string;
  provider_id: string;
  requester_id: string;
  duration_minutes: number;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// time_accounts 表行类型：与数据库列结构对齐
// 设计原因：原 Map<string, any> 导致 .balance 等字段访问失去类型保护，
// 列重命名（如 balance → credit）不会触发编译期告警
interface TimeAccountRow extends QueryResultRow {
  id: string;
  user_id: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  created_at: Date;
  updated_at: Date;
}

// SQL 参数联合类型复用 database.ts 的 SqlParam，避免本地定义与全局类型不一致
// 设计原因：原本地 SqlParam 含 object 类型过宽（含函数、Symbol 等），改用全局统一类型

// 事务内查询函数签名：与 database.query 对齐，用于 fetchDailyEarned 等辅助函数
type QueryFn = (text: string, params?: SqlParam[]) => Promise<{ rows: QueryResultRow[] }>;

function toService(row: TimeServiceRow) {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category,
    type: row.type,
    title: row.title,
    description: row.description,
    durationMinutes: row.duration_minutes,
    certification: row.certification,
    location: row.location,
    address: row.address,
    // 兼容旧数据：images 列可能为 null（迁移前的历史记录）
    images: row.images || [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOrder(row: TimeOrderRow) {
  return {
    id: row.id,
    serviceId: row.service_id,
    providerId: row.provider_id,
    requesterId: row.requester_id,
    durationMinutes: row.duration_minutes,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOrCreateAccount(client: PoolClient, userId: string): Promise<TimeAccountRow> {
  // 事务内查询并加行锁，防止并发场景下余额丢失更新
  const result = await client.query('SELECT * FROM time_accounts WHERE user_id = $1 FOR UPDATE', [userId]);
  if (result.rows.length > 0) return result.rows[0] as TimeAccountRow;

  const insertResult = await client.query(
    `INSERT INTO time_accounts (user_id, balance, total_earned, total_spent)
     VALUES ($1, 0, 0, 0) RETURNING *`,
    [userId],
  );
  return insertResult.rows[0] as TimeAccountRow;
}

/**
 * 事务内对多个 users 行按 id 升序逐个加 FOR UPDATE 行锁。
 * 统一加锁顺序可避免不同事务之间形成死锁。
 *
 * 返回 userId -> { timeBalance, nickname } 的映射：
 * - timeBalance 用于余额校验（与原逻辑一致）
 * - nickname 复用本次锁查询一并取出，供通知文案携带发送方昵称，避免额外查库
 */
interface UserLockInfo {
  timeBalance: number;
  nickname: string;
}

async function lockUsersForUpdate(
  client: PoolClient,
  userIds: string[],
): Promise<Map<string, UserLockInfo>> {
  const userMap = new Map<string, UserLockInfo>();
  // 去重并按 id 升序排序，确保所有事务以相同顺序加锁
  const sortedIds = [...new Set(userIds)].sort();
  for (const id of sortedIds) {
    const result = await client.query(
      'SELECT id, time_balance, nickname FROM users WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (result.rows.length > 0) {
      userMap.set(result.rows[0].id, {
        timeBalance: result.rows[0].time_balance,
        nickname: result.rows[0].nickname,
      });
    }
  }
  return userMap;
}

/**
 * 查询用户当日已发放的收益总额（type='earn' 且 status='completed'）
 * 用于 DAILY_EARN_LIMIT 上限预检查，避免超限发放。
 *
 * 仅统计 status='completed' 的流水；status='pending' 的延迟发放部分
 * 在 scheduler handleDeferredTimeEarn 发放后才会计入当日上限。
 */
async function fetchDailyEarned(
  queryFn: QueryFn,
  userId: string,
): Promise<number> {
  const result = await queryFn(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM time_transactions
     WHERE to_user_id = $1 AND type = 'earn' AND status = 'completed'
     AND created_at >= CURRENT_DATE`,
    [userId],
  );
  return parseInt(result.rows[0].total, 10);
}

async function createService(
  userId: string,
  data: {
    type: string;
    category: string;
    title: string;
    description?: string;
    duration_minutes: number;
    location?: { x: number; y: number };
    address?: string;
    // 认证信息为对象结构，使用 Record<string, unknown> 替代 any 强制消费方做类型收窄
    certification?: Record<string, unknown> | null;
    images?: string[];
  },
) {
  if (!['provide', 'request'].includes(data.type)) {
    throw new BadRequestError('服务类型必须为 provide 或 request');
  }

  // 入库前清洗富文本字段，防止存储型 XSS（与 kitchen.service 保持一致的处理方式）
  const sanitized = sanitizeObject(data, ['title', 'description']);
  // 校验图片 URL：必须为 /uploads/ 相对路径或 HTTPS 白名单域名
  validateImageUrls(sanitized.images);

  const result = await query(
    `INSERT INTO time_services (user_id, type, category, title, description, duration_minutes, location, address, certification, images)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, created_at`,
    [
      userId,
      sanitized.type,
      sanitized.category,
      sanitized.title,
      sanitized.description || null,
      sanitized.duration_minutes,
      sanitized.location ? `(${sanitized.location.x},${sanitized.location.y})` : null,
      sanitized.address || null,
      sanitized.certification ? JSON.stringify(sanitized.certification) : null,
      sanitized.images || [],
    ],
  );

  return result.rows[0];
}

async function getServiceList(
  filters: { type?: string; category?: string } = {},
  pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
) {
  const conditions: string[] = ['ts.deleted_at IS NULL', "ts.status = 'active'"];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (filters.type) {
    conditions.push(`ts.type = $${paramIndex++}`);
    params.push(filters.type);
  }
  if (filters.category) {
    conditions.push(`ts.category = $${paramIndex++}`);
    params.push(filters.category);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (pagination.page - 1) * pagination.pageSize;

  const [countResult, listResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM time_services ts WHERE ${whereClause}`, params),
    query(
      `SELECT ts.*,
              u.nickname, u.avatar, u.reputation_score
       FROM time_services ts
       LEFT JOIN users u ON ts.user_id = u.id
       WHERE ${whereClause}
       ORDER BY ts.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pagination.pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  // 断言 row 为 TimeServiceRow：SQL 返回的列类型本质是动态的，TS 无法静态校验，
  // 调用方按 SELECT 列结构做断言是 PG 项目通用做法
  const list = listResult.rows.map((row) => {
    const typedRow = row as TimeServiceRow;
    return {
    ...toService(typedRow),
    publisher: {
      id: typedRow.user_id,
      nickname: typedRow.nickname,
      avatar: typedRow.avatar,
      reputationScore: typedRow.reputation_score ? parseFloat(typedRow.reputation_score) : null,
    },
  }});

  return createPaginatedResponse(list, total, pagination.page, pagination.pageSize);
}

/**
 * 获取服务详情
 * @param id 服务 ID
 * @param viewerUserId 查看者用户 ID（未登录时为 undefined）
 *
 * 安全考虑：未登录用户可查看服务基本信息，但隐藏 address、location、certification
 * 等敏感字段，避免 PII 泄露；登录用户（含非发布者）可见完整信息以便下单决策
 *
 * 缓存策略：缓存完整数据，获取后根据 viewerUserId 进行脱敏处理
 */
async function getServiceById(id: string, viewerUserId?: string) {
  // 使用缓存：先查缓存，未命中时查数据库并缓存结果
  const cachedData = await timeServiceCache.get(id, async () => {
    const result = await query(
      `SELECT ts.*,
              u.nickname, u.avatar, u.reputation_score
       FROM time_services ts
       LEFT JOIN users u ON ts.user_id = u.id
       WHERE ts.id = $1 AND ts.deleted_at IS NULL`,
      [id],
    );

    if (result.rows.length === 0) throw new NotFoundError('服务');
    // 断言为 TimeServiceRow：与 SELECT 列结构对齐，编译期校验字段访问
    const row = result.rows[0] as TimeServiceRow;

    return {
      ...toService(row),
      publisher: {
        id: row.user_id,
        nickname: row.nickname,
        avatar: row.avatar,
        reputationScore: row.reputation_score ? parseFloat(row.reputation_score) : null,
      },
      // 缓存原始数据用于脱敏判断
      _raw: row,
    };
  });

  // 未登录查看者：隐藏精确地址、位置、认证信息等敏感字段
  const isAnonymous = !viewerUserId;
  if (isAnonymous) {
    return {
      ...cachedData,
      address: null,
      location: null,
      certification: null,
    };
  }

  return cachedData;
}

// 可更新字段白名单：防止 SQL 注入，仅允许以下字段进入 UPDATE 语句
// 任何不在白名单内的字段（包括恶意构造的 SQL 片段）都会被忽略并记录告警
const UPDATABLE_SERVICE_FIELDS = [
  'type',
  'category',
  'title',
  'description',
  'duration_minutes',
  'address',
  'status',
  'images',
] as const;

async function updateService(id: string, userId: string, data: Partial<{
  type: string;
  category: string;
  title: string;
  description: string;
  duration_minutes: number;
  address: string;
  status: string;
  images: string[];
}>) {
  const serviceResult = await query('SELECT * FROM time_services WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (serviceResult.rows.length === 0) throw new NotFoundError('服务');
  const service = serviceResult.rows[0];

  if (service.user_id !== userId) throw new PermissionDeniedError();
  if (['completed', 'closed'].includes(service.status)) {
    throw new OrderStatusInvalidError('该服务已完成或关闭，无法修改');
  }

  // images 更新前校验 URL 合法性，与 createService 保持一致
  // 设计原因：避免恶意 URL 入库，统一走 validateImageUrls（支持 /uploads/ 与 HTTPS 白名单）
  if (data.images !== undefined) {
    validateImageUrls(data.images);
  }

  const fields: string[] = [];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  // 仅遍历白名单字段，确保字段名为受控常量，杜绝用户输入直接拼入 SQL
  for (const field of UPDATABLE_SERVICE_FIELDS) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      params.push(data[field]);
    }
  }

  // 检测并告警白名单外的可疑字段，便于安全审计追踪
  // 类型断言为白名单字面量联合类型，避免 as any 掩盖 key 与白名单的类型不匹配
  const incomingFields = Object.keys(data || {});
  const suspiciousFields = incomingFields.filter(
    (key) => !UPDATABLE_SERVICE_FIELDS.includes(key as (typeof UPDATABLE_SERVICE_FIELDS)[number]),
  );
  if (suspiciousFields.length > 0) {
    logger.warn({ suspiciousFields }, 'updateService 收到白名单外字段，已忽略');
  }

  if (fields.length === 0) return toService(service as TimeServiceRow);

  fields.push(`updated_at = NOW()`);
  params.push(id);

  const result = await query(
    `UPDATE time_services SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    params,
  );

  // 服务更新后清除缓存
  await timeServiceCache.invalidate(id);

  return toService(result.rows[0] as TimeServiceRow);
}

async function createOrder(userId: string, serviceId: string) {
  // 幂等检查：5 秒内对同一服务的重复下单请求直接返回缓存结果
  const idempotencyKey = idempotency.buildKey(userId, 'time_order', serviceId);
  const cached = await idempotency.checkIdempotency(idempotencyKey);
  // cached.data 为 unknown，但写入方在本函数末尾用 setIdempotencyResult 存入的是
  // INSERT RETURNING 的 { id, status } 行，因此断言为 Pick<TimeOrderRow, 'id' | 'status'> 是安全的
  if (cached.hit) return cached.data as Pick<TimeOrderRow, 'id' | 'status'>;

  const serviceResult = await query('SELECT * FROM time_services WHERE id = $1 AND deleted_at IS NULL', [serviceId]);
  if (serviceResult.rows.length === 0) throw new NotFoundError('服务');
  const service = serviceResult.rows[0];

  if (service.status !== 'active') throw new OrderStatusInvalidError('该服务当前不可下单');
  if (service.user_id === userId) throw new BadRequestError('不能下单自己的服务');

  // SubTask 16.4: 预检查 provider 当日收益是否已达上限，已达上限则拒绝下单
  // 避免下单后完成时才发现超限，导致订单状态与收益发放不一致
  const providerDailyEarned = await fetchDailyEarned(query, service.user_id);
  if (providerDailyEarned >= DAILY_EARN_LIMIT) {
    throw new BadRequestError(`服务提供者当日收益已达上限 ${DAILY_EARN_LIMIT} 分钟，无法下单`);
  }

  // INSERT RETURNING 仅返回 id, status 两列，用 Pick<TimeOrderRow, 'id' | 'status'> 精确收窄类型
  const result = await query<Pick<TimeOrderRow, 'id' | 'status'>>(
    `INSERT INTO time_orders (service_id, provider_id, requester_id, duration_minutes)
     VALUES ($1, $2, $3, $4) RETURNING id, status`,
    [serviceId, service.user_id, userId, service.duration_minutes],
  );

  // 创建成功后写入幂等缓存，防止短时间内重复提交
  await idempotency.setIdempotencyResult(idempotencyKey, result.rows[0]);
  return result.rows[0];
}

async function updateOrderStatus(orderId: string, userId: string, action: string) {
  // 使用事务 + FOR UPDATE 行锁，防止并发状态变更破坏订单状态机一致性
  const order = await transaction(async (client) => {
    const orderResult = await client.query('SELECT * FROM time_orders WHERE id = $1 FOR UPDATE', [orderId]);
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    const isProvider = order.provider_id === userId;
    const isRequester = order.requester_id === userId;
    if (!isProvider && !isRequester) throw new PermissionDeniedError();

    switch (action) {
      case 'accept': {
        if (!isProvider) throw new PermissionDeniedError('仅服务提供者可接受订单');
        if (order.status !== 'pending') throw new OrderStatusInvalidError();
        await client.query("UPDATE time_orders SET status = 'accepted', updated_at = NOW() WHERE id = $1", [orderId]);
        break;
      }
      case 'start': {
        if (!isProvider) throw new PermissionDeniedError('仅服务提供者可开始服务');
        if (order.status !== 'accepted') throw new OrderStatusInvalidError();
        await client.query("UPDATE time_orders SET status = 'in_progress', started_at = NOW(), updated_at = NOW() WHERE id = $1", [orderId]);
        break;
      }
      case 'cancel': {
        if (!['pending', 'accepted'].includes(order.status)) {
          throw new OrderStatusInvalidError('订单状态不允许取消');
        }
        await client.query("UPDATE time_orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1", [orderId]);
        break;
      }
      case 'complete':
        throw new BadRequestError('请使用 completeOrder 方法完成订单');
      default:
        throw new BadRequestError('无效的操作类型');
    }

    // 事务内重新查询更新后的订单行
    const updatedResult = await client.query('SELECT * FROM time_orders WHERE id = $1', [orderId]);
    return updatedResult.rows[0];
  });

  // 通知对方订单状态变更（accept/start 由 provider 操作通知 requester；cancel 通知对方）
  const isProvider = order.provider_id === userId;
  const otherUserId = isProvider ? order.requester_id : order.provider_id;
  const statusMap: Record<string, string> = { accept: 'accepted', start: 'in_progress', cancel: 'cancelled' };
  notificationService.notifyOrderStatusChange(
    otherUserId,
    orderId,
    'time_order',
    statusMap[action],
  ).catch(() => {});

  // 断言为 TimeOrderRow：与 time_orders 表结构对齐
  return toOrder(order as TimeOrderRow);
}

async function completeOrder(
  orderId: string,
  userId: string,
  actualDuration: number,
  rating?: number,
  review?: string,
) {
  return transaction(async (client) => {
    const orderResult = await client.query(
      'SELECT * FROM time_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.requester_id !== userId) throw new PermissionDeniedError('仅服务请求者可确认完成');
    if (order.status !== 'in_progress') throw new OrderStatusInvalidError();

    // ===== SubTask 16.1: 预检查 provider 当日收益（在更新订单状态前） =====
    // 先计算 bonus：completedCount === 0 表示当前订单是首单（更新后将为 1）
    let bonusTotal = 0;
    const completedCountResult = await client.query(
      "SELECT COUNT(*) FROM time_orders WHERE provider_id = $1 AND status = 'completed'",
      [order.provider_id],
    );
    const completedCount = parseInt(completedCountResult.rows[0].count, 10);
    if (completedCount === 0) {
      bonusTotal += FIRST_SERVICE_BONUS;
    }
    if (rating === 5) {
      bonusTotal += FIVE_STAR_BONUS;
    }

    // 查询 provider 当日已发放收益（type='earn' 且 status='completed'）
    const dailyEarned = await fetchDailyEarned(client.query.bind(client), order.provider_id);
    const remainingLimit = Math.max(0, DAILY_EARN_LIMIT - dailyEarned);

    // ===== SubTask 16.2: 超限部分延迟发放 =====
    // 优先发放 earn（服务收入），其次 bonus；超出部分记为 pending，由 scheduler 次日发放
    const immediateEarn = Math.min(actualDuration, remainingLimit);
    const deferredEarn = actualDuration - immediateEarn;
    const remainingAfterEarn = remainingLimit - immediateEarn;
    const immediateBonus = Math.min(bonusTotal, remainingAfterEarn);
    const deferredBonus = bonusTotal - immediateBonus;
    const immediateTotal = immediateEarn + immediateBonus;

    // 预检查通过后才更新订单状态（原逻辑在更新后才检查，可能导致超限发放）
    await client.query(
      "UPDATE time_orders SET status = 'completed', completed_at = NOW(), duration_minutes = $1, updated_at = NOW() WHERE id = $2",
      [actualDuration, orderId],
    );

    // 1. 对双方 users 行按 id 排序加 FOR UPDATE 行锁，避免并发超扣与死锁
    const userMap = await lockUsersForUpdate(client, [order.provider_id, order.requester_id]);
    const requesterInfo = userMap.get(order.requester_id);
    if (requesterInfo === undefined) throw new NotFoundError('用户');
    // 余额校验：requester 需要支付 actualDuration 分钟，余额不足则提前失败
    if (requesterInfo.timeBalance < actualDuration) {
      throw new InsufficientCreditError('时间余额不足，无法完成服务');
    }

    // 2. 按 id 排序获取 time_accounts 账户（getOrCreateAccount 内部对 time_accounts 行加 FOR UPDATE）
    const sortedAccountIds = [order.provider_id, order.requester_id].sort();
    const accounts = new Map<string, TimeAccountRow>();
    for (const uid of sortedAccountIds) {
      accounts.set(uid, await getOrCreateAccount(client, uid));
    }
    // accounts 在上一行 for 循环中已写入该 key，getOrCreateAccount 保证返回值，故用非空断言
    const requesterAccount = accounts.get(order.requester_id)!;

    // time_accounts 余额同样校验，保持双账本一致
    if (requesterAccount.balance < actualDuration) {
      throw new InsufficientCreditError('时间余额不足，无法完成服务');
    }

    // 仅发放未超限部分（immediateTotal）给 provider；超限部分延迟发放
    await client.query(
      'UPDATE time_accounts SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
      [immediateTotal, order.provider_id],
    );
    await client.query(
      'UPDATE time_accounts SET balance = balance - $1, total_spent = total_spent + $1, updated_at = NOW() WHERE user_id = $2',
      [actualDuration, order.requester_id],
    );

    await client.query('UPDATE users SET time_balance = time_balance + $1 WHERE id = $2', [immediateTotal, order.provider_id]);
    await client.query('UPDATE users SET time_balance = time_balance - $1 WHERE id = $2', [actualDuration, order.requester_id]);

    // bonus 流水：立即发放部分记为 completed，延迟部分记为 pending
    if (immediateBonus > 0 || deferredBonus > 0) {
      const bonusRemark = completedCount === 0 && rating === 5
        ? '首次服务奖励+好评奖励'
        : completedCount === 0 ? '首次服务奖励' : '好评奖励';
      if (immediateBonus > 0) {
        await client.query(
          `INSERT INTO time_transactions (service_id, from_user_id, to_user_id, amount, type, status, remark)
           VALUES ($1, NULL, $2, $3, 'bonus', 'completed', $4)`,
          [order.service_id, order.provider_id, immediateBonus, bonusRemark],
        );
      }
      // 延迟发放的 bonus 部分：status='pending'，由 scheduler 次日发放
      // scheduler.ts 需新增 handleDeferredTimeEarn，由统一任务处理
      if (deferredBonus > 0) {
        await client.query(
          `INSERT INTO time_transactions (service_id, from_user_id, to_user_id, amount, type, status, remark)
           VALUES ($1, NULL, $2, $3, 'bonus', 'pending', $4)`,
          [order.service_id, order.provider_id, deferredBonus, `延迟发放：${bonusRemark}`],
        );
      }
    }

    // earn 流水：立即发放部分记为 completed，延迟部分记为 pending
    // from_user_id 填 order.requester_id（原为 NULL，修复为正确来源）
    if (immediateEarn > 0) {
      await client.query(
        `INSERT INTO time_transactions (service_id, from_user_id, to_user_id, amount, type, status, remark)
         VALUES ($1, $2, $3, $4, 'earn', 'completed', '服务收入')`,
        [order.service_id, order.requester_id, order.provider_id, immediateEarn],
      );
    }
    // 延迟发放的 earn 部分：status='pending'，由 scheduler 次日发放
    // scheduler.ts 需新增 handleDeferredTimeEarn，由统一任务处理
    if (deferredEarn > 0) {
      await client.query(
        `INSERT INTO time_transactions (service_id, from_user_id, to_user_id, amount, type, status, remark)
         VALUES ($1, $2, $3, $4, 'earn', 'pending', '延迟发放：服务收入')`,
        [order.service_id, order.requester_id, order.provider_id, deferredEarn],
      );
    }
    await client.query(
      `INSERT INTO time_transactions (service_id, from_user_id, to_user_id, amount, type, status, remark)
       VALUES ($1, $2, $3, $4, 'spend', 'completed', '服务支出')`,
      [order.service_id, order.requester_id, order.provider_id, actualDuration],
    );

    if (rating !== undefined && rating !== null) {
      await client.query(
        `INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
         VALUES ($1, $2, $3, 'time', $4, $5)`,
        [userId, order.provider_id, orderId, rating, review || null],
      );

      // 取最近50条评价计算平均信誉分
      await reputationService.updateReputationScore(client, order.provider_id);
    }

    const updatedResult = await client.query('SELECT * FROM time_orders WHERE id = $1', [orderId]);

    // 通知服务提供者：订单已完成（仅 requester 可确认完成，通知 provider）
    notificationService.notifyOrderStatusChange(
      order.provider_id,
      orderId,
      'time_order',
      'completed',
    ).catch(() => {});

    return toOrder(updatedResult.rows[0] as TimeOrderRow);
  });
}

async function getAccount(userId: string) {
  const result = await query('SELECT * FROM time_accounts WHERE user_id = $1', [userId]);
  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      balance: row.balance,
      totalEarned: row.total_earned,
      totalSpent: row.total_spent,
      updatedAt: row.updated_at,
    };
  }

  const insertResult = await query(
    `INSERT INTO time_accounts (user_id, balance, total_earned, total_spent)
     VALUES ($1, 0, 0, 0) RETURNING *`,
    [userId],
  );
  const row = insertResult.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    balance: row.balance,
    totalEarned: row.total_earned,
    totalSpent: row.total_spent,
    updatedAt: row.updated_at,
  };
}

async function transferTime(fromUserId: string, toUserId: string, amount: number, remark?: string) {
  if (fromUserId === toUserId) throw new BadRequestError('不能向自己转账');
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('转账金额必须为正整数');

  return transaction(async (client) => {
    // 1. 对双方 users 行按 id 排序加 FOR UPDATE 行锁，避免并发超扣与死锁
    const userMap = await lockUsersForUpdate(client, [fromUserId, toUserId]);
    const fromInfo = userMap.get(fromUserId);
    if (fromInfo === undefined) throw new NotFoundError('用户');
    if (!userMap.has(toUserId)) throw new NotFoundError('用户');

    // 2. 校验 from_user 余额充足（基于已加锁的 users.time_balance）
    if (fromInfo.timeBalance < amount) throw new InsufficientCreditError('时间余额不足');

    // 3. 按 id 排序获取 time_accounts 账户（getOrCreateAccount 内部对 time_accounts 行加 FOR UPDATE）
    const sortedUserIds = [fromUserId, toUserId].sort();
    const accounts = new Map<string, TimeAccountRow>();
    for (const uid of sortedUserIds) {
      accounts.set(uid, await getOrCreateAccount(client, uid));
    }
    // accounts 在上一行 for 循环中已写入该 key，getOrCreateAccount 保证返回值，故用非空断言
    const fromAccount = accounts.get(fromUserId)!;

    // time_accounts 余额同样校验，保持双账本一致
    if (fromAccount.balance < amount) throw new InsufficientCreditError('时间余额不足');

    await client.query(
      'UPDATE time_accounts SET balance = balance - $1, total_spent = total_spent + $1, updated_at = NOW() WHERE user_id = $2',
      [amount, fromUserId],
    );
    await client.query(
      'UPDATE time_accounts SET balance = balance + $1, total_earned = total_earned + $1, updated_at = NOW() WHERE user_id = $2',
      [amount, toUserId],
    );

    await client.query('UPDATE users SET time_balance = time_balance - $1 WHERE id = $2', [amount, fromUserId]);
    await client.query('UPDATE users SET time_balance = time_balance + $1 WHERE id = $2', [amount, toUserId]);

    await client.query(
      `INSERT INTO time_transactions (from_user_id, to_user_id, amount, type, status, remark)
       VALUES ($1, $2, $3, 'transfer', 'completed', $4)`,
      [fromUserId, toUserId, amount, remark || null],
    );

    // 通知接收方：携带发送方昵称让接收方知道是谁转赠的（空昵称兜底"一位用户"）
    // 不查询流水 id 避免额外查库，referenceId 落 null
    notificationService.notifyTimeBankTransaction(
      toUserId,
      undefined,
      'transfer',
      amount,
      fromInfo.nickname || undefined,
    ).catch(() => {});

    return { fromUserId, toUserId, amount };
  });
}

/**
 * 时间币捐赠：fromUserId 将时间币无偿赠予 toUserId。
 *
 * 设计与 transferTime 的关键差异：
 * - 流水 type='donate'，与 'transfer' 语义区分，便于后续报表统计公益行为；
 * - to_user 仅增加 balance，不计入 total_earned，避免污染 DAILY_EARN_LIMIT（收益上限只约束服务收入）；
 * - from_user 计入 total_spent，与 transfer/spend 一致，保持账户口径统一。
 *
 * 并发安全复用 lockUsersForUpdate + getOrCreateAccount 的统一加锁顺序，
 * 与 transferTime / completeOrder 共用同一套行锁协议，避免跨事务死锁。
 */
async function donateTime(fromUserId: string, toUserId: string, amount: number, remark?: string) {
  if (fromUserId === toUserId) throw new BadRequestError('不能向自己捐赠');
  if (!Number.isInteger(amount) || amount <= 0) throw new ValidationError('捐赠金额必须为正整数');

  return transaction(async (client) => {
    // 1. 双方 users 行按 id 排序加 FOR UPDATE 行锁，统一加锁顺序避免死锁
    const userMap = await lockUsersForUpdate(client, [fromUserId, toUserId]);
    const fromInfo = userMap.get(fromUserId);
    if (fromInfo === undefined) throw new NotFoundError('用户');
    if (!userMap.has(toUserId)) throw new NotFoundError('用户');

    // 2. 校验 from_user 余额充足（基于已加锁的 users.time_balance）
    if (fromInfo.timeBalance < amount) throw new InsufficientCreditError('时间余额不足');

    // 3. 按 id 排序获取 time_accounts 账户（getOrCreateAccount 内部对 time_accounts 行加 FOR UPDATE）
    const sortedUserIds = [fromUserId, toUserId].sort();
    const accounts = new Map<string, TimeAccountRow>();
    for (const uid of sortedUserIds) {
      accounts.set(uid, await getOrCreateAccount(client, uid));
    }
    // accounts 在上一行 for 循环中已写入该 key，getOrCreateAccount 保证返回值，故用非空断言
    const fromAccount = accounts.get(fromUserId)!;

    // time_accounts 余额同样校验，保持双账本一致
    if (fromAccount.balance < amount) throw new InsufficientCreditError('时间余额不足');

    // from_user：扣减余额、累计 total_spent
    await client.query(
      'UPDATE time_accounts SET balance = balance - $1, total_spent = total_spent + $1, updated_at = NOW() WHERE user_id = $2',
      [amount, fromUserId],
    );
    // to_user：仅增加 balance，不计入 total_earned（捐赠不属于服务收入，不占日收益上限）
    await client.query(
      'UPDATE time_accounts SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2',
      [amount, toUserId],
    );

    // 同步 users.time_balance，保持双账本一致
    await client.query('UPDATE users SET time_balance = time_balance - $1 WHERE id = $2', [amount, fromUserId]);
    await client.query('UPDATE users SET time_balance = time_balance + $1 WHERE id = $2', [amount, toUserId]);

    // 写入捐赠流水：from_user_id 与 to_user_id 均填，type='donate'
    await client.query(
      `INSERT INTO time_transactions (from_user_id, to_user_id, amount, type, status, remark)
       VALUES ($1, $2, $3, 'donate', 'completed', $4)`,
      [fromUserId, toUserId, amount, remark || null],
    );

    // 通知接收方：携带发送方昵称让接收方知道是谁捐赠的（空昵称兜底"一位用户"）
    // 不查询流水 id 避免额外查库，referenceId 落 null
    notificationService.notifyTimeBankTransaction(
      toUserId,
      undefined,
      'donate',
      amount,
      fromInfo.nickname || undefined,
    ).catch(() => {});

    return { fromUserId, toUserId, amount };
  });
}

async function getTransactions(
  userId: string,
  cursor: string | undefined,
  limit: number = 20,
): Promise<CursorPaginatedResponse<{ id: string; serviceId: string | null; fromUserId: string | null; toUserId: string | null; amount: number; type: string; status: string; remark: string | null; createdAt: string; completedAt: string | null }>> {
  // 游标分页：第一页时 cursor 为空，查询最新记录
  // 查询条件：WHERE id < cursor ORDER BY id DESC LIMIT limit
  const params: SqlParam[] = [userId, limit];
  let sql = `SELECT * FROM time_transactions WHERE from_user_id = $1 OR to_user_id = $1`;

  if (cursor) {
    sql += ' AND id < $3 ORDER BY id DESC LIMIT $2';
    params.push(cursor);
  } else {
    sql += ' ORDER BY id DESC LIMIT $2';
  }

  const { rows } = await query(sql, params);

  return createCursorPaginatedResponse(
    rows.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      amount: row.amount,
      type: row.type,
      status: row.status,
      remark: row.remark,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
    limit,
  );
}

async function createFamilyBinding(userId: string, parentPhone: string, relationship: string) {
  const parentResult = await query('SELECT id FROM users WHERE phone = $1', [parentPhone]);
  if (parentResult.rows.length === 0) throw new NotFoundError('用户');
  const parent = parentResult.rows[0];

  if (userId === parent.id) throw new BadRequestError('不能与自己绑定');

  const existResult = await query(
    `SELECT id FROM family_bindings
     WHERE user_id = $1 AND parent_id = $2 AND status = 'confirmed'`,
    [userId, parent.id],
  );
  if (existResult.rows.length > 0) throw new BadRequestError('已存在确认的绑定关系');

  const result = await query(
    `INSERT INTO family_bindings (user_id, parent_id, relationship)
     VALUES ($1, $2, $3) RETURNING *`,
    [userId, parent.id, relationship],
  );

  // 通知对方：收到新的亲情绑定请求（通知失败不影响主流程）
  notificationService.notifyFamilyBindingChange(
    parent.id,
    result.rows[0].id,
    'request',
  ).catch(() => {});

  return result.rows[0];
}

async function confirmFamilyBinding(bindingId: string, userId: string) {
  const bindingResult = await query('SELECT * FROM family_bindings WHERE id = $1', [bindingId]);
  if (bindingResult.rows.length === 0) throw new NotFoundError('绑定记录');
  const binding = bindingResult.rows[0];

  if (binding.parent_id !== userId) throw new PermissionDeniedError();
  if (binding.status !== 'pending') throw new OrderStatusInvalidError('绑定状态不允许此操作');

  await query("UPDATE family_bindings SET status = 'confirmed', updated_at = NOW() WHERE id = $1", [bindingId]);

  // 通知发起方：亲情绑定已被对方确认
  notificationService.notifyFamilyBindingChange(
    binding.user_id,
    bindingId,
    'confirmed',
  ).catch(() => {});

  const updatedResult = await query('SELECT * FROM family_bindings WHERE id = $1', [bindingId]);
  return updatedResult.rows[0];
}

async function rejectFamilyBinding(bindingId: string, userId: string) {
  const bindingResult = await query('SELECT * FROM family_bindings WHERE id = $1', [bindingId]);
  if (bindingResult.rows.length === 0) throw new NotFoundError('绑定记录');
  const binding = bindingResult.rows[0];

  if (binding.parent_id !== userId) throw new PermissionDeniedError();
  if (binding.status !== 'pending') throw new OrderStatusInvalidError('绑定状态不允许此操作');

  await query("UPDATE family_bindings SET status = 'rejected', updated_at = NOW() WHERE id = $1", [bindingId]);

  // 通知发起方：亲情绑定被对方拒绝
  notificationService.notifyFamilyBindingChange(
    binding.user_id,
    bindingId,
    'rejected',
  ).catch(() => {});

  const updatedResult = await query('SELECT * FROM family_bindings WHERE id = $1', [bindingId]);
  return updatedResult.rows[0];
}

// 解绑亲情绑定：仅已确认（confirmed）的绑定可解绑，双方均可发起
// 设计原因：原流程仅支持 pending→rejected，已确认的绑定无法解除；
// 新增 unbound 终态保留解绑历史，避免直接删除记录导致关系链断裂
async function unbindFamilyBinding(bindingId: string, userId: string) {
  const bindingResult = await query('SELECT * FROM family_bindings WHERE id = $1', [bindingId]);
  if (bindingResult.rows.length === 0) throw new NotFoundError('绑定记录');
  const binding = bindingResult.rows[0];

  // 仅绑定双方（发起方 user_id 或家长 parent_id）可解绑，避免第三方越权
  if (binding.user_id !== userId && binding.parent_id !== userId) throw new PermissionDeniedError();
  // 仅已确认的绑定可解绑：pending 应走 reject 流程，rejected/unbound 已是终态
  if (binding.status !== 'confirmed') throw new OrderStatusInvalidError('仅已确认的绑定可解绑');

  await query("UPDATE family_bindings SET status = 'unbound', updated_at = NOW() WHERE id = $1", [bindingId]);

  // 通知另一方：绑定已被解绑（通知失败不阻塞主流程）
  const otherId = binding.user_id === userId ? binding.parent_id : binding.user_id;
  notificationService.notifyFamilyBindingChange(
    otherId,
    bindingId,
    'unbound',
  ).catch(() => {});

  const updatedResult = await query('SELECT * FROM family_bindings WHERE id = $1', [bindingId]);
  return updatedResult.rows[0];
}

async function getFamilyBindings(userId: string) {
  const result = await query(
    `SELECT fb.*,
            CASE WHEN fb.user_id = $1 THEN u1.nickname ELSE u2.nickname END AS other_nickname,
            CASE WHEN fb.user_id = $1 THEN u1.avatar ELSE u2.avatar END AS other_avatar,
            CASE WHEN fb.user_id = $1 THEN u1.id ELSE u2.id END AS other_id
     FROM family_bindings fb
     LEFT JOIN users u1 ON fb.user_id = u1.id
     LEFT JOIN users u2 ON fb.parent_id = u2.id
     WHERE fb.user_id = $1 OR fb.parent_id = $1
     ORDER BY fb.created_at DESC`,
    [userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    relationship: row.relationship,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    other: {
      id: row.other_id,
      nickname: row.other_nickname,
      avatar: row.other_avatar,
    },
  }));
}

async function createReview(orderId: string, reviewerId: string, rating: number, content?: string) {
  if (rating < 1 || rating > 5) throw new ValidationError('评分必须在1-5之间');

  const orderResult = await query('SELECT * FROM time_orders WHERE id = $1', [orderId]);
  if (orderResult.rows.length === 0) throw new NotFoundError('订单');
  const order = orderResult.rows[0];

  if (order.status !== 'completed') throw new OrderStatusInvalidError('订单未完成，无法评价');

  const isProvider = order.provider_id === reviewerId;
  const isRequester = order.requester_id === reviewerId;
  if (!isProvider && !isRequester) throw new PermissionDeniedError();

  const revieweeId = isProvider ? order.requester_id : order.provider_id;

  const existResult = await query(
    'SELECT id FROM reviews WHERE order_id = $1 AND reviewer_id = $2',
    [orderId, reviewerId],
  );
  if (existResult.rows.length > 0) throw new BadRequestError('已评价过此订单');

  const result = await query(
    `INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
     VALUES ($1, $2, $3, 'time', $4, $5) RETURNING *`,
    [reviewerId, revieweeId, orderId, rating, content || null],
  );

  // 事务外调用：直接使用连接池更新信誉分
  await reputationService.updateReputationScore(revieweeId);

  return result.rows[0];
}

async function createDispute(
  orderId: string,
  reporterId: string,
  reason: string,
  description?: string,
  evidence?: string[],
) {
  const orderResult = await query('SELECT * FROM time_orders WHERE id = $1', [orderId]);
  if (orderResult.rows.length === 0) throw new NotFoundError('订单');
  const order = orderResult.rows[0];

  if (order.provider_id !== reporterId && order.requester_id !== reporterId) {
    throw new PermissionDeniedError();
  }

  const result = await query(
    `INSERT INTO service_disputes (order_id, initiator_id, reason, evidence)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [orderId, reporterId, reason, evidence || null],
  );

  return result.rows[0];
}

async function getDisputes(
  userId: string,
  pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
) {
  const offset = (pagination.page - 1) * pagination.pageSize;

  const [countResult, listResult] = await Promise.all([
    query(
      `SELECT COUNT(*) FROM service_disputes sd
       JOIN time_orders o ON sd.order_id = o.id
       WHERE sd.initiator_id = $1 OR o.provider_id = $1 OR o.requester_id = $1`,
      [userId],
    ),
    query(
      `SELECT sd.*, o.provider_id, o.requester_id
       FROM service_disputes sd
       JOIN time_orders o ON sd.order_id = o.id
       WHERE sd.initiator_id = $1 OR o.provider_id = $1 OR o.requester_id = $1
       ORDER BY sd.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pagination.pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  return {
    list: listResult.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      initiatorId: row.initiator_id,
      reason: row.reason,
      evidence: row.evidence,
      status: row.status,
      resolution: row.resolution,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

async function getOrders(
  userId: string,
  pagination: { page: number; pageSize: number } = { page: 1, pageSize: 20 },
) {
  const offset = (pagination.page - 1) * pagination.pageSize;

  const [countResult, listResult] = await Promise.all([
    query(
      'SELECT COUNT(*) FROM time_orders WHERE provider_id = $1 OR requester_id = $1',
      [userId],
    ),
    query(
      `SELECT o.*,
              ts.title AS service_title, ts.category AS service_category, ts.type AS service_type,
              CASE
                WHEN o.provider_id = $1 THEN req.nickname
                ELSE prov.nickname
              END AS other_nickname,
              CASE
                WHEN o.provider_id = $1 THEN req.avatar
                ELSE prov.avatar
              END AS other_avatar,
              CASE
                WHEN o.provider_id = $1 THEN req.id
                ELSE prov.id
              END AS other_id
       FROM time_orders o
       LEFT JOIN time_services ts ON o.service_id = ts.id
       LEFT JOIN users prov ON o.provider_id = prov.id
       LEFT JOIN users req ON o.requester_id = req.id
       WHERE o.provider_id = $1 OR o.requester_id = $1
       ORDER BY o.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pagination.pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  // 断言为 TimeOrderRow：与 SELECT 列结构对齐，编译期校验字段访问
  const list = listResult.rows.map((row) => {
    const typedRow = row as TimeOrderRow;
    return {
    ...toOrder(typedRow),
    service: {
      title: typedRow.service_title,
      category: typedRow.service_category,
      type: typedRow.service_type,
    },
    other: {
      id: typedRow.other_id,
      nickname: typedRow.other_nickname,
      avatar: typedRow.other_avatar,
    },
  }});

  return createPaginatedResponse(list, total, pagination.page, pagination.pageSize);
}

export const timeBankService = {
  createService,
  getServiceList,
  getServiceById,
  updateService,
  createOrder,
  updateOrderStatus,
  completeOrder,
  getAccount,
  transferTime,
  donateTime,
  getTransactions,
  createFamilyBinding,
  confirmFamilyBinding,
  rejectFamilyBinding,
  unbindFamilyBinding,
  getFamilyBindings,
  createReview,
  createDispute,
  getDisputes,
  getOrders,
};
