import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { WebSocket as WSClient, WebSocketServer } from 'ws';

// vi.hoisted 提前创建所有 mock 引用，确保 vi.mock 工厂能安全访问
// 注意：pubSub 必须在 redisClient 之前定义，因为 duplicate() 返回它
const mocks = vi.hoisted(() => {
  const mockPubSub = {
    connect: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockResolvedValue(undefined),
  };
  const mockRedisClient = {
    publish: vi.fn().mockResolvedValue(1),
    duplicate: vi.fn(() => mockPubSub),
  };
  return {
    mockQuery: vi.fn(),
    mockMessageService: { sendMessage: vi.fn() },
    mockEnv: { JWT_SECRET: 'test-secret' },
    mockRedisClient,
    mockPubSub,
    mockLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    mockJwtVerify: vi.fn(),
  };
});

// mock 所有外部依赖：websocket 模块在 import 时即执行 redisClient.duplicate()
// mock 路径陷阱：测试文件在 __tests__ 子目录，mock 路径需比源码 import 路径多一层 ../
vi.mock('../../config/database', () => ({ query: mocks.mockQuery }));
vi.mock('../../services/message.service', () => ({ messageService: mocks.mockMessageService }));
vi.mock('../../config/env', () => ({ env: mocks.mockEnv }));
vi.mock('../../config/redis', () => ({ redisClient: mocks.mockRedisClient }));
vi.mock('../../utils/logger', () => ({ logger: mocks.mockLogger }));
// jsonwebtoken 使用默认导入，mock 工厂需返回 { default: {...} }
vi.mock('jsonwebtoken', () => ({ default: { verify: mocks.mockJwtVerify } }));

import { initWebSocket, sendToUser, getOnlineUsers } from '../index';

// 创建 HTTP server 并在随机端口监听，返回 server 与实际端口
function startServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

// 消息缓冲：缓存客户端收到的所有消息，避免 'open' 与 waitForMessage 注册 'message' 之间的时序竞态
// connection 回调的 ws.send 可能在 waitForMessage 注册监听前执行，导致消息丢失
const clientMessages = new WeakMap<WSClient, Array<Record<string, unknown>>>();

// 创建 WebSocket 客户端并连接，token 为可选参数
// 认证模式：连接建立后发送 { type: 'auth', token } 消息完成认证（不再通过 URL query 传递 token）
function connectClient(port: number, token?: string): Promise<WSClient> {
  const url = `ws://127.0.0.1:${port}/ws`;
  return new Promise((resolve, reject) => {
    const client = new WSClient(url);
    const buffer: Array<Record<string, unknown>> = [];
    clientMessages.set(client, buffer);
    // 在 'open' 之前注册 message 监听，避免 connection 回调的 ws.send 在 waitForMessage 之前执行导致消息丢失
    client.on('message', (raw) => {
      buffer.push(JSON.parse((raw as Buffer).toString()));
    });
    client.on('open', () => {
      // 连接建立后发送认证消息（token 存在时）
      if (token) {
        client.send(JSON.stringify({ type: 'auth', token }));
      }
      resolve(client);
    });
    client.on('error', reject);
  });
}

