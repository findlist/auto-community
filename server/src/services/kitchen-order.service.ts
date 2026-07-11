import { query, transaction, SqlParam } from '../config/database';
import {
  NotFoundError,
  BadRequestError,
  OrderStatusInvalidError,
  PermissionDeniedError,
} from '../utils/errors';
import { idempotency } from '../utils/idempotency';
import { reputationService } from './reputation.service';
import { createPaginatedResponse } from '../utils/pagination';
import { creditService } from './credit.service';
import { notificationService } from './notification.service';

/**
 * kitchen_orders 表显式查询列：替代 SELECT *，与数据库实际列结构对齐。
 * 含 seller_id/pickup_time/remark（迁移 002_shared_kitchen.sql 添加）。
 * 列为硬编码常量非用户输入，模板插值无注入风险。
 */
const KITCHEN_ORDER_COLUMNS = `id, post_id, user_id, seller_id, portions, credit_amount,
  pickup_type, pickup_time, delivery_address, remark, status,
  completed_at, cancelled_at, timeout_at, created_at, updated_at`;

// 设计原因：原 toOrderResponse(row: any, post?: any, buyer?: any, seller?: any) 四个 any 参数
// 让字段误用静默通过编译，定义精确接口后编译期即可发现拼写错误或类型不匹配
interface KitchenOrderRow {
  id: string;
  post_id: string;
  user_id: string;
  seller_id: string;
  portions: number;
  credit_amount: number;
  pickup_type: string | null;
  pickup_time: Date | null;
  delivery_address: string | null;
  remark: string | null;
  status: string;
  created_at: Date;
  completed_at: Date | null;
  timeout_at: Date | null;
}

// 帖子简要信息（toOrderResponse 的 post 参数）
interface KitchenPostBrief {
  id: string;
  title?: string;
  images?: string[];
}

// 用户简要信息（toOrderResponse 的 buyer/seller 参数）
interface UserBrief {
  id: string;
  nickname?: string;
  avatar?: string;
}

// 列表查询行：KitchenOrderRow + JOIN 引入的帖子/买家/卖家字段
interface KitchenOrderListRow extends KitchenOrderRow {
  post_title: string | null;
  post_images: string[] | null;
  buyer_nickname: string | null;
  buyer_avatar: string | null;
  seller_nickname: string | null;
  seller_avatar: string | null;
}

// 订单数据序列化
export function toOrderResponse(row: KitchenOrderRow, post?: KitchenPostBrief, buyer?: UserBrief, seller?: UserBrief) {
  return {
    id: row.id,
    postId: row.post_id,
    post: post,
    buyerId: row.user_id,
    buyer: buyer,
    sellerId: row.seller_id,
    seller: seller,
    quantity: row.portions,
    totalPrice: row.credit_amount,
    pickupType: row.pickup_type,
    pickupTime: row.pickup_time,
    deliveryAddress: row.delivery_address,
    remark: row.remark,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    timeoutAt: row.timeout_at
  };
}

// 创建订单（预约领取）
async function create(userId: string, data: {
  postId: string;
  quantity: number;
  pickupType?: 'self_pickup' | 'delivery';
  pickupTime?: string;
  deliveryAddress?: string;
  remark?: string;
}) {
  // 幂等检查：5 秒内对同一美食帖相同份数的重复下单请求直接返回缓存结果
  const idempotencyKey = idempotency.buildKey(
    userId,
    'kitchen_order',
    `${data.postId}:${data.quantity}`,
  );
  const cached = await idempotency.checkIdempotency(idempotencyKey);
  // cached.data 为 unknown，但写入方在本函数末尾用 setIdempotencyResult 存入的是
  // toOrderResponse 的返回值，因此断言为 ReturnType<typeof toOrderResponse> 是安全的
  if (cached.hit) return cached.data as ReturnType<typeof toOrderResponse>;

  const result = await transaction(async (client) => {
    // 1. 查询美食信息并锁定
    // 仅查询 createOrder 实际消费的 6 个字段，避免返回 description TEXT/allergens TEXT[] 等大字段
    const postResult = await client.query(
      'SELECT id, user_id, title, images, remaining_portions, credit_price FROM kitchen_posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [data.postId]
    );
    if (postResult.rows.length === 0) {
      throw new NotFoundError('美食');
    }
    const post = postResult.rows[0];

    // 2. 校验份数
    if (post.remaining_portions < data.quantity) {
      throw new BadRequestError('剩余份数不足');
    }

    // 3. 校验积分并冻结（统一走 creditService，行锁防双花）
    const price = post.credit_price * data.quantity;
    if (price > 0) {
      await creditService.freezeCredits(
        client,
        userId,
        price,
        '预约美食',
        post.id,
        'kitchen_order',
      );
    }

    // 4. 减少剩余份数
    await client.query(
      'UPDATE kitchen_posts SET remaining_portions = remaining_portions - $1 WHERE id = $2',
      [data.quantity, data.postId]
    );

    // 5. 如果份数卖完，更新状态
    if (post.remaining_portions - data.quantity === 0) {
      await client.query(
        "UPDATE kitchen_posts SET status = 'sold_out' WHERE id = $1",
        [data.postId]
      );
    }

    // 6. 创建订单
    const orderResult = await client.query(
      `INSERT INTO kitchen_orders 
       (post_id, user_id, seller_id, portions, credit_amount, pickup_type, pickup_time, delivery_address, remark, status, timeout_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW() + INTERVAL '30 minutes')
       RETURNING ${KITCHEN_ORDER_COLUMNS}`,
      [
        data.postId,
        userId,
        post.user_id,
        data.quantity,
        price,
        data.pickupType || 'self_pickup',
        data.pickupTime || null,
        data.deliveryAddress || null,
        data.remark || null
      ]
    );

    return toOrderResponse(orderResult.rows[0], {
      id: post.id,
      title: post.title,
      images: post.images
    });
  });

  // 创建成功后写入幂等缓存，防止短时间内重复提交
  await idempotency.setIdempotencyResult(idempotencyKey, result);
  return result;
}

