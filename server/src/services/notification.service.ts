import { query } from '../config/database';
import { createPaginatedResponse } from '../utils/pagination';
import { sendToUser } from '../websocket/index';
import { dispatchExternalChannels } from './notification-channels';

// 通知类型：订单状态变更、求助响应、举报结果、系统通知
export type NotificationType = 'order_status' | 'emergency_response' | 'report_result' | 'system';

// notifications 表显式查询列：替代 SELECT *，防御未来新增字段意外泄露
// 字段对齐 NotificationRow 接口声明，列为硬编码常量非用户输入，模板插值无注入风险
const NOTIFICATION_COLUMNS = `id, user_id, type, title, content, reference_id, reference_type,
  read_at, created_at`;

// 关联类型：技能订单、厨房订单、时间银行订单、拼单、应急求助、家庭绑定
// 扩展原因：原本仅覆盖 skill/kitchen/emergency，time-bank 与 group-order 接入通知后需要对应关联类型
export type ReferenceType = 'skill_order' | 'kitchen_order' | 'time_order' | 'group_order' | 'emergency_request' | 'family_binding';

// 通知数据结构
export interface NotificationData {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content?: string;
  referenceId?: string;
  referenceType?: ReferenceType;
  readAt?: string;
  createdAt: string;
}

// 创建通知参数
export interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  content?: string;
  referenceId?: string;
  referenceType?: ReferenceType;
}

// notifications 表行类型：与数据库列结构对齐，避免 row: any 逃逸类型检查
// 设计原因：原 row: any 让字段拼写错误与 null 误用静默通过编译，
// 收紧后访问不存在字段会立即报错，nullable 字段需显式处理 null → undefined 转换
interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  content: string | null;
  reference_id: string | null;
  reference_type: string | null;
  read_at: Date | null;
  created_at: Date;
}

// 将数据库行转换为通知对象
function toNotification(row: NotificationRow): NotificationData {
  return {
    id: row.id,
    userId: row.user_id,
    // DB 存储为 varchar，运行时由 CHECK 约束保证为合法枚举值，断言为联合类型
    type: row.type as NotificationType,
    title: row.title,
    // nullable 字段 null → undefined：匹配 NotificationData 的 optional 语义，
    // 前端 falsy 判断行为一致（null 与 undefined 都是 falsy）
    content: row.content ?? undefined,
    referenceId: row.reference_id ?? undefined,
    referenceType: (row.reference_type ?? undefined) as ReferenceType | undefined,
    // read_at 为 null 时返回 undefined，匹配 readAt?: string；
    // 原代码 || row.read_at 在 null 时返回 null，与 optional 类型不匹配（被 any 掩盖）
    readAt: row.read_at?.toISOString() ?? undefined,
    // created_at 为 NOT NULL，toISOString() 一定可调用；String() 兜底防御非 Date 情况
    createdAt: row.created_at?.toISOString() ?? String(row.created_at),
  };
}

