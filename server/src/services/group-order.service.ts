import { query, transaction, SqlParam } from '../config/database';
import { NotFoundError, BadRequestError, ForbiddenError } from '../utils/errors';
import { creditService } from './credit.service';
import { logger } from '../utils/logger';
import { safeNotify } from '../utils/safeNotify';
import { notificationService } from './notification.service';
import { prefixColumns } from '../utils/sql';
import { sanitizeObject } from '../utils/sanitize';

// 成团后(ongoing)退出的部分退款比例：退还参与者 90%，10% 作为已发生成本补偿给发起人
const ONGOING_REFUND_RATE = 0.9;

// group_orders 表列名常量：显式列名替代 SELECT *，防御未来新增字段意外泄露
// 字段对齐 GroupOrderRow 接口声明（不含 deleted_at/cancel_reason/cancelled_at/completed_at：
// 查询条件已过滤 deleted_at，其余字段在 SELECT 后不被读取，仅在 UPDATE 中设置）
const GROUP_ORDER_COLUMNS = `id, initiator_id, title, description, target_amount, current_amount,
  min_participants, max_participants, current_participants, address, deadline, status,
  created_at, updated_at`;

// group_order_participants 表列名常量：显式列名防御未来字段泄露
const GROUP_ORDER_PARTICIPANT_COLUMNS = `id, group_order_id, user_id, amount, status, created_at`;

// 拼单 DB Row：与 group_orders 表结构对齐
interface GroupOrderRow {
  id: string;
  initiator_id: string;
  title: string;
  description: string | null;
  target_amount: number;
  current_amount: number;
  min_participants: number;
  max_participants: number;
  current_participants: number;
  address: string;
  deadline: Date;
  status: string;
  created_at: Date;
  updated_at: Date;
}

// 列表/详情查询行：GroupOrderRow + JOIN 引入的发起人字段
interface GroupOrderListRow extends GroupOrderRow {
  // LEFT JOIN users：group_orders.initiator_id 为 NOT NULL 外键，业务上一定有对应 user
  initiator_uid: string;
  initiator_nickname: string | null;
  initiator_avatar: string | null;
}

// 发起人简要信息（toGroupOrderResponse 的 initiator 参数）
interface UserBrief {
  id: string;
  nickname?: string | null;
  avatar?: string | null;
}

// 参与者简要信息（toGroupOrderResponse 的 participants 参数）
interface ParticipantBrief {
  id: string;
  nickname?: string | null;
  avatar?: string | null;
  amount: number;
  status: string;
}

// 参与者查询行：group_order_participants 表 + JOIN 引入的用户字段
interface GroupOrderParticipantRow {
  user_id: string;
  group_order_id: string;
  amount: number;
  status: string;
  created_at: Date;
  nickname: string | null;
  avatar: string | null;
}