// 确认订单
async function confirm(orderId: string, sellerId: string) {
  // 使用事务 + FOR UPDATE 行锁，防止并发确认破坏订单状态机一致性
  const order = await transaction(async (client) => {
    const result = await client.query<KitchenOrderRow>(
      `SELECT ${KITCHEN_ORDER_COLUMNS} FROM kitchen_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('订单');
    }
    const order = result.rows[0];

    if (order.seller_id !== sellerId) {
      throw new PermissionDeniedError('只有分享者可以确认订单');
    }
    if (order.status !== 'pending') {
      throw new OrderStatusInvalidError('只能确认待确认的订单');
    }

    await client.query(
      "UPDATE kitchen_orders SET status = 'confirmed', updated_at = NOW() WHERE id = $1",
      [orderId]
    );

    return result.rows[0];
  });

  // 通知买家：订单已被分享者确认（通知失败不影响主流程）
  notificationService.notifyOrderStatusChange(
    order.user_id,
    orderId,
    'kitchen_order',
    'confirmed',
  ).catch(() => {});

  return { ...toOrderResponse(order), status: 'confirmed' };
}

// 完成订单（含评价和积分结算）
async function complete(orderId: string, userId: string, reviewData: {
  rating: number;
  content?: string;
}) {
  // 校验评分范围（必须在 1-5 之间）
  if (reviewData.rating < 1 || reviewData.rating > 5) {
    throw new BadRequestError('评分必须在1-5之间');
  }
  return await transaction(async (client) => {
    // 1. 查询订单
    const orderResult = await client.query(
      `SELECT ${KITCHEN_ORDER_COLUMNS} FROM kitchen_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw new NotFoundError('订单');
    }
    const order = orderResult.rows[0];

    if (order.user_id !== userId) {
      throw new PermissionDeniedError('只有领取者可以完成订单');
    }
    if (order.status !== 'confirmed') {
      throw new OrderStatusInvalidError('只能完成已确认的订单');
    }

    // 2. 结算积分给分享者（统一走 creditService）
    if (order.credit_amount > 0) {
      await creditService.settleCredits(
        client,
        order.user_id,
        order.seller_id,
        order.credit_amount,
        orderId,
        'kitchen_order',
      );
    }

    // 3. 更新订单状态
    await client.query(
      "UPDATE kitchen_orders SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1",
      [orderId]
    );

    // 4. 创建评价
    if (reviewData.rating) {
      await client.query(
        `INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
         VALUES ($1, $2, $3, 'kitchen', $4, $5)`,
        [userId, order.seller_id, orderId, reviewData.rating, reviewData.content || null]
      );

      // 5. 更新分享者信誉分（统一使用最近50条评价，与其他模块保持一致）
      await reputationService.updateReputationScore(client, order.seller_id);
    }

    // 通知卖家：订单已被买家完成（通知失败不影响主流程）
    notificationService.notifyOrderStatusChange(
      order.seller_id,
      orderId,
      'kitchen_order',
      'completed',
    ).catch(() => {});

    return { ...toOrderResponse(order), status: 'completed' };
  });
}

