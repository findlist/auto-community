import { query, transaction, SqlParam } from '../config/database';
import {
  BadRequestError,
  NotFoundError,
  OrderStatusInvalidError,
  PermissionDeniedError,
} from '../utils/errors';
import { idempotency } from '../utils/idempotency';
import { reputationService } from './reputation.service';
import { createPaginatedResponse } from '../utils/pagination';
import { creditService } from './credit.service';
import { notificationService } from './notification.service';

/**
 * skill_orders 表行类型
 * credit_amount 为 string：pg DECIMAL 默认解析为 string，业务侧消费时由调用方按需 Number() 转换
 * 争议相关字段（dispute_reason/dispute_time/previous_status/resolution/resolved_at/resolved_by）
 * 均为 nullable：仅在 disputed 状态下写入，其余状态为 null
 */
interface SkillOrderRow {
  id: string;
  post_id: string;
  buyer_id: string;
  seller_id: string;
  credit_amount: string;
  status: string;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  dispute_reason: string | null;
  dispute_time: Date | null;
  previous_status: string | null;
  resolution: string | null;
  resolved_at: Date | null;
  resolved_by: string | null;
}

/**
 * 技能订单列表/详情查询行：extends SkillOrderRow + LEFT JOIN 引入的帖子与用户信息
 * 用于 getOrderList 和 getOrderById，JOIN 字段可能为 null（帖子删除或用户注销时）
 * post_images 为 string[] | null：pg 数组类型，可能为 NULL
 */
interface SkillOrderListRow extends SkillOrderRow {
  post_title: string | null;
  post_images: string[] | null;
  post_credit_price: string | null;
  buyer_nickname: string | null;
  buyer_avatar: string | null;
  seller_nickname: string | null;
  seller_avatar: string | null;
}