// 拼单数据序列化
export function toGroupOrderResponse(
  row: GroupOrderRow,
  initiator?: UserBrief,
  participants?: ParticipantBrief[],
) {
  return {
    id: row.id,
    initiatorId: row.initiator_id,
    initiator: initiator,
    title: row.title,
    description: row.description,
    targetAmount: row.target_amount,
    currentAmount: row.current_amount,
    minParticipants: row.min_participants,
    maxParticipants: row.max_participants,
    currentParticipants: row.current_participants,
    address: row.address,
    deadline: row.deadline,
    status: row.status,
    participants: participants,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// 创建拼单
async function create(userId: string, data: {
  title: string;
  description?: string;
  targetAmount: number;
  minParticipants: number;
  maxParticipants: number;
  address: string;
  deadline: string;
}) {
  // XSS 清洗：title/description/address 三个用户输入字段在拼单列表/详情中高频渲染
  // 设计原因：未清洗的恶意脚本会触发存储型 XSS，影响所有浏览该拼单的用户
  const sanitized = sanitizeObject(data, ['title', 'description', 'address']);

  // 事务包裹三条 SQL：避免 INSERT group_orders 成功但参与记录或计数更新失败时
  // 留下 current_participants = 0 且无发起人参与记录的孤儿拼单，破坏后续 join/cancel 逻辑
  const result = await transaction(async (client) => {
    const insertResult = await client.query<GroupOrderRow>(
      `INSERT INTO group_orders
       (initiator_id, title, description, target_amount, min_participants, max_participants, address, deadline, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
       RETURNING ${GROUP_ORDER_COLUMNS}`,
      [
        userId,
        sanitized.title,
        sanitized.description || null,
        sanitized.targetAmount,
        sanitized.minParticipants,
        sanitized.maxParticipants,
        sanitized.address,
        sanitized.deadline
      ]
    );

    // 发起人也算一个参与者
    await client.query(
      `INSERT INTO group_order_participants (group_order_id, user_id, amount, status)
       VALUES ($1, $2, 0, 'paid')`,
      [insertResult.rows[0].id, userId]
    );

    // 更新参与者数量
    await client.query(
      'UPDATE group_orders SET current_participants = 1 WHERE id = $1',
      [insertResult.rows[0].id]
    );

    return insertResult;
  });

  return toGroupOrderResponse(result.rows[0], {
    id: userId,
    nickname: null,
    avatar: null
  });
}

// 参与拼单
async function join(groupOrderId: string, userId: string, amount: number) {
  return await transaction(async (client) => {
    // 1. 查询拼单
    const orderResult = await client.query(
      `SELECT ${GROUP_ORDER_COLUMNS} FROM group_orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [groupOrderId]
    );
    if (orderResult.rows.length === 0) {
      throw new NotFoundError('拼单');
    }
    const order = orderResult.rows[0];

    // 2. 校验状态
    if (order.status !== 'open') {
      throw new BadRequestError('拼单已关闭');
    }

    // 3. 校验截止时间
    if (new Date(order.deadline) < new Date()) {
      throw new BadRequestError('拼单已截止');
    }

    // 4. 校验人数
    if (order.current_participants >= order.max_participants) {
      throw new BadRequestError('拼单已满');
    }

    // 5. 校验是否已参与
    const existingResult = await client.query(
      'SELECT id FROM group_order_participants WHERE group_order_id = $1 AND user_id = $2',
      [groupOrderId, userId]
    );
    if (existingResult.rows.length > 0) {
      throw new BadRequestError('已参与此拼单');
    }

    // 6. 扣减积分（统一走 creditService，行锁防双花）
    if (amount > 0) {
      await creditService.freezeCredits(
        client,
        userId,
        amount,
        '参与拼单',
        groupOrderId,
        'group_order',
      );
    }

    // 7. 创建参与记录
    await client.query(
      `INSERT INTO group_order_participants (group_order_id, user_id, amount, status)
       VALUES ($1, $2, $3, 'paid')`,
      [groupOrderId, userId, amount]
    );

    // 8. 更新拼单
    const newAmount = order.current_amount + amount;
    const newParticipants = order.current_participants + 1;
    let newStatus = order.status;

    if (newParticipants >= order.max_participants) {
      newStatus = 'full';
    }

    await client.query(
      `UPDATE group_orders
       SET current_amount = $1, current_participants = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [newAmount, newParticipants, newStatus, groupOrderId]
    );

    // 拼单满员时通知发起人（重要状态变更）；未满员的加入不通知，避免通知噪音
    if (newStatus === 'full') {
      // safeNotify 吞错不阻塞主流程，同时记录 warn 日志便于监控
      safeNotify(
        notificationService.notifyOrderStatusChange(
          order.initiator_id,
          groupOrderId,
          'group_order',
          'full',
        ),
        { userId: order.initiator_id, orderId: groupOrderId, groupId: groupOrderId },
      );
    }

    return {
      id: groupOrderId,
      currentAmount: newAmount,
      currentParticipants: newParticipants,
      status: newStatus
    };
  });
}

// 参与者退出拼单：
// - open/full 状态：全额退款
// - ongoing 状态（成团后进行中）：部分退款，扣除 10% 作为已发生成本补偿给发起人
// - completed/cancelled 状态：禁止退出
// - 发起人不可退出，应使用取消功能
async function exit(groupOrderId: string, userId: string): Promise<void> {
  await transaction(async (client) => {
    // 1. 锁定拼单行，防止并发修改
    const orderResult = await client.query(
      `SELECT ${GROUP_ORDER_COLUMNS} FROM group_orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [groupOrderId],
    );
    if (orderResult.rows.length === 0) {
      throw new NotFoundError('拼单');
    }
    const order = orderResult.rows[0];

    // 2. 发起人不能退出，应使用取消功能
    if (order.initiator_id === userId) {
      throw new BadRequestError('发起者不能退出拼单，请使用取消功能');
    }

    // 3. 查询参与者记录
    const participantResult = await client.query(
      `SELECT ${GROUP_ORDER_PARTICIPANT_COLUMNS} FROM group_order_participants WHERE group_order_id = $1 AND user_id = $2`,
      [groupOrderId, userId],
    );
    if (participantResult.rows.length === 0) {
      throw new BadRequestError('未参与此拼单');
    }
    const participant = participantResult.rows[0];

    // 4. 已退款的参与者无需重复操作
    if (participant.status === 'refunded') {
      throw new BadRequestError('已退款，无需重复操作');
    }

    // 5. 状态校验：completed/cancelled 禁止退出，ongoing 走部分退款分支
    if (!['open', 'full', 'ongoing'].includes(order.status)) {
      throw new BadRequestError('当前拼单状态不允许退出');
    }

    // 6. 退款：根据拼单状态决定全额或部分退款
    //    - open/full：未成团或已成团未开始，全额解冻退还
    //    - ongoing：成团后进行中，退还 90% 给参与者，10% 补偿给发起人
    if (['open', 'full'].includes(order.status)) {
      if (participant.amount > 0) {
        await creditService.unfreezeCredits(
          client,
          userId,
          participant.amount,
          '拼单退出退还',
          groupOrderId,
          'group_order',
        );
      }
    } else if (order.status === 'ongoing') {
      // 向下取整避免多退，差额归发起人，保证总额守恒
      // amount>0 时至少退 1，避免 amount=1 时 Math.floor(0.9)=0 全额归发起人违反 90% 设计意图
      const refundAmount = participant.amount > 0
        ? Math.max(1, Math.floor(participant.amount * ONGOING_REFUND_RATE))
        : 0;
      const feeAmount = participant.amount - refundAmount;

      if (refundAmount > 0) {
        await creditService.unfreezeCredits(
          client,
          userId,
          refundAmount,
          '拼单退出部分退还',
          groupOrderId,
          'group_order',
        );
      }
      // 已发生成本补偿给发起人（食材采购、准备投入等）
      if (feeAmount > 0) {
        await creditService.earnCredits(
          client,
          order.initiator_id,
          feeAmount,
          '拼单退出成本补偿',
          groupOrderId,
          'group_order',
        );
      }
    }

    // 7. 标记参与者状态为 refunded
    await client.query(
      `UPDATE group_order_participants SET status = 'refunded' WHERE group_order_id = $1 AND user_id = $2`,
      [groupOrderId, userId],
    );

    // 8. 更新拼单的 current_amount 和 current_participants
    const newAmount = order.current_amount - participant.amount;
    const newParticipants = order.current_participants - 1;
    let newStatus = order.status;

    // 若原状态为 full 且退出后人数 < max_participants，回退为 open
    // ongoing 状态保持不变（已成团，不回退）
    if (order.status === 'full' && newParticipants < order.max_participants) {
      newStatus = 'open';
    }

    await client.query(
      `UPDATE group_orders
       SET current_amount = $1, current_participants = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [newAmount, newParticipants, newStatus, groupOrderId],
    );

    logger.info(
      { orderId: groupOrderId, userId, amount: participant.amount, status: order.status },
      '参与者退出拼单并已退款',
    );

    // 通知发起人：有参与者退出拼单（safeNotify 吞错不阻塞主流程，同时记录 warn 日志便于监控）
    safeNotify(
      notificationService.createNotification({
        userId: order.initiator_id,
        type: 'system',
        title: '有参与者退出拼单',
        content: '一位参与者已退出您的拼单，相关积分已退还。',
        referenceId: groupOrderId,
        referenceType: 'group_order',
      }),
      { userId: order.initiator_id, orderId: groupOrderId, groupId: groupOrderId },
    );
  });
}

// 获取拼单列表
async function getList(filters: {
  status?: string;
} = {}, page: number = 1, pageSize: number = 20) {
  // conditions 默认附加 90 天时间窗：
  // group_orders 表只增不减，无时间窗会持续触发全表 COUNT 与扫描。公开接口每刷新一次都打满 DB。
  // 与 emergency.service.getRequests / admin.service.getReports 保持一致模式：
  // INTERVAL 用 SQL 字面量不加参数化，参数列表稳定。90 天覆盖完整拼单生命周期（含配送/结算），
  // 超出 90 天的拼单通常已结束，对当前用户价值低。
  const conditions: string[] = ['go.deleted_at IS NULL', "go.created_at >= NOW() - INTERVAL '90 days'"];
  // SQL 参数数组：收紧为 SqlParam[]，避免误传函数/Symbol 等非 SQL 友好类型
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (filters.status) {
    conditions.push(`go.status = $${paramIndex++}`);
    params.push(filters.status);
  }

  const whereClause = conditions.join(' AND ');

  // 查询总数
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) FROM group_orders go WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // 查询列表
  const offset = (page - 1) * pageSize;
  const listResult = await query<GroupOrderListRow>(
    `SELECT ${prefixColumns(GROUP_ORDER_COLUMNS, 'go')}, u.id as initiator_uid, u.nickname as initiator_nickname, u.avatar as initiator_avatar
     FROM group_orders go
     LEFT JOIN users u ON go.initiator_id = u.id
     WHERE ${whereClause}
     ORDER BY go.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, pageSize, offset]
  );

  return {
    list: listResult.rows.map(row => toGroupOrderResponse(
      row,
      { id: row.initiator_uid, nickname: row.initiator_nickname, avatar: row.initiator_avatar }
    )),
    total,
    page,
    pageSize
  };
}

// 获取拼单详情
async function getById(id: string) {
  const orderResult = await query<GroupOrderListRow>(
    `SELECT ${prefixColumns(GROUP_ORDER_COLUMNS, 'go')}, u.id as initiator_uid, u.nickname as initiator_nickname, u.avatar as initiator_avatar
     FROM group_orders go
     LEFT JOIN users u ON go.initiator_id = u.id
     WHERE go.id = $1 AND go.deleted_at IS NULL`,
    [id]
  );

  if (orderResult.rows.length === 0) {
    throw new NotFoundError('拼单');
  }
  const row = orderResult.rows[0];

  // 查询参与人列表
  // 加 LIMIT 100 防御性约束：拼单参与人受 max_participants 业务约束（通常 < 100），
  // 超限通常意味着脏数据，提前截断避免极端场景下参与人列表拖累详情页渲染
  const participantsResult = await query<GroupOrderParticipantRow>(
    `SELECT ${prefixColumns(GROUP_ORDER_PARTICIPANT_COLUMNS, 'gop')}, u.nickname, u.avatar
     FROM group_order_participants gop
     LEFT JOIN users u ON gop.user_id = u.id
     WHERE gop.group_order_id = $1
     ORDER BY gop.created_at
     LIMIT 100`,
    [id]
  );

  return toGroupOrderResponse(
    row,
    { id: row.initiator_uid, nickname: row.initiator_nickname, avatar: row.initiator_avatar },
    participantsResult.rows.map(p => ({
      id: p.user_id,
      nickname: p.nickname,
      avatar: p.avatar,
      amount: p.amount,
      status: p.status
    }))
  );
}

// 取消拼单：仅发起人可取消，事务内退款所有已付款参与者
async function cancel(groupOrderId: string, userId: string, reason?: string): Promise<void> {
  await transaction(async (client) => {
    // 1. 锁定拼单行，防止并发修改
    const orderResult = await client.query(
      `SELECT ${GROUP_ORDER_COLUMNS} FROM group_orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [groupOrderId],
    );
    if (orderResult.rows.length === 0) {
      throw new NotFoundError('拼单');
    }
    const order = orderResult.rows[0];

    // 2. 权限校验：仅发起人可取消
    if (order.initiator_id !== userId) {
      throw new ForbiddenError('只有发起人可以取消拼单');
    }

    // 3. 状态校验：已完成或已取消的拼单不可再次取消
    if (order.status === 'cancelled') {
      throw new BadRequestError('拼单已取消');
    }
    if (order.status === 'completed') {
      throw new BadRequestError('拼单已完成，无法取消');
    }

    // 4. 查询所有已付款参与者（status='paid'），退款并记录流水
    const participantsResult = await client.query(
      `SELECT user_id, amount FROM group_order_participants
       WHERE group_order_id = $1 AND status = 'paid' FOR UPDATE`,
      [groupOrderId],
    );

    // 4.1 逐条调用 creditService.unfreezeCredits 退还积分账本
    // 设计原因：unfreezeCredits 涉及积分流水 INSERT 与 users 余额 UPDATE，需逐条事务内执行保证账本一致性
    for (const p of participantsResult.rows) {
      // 仅对实际支付金额大于 0 的参与者执行退款
      if (p.amount > 0) {
        // 统一走 creditService 解冻积分，退还参与者余额并记录 unfreeze 流水
        await creditService.unfreezeCredits(
          client,
          p.user_id,
          p.amount,
          '拼单取消退还',
          groupOrderId,
          'group_order',
        );
      }
    }

    // 4.2 批量更新参与者状态为 refunded：单条 UPDATE 替代循环内 N 次 UPDATE
    // 性能改进：拼单人数较多时事务持锁时间从 O(N) 降至 O(1)，避免 N+1 查询模式
    const participantUserIds = participantsResult.rows.map((p) => p.user_id);
    if (participantUserIds.length > 0) {
      await client.query(
        `UPDATE group_order_participants
         SET status = 'refunded'
         WHERE group_order_id = $1 AND user_id = ANY($2)`,
        [groupOrderId, participantUserIds],
      );
    }

    // 5. 更新拼单状态为 cancelled，记录取消原因与时间
    await client.query(
      `UPDATE group_orders
       SET status = 'cancelled', cancel_reason = $1, cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reason || null, groupOrderId],
    );

    // 6. 通知所有已付款参与者：拼单已取消（批量通知，单个失败不影响整体）
    // safeNotify 吞错不阻塞主流程，同时记录 warn 日志便于监控
    for (const p of participantsResult.rows) {
      safeNotify(
        notificationService.notifyOrderStatusChange(
          p.user_id,
          groupOrderId,
          'group_order',
          'cancelled',
        ),
        { userId: p.user_id, orderId: groupOrderId, groupId: groupOrderId },
      );
    }
  });
}

// 完成拼单：校验达到最低人数后，将累计金额结算给发起人
async function complete(groupOrderId: string, userId: string): Promise<void> {
  await transaction(async (client) => {
    // 1. 锁定拼单行
    const orderResult = await client.query(
      `SELECT ${GROUP_ORDER_COLUMNS} FROM group_orders WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [groupOrderId],
    );
    if (orderResult.rows.length === 0) {
      throw new NotFoundError('拼单');
    }
    const order = orderResult.rows[0];

    // 2. 权限校验：仅发起人可完成结算
    if (order.initiator_id !== userId) {
      throw new ForbiddenError('只有发起人可以完成拼单');
    }

    // 3. 状态校验：仅 open/full/ongoing 状态可完成
    if (!['open', 'full', 'ongoing'].includes(order.status)) {
      throw new BadRequestError('当前拼单状态不允许完成操作');
    }

    // 4. 人数校验：必须达到最低参与人数
    if (order.current_participants < order.min_participants) {
      throw new BadRequestError('未达到最低参与人数，无法完成');
    }

    // 5. 结算积分给发起人：将累计金额转入发起人账户
    //    拼单场景下参与者已 freeze 扣减，此处仅给发起人加余额并记录 earn 流水
    if (order.current_amount > 0) {
      await creditService.earnCredits(
        client,
        order.initiator_id,
        order.current_amount,
        '拼单结算收入',
        groupOrderId,
        'group_order',
      );
    }

    // 6. 更新拼单状态为 completed
    await client.query(
      `UPDATE group_orders SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [groupOrderId],
    );

    // 7. 通知所有仍参与的成员：拼单已完成（查询 status='paid' 的参与者，排除已退出的）
    const paidParticipantsResult = await client.query(
      `SELECT user_id FROM group_order_participants
       WHERE group_order_id = $1 AND status = 'paid'`,
      [groupOrderId],
    );
    for (const p of paidParticipantsResult.rows) {
      // safeNotify 吞错不阻塞主流程，同时记录 warn 日志便于监控
      safeNotify(
        notificationService.notifyOrderStatusChange(
          p.user_id,
          groupOrderId,
          'group_order',
          'completed',
        ),
        { userId: p.user_id, orderId: groupOrderId, groupId: groupOrderId },
      );
    }
  });
}

// 检查过期拼单：截止时间已过且未达最低人数的拼单自动取消并退款
// 返回本次处理的拼单数量
async function checkExpired(): Promise<number> {
  // 查询过期且未达最低人数的活跃拼单（open/full/ongoing 均视为活跃）
  // 同时取出 initiator_id，以便以发起人身份调用 cancel 完成权限校验
  const expiredResult = await query<{ id: string; initiator_id: string }>(
    `SELECT id, initiator_id FROM group_orders
     WHERE deadline < NOW()
       AND status IN ('open', 'full', 'ongoing')
       AND current_participants < min_participants
       AND deleted_at IS NULL`,
  );

  let processedCount = 0;
  for (const row of expiredResult.rows) {
    try {
      // 以发起人身份执行取消，使用系统默认原因
      await cancel(row.id, row.initiator_id, '拼单过期未达最低人数，自动取消');
      processedCount++;
      logger.info({ orderId: row.id }, '拼单过期已自动取消并退款');
    } catch (error) {
      // 单个拼单取消失败不影响其他拼单处理
      logger.error({ err: error, orderId: row.id }, '拼单过期自动取消失败');
    }
  }

  return processedCount;
}

export const groupOrderService = {
  create,
  join,
  exit,
  cancel,
  complete,
  checkExpired,
  getList,
  getById,
  toGroupOrderResponse
};
