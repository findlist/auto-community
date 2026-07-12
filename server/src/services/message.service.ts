import { query, SqlParam } from '../config/database';
import { ForbiddenError } from '../utils/errors';
import { createCursorPaginatedResponse, CursorPaginatedResponse } from '../utils/pagination';

// 支持的业务模块类型
export type OrderType = 'skill' | 'kitchen' | 'time' | 'emergency';

// messages 表显式查询列：替代 SELECT *，防御未来新增字段意外泄露
// 字段对齐 MessageRow 接口声明，列为硬编码常量非用户输入，模板插值无注入风险
const MESSAGE_COLUMNS = `id, sender_id, receiver_id, order_id, order_type, content, type,
  read_at, created_at`;

/**
 * messages 表行类型
 * 设计原因：原 toMessage(row: any) 让 row 各字段为 any，编译期无法发现字段拼写错误；
 * 收紧后 read_at/created_at 为 Date 类型（pg TIMESTAMP 默认解析行为），与 DB 实际行为对齐
 */
interface MessageRow {
  id: string;
  sender_id: string;
  receiver_id: string;
  order_id: string | null;
  order_type: string;
  content: string;
  type: string;
  read_at: Date | null;
  created_at: Date;
}

// Date → ISO string：与 getMessages 返回类型 readAt: string | null / createdAt: string 对齐
// JSON 序列化时 Date 本就转为 ISO string，此处显式转换不改变 API 行为
// orderId 用 as string：getMessages 上下文带 WHERE order_id = $1，该字段必非 null；
// sendMessage 可能写入 null，但返回值由调用方直接消费，不走 getMessages 返回类型校验
function toMessage(row: MessageRow) {
  return {
    id: row.id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    orderId: row.order_id as string,
    orderType: row.order_type as OrderType,
    content: row.content,
    type: row.type,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

// 根据订单类型查询订单的双方用户 ID，并校验当前用户是否有权访问
// 返回订单的双方用户 ID（buyer/seller 或 provider/requester 或 user/responder）
async function getOrderParticipants(orderId: string, orderType: OrderType, userId: string): Promise<void> {
  let sql: string;
  let firstUserField: string;
  let secondUserField: string;

  switch (orderType) {
    case 'skill':
      sql = 'SELECT buyer_id, seller_id FROM skill_orders WHERE id = $1';
      firstUserField = 'buyer_id';
      secondUserField = 'seller_id';
      break;
    case 'kitchen':
      // kitchen_orders 中 user_id 为买家，seller_id 为卖家
      sql = 'SELECT user_id, seller_id FROM kitchen_orders WHERE id = $1';
      firstUserField = 'user_id';
      secondUserField = 'seller_id';
      break;
    case 'time':
      sql = 'SELECT provider_id, requester_id FROM time_orders WHERE id = $1';
      firstUserField = 'provider_id';
      secondUserField = 'requester_id';
      break;
    case 'emergency':
      // 应急模块：订单可能涉及发起人和多个响应者，只要用户是其中一方即可
      sql = `SELECT er.responder_id, req.user_id
             FROM emergency_responses er
             JOIN emergency_requests req ON req.id = er.request_id
             WHERE er.id = $1`;
      firstUserField = 'responder_id';
      secondUserField = 'user_id';
      break;
    default:
      throw new ForbiddenError('无效的订单类型');
  }

  const { rows } = await query(sql, [orderId]);
  if (rows.length === 0) {
    throw new ForbiddenError('无权查看此聊天记录');
  }

  const firstUserId = rows[0][firstUserField];
  const secondUserId = rows[0][secondUserField];
  if (firstUserId !== userId && secondUserId !== userId) {
    throw new ForbiddenError('无权查看此聊天记录');
  }
}

async function sendMessage(
  senderId: string,
  receiverId: string,
  orderId: string | null,
  content: string,
  type: string = 'text',
  orderType: OrderType = 'skill',
) {
  const { rows } = await query<MessageRow>(
    `INSERT INTO messages (sender_id, receiver_id, order_id, order_type, content, type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MESSAGE_COLUMNS}`,
    [senderId, receiverId, orderId, orderType, content, type],
  );

  return toMessage(rows[0]);
}

async function getMessages(
  orderId: string,
  userId: string,
  cursor: string | undefined,
  limit: number,
  orderType: OrderType = 'skill',
): Promise<CursorPaginatedResponse<{ id: string; senderId: string; receiverId: string; orderId: string; orderType: OrderType; content: string; type: string; readAt: string | null; createdAt: string }>> {
  // 先校验当前用户是否有权查看该订单的聊天记录
  await getOrderParticipants(orderId, orderType, userId);

  // 游标分页：第一页时 cursor 为空，查询最新记录
  // 查询条件：WHERE id < cursor ORDER BY id DESC LIMIT limit
  const params: SqlParam[] = [orderId, orderType, limit];
  let sql = `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE order_id = $1 AND order_type = $2`;

  if (cursor) {
    sql += ' AND id < $4 ORDER BY id DESC LIMIT $3';
    params.push(cursor);
  } else {
    sql += ' ORDER BY id DESC LIMIT $3';
  }

  const { rows } = await query<MessageRow>(sql, params);

  return createCursorPaginatedResponse(
    rows.map(toMessage),
    limit,
  );
}

async function markAsRead(orderId: string, userId: string, orderType: OrderType = 'skill') {
  const result = await query(
    `UPDATE messages SET read_at = NOW()
     WHERE order_id = $1 AND order_type = $2 AND receiver_id = $3 AND read_at IS NULL`,
    [orderId, orderType, userId],
  );

  return result.rowCount || 0;
}

async function getUnreadCount(userId: string, orderType?: OrderType) {
  // 可选按订单类型过滤未读消息数
  if (orderType) {
    const { rows } = await query(
      'SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND order_type = $2 AND read_at IS NULL',
      [userId, orderType],
    );
    return { unreadCount: parseInt(rows[0].count, 10) };
  }

  const { rows } = await query(
    'SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND read_at IS NULL',
    [userId],
  );

  return { unreadCount: parseInt(rows[0].count, 10) };
}

export const messageService = {
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCount,
};