function toSkillOrder(row: SkillOrderRow) {
  return {
    id: row.id,
    postId: row.post_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    creditsAmount: row.credit_amount,
    status: row.status,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 争议相关字段：disputed 状态下用于展示与追溯
    disputeReason: row.dispute_reason,
    disputeTime: row.dispute_time,
    previousStatus: row.previous_status,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

async function createOrder(buyerId: string, postId: string) {
  // 幂等检查：5 秒内对同一帖子的重复下单请求直接返回缓存结果
  const idempotencyKey = idempotency.buildKey(buyerId, 'skill_order', postId);
  const cached = await idempotency.checkIdempotency(idempotencyKey);
  // cached.data 为 unknown（工具层无法预知业务类型），但写入方在本函数末尾用 setIdempotencyResult
  // 存入的就是 toSkillOrder 的返回值，因此这里断言为 ReturnType<typeof toSkillOrder> 是安全的
  if (cached.hit) return cached.data as ReturnType<typeof toSkillOrder>;

  const postResult = await query(
    'SELECT * FROM skill_posts WHERE id = $1 AND deleted_at IS NULL',
    [postId],
  );
  if (postResult.rows.length === 0) throw new NotFoundError('技能帖子');
  const post = postResult.rows[0];

  if (post.status !== 'active') throw new OrderStatusInvalidError('该帖子不可交易');
  if (post.user_id === buyerId) throw new BadRequestError('不能购买自己的帖子');
  // 过期校验：expires_at 已过的帖子禁止下单，避免用户对已失效服务产生交易纠纷
  if (post.expires_at && new Date(post.expires_at) < new Date()) {
    throw new BadRequestError('帖子已过期，无法下单');
  }

  const result = await transaction(async (client) => {
    // 冻结积分：行锁防双花，事务内校验余额并扣减，记录 freeze 流水
    await creditService.freezeCredits(
      client,
      buyerId,
      post.credit_price,
      '技能订单冻结',
      postId,
      'skill_order',
    );

    // 创建订单
    const orderResult = await client.query<SkillOrderRow>(
      `INSERT INTO skill_orders (post_id, buyer_id, seller_id, credit_amount, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [postId, buyerId, post.user_id, post.credit_price],
    );

    return toSkillOrder(orderResult.rows[0]);
  });

  // 创建成功后写入幂等缓存，防止短时间内重复提交
  await idempotency.setIdempotencyResult(idempotencyKey, result);
  return result;
}

async function acceptOrder(orderId: string, sellerId: string) {
  return transaction(async (client) => {
    const orderResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.seller_id !== sellerId) throw new PermissionDeniedError();
    if (order.status !== 'pending') throw new OrderStatusInvalidError();

    await client.query(
      "UPDATE skill_orders SET status = 'accepted', updated_at = NOW() WHERE id = $1",
      [orderId],
    );

    // 结算积分：记录买家支出流水，卖家收入入账
    // 防御性校验：买家余额不应为负数（下单时已扣减，此处确保无异常）
    const buyerBalanceResult = await client.query(
      'SELECT credit_balance FROM users WHERE id = $1',
      [order.buyer_id],
    );
    if (buyerBalanceResult.rows[0].credit_balance < 0) {
      throw new BadRequestError('买家积分异常，无法完成订单');
    }
    await creditService.settleCredits(
      client,
      order.buyer_id,
      order.seller_id,
      Number(order.credit_amount),
      orderId,
      'order',
    );

    const updatedResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1',
      [orderId],
    );
    const updatedOrder = toSkillOrder(updatedResult.rows[0]);

    // 发送通知给买家：订单已被接受
    notificationService.notifyOrderStatusChange(
      order.buyer_id,
      orderId,
      'skill_order',
      'accepted',
    ).catch(() => {}); // 通知失败不影响主流程

    return updatedOrder;
  });
}

async function rejectOrder(orderId: string, sellerId: string) {
  return transaction(async (client) => {
    const orderResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.seller_id !== sellerId) throw new PermissionDeniedError();
    if (order.status !== 'pending') throw new OrderStatusInvalidError();

    await client.query(
      "UPDATE skill_orders SET status = 'rejected', updated_at = NOW() WHERE id = $1",
      [orderId],
    );

    // 解冻积分：退还买家余额并记录 unfreeze 流水
    await creditService.unfreezeCredits(
      client,
      order.buyer_id,
      Number(order.credit_amount),
      '技能订单拒绝退还',
      orderId,
      'skill_order',
    );

    const updatedResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1',
      [orderId],
    );
    const updatedOrder = toSkillOrder(updatedResult.rows[0]);

    // 发送通知给买家：订单已被拒绝
    notificationService.notifyOrderStatusChange(
      order.buyer_id,
      orderId,
      'skill_order',
      'rejected',
    ).catch(() => {}); // 通知失败不影响主流程

    return updatedOrder;
  });
}

async function completeOrder(orderId: string, userId: string, rating?: number, review?: string) {
  return transaction(async (client) => {
    const orderResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.buyer_id !== userId && order.seller_id !== userId) throw new PermissionDeniedError();
    if (!['accepted', 'in_progress'].includes(order.status)) {
      throw new OrderStatusInvalidError();
    }

    await client.query(
      "UPDATE skill_orders SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
      [orderId],
    );

    // 提交评价并更新信誉分
    if (rating) {
      const reviewedId = userId === order.buyer_id ? order.seller_id : order.buyer_id;
      await client.query(
        `INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
         VALUES ($1, $2, $3, 'skill', $4, $5)`,
        [userId, reviewedId, orderId, rating, review || null],
      );

      // 取最近50条评价计算平均信誉分
      await reputationService.updateReputationScore(client, reviewedId);
    }

    const updatedResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1',
      [orderId],
    );
    const updatedOrder = toSkillOrder(updatedResult.rows[0]);

    // 发送通知给对方：订单已完成
    const notifyUserId = userId === order.buyer_id ? order.seller_id : order.buyer_id;
    notificationService.notifyOrderStatusChange(
      notifyUserId,
      orderId,
      'skill_order',
      'completed',
    ).catch(() => {}); // 通知失败不影响主流程

    return updatedOrder;
  });
}

async function cancelOrder(orderId: string, userId: string) {
  return transaction(async (client) => {
    const orderResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.buyer_id !== userId && order.seller_id !== userId) throw new PermissionDeniedError();
    if (!['pending', 'accepted'].includes(order.status)) {
      throw new OrderStatusInvalidError();
    }

    await client.query(
      "UPDATE skill_orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1",
      [orderId],
    );

    if (order.status === 'pending') {
      // 待接受状态：解冻冻结积分退还买家
      await creditService.unfreezeCredits(
        client,
        order.buyer_id,
        Number(order.credit_amount),
        '技能订单取消退还',
        orderId,
        'skill_order',
      );
    } else {
      // 已接受状态：退还买家已扣积分，扣回卖家已收入
      // 买家退款使用 unfreeze 语义（实际为 refund，但统一走 creditService）
      await creditService.unfreezeCredits(
        client,
        order.buyer_id,
        Number(order.credit_amount),
        '技能订单取消退还',
        orderId,
        'skill_order',
      );

      // 卖家扣回已收入积分：允许余额为负（负债扣回），描述根据余额是否充足区分
      const sellerBalanceResult = await client.query(
        'SELECT credit_balance FROM users WHERE id = $1',
        [order.seller_id],
      );
      // credit_amount 为 string（pg DECIMAL），credit_balance 为 number（pg INTEGER），比较前需统一为 number
      const isDebt = sellerBalanceResult.rows[0].credit_balance < Number(order.credit_amount);
      const description = isDebt ? '技能订单取消扣回（负债）' : '技能订单取消扣回';
      await creditService.deductCredits(
        client,
        order.seller_id,
        Number(order.credit_amount),
        description,
        orderId,
        'skill_order',
        true,
      );
    }

    const updatedResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1',
      [orderId],
    );
    const updatedOrder = toSkillOrder(updatedResult.rows[0]);

    // 发送通知给对方：订单已取消
    const notifyUserId = userId === order.buyer_id ? order.seller_id : order.buyer_id;
    notificationService.notifyOrderStatusChange(
      notifyUserId,
      orderId,
      'skill_order',
      'cancelled',
    ).catch(() => {}); // 通知失败不影响主流程

    return updatedOrder;
  });
}

// 争议处理支持的 action 类型
// 导出 ResolveAction 供 routes 层收窄 req.body.action 类型
export type ResolveAction = 'refund' | 'continue' | 'cancel';

/**
 * 发起争议：买家或卖家在订单进行中（accepted/in_progress）可发起争议
 * 状态置为 disputed，记录争议原因与原状态（用于后续 continue 恢复）
 */
async function disputeOrder(orderId: string, userId: string, reason: string) {
  return transaction(async (client) => {
    // 行锁锁定订单，防止并发状态变更
    const orderResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    // 权限校验：仅买家或卖家可发起争议
    if (order.buyer_id !== userId && order.seller_id !== userId) {
      throw new PermissionDeniedError();
    }
    // 状态校验：仅 accepted/in_progress 可争议
    if (!['accepted', 'in_progress'].includes(order.status)) {
      throw new OrderStatusInvalidError('当前订单状态不允许发起争议');
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestError('争议原因不能为空');
    }

    // 记录 previous_status 以便 continue 时恢复，避免状态丢失
    await client.query(
      `UPDATE skill_orders
       SET status = 'disputed',
           previous_status = $2,
           dispute_reason = $3,
           dispute_time = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [orderId, order.status, reason.trim()],
    );

    const updatedResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1',
      [orderId],
    );
    return toSkillOrder(updatedResult.rows[0]);
  });
}

/**
 * 处理争议：管理员对 disputed 订单做出裁决
 * - refund: 退款买家，订单取消
 * - continue: 恢复为争议前状态（accepted/in_progress）
 * - cancel: 退款买家，订单取消
 */
async function resolveDispute(
  orderId: string,
  adminId: string,
  resolution: string,
  action: ResolveAction,
) {
  if (!['refund', 'continue', 'cancel'].includes(action)) {
    throw new BadRequestError('无效的争议处理操作');
  }
  if (!resolution || !resolution.trim()) {
    throw new BadRequestError('处理结果说明不能为空');
  }

  return transaction(async (client) => {
    const orderResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.status !== 'disputed') {
      throw new OrderStatusInvalidError('订单非争议状态，无法处理');
    }

    if (action === 'continue') {
      // 恢复为争议前状态，previous_status 由 disputeOrder 写入
      const previousStatus = order.previous_status || 'accepted';
      await client.query(
        `UPDATE skill_orders
         SET status = $2,
             resolution = $3,
             resolved_at = NOW(),
             resolved_by = $4,
             updated_at = NOW()
         WHERE id = $1`,
        [orderId, previousStatus, resolution.trim(), adminId],
      );
    } else {
      // refund / cancel 均退款买家并取消订单
      // 退款语义统一走 unfreezeCredits：买家余额在 freeze 时已扣减，此处退还
      await creditService.unfreezeCredits(
        client,
        order.buyer_id,
        Number(order.credit_amount),
        action === 'refund' ? '争议裁决退款买家' : '争议裁决取消订单退款',
        orderId,
        'skill_order',
      );

      await client.query(
        `UPDATE skill_orders
         SET status = 'cancelled',
             cancelled_at = NOW(),
             resolution = $2,
             resolved_at = NOW(),
             resolved_by = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [orderId, resolution.trim(), adminId],
      );
    }

    const updatedResult = await client.query<SkillOrderRow>(
      'SELECT * FROM skill_orders WHERE id = $1',
      [orderId],
    );
    return toSkillOrder(updatedResult.rows[0]);
  });
}

async function getOrderList(
  userId: string,
  filters: { status?: string } = {},
  page: number = 1,
  pageSize: number = 20,
) {
  const conditions: string[] = [];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  conditions.push(`(so.buyer_id = $${paramIndex++} OR so.seller_id = $${paramIndex++})`);
  params.push(userId, userId);

  if (filters.status) {
    conditions.push(`so.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) FROM skill_orders so WHERE ${whereClause}`, params),
    query<SkillOrderListRow>(
      `SELECT so.*,
              sp.title as post_title, sp.images as post_images, sp.credit_price as post_credit_price,
              buyer.nickname as buyer_nickname, buyer.avatar as buyer_avatar,
              seller.nickname as seller_nickname, seller.avatar as seller_avatar
       FROM skill_orders so
       LEFT JOIN skill_posts sp ON so.post_id = sp.id
       LEFT JOIN users buyer ON so.buyer_id = buyer.id
       LEFT JOIN users seller ON so.seller_id = seller.id
       WHERE ${whereClause}
       ORDER BY so.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  const list = listResult.rows.map((row) => ({
    ...toSkillOrder(row),
    post: {
      id: row.post_id,
      title: row.post_title,
      images: row.post_images,
      creditPrice: row.post_credit_price,
    },
    buyer: {
      id: row.buyer_id,
      nickname: row.buyer_nickname,
      avatar: row.buyer_avatar,
    },
    seller: {
      id: row.seller_id,
      nickname: row.seller_nickname,
      avatar: row.seller_avatar,
    },
  }));

  return createPaginatedResponse(list, total, page, pageSize);
}

async function getOrderById(orderId: string, userId: string) {
  const result = await query<SkillOrderListRow>(
    `SELECT so.*,
            sp.title as post_title, sp.images as post_images, sp.credit_price as post_credit_price,
            buyer.nickname as buyer_nickname, buyer.avatar as buyer_avatar,
            seller.nickname as seller_nickname, seller.avatar as seller_avatar
     FROM skill_orders so
     LEFT JOIN skill_posts sp ON so.post_id = sp.id
     LEFT JOIN users buyer ON so.buyer_id = buyer.id
     LEFT JOIN users seller ON so.seller_id = seller.id
     WHERE so.id = $1`,
    [orderId],
  );

  if (result.rows.length === 0) throw new NotFoundError('订单');
  const row = result.rows[0];

  if (row.buyer_id !== userId && row.seller_id !== userId) throw new PermissionDeniedError();

  return {
    ...toSkillOrder(row),
    post: {
      id: row.post_id,
      title: row.post_title,
      images: row.post_images,
      creditPrice: row.post_credit_price,
    },
    buyer: {
      id: row.buyer_id,
      nickname: row.buyer_nickname,
      avatar: row.buyer_avatar,
    },
    seller: {
      id: row.seller_id,
      nickname: row.seller_nickname,
      avatar: row.seller_avatar,
    },
  };
}

export const skillOrderService = {
  createOrder,
  acceptOrder,
  rejectOrder,
  completeOrder,
  cancelOrder,
  disputeOrder,
  resolveDispute,
  getOrderList,
  getOrderById,
};