// 取消订单
async function cancel(orderId: string, userId: string) {
  return await transaction(async (client) => {
    // 1. 查询订单
    const orderResult = await client.query(
      `SELECT ${KITCHEN_ORDER_COLUMNS} FROM kitchen_orders WHERE id = $1 FOR UPDATE`,
      [orderId]
    );
    if (orderResult.rows.length === 0) {
      throw new NotFoundError('订单');
    }
    const order = orderResult.rows[0];

    // 2. 校验权限（买家或卖家都可以取消）
    if (order.user_id !== userId && order.seller_id !== userId) {
      throw new PermissionDeniedError();
    }
    if (!['pending', 'confirmed'].includes(order.status)) {
      throw new OrderStatusInvalidError('只能取消待确认或已确认的订单');
    }

    // 3. 退还积分（统一走 creditService，解冻买家冻结积分）
    if (order.credit_amount > 0) {
      await creditService.unfreezeCredits(
        client,
        order.user_id,
        order.credit_amount,
        '订单取消退还',
        orderId,
        'kitchen_order',
      );
    }

    // 4. 恢复美食份数
    await client.query(
      'UPDATE kitchen_posts SET remaining_portions = remaining_portions + $1 WHERE id = $2',
      [order.portions, order.post_id]
    );

    // 5. 查询恢复后的剩余份数，仅当 > 0 时才将 sold_out 恢复为 active
    //    避免帖子原本就是 sold_out（非本次订单触发）被误恢复
    const postAfterResult = await client.query(
      'SELECT remaining_portions FROM kitchen_posts WHERE id = $1',
      [order.post_id]
    );
    if (postAfterResult.rows[0].remaining_portions > 0) {
      await client.query(
        "UPDATE kitchen_posts SET status = 'active' WHERE id = $1 AND status = 'sold_out'",
        [order.post_id]
      );
    }

    // 6. 更新订单状态
    await client.query(
      "UPDATE kitchen_orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
      [orderId]
    );

    // 通知对方：订单已被取消（取消者是买家则通知卖家，反之亦然）
    const otherUserId = userId === order.user_id ? order.seller_id : order.user_id;
    notificationService.notifyOrderStatusChange(
      otherUserId,
      orderId,
      'kitchen_order',
      'cancelled',
    ).catch(() => {});

    return { ...toOrderResponse(order), status: 'cancelled' };
  });
}

// 获取订单列表
async function getList(userId: string, filters: {
  role?: 'buyer' | 'seller';
  status?: string;
} = {}, page: number = 1, pageSize: number = 20) {
  const conditions: string[] = ['ko.deleted_at IS NULL'];
  // SQL 参数数组：收紧为 SqlParam[]，避免误传函数/Symbol 等非 SQL 友好类型
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (filters.role === 'buyer') {
    conditions.push(`ko.user_id = $${paramIndex++}`);
    params.push(userId);
  } else if (filters.role === 'seller') {
    conditions.push(`ko.seller_id = $${paramIndex++}`);
    params.push(userId);
  } else {
    conditions.push(`(ko.user_id = $${paramIndex++} OR ko.seller_id = $${paramIndex++})`);
    params.push(userId, userId);
  }

  if (filters.status) {
    conditions.push(`ko.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  const whereClause = conditions.join(' AND ');

  // 查询总数
  const countResult = await query(
    `SELECT COUNT(*) FROM kitchen_orders ko WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // 查询列表
  const offset = (page - 1) * pageSize;
  const listResult = await query<KitchenOrderListRow>(
    `SELECT ko.*, 
            kp.title as post_title, kp.images as post_images,
            buyer.nickname as buyer_nickname, buyer.avatar as buyer_avatar,
            seller.nickname as seller_nickname, seller.avatar as seller_avatar
     FROM kitchen_orders ko
     LEFT JOIN kitchen_posts kp ON ko.post_id = kp.id
     LEFT JOIN users buyer ON ko.user_id = buyer.id
     LEFT JOIN users seller ON ko.seller_id = seller.id
     WHERE ${whereClause}
     ORDER BY ko.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, pageSize, offset]
  );

  const list = listResult.rows.map(row => toOrderResponse(
    row,
    // null → undefined 转换：DB 行的 nullable 字段需匹配 brief 接口的 optional 语义
    { id: row.post_id, title: row.post_title ?? undefined, images: row.post_images ?? undefined },
    { id: row.user_id, nickname: row.buyer_nickname ?? undefined, avatar: row.buyer_avatar ?? undefined },
    { id: row.seller_id, nickname: row.seller_nickname ?? undefined, avatar: row.seller_avatar ?? undefined }
  ));

  return createPaginatedResponse(list, total, page, pageSize);
}

export const kitchenOrderService = {
  create,
  confirm,
  complete,
  cancel,
  getList,
  toOrderResponse
};
