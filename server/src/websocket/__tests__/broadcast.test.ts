/**
 * WebSocket 跨实例消息广播测试
 *
 * 说明：当前项目尚未引入测试框架（jest/vitest/mocha 等），
 * 以下以注释形式描述测试场景。引入测试框架后，可按下方示例编写可执行用例。
 *
 * 被测模块：server/src/websocket/index.ts
 * 核心函数：sendToUser(receiverId, payload)
 * 核心机制：Redis pub/sub 频道 ws:broadcast
 */

// ============================================================================
// 场景 1：本地存在目标用户连接 —— 直接下发，不触发 Redis publish
// ============================================================================
// 前置条件：
//   - userSockets 中存在 receiverId 对应的 OPEN 状态连接
// 预期：
//   - 调用 sendToUser 后，目标 WebSocket 收到 JSON.stringify(payload) 消息
//   - redisClient.publish 不被调用（可通过 mock 验证）
//
// 示例伪代码：
//   const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
//   userSockets.set('user-2', mockWs);
//   const publishSpy = jest.spyOn(redisClient, 'publish');
//   sendToUser('user-2', { type: 'chat', data: { id: 'm1' } });
//   expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'chat', data: { id: 'm1' } }));
//   expect(publishSpy).not.toHaveBeenCalled();

// ============================================================================
// 场景 2：本地无目标用户连接 —— 通过 Redis publish 跨实例广播
// ============================================================================
// 前置条件：
//   - userSockets 中不存在 receiverId，或连接非 OPEN 状态
// 预期：
//   - redisClient.publish 被调用，频道为 'ws:broadcast'
//   - 发布内容为 JSON.stringify({ receiverId, payload })
//
// 示例伪代码：
//   userSockets.delete('user-3');
//   const publishSpy = jest.spyOn(redisClient, 'publish').mockResolvedValue(1);
//   sendToUser('user-3', { type: 'chat', data: { id: 'm2' } });
//   expect(publishSpy).toHaveBeenCalledWith(
//     'ws:broadcast',
//     JSON.stringify({ receiverId: 'user-3', payload: { type: 'chat', data: { id: 'm2' } } }),
//   );

// ============================================================================
// 场景 3：订阅端收到广播 —— 本地有匹配连接则下发
// ============================================================================
// 前置条件：
//   - pubSub 已订阅 'ws:broadcast' 频道
//   - userSockets 中存在消息内 receiverId 对应的 OPEN 连接
// 预期：
//   - 当 Redis 频道收到 { receiverId, payload } 消息后
//   - 本地目标 WebSocket.send 被调用，内容为 JSON.stringify(payload)
//
// 示例伪代码：
//   const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
//   userSockets.set('user-4', mockWs);
//   // 模拟 Redis 订阅回调触发
//   pubSubSubscribeCallback(JSON.stringify({
//     receiverId: 'user-4',
//     payload: { type: 'chat', data: { id: 'm3' } },
//   }));
//   expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'chat', data: { id: 'm3' } }));

// ============================================================================
// 场景 4：订阅端收到广播 —— 本地无匹配连接则静默忽略（不报错）
// ============================================================================
// 前置条件：
//   - pubSub 已订阅 'ws:broadcast' 频道
//   - userSockets 中不存在消息内 receiverId
// 预期：
//   - 不抛出异常，不调用任何 WebSocket.send
//   - 错误日志不输出（因非异常分支）
//
// 示例伪代码：
//   userSockets.delete('user-5');
//   const sendSpy = jest.fn();
//   // 模拟 Redis 订阅回调触发
//   pubSubSubscribeCallback(JSON.stringify({
//     receiverId: 'user-5',
//     payload: { type: 'chat', data: { id: 'm4' } },
//   }));
//   expect(sendSpy).not.toHaveBeenCalled();

// ============================================================================
// 场景 5：订阅端收到非法 JSON —— 捕获异常并记录错误日志，不影响后续消息
// ============================================================================
// 前置条件：
//   - pubSub 已订阅 'ws:broadcast' 频道
// 预期：
//   - 收到非法 JSON 字符串时，JSON.parse 抛出异常被 catch 捕获
//   - 输出结构化错误日志（module: 'websocket'，message: '处理 ws:broadcast 消息失败'）
//   - 不影响后续正常消息的处理
//
// 示例伪代码：
//   const errorSpy = jest.spyOn(console, 'error').mockImplementation();
//   pubSubSubscribeCallback('not-a-json');
//   expect(errorSpy).toHaveBeenCalled();
//   // 后续正常消息仍可处理
//   const mockWs = { readyState: WebSocket.OPEN, send: jest.fn() };
//   userSockets.set('user-6', mockWs);
//   pubSubSubscribeCallback(JSON.stringify({
//     receiverId: 'user-6',
//     payload: { type: 'chat', data: { id: 'm5' } },
//   }));
//   expect(mockWs.send).toHaveBeenCalled();

// ============================================================================
// 场景 6：chat 消息处理 —— 接收方在同实例，走 sendToUser 本地直发
// ============================================================================
// 前置条件：
//   - 发送方 user-1 与接收方 user-2 均连接到当前实例
//   - 发送方发送 { type: 'chat', orderId, content, orderType }
// 预期：
//   - messageService.sendMessage 被调用并返回消息对象
//   - 发送方收到 { type: 'chat_ack', data: message }
//   - 接收方收到 { type: 'chat', data: message }（经 sendToUser 本地直发）
//   - redisClient.publish 不被调用

// ============================================================================
// 场景 7：chat 消息处理 —— 接收方在另一实例，走 Redis 跨实例广播
// ============================================================================
// 前置条件：
//   - 发送方 user-1 连接到实例 A
//   - 接收方 user-2 连接到实例 B（实例 A 的 userSockets 无 user-2）
// 预期：
//   - 实例 A：发送方收到 chat_ack，redisClient.publish 被调用广播给 user-2
//   - 实例 B：pubSub 订阅回调收到消息，本地 user-2 连接收到 { type: 'chat', data: message }
//
// 此场景验证了多实例部署下消息可达性，是本次改造的核心目标。

// ============================================================================
// 场景 8：pubSub 连接独立于主 redisClient —— duplicate 不阻塞主连接
// ============================================================================
// 前置条件：
//   - redisClient 已连接，pubSub 通过 duplicate() 创建并独立 connect()
// 预期：
//   - pubSub 进入订阅模式后，redisClient 仍可执行 set/get/publish 等常规命令
//   - 两个连接相互独立，互不影响
//
// 验证点：redis v4 中订阅模式的连接只能执行订阅相关命令，
// 因此必须用 duplicate 出独立连接，主连接保持可用。