// 创建通知并实时推送
async function createNotification(params: CreateNotificationParams): Promise<NotificationData> {
  // 泛型 NotificationRow：INSERT RETURNING * 结果传给 toNotification，需精确类型
  const { rows } = await query<NotificationRow>(
    `INSERT INTO notifications (user_id, type, title, content, reference_id, reference_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [params.userId, params.type, params.title, params.content || null, params.referenceId || null, params.referenceType || null],
  );

  const notification = toNotification(rows[0]);

  // 通过 WebSocket 实时推送通知给用户
  sendToUser(params.userId, { type: 'notification', data: notification });

  // 外部通道分发（邮件/短信）：由配置开关控制，未启用则内部直接返回
  // 使用 catch 吞错，确保外部通道故障不影响站内信主流程（与 skill-order 通知调用一致）
  dispatchExternalChannels(notification).catch(() => {});

  return notification;
}

// 获取用户通知列表（分页）
async function getNotifications(
  userId: string,
  page: number = 1,
  pageSize: number = 20,
): Promise<{ list: NotificationData[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    // COUNT 返回字符串，需泛型 { count: string } 让 parseInt 拿到字符串
    query<{ count: string }>('SELECT COUNT(*) FROM notifications WHERE user_id = $1', [userId]),
    query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const list = listResult.rows.map(toNotification);

  return createPaginatedResponse(list, total, page, pageSize);
}

// 获取未读通知数量
async function getUnreadCount(userId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL',
    [userId],
  );
  return parseInt(rows[0].count, 10);
}

// 标记单条通知已读
async function markAsRead(userId: string, notificationId: string): Promise<boolean> {
  const result = await query(
    `UPDATE notifications SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

// 标记所有通知已读
async function markAllAsRead(userId: string): Promise<number> {
  const result = await query(
    `UPDATE notifications SET read_at = NOW()
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return result.rowCount || 0;
}

// 订单状态变更通知标题映射
// 覆盖 skill/kitchen/time/group 四类订单的全部状态
const ORDER_STATUS_TITLES: Record<string, string> = {
  pending: '订单已创建',
  accepted: '订单已被接受',
  rejected: '订单已被拒绝',
  confirmed: '订单已确认',
  in_progress: '订单正在进行',
  completed: '订单已完成',
  cancelled: '订单已取消',
  disputed: '订单已发起争议',
  // 拼单专属状态
  open: '拼单已开启',
  full: '拼单已满员',
  ongoing: '拼单进行中',
};

// 创建订单状态变更通知
async function notifyOrderStatusChange(
  userId: string,
  orderId: string,
  orderType: ReferenceType,
  newStatus: string,
  extraContent?: string,
): Promise<NotificationData> {
  const title = ORDER_STATUS_TITLES[newStatus] || `订单状态更新：${newStatus}`;
  const content = extraContent || `您的订单状态已变更为「${newStatus}」，请及时查看处理。`;

  return createNotification({
    userId,
    type: 'order_status',
    title,
    content,
    referenceId: orderId,
    referenceType: orderType,
  });
}

// 创建求助响应通知
async function notifyEmergencyResponse(
  requesterId: string,
  requestId: string,
  responderNickname: string,
): Promise<NotificationData> {
  return createNotification({
    userId: requesterId,
    type: 'emergency_response',
    title: '您的求助已有人响应',
    content: `${responderNickname} 已响应您的求助，请及时查看并确认。`,
    referenceId: requestId,
    referenceType: 'emergency_request',
  });
}

// 创建举报处理结果通知
async function notifyReportResult(
  reporterId: string,
  requestId: string,
  resolution: string,
): Promise<NotificationData> {
  return createNotification({
    userId: reporterId,
    type: 'report_result',
    title: '您的举报已处理',
    content: `处理结果：${resolution}`,
    referenceId: requestId,
    referenceType: 'emergency_request',
  });
}

// 亲情绑定状态变更通知
// action 取值：request（发起绑定，通知对方）/ confirmed（对方确认，通知发起人）/ rejected（对方拒绝，通知发起人）/ unbound（对方解绑，通知另一方）
async function notifyFamilyBindingChange(
  userId: string,
  bindingId: string,
  action: 'request' | 'confirmed' | 'rejected' | 'unbound',
  otherNickname?: string,
): Promise<NotificationData> {
  const titleMap = {
    request: '收到新的亲情绑定请求',
    confirmed: '亲情绑定已确认',
    rejected: '亲情绑定被拒绝',
    unbound: '亲情绑定已解除',
  };
  const contentMap = {
    request: `${otherNickname || '一位用户'} 向您发起了亲情绑定请求，请及时确认。`,
    confirmed: `${otherNickname || '对方'} 已确认您的亲情绑定请求，绑定已生效。`,
    rejected: `${otherNickname || '对方'} 拒绝了您的亲情绑定请求。`,
    unbound: `${otherNickname || '对方'} 已解除与您的亲情绑定关系。`,
  };

  return createNotification({
    userId,
    type: 'system',
    title: titleMap[action],
    content: contentMap[action],
    referenceId: bindingId,
    referenceType: 'family_binding',
  });
}

// 时间币转赠/捐赠到账通知
// transactionType 取值：transfer（用户间转赠）/ donate（捐赠到账）
// transactionId 可选：transfer/donate 场景下若不查询流水 id 则不传，referenceId 落 null
async function notifyTimeBankTransaction(
  toUserId: string,
  transactionId: string | undefined,
  transactionType: 'transfer' | 'donate',
  amount: number,
  fromNickname?: string,
): Promise<NotificationData> {
  const titleMap = {
    transfer: '收到时间币转赠',
    donate: '收到时间币捐赠',
  };
  const contentMap = {
    transfer: `${fromNickname || '一位用户'} 向您转赠了 ${amount} 个时间币。`,
    donate: `${fromNickname || '一位用户'} 向您捐赠了 ${amount} 个时间币。`,
  };

  return createNotification({
    userId: toUserId,
    type: 'system',
    title: titleMap[transactionType],
    content: contentMap[transactionType],
    referenceId: transactionId,
    referenceType: 'time_order',
  });
}

export const notificationService = {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  notifyOrderStatusChange,
  notifyEmergencyResponse,
  notifyReportResult,
  notifyFamilyBindingChange,
  notifyTimeBankTransaction,
};