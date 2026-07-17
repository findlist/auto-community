import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { messageService, OrderType } from '../services/message.service';
import { query } from '../config/database';
import { env } from '../config/env';
import { redisClient } from '../config/redis';
import { logger } from '../utils/logger';

const userSockets = new Map<string, WebSocket>();

const heartbeatIntervals = new Map<string, NodeJS.Timeout>();

// 跨实例 WebSocket 消息广播频道名
const WS_BROADCAST_CHANNEL = 'ws:broadcast';

// 订阅专用 Redis 连接：duplicate 出独立连接，避免订阅模式阻塞主连接的常规命令
const pubSub = redisClient.duplicate();

// JWT Payload：与 middleware/auth.ts 保持一致
// 安全考虑：JWT 中不再携带 phone（避免 token 泄露后暴露 PII），
// phone 在需要时通过数据库查询并解密获取
interface JwtPayload {
  id: string;
  nickname: string;
  iat?: number;
  exp?: number;
}

// 根据订单类型与订单 ID 查询接收方用户 ID
// 返回订单中除发送者之外的另一方用户 ID；若订单不存在或发送者不属于该订单则返回 null
async function resolveReceiverId(orderId: string, orderType: OrderType, senderId: string): Promise<string | null> {
  switch (orderType) {
    case 'skill': {
      const { rows } = await query('SELECT buyer_id, seller_id FROM skill_orders WHERE id = $1', [orderId]);
      if (rows.length === 0) return null;
      const { buyer_id, seller_id } = rows[0];
      return buyer_id === senderId ? seller_id : buyer_id;
    }
    case 'kitchen': {
      // kitchen_orders 中 user_id 为买家，seller_id 为卖家
      const { rows } = await query('SELECT user_id, seller_id FROM kitchen_orders WHERE id = $1', [orderId]);
      if (rows.length === 0) return null;
      const { user_id, seller_id } = rows[0];
      return user_id === senderId ? seller_id : user_id;
    }
    case 'time': {
      const { rows } = await query('SELECT provider_id, requester_id FROM time_orders WHERE id = $1', [orderId]);
      if (rows.length === 0) return null;
      const { provider_id, requester_id } = rows[0];
      return provider_id === senderId ? requester_id : provider_id;
    }
    case 'emergency': {
      // 应急模块：orderId 对应 emergency_responses.id
      // 需要先查响应记录获取 responder_id 与 request_id，再查请求记录获取发起人 user_id
      const { rows } = await query(
        `SELECT er.responder_id, req.user_id
         FROM emergency_responses er
         JOIN emergency_requests req ON req.id = er.request_id
         WHERE er.id = $1`,
        [orderId],
      );
      if (rows.length === 0) return null;
      const { responder_id, user_id } = rows[0];
      return responder_id === senderId ? user_id : responder_id;
    }
    default:
      return null;
  }
}

// 发送消息给指定用户：本地有连接直接发，否则通过 Redis pub/sub 跨实例广播
// 调用方无需关心接收方连接在哪个实例，统一由此函数处理路由
// payload: unknown — 消息载荷由调用方决定具体结构，传输层只负责 JSON 序列化转发，用 unknown 替代 any 更安全
export function sendToUser(receiverId: string, payload: unknown): void {
  const localWs = userSockets.get(receiverId);
  if (localWs && localWs.readyState === WebSocket.OPEN) {
    localWs.send(JSON.stringify(payload));
    return;
  }
  // 本地无连接：发布到 Redis 频道，由持有该用户连接的实例接收并下发
  redisClient
    .publish(WS_BROADCAST_CHANNEL, JSON.stringify({ receiverId, payload }))
    .catch((err) => {
      logger.error({
        module: 'websocket',
        message: 'Redis publish 失败',
        error: err instanceof Error ? err.message : String(err),
        receiverId,
      }, 'WebSocket 跨实例广播失败');
    });
}

// 初始化 Redis pub/sub 订阅：连接 pubSub 并监听 ws:broadcast 频道
// 收到消息后解析 { receiverId, payload }，若本地持有该用户连接则下发
async function initPubSub(): Promise<void> {
  await pubSub.connect();
  await pubSub.subscribe(WS_BROADCAST_CHANNEL, (raw) => {
    try {
      const { receiverId, payload } = JSON.parse(raw);
      const localWs = userSockets.get(receiverId);
      if (localWs && localWs.readyState === WebSocket.OPEN) {
        localWs.send(JSON.stringify(payload));
      }
    } catch (err) {
      logger.error({
        module: 'websocket',
        message: '处理 ws:broadcast 消息失败',
        error: err instanceof Error ? err.message : String(err),
      }, 'WebSocket pub/sub 消息处理失败');
    }
  });
}

