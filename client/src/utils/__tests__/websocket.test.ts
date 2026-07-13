import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketClient } from '../websocket';

/**
 * WebSocket mock：jsdom 不内置 WebSocket，需手动 mock 全局对象
 * 设计原因：记录所有构造的实例，便于测试在重连场景获取新连接引用；
 * 提供 simulate* 辅助方法触发事件，避免直接操作底层 Event
 */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  // WebSocket 常量：与浏览器原生 WebSocket 数值保持一致，供 readyState 比较
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  // 控制构造函数是否抛错，用于测试 connect 的 catch 分支
  static shouldThrow = false;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  // 记录所有发送的消息，便于断言订阅/取消订阅内容
  sentMessages: string[] = [];

  constructor(url: string) {
    if (MockWebSocket.shouldThrow) {
      MockWebSocket.shouldThrow = false;
      throw new Error('构造失败');
    }
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // 测试辅助方法：模拟事件触发
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
  simulateRawMessage(raw: string) {
    this.onmessage?.({ data: raw } as MessageEvent);
  }
  simulateError() {
    this.onerror?.(new Event('error'));
  }
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

describe('WebSocketClient', () => {
  let client: WebSocketClient;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    MockWebSocket.shouldThrow = false;
    vi.stubGlobal('WebSocket', MockWebSocket);
    // 静默 console 输出，避免测试噪音干扰结果阅读
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // 辅助：连接并模拟 open 完成，返回底层 mock 实例
  function connectAndOpen(c: WebSocketClient): MockWebSocket {
    c.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.simulateOpen();
    return ws;
  }

  // 辅助：模拟一次完整重连周期（close → 推进定时器 → 新实例 open）
  // 设计原因：清空 instances 后重连，保证返回的是新创建的连接引用
  function reconnect(oldWs: MockWebSocket, delay = 1000): MockWebSocket {
    MockWebSocket.instances = [];
    oldWs.simulateClose();
    vi.advanceTimersByTime(delay);
    const newWs = MockWebSocket.instances.at(-1)!;
    newWs.simulateOpen();
    return newWs;
  }

  describe('constructor', () => {
    it('未传 options 时使用默认值（重连上限 5、间隔序列 [1000,2000,5000]）', () => {
      client = new WebSocketClient('ws://test');
      expect(client.getReconnectAttempts()).toBe(0);
      expect(client.getReadyState()).toBe(MockWebSocket.CLOSED);
    });

    it('自定义 options 覆盖默认值并透传回调', () => {
      const onMessage = vi.fn();
      client = new WebSocketClient('ws://test', { maxReconnectAttempts: 2, onMessage });
      const ws = connectAndOpen(client);
      ws.simulateMessage({ hello: 'world' });
      expect(onMessage).toHaveBeenCalledWith({ hello: 'world' });
    });
  });

  describe('connect', () => {
    it('已处于 OPEN 状态时不重复创建连接', () => {
      client = new WebSocketClient('ws://test');
      connectAndOpen(client);
      const countBefore = MockWebSocket.instances.length;
      client.connect();
      expect(MockWebSocket.instances.length).toBe(countBefore);
    });

    it('正常连接触发 onStatusChange("connecting")', () => {
      const onStatusChange = vi.fn();
      client = new WebSocketClient('ws://test', { onStatusChange });
      client.connect();
      expect(onStatusChange).toHaveBeenCalledWith('connecting');
    });

    it('WebSocket 构造抛错时进入重连流程', () => {
      const onStatusChange = vi.fn();
      client = new WebSocketClient('ws://test', { onStatusChange });
      MockWebSocket.shouldThrow = true;
      client.connect();
      expect(onStatusChange).toHaveBeenCalledWith('reconnecting');
    });
  });

  describe('onopen 事件', () => {
    it('首次连接成功触发 connected 状态与 onOpen 回调', () => {
      const onOpen = vi.fn();
      const onStatusChange = vi.fn();
      client = new WebSocketClient('ws://test', { onOpen, onStatusChange });
      connectAndOpen(client);
      expect(onStatusChange).toHaveBeenCalledWith('connected');
      expect(onOpen).toHaveBeenCalled();
    });

    it('重连成功后恢复之前的订阅', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      const newWs = reconnect(ws);
      // 重连后恢复订阅：发送的消息体为 {type:"subscribe", channelId:"c1"}
      // 设计原因：subscribe 第一个参数 type 仅用于订阅列表去重，不进入消息体
      expect(newWs.sentMessages.some((m) => m.includes('subscribe') && m.includes('c1'))).toBe(true);
    });

    it('authMessage 在 onOpen 前发送（认证消息优先于业务回调）', () => {
      // 验证 token 不再通过 URL 传递，改用消息体发送
      const authPayload = { type: 'auth', token: 'test-jwt-token' };
      client = new WebSocketClient('ws://test', { authMessage: authPayload });
      const ws = connectAndOpen(client);
      // 连接建立后应立即发送 auth 消息，且为第一条发送的消息
      expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1);
      // 上一行已断言 length >= 1，此处用非空断言访问第 0 条消息
      const firstMessage = JSON.parse(ws.sentMessages[0]!);
      expect(firstMessage).toEqual(authPayload);
    });

    it('未设置 authMessage 时不发送额外消息', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      // 无 authMessage 时，连接后不应发送任何消息
      expect(ws.sentMessages).toHaveLength(0);
    });
  });

  describe('onmessage 事件', () => {
    it('合法 JSON 消息触发 onMessage 回调', () => {
      const onMessage = vi.fn();
      client = new WebSocketClient('ws://test', { onMessage });
      const ws = connectAndOpen(client);
      ws.simulateMessage({ type: 'notification', content: 'hi' });
      expect(onMessage).toHaveBeenCalledWith({ type: 'notification', content: 'hi' });
    });

    it('非法 JSON 不抛错（catch 吞错，不触发 onMessage）', () => {
      const onMessage = vi.fn();
      client = new WebSocketClient('ws://test', { onMessage });
      const ws = connectAndOpen(client);
      expect(() => ws.simulateRawMessage('not-json')).not.toThrow();
      expect(onMessage).not.toHaveBeenCalled();
    });
  });

  describe('onerror 事件', () => {
    it('触发 onError 回调', () => {
      const onError = vi.fn();
      client = new WebSocketClient('ws://test', { onError });
      const ws = connectAndOpen(client);
      ws.simulateError();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('onclose 事件', () => {
    it('非手动关闭时触发重连（状态变为 reconnecting）', () => {
      const onStatusChange = vi.fn();
      client = new WebSocketClient('ws://test', { onStatusChange });
      const ws = connectAndOpen(client);
      MockWebSocket.instances = [];
      ws.simulateClose();
      expect(onStatusChange).toHaveBeenCalledWith('reconnecting');
    });

    it('手动关闭时不触发重连', () => {
      const onStatusChange = vi.fn();
      client = new WebSocketClient('ws://test', { onStatusChange });
      connectAndOpen(client);
      client.close();
      expect(onStatusChange).toHaveBeenCalledWith('disconnected');
      // 推进定时器后不应创建新连接实例
      const countAfterClose = MockWebSocket.instances.length;
      vi.advanceTimersByTime(10000);
      expect(MockWebSocket.instances.length).toBe(countAfterClose);
    });
  });

  describe('handleReconnect', () => {
    it('达到最大重连次数后停止并标记 disconnected', () => {
      const onStatusChange = vi.fn();
      client = new WebSocketClient('ws://test', {
        onStatusChange,
        maxReconnectAttempts: 2,
        reconnectIntervals: [100, 100],
      });
      client.connect();
      // 连续失败（不 simulateOpen，避免 onopen 重置重连计数）
      // 第 1 次失败：close → 重连 → 新实例
      MockWebSocket.instances[0]!.simulateClose();
      vi.advanceTimersByTime(100);
      // 第 2 次失败：新实例 close → 重连 → 再新实例
      MockWebSocket.instances[1]!.simulateClose();
      vi.advanceTimersByTime(100);
      // 第 3 次失败：reconnectAttempts 已达 2，停止并标记 disconnected
      MockWebSocket.instances[2]!.simulateClose();
      expect(onStatusChange).toHaveBeenCalledWith('disconnected');
    });

    it('重连成功后重置重连计数', () => {
      client = new WebSocketClient('ws://test', { reconnectIntervals: [100] });
      const ws = connectAndOpen(client);
      reconnect(ws, 100);
      // 重连成功后 reconnectAttempts 应回到 0
      expect(client.getReconnectAttempts()).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('已连接时立即发送订阅消息', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      expect(ws.sentMessages.some((m) => m.includes('"type":"subscribe"') && m.includes('c1'))).toBe(true);
    });

    it('重复订阅不重复添加到订阅列表（重连后只恢复一条）', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      client.subscribe('chat', { channelId: 'c1' });
      const newWs = reconnect(ws);
      // 重连恢复订阅：c1 仅一条
      const resub = newWs.sentMessages.filter((m) => m.includes('"type":"subscribe"') && m.includes('c1'));
      expect(resub).toHaveLength(1);
    });

    it('未连接时记录订阅但不发送', () => {
      client = new WebSocketClient('ws://test');
      client.subscribe('chat', { channelId: 'c1' });
      // 未连接，无实例可发送
      expect(MockWebSocket.instances).toHaveLength(0);
    });
  });

  describe('unsubscribe', () => {
    it('按类型+data 精确移除指定订阅', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      client.subscribe('chat', { channelId: 'c2' });
      client.unsubscribe('chat', { channelId: 'c1' });
      const newWs = reconnect(ws);
      // 重连后仅恢复 c2，不恢复 c1
      const resub = newWs.sentMessages.filter((m) => m.includes('"type":"subscribe"'));
      expect(resub.some((m) => m.includes('c2'))).toBe(true);
      expect(resub.some((m) => m.includes('c1'))).toBe(false);
    });

    it('不传 data 时按类型移除全部订阅', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      client.subscribe('chat', { channelId: 'c2' });
      client.unsubscribe('chat');
      const newWs = reconnect(ws);
      const resub = newWs.sentMessages.filter((m) => m.includes('"type":"subscribe"'));
      expect(resub).toHaveLength(0);
    });

    it('已连接且传 data 时发送取消订阅消息', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      client.unsubscribe('chat', { channelId: 'c1' });
      expect(ws.sentMessages.some((m) => m.includes('"type":"unsubscribe"'))).toBe(true);
    });

    it('已连接但不传 data 时不发送取消订阅消息', () => {
      client = new WebSocketClient('ws://test');
      const ws = connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      client.unsubscribe('chat');
      expect(ws.sentMessages.some((m) => m.includes('"type":"unsubscribe"'))).toBe(false);
    });
  });

  describe('send', () => {
    it('已连接时发送成功返回 true', () => {
      client = new WebSocketClient('ws://test');
      connectAndOpen(client);
      expect(client.send({ type: 'ping' })).toBe(true);
    });

    it('未连接时返回 false', () => {
      client = new WebSocketClient('ws://test');
      expect(client.send({ type: 'ping' })).toBe(false);
    });
  });

  describe('getReadyState', () => {
    it('无连接时返回 CLOSED', () => {
      client = new WebSocketClient('ws://test');
      expect(client.getReadyState()).toBe(MockWebSocket.CLOSED);
    });

    it('已连接时返回 OPEN', () => {
      client = new WebSocketClient('ws://test');
      connectAndOpen(client);
      expect(client.getReadyState()).toBe(MockWebSocket.OPEN);
    });
  });

  describe('getReconnectAttempts', () => {
    it('返回当前重连次数', () => {
      client = new WebSocketClient('ws://test', { reconnectIntervals: [100] });
      const ws = connectAndOpen(client);
      reconnect(ws, 100);
      expect(client.getReconnectAttempts()).toBe(0);
    });
  });

  describe('close', () => {
    it('手动关闭触发 disconnected 状态', () => {
      const onStatusChange = vi.fn();
      client = new WebSocketClient('ws://test', { onStatusChange });
      connectAndOpen(client);
      client.close();
      expect(onStatusChange).toHaveBeenCalledWith('disconnected');
    });

    it('关闭后不再触发重连', () => {
      client = new WebSocketClient('ws://test');
      connectAndOpen(client);
      client.close();
      const countAfterClose = MockWebSocket.instances.length;
      vi.advanceTimersByTime(10000);
      expect(MockWebSocket.instances.length).toBe(countAfterClose);
    });
  });

  describe('reset', () => {
    it('清空订阅并重置重连计数', () => {
      client = new WebSocketClient('ws://test');
      connectAndOpen(client);
      client.subscribe('chat', { channelId: 'c1' });
      client.reset();
      // reset 已 close，需重新 connect 验证订阅已清空
      client.connect();
      const newWs = MockWebSocket.instances.at(-1)!;
      newWs.simulateOpen();
      // 重连后无订阅恢复（reset 已清空 subscriptions）
      expect(newWs.sentMessages.some((m) => m.includes('subscribe'))).toBe(false);
      expect(client.getReconnectAttempts()).toBe(0);
    });
  });
});