// 等待客户端收到指定 type 的消息，先查缓冲再等待新消息，超时则 reject
function waitForMessage(client: WSClient, type: string, timeout = 1500): Promise<Record<string, unknown>> {
  const buffer = clientMessages.get(client);
  // 先查已缓存的消息，避免 'open' 前到达的消息丢失
  if (buffer) {
    const idx = buffer.findIndex((m) => m.type === type);
    if (idx >= 0) {
      return Promise.resolve(buffer.splice(idx, 1)[0]);
    }
  }
  // 缓存没有则等待新消息
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待消息 ${type} 超时`)), timeout);
    const handler = (raw: unknown) => {
      const data = JSON.parse((raw as Buffer).toString());
      if (data.type === type) {
        clearTimeout(timer);
        client.off('message', handler);
        resolve(data);
      }
    };
    client.on('message', handler);
  });
}

// 等待客户端关闭，返回关闭码
function waitForClose(client: WSClient, timeout = 1500): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待关闭超时')), timeout);
    client.on('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    client.on('error', reject);
  });
}

describe('websocket 模块', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;
  const clients: WSClient[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 mock 默认返回值（clearAllMocks 不重置 mockResolvedValue）
    mocks.mockRedisClient.publish.mockResolvedValue(1);
    mocks.mockPubSub.connect.mockResolvedValue(undefined);
    mocks.mockPubSub.subscribe.mockResolvedValue(undefined);
    mocks.mockJwtVerify.mockReturnValue({ id: 'user-1', phone: '13800138000', nickname: '测试用户' });
  });

  afterEach(async () => {
    // 关闭所有客户端连接，避免端口泄漏影响后续测试
    for (const c of clients) {
      if (c.readyState === WSClient.OPEN || c.readyState === WSClient.CONNECTING) {
        c.close();
      }
    }
    clients.length = 0;
    // 关闭 WebSocketServer 与 HTTP server
    if (wss) {
      wss.clients.forEach((c) => c.terminate());
      wss.close();
    }
    if (server && server.listening) {
      await new Promise<void>((r) => server.close(() => r()));
    }
    // 等待连接清理完成
    await new Promise((r) => setTimeout(r, 50));
  });

  describe('sendToUser', () => {
    it('本地无连接时通过 Redis 发布消息', async () => {
      // userSockets 为空，sendToUser 应走 redis publish 分支
      sendToUser('user-2', { type: 'chat', content: 'hello' });
      expect(mocks.mockRedisClient.publish).toHaveBeenCalledWith(
        'ws:broadcast',
        JSON.stringify({ receiverId: 'user-2', payload: { type: 'chat', content: 'hello' } }),
      );
    });

    it('Redis publish 失败时记录错误日志但不抛出', async () => {
      // 模拟 Redis 故障，sendToUser 内的 catch 应吞错并记录日志
      mocks.mockRedisClient.publish.mockRejectedValue(new Error('redis down'));
      sendToUser('user-3', { type: 'notice' });
      // catch 是异步的，等待微任务执行
      await new Promise((r) => setTimeout(r, 50));
      expect(mocks.mockLogger.error).toHaveBeenCalled();
    });

    it('本地有连接时直接通过 WebSocket 发送不走 Redis', async () => {
      // 建立真实连接，使 userSockets 注入该 userId 的 WebSocket
      ({ server, port } = await startServer());
      wss = initWebSocket(server);
      mocks.mockJwtVerify.mockReturnValue({ id: 'local-user', phone: '13800138000', nickname: '本地用户' });
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      // 重置 publish 调用记录，验证本地连接分支不触发 Redis
      mocks.mockRedisClient.publish.mockClear();
      sendToUser('local-user', { type: 'ping' });
      await new Promise((r) => setTimeout(r, 50));

      expect(mocks.mockRedisClient.publish).not.toHaveBeenCalled();
      // 客户端应直接收到 ping 消息
      const msg = await waitForMessage(client, 'ping');
      expect(msg).toEqual({ type: 'ping' });
    });
  });

  describe('getOnlineUsers', () => {
    it('无连接时返回空数组', () => {
      expect(getOnlineUsers()).toEqual([]);
    });

    it('有连接时返回在线用户 ID 列表', async () => {
      ({ server, port } = await startServer());
      wss = initWebSocket(server);
      mocks.mockJwtVerify.mockReturnValue({ id: 'online-user', phone: '13800138000', nickname: '在线用户' });
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      expect(getOnlineUsers()).toContain('online-user');
    });
  });

  describe('initWebSocket 连接认证', () => {
    beforeEach(async () => {
      ({ server, port } = await startServer());
      wss = initWebSocket(server);
    });

    it('未发送 auth 消息时超时以 4001 关闭连接', async () => {
      // 连接后不发送 auth 消息，服务器应在 5 秒认证超时后关闭连接
      const client = await connectClient(port);
      clients.push(client);
      // 认证超时为 5 秒，等待 6 秒确保超时触发
      const code = await waitForClose(client, 6000);
      expect(code).toBe(4001);
    }, 8000);

    it('auth token 无效时以 4001 关闭连接', async () => {
      mocks.mockJwtVerify.mockImplementation(() => {
        throw new Error('invalid token');
      });
      const client = await connectClient(port, 'bad-token');
      clients.push(client);
      const code = await waitForClose(client);
      expect(code).toBe(4001);
    });

    it('auth 消息认证成功后发送 connected 消息', async () => {
      mocks.mockJwtVerify.mockReturnValue({ id: 'auth-user', phone: '13800138000', nickname: '认证用户' });
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      const msg = await waitForMessage(client, 'connected');
      expect(msg).toEqual({ type: 'connected', data: { userId: 'auth-user' } });
    });

    it('同一用户重复连接时关闭旧连接', async () => {
      mocks.mockJwtVerify.mockReturnValue({ id: 'dup-user', phone: '13800138000', nickname: '重复用户' });
      const client1 = await connectClient(port, 'valid-token');
      clients.push(client1);
      await waitForMessage(client1, 'connected');

      // 同一用户再次连接，旧连接应被关闭（4002）
      const client2 = await connectClient(port, 'valid-token');
      clients.push(client2);
      const code = await waitForClose(client1);
      expect(code).toBe(4002);
      // 新连接正常收到 connected
      await waitForMessage(client2, 'connected');
    });

    it('认证前发送 chat 消息应被忽略（不触发 sendMessage）', async () => {
      // 连接后先发 chat 再发 auth，chat 消息应被忽略
      const client = new WSClient(`ws://127.0.0.1:${port}/ws`);
      clients.push(client);
      const buffer: Array<Record<string, unknown>> = [];
      clientMessages.set(client, buffer);
      client.on('message', (raw) => {
        buffer.push(JSON.parse((raw as Buffer).toString()));
      });
      await new Promise<void>((resolve) => client.on('open', () => resolve()));

      // 先发 chat（认证前，应被忽略）
      client.send(JSON.stringify({ type: 'chat', orderId: 'order-1', content: 'test' }));
      // 再发 auth
      mocks.mockJwtVerify.mockReturnValue({ id: 'auth-user', phone: '138', nickname: '测试' });
      client.send(JSON.stringify({ type: 'auth', token: 'valid-token' }));
      await waitForMessage(client, 'connected');

      // chat 消息未被处理（sendMessage 未调用）
      await new Promise((r) => setTimeout(r, 200));
      expect(mocks.mockMessageService.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('initWebSocket 消息处理', () => {
    beforeEach(async () => {
      ({ server, port } = await startServer());
      wss = initWebSocket(server);
      mocks.mockJwtVerify.mockReturnValue({ id: 'sender-1', phone: '13800138000', nickname: '发送方' });
    });

    it('收到 chat 消息时转发给接收方并返回 chat_ack', async () => {
      // 模拟 resolveReceiverId 查询：sender 是 buyer，receiver 是 seller
      mocks.mockQuery.mockResolvedValue({
        rows: [{ buyer_id: 'sender-1', seller_id: 'receiver-1' }],
        command: 'SELECT',
        rowCount: 1,
        oid: 0,
        fields: [],
      });
      mocks.mockMessageService.sendMessage.mockResolvedValue({ id: 'msg-1', content: '你好', orderId: 'order-1' });

      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      // 发送 chat 消息
      client.send(JSON.stringify({ type: 'chat', orderId: 'order-1', content: '你好', orderType: 'skill' }));

      // 应收到 chat_ack
      const ack = await waitForMessage(client, 'chat_ack');
      expect(ack).toEqual({ type: 'chat_ack', data: { id: 'msg-1', content: '你好', orderId: 'order-1' } });
      // messageService.sendMessage 应被调用，参数透传
      expect(mocks.mockMessageService.sendMessage).toHaveBeenCalledWith(
        'sender-1', 'receiver-1', 'order-1', '你好', 'text', 'skill',
      );
      // sendToUser 应通过 Redis 发布给 receiver-1（receiver 不在本地）
      expect(mocks.mockRedisClient.publish).toHaveBeenCalledWith(
        'ws:broadcast',
        expect.stringContaining('"receiverId":"receiver-1"'),
      );
    });

    it('缺少 orderId 时直接返回不处理', async () => {
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      // 发送无 orderId 的 chat 消息
      client.send(JSON.stringify({ type: 'chat', content: 'hello' }));
      // 等待一段时间确保不会收到 chat_ack
      await new Promise((r) => setTimeout(r, 200));
      expect(mocks.mockMessageService.sendMessage).not.toHaveBeenCalled();
    });

    it('订单不存在时（receiverId 为 null）不发送消息', async () => {
      mocks.mockQuery.mockResolvedValue({ rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] });
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      client.send(JSON.stringify({ type: 'chat', orderId: 'not-exist', content: 'hello', orderType: 'skill' }));
      await new Promise((r) => setTimeout(r, 200));
      expect(mocks.mockMessageService.sendMessage).not.toHaveBeenCalled();
    });

    it('消息处理异常时记录错误日志不抛出', async () => {
      // sendMessage 抛错，触发 catch 分支
      mocks.mockQuery.mockResolvedValue({
        rows: [{ buyer_id: 'sender-1', seller_id: 'receiver-1' }],
        command: 'SELECT', rowCount: 1, oid: 0, fields: [],
      });
      mocks.mockMessageService.sendMessage.mockRejectedValue(new Error('DB 写入失败'));

      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      client.send(JSON.stringify({ type: 'chat', orderId: 'order-1', content: 'hello', orderType: 'skill' }));
      await new Promise((r) => setTimeout(r, 200));
      expect(mocks.mockLogger.error).toHaveBeenCalled();
    });

    it('默认 orderType 为 skill（保持向后兼容）', async () => {
      mocks.mockQuery.mockResolvedValue({
        rows: [{ buyer_id: 'sender-1', seller_id: 'receiver-1' }],
        command: 'SELECT', rowCount: 1, oid: 0, fields: [],
      });
      mocks.mockMessageService.sendMessage.mockResolvedValue({ id: 'msg-2', content: 'test' });

      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      // 不传 orderType，应默认 skill
      client.send(JSON.stringify({ type: 'chat', orderId: 'order-1', content: 'test' }));
      await waitForMessage(client, 'chat_ack');
      expect(mocks.mockMessageService.sendMessage).toHaveBeenCalledWith(
        'sender-1', 'receiver-1', 'order-1', 'test', 'text', 'skill',
      );
    });

    it('close 事件触发时清理用户连接与心跳', async () => {
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');
      expect(getOnlineUsers()).toContain('sender-1');

      // 主动关闭连接，触发 close 事件
      client.close();
      await new Promise((r) => setTimeout(r, 100));
      // close 后 userSockets 应清理该用户
      expect(getOnlineUsers()).not.toContain('sender-1');
    });
  });

  describe('resolveReceiverId（通过 chat 消息间接覆盖多 orderType）', () => {
    beforeEach(async () => {
      ({ server, port } = await startServer());
      wss = initWebSocket(server);
      mocks.mockJwtVerify.mockReturnValue({ id: 'sender-1', phone: '13800138000', nickname: '发送方' });
      mocks.mockMessageService.sendMessage.mockResolvedValue({ id: 'msg-x', content: 'test' });
    });

    it('kitchen 类型查询 user_id / seller_id', async () => {
      mocks.mockQuery.mockResolvedValue({
        rows: [{ user_id: 'sender-1', seller_id: 'kitchen-seller' }],
        command: 'SELECT', rowCount: 1, oid: 0, fields: [],
      });
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      client.send(JSON.stringify({ type: 'chat', orderId: 'k-order-1', content: 'test', orderType: 'kitchen' }));
      await waitForMessage(client, 'chat_ack');
      expect(mocks.mockMessageService.sendMessage).toHaveBeenCalledWith(
        'sender-1', 'kitchen-seller', 'k-order-1', 'test', 'text', 'kitchen',
      );
    });

    it('time 类型查询 provider_id / requester_id', async () => {
      mocks.mockQuery.mockResolvedValue({
        rows: [{ provider_id: 'time-provider', requester_id: 'sender-1' }],
        command: 'SELECT', rowCount: 1, oid: 0, fields: [],
      });
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      client.send(JSON.stringify({ type: 'chat', orderId: 't-order-1', content: 'test', orderType: 'time' }));
      await waitForMessage(client, 'chat_ack');
      // sender 是 requester，receiver 应是 provider
      expect(mocks.mockMessageService.sendMessage).toHaveBeenCalledWith(
        'sender-1', 'time-provider', 't-order-1', 'test', 'text', 'time',
      );
    });

    it('emergency 类型查询 responder_id / user_id', async () => {
      mocks.mockQuery.mockResolvedValue({
        rows: [{ responder_id: 'sender-1', user_id: 'emergency-victim' }],
        command: 'SELECT', rowCount: 1, oid: 0, fields: [],
      });
      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      client.send(JSON.stringify({ type: 'chat', orderId: 'e-resp-1', content: 'test', orderType: 'emergency' }));
      await waitForMessage(client, 'chat_ack');
      // sender 是 responder，receiver 应是 victim
      expect(mocks.mockMessageService.sendMessage).toHaveBeenCalledWith(
        'sender-1', 'emergency-victim', 'e-resp-1', 'test', 'text', 'emergency',
      );
    });
  });

  // 覆盖 line 117：initPubSub 初始化失败时的 catch 分支
  // 设计原因：initWebSocket 内部异步调用 initPubSub()，失败时 catch 记录 error 日志
  describe('initPubSub 异常处理', () => {
    it('Redis pub/sub 初始化失败时记录 error 日志', async () => {
      // 让 pubSub.connect 抛错，触发 initPubSub 的 Promise reject
      mocks.mockPubSub.connect.mockRejectedValueOnce(new Error('redis connect failed'));
      ({ server, port } = await startServer());
      wss = initWebSocket(server);

      // initPubSub 是异步的，catch 也是异步的，等待微任务执行
      await new Promise((r) => setTimeout(r, 100));

      expect(mocks.mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'websocket',
          message: 'Redis pub/sub 初始化失败',
          error: 'redis connect failed',
        }),
        'WebSocket pub/sub 初始化失败',
      );
    });
  });

  // 覆盖 line 152-153：heartbeat setInterval 回调，对 OPEN 状态连接发送 ping
  // 设计原因：heartbeat 每 30 秒触发一次，测试中无法等待真实 30 秒。
  // 通过 mock global.setInterval 捕获 heartbeat 回调（ms=30000），手动触发验证 ping 发送。
  // 只 mock ms=30000 的调用，其他 setInterval 正常执行，避免影响 WebSocket 内部机制。
  describe('heartbeat 心跳机制', () => {
    it('heartbeat 回调对 OPEN 状态连接发送 ping', async () => {
      ({ server, port } = await startServer());

      // 捕获 heartbeat 的 setInterval 回调（ms=30000），其他 setInterval 正常执行
      const originalSetInterval = global.setInterval;
      let heartbeatCallback: (() => void) | null = null;
      global.setInterval = ((cb: () => void, ms: number) => {
        if (ms === 30000) {
          heartbeatCallback = cb;
          return {} as NodeJS.Timeout;
        }
        return originalSetInterval(cb, ms);
      }) as typeof global.setInterval;

      wss = initWebSocket(server);
      mocks.mockJwtVerify.mockReturnValue({ id: 'ping-user', phone: '13800138000', nickname: '心跳用户' });

      const client = await connectClient(port, 'valid-token');
      clients.push(client);
      await waitForMessage(client, 'connected');

      // 恢复 setInterval，避免影响后续测试
      global.setInterval = originalSetInterval;

      // 监听客户端的 ping 事件（ws 库在收到 ping 帧时触发）
      const pingPromise = new Promise<void>((resolve) => {
        client.on('ping', () => resolve());
      });

      // 手动触发 heartbeat 回调，模拟 30 秒定时器到期
      expect(heartbeatCallback).not.toBeNull();
      heartbeatCallback!();

      // 等待 ping 事件到达客户端（设 1 秒超时避免卡死）
      await Promise.race([
        pingPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('等待 ping 超时')), 1000)),
      ]);
      // pingPromise resolve 即表示 ping 已收到，测试通过
      expect(true).toBe(true);
    });
  });
});