export function initWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  // 异步初始化 pub/sub 订阅，不阻塞 WebSocket 服务启动
  initPubSub().catch((err) => {
    logger.error({
      module: 'websocket',
      message: 'Redis pub/sub 初始化失败',
      error: err instanceof Error ? err.message : String(err),
    }, 'WebSocket pub/sub 初始化失败');
  });

  // 认证超时时间：连接后 5 秒内未完成认证则关闭，防止未认证连接长期占用资源
  const AUTH_TIMEOUT_MS = 5000;

  wss.on('connection', (ws: WebSocket) => {
    // 认证阶段：userId 尚未确定，先设为 null，认证成功后赋值
    let userId: string | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    // 认证超时定时器：超时未收到 auth 消息则关闭连接
    const authTimeout = setTimeout(() => {
      if (!userId) {
        ws.close(4001, '认证超时');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('message', async (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return; // 非 JSON 消息忽略，避免阻塞认证流程
      }

      // —— 认证阶段：仅处理 auth 消息 ——
      // 设计原因：token 不再通过 URL query 传递（会泄漏到 Nginx 日志/浏览器历史），
      // 改为连接后发送 { type: 'auth', token } 消息完成认证
      if (!userId) {
        if (data.type !== 'auth' || !data.token) {
          return; // 认证前忽略所有非 auth 消息
        }

        let payload: JwtPayload;
        try {
          payload = jwt.verify(data.token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
        } catch {
          clearTimeout(authTimeout);
          ws.close(4001, 'token 无效');
          return;
        }

        userId = payload.id;
        clearTimeout(authTimeout);

        // 同一用户重复连接时关闭旧连接
        const oldWs = userSockets.get(userId);
        if (oldWs && oldWs.readyState === WebSocket.OPEN) {
          oldWs.close(4002, '被新连接替换');
        }

        userSockets.set(userId, ws);

        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }, 30000);
        heartbeatIntervals.set(userId, heartbeat);

        ws.send(JSON.stringify({ type: 'connected', data: { userId } }));
        return;
      }

      // —— 已认证阶段：处理业务消息 ——
      try {
        if (data.type === 'chat') {
          // 默认按技能交换模块处理，保持向后兼容
          const orderType: OrderType = (data.orderType as OrderType) || 'skill';
          const orderId: string = data.orderId;
          if (!orderId) return;

          const receiverId = await resolveReceiverId(orderId, orderType, userId);
          if (!receiverId) return;

          const message = await messageService.sendMessage(
            userId,
            receiverId,
            orderId,
            data.content,
            data.msgType || 'text',
            orderType,
          );

          ws.send(JSON.stringify({ type: 'chat_ack', data: message }));

          // 统一通过 sendToUser 下发：本地有连接直接发，否则跨实例广播
          sendToUser(receiverId, { type: 'chat', data: message });
        }
      } catch (error) {
        // 结构化日志记录 WebSocket 消息处理异常，便于排查
        logger.error({
          module: 'websocket',
          message: '消息处理错误',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId,
        }, 'WebSocket 消息处理异常');
      }
    });

    ws.on('close', () => {
      // 清除认证超时定时器（无论是否已完成认证都需要清理，防止泄漏）
      clearTimeout(authTimeout);
      // 仅认证成功的连接才需要清理 userSockets 与心跳
      if (userId) {
        logger.debug({ module: 'websocket', userId }, 'WebSocket 连接关闭');
        userSockets.delete(userId);
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeatIntervals.delete(userId);
        }
      }
    });
  });

  return wss;
}

export function getOnlineUsers(): string[] {
  return Array.from(userSockets.keys());
}

// 关闭 WebSocket 服务与 Redis pub/sub 订阅连接，供优雅关闭流程调用
// 设计原因：pubSub 由 redisClient.duplicate() 创建的独立连接，disconnectRedis 不会自动关闭它
export async function closeWebSocket(): Promise<void> {
  try {
    await pubSub.quit();
  } catch (err) {
    logger.error({
      module: 'websocket',
      error: err instanceof Error ? err.message : String(err),
    }, '关闭 Redis pub/sub 连接失败');
  }
}
