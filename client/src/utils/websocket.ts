/**
 * WebSocket 客户端类
 * 支持自动断线重连、消息订阅管理
 */

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface WebSocketClientOptions {
  // 最大重连次数，默认 5 次
  maxReconnectAttempts?: number;
  // 重连间隔序列（毫秒），默认 [1000, 2000, 5000]
  reconnectIntervals?: number[];
  // 心跳间隔（毫秒）：每间隔发送一次 ping，默认 25 秒
  // 设计原因：< 30 秒可穿透多数中间设备的空闲连接回收；与 nginx proxy_read_timeout 86400 形成层级保险
  heartbeatInterval?: number;
  // pong 等待超时（毫秒）：心跳后等待任意响应的超时时间，默认 10 秒
  // 设计原因：给服务端处理与网络往返留 10 秒缓冲，超时则视为静默断连，主动 close 触发重连
  pongTimeout?: number;
  // 连接成功回调
  onOpen?: () => void;
  // 连接关闭回调
  onClose?: () => void;
  // 连接错误回调
  onError?: (error: Event) => void;
  // 消息接收回调
  // data 用 unknown 而非 any，强制消费方做类型收窄，避免运行时因结构不匹配触发隐式 any 污染
  onMessage?: (data: unknown) => void;
  // 连接状态变化回调
  onStatusChange?: (status: ConnectionStatus) => void;
  // 认证消息：连接建立后立即发送，用于替代 URL query 传递 token（避免 token 泄漏到日志/浏览器历史）
  authMessage?: unknown;
}

interface Subscription {
  type: string;
  // 订阅载荷由调用方决定，统一 unknown 强制消费方收窄，避免 any 逃逸
  data: Record<string, unknown>;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private options: Required<WebSocketClientOptions>;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // 心跳定时器：周期性发送 ping 维持连接活跃，配合中间设备空闲回收策略
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  // pong 等待定时器：心跳后启动，收到任意消息则重置；超时未收到则判定静默断连
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Subscription[] = [];
  private isManualClose = false;

  constructor(url: string, options: WebSocketClientOptions = {}) {
    this.url = url;
    this.options = {
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectIntervals: options.reconnectIntervals ?? [1000, 2000, 5000],
      heartbeatInterval: options.heartbeatInterval ?? 25000,
      pongTimeout: options.pongTimeout ?? 10000,
      onOpen: options.onOpen ?? (() => {}),
      onClose: options.onClose ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onMessage: options.onMessage ?? (() => {}),
      onStatusChange: options.onStatusChange ?? (() => {}),
      authMessage: options.authMessage,
    };
  }

  /**
   * 建立 WebSocket 连接
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.isManualClose = false;
    this.options.onStatusChange("connecting");

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventHandlers();
    } catch (error) {
      console.error("WebSocket 创建失败:", error);
      this.handleReconnect();
    }
  }

  /**
   * 设置 WebSocket 事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      if (import.meta.env.DEV) {
        console.log("WebSocket 连接已建立");
      }
      const wasReconnecting = this.reconnectAttempts > 0;

      // 重置重连计数
      this.reconnectAttempts = 0;
      this.options.onStatusChange("connected");

      // 认证消息优先发送：连接建立后立即发送，后端在收到 auth 消息前拒绝处理业务消息
      // 设计原因：token 不再通过 URL query 传递，改用消息体发送避免泄漏到 Nginx 日志/浏览器历史
      if (this.options.authMessage !== undefined) {
        this.send(this.options.authMessage);
      }

      this.options.onOpen();

      // 重连成功后恢复之前的订阅（认证完成后才生效）
      if (wasReconnecting) {
        this.resubscribeAll();
      }

      // 启动心跳：连接建立后开启周期性 ping，确保中间设备不会因空闲回收 TCP 连接
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      // 收到任意消息即重置 pong 等待定时器：服务端任何响应都视作连接存活证据
      // 设计原因：不强制要求服务端实现 pong 帧，pong/业务消息/suback 均可重置超时
      this.resetPongTimer();

      try {
        const data = JSON.parse(event.data);
        this.options.onMessage(data);
      } catch (error) {
        console.error("解析消息失败:", error);
      }
    };

    this.ws.onerror = (error) => {
      // 不在此处 console.error：onError 回调已由调用方处理，
      // 重复输出会在生产环境控制台产生噪音且可能泄露 WebSocket 内部实现细节
      this.options.onError(error);
    };

    this.ws.onclose = () => {
      // 仅开发环境输出连接关闭日志，生产环境避免每次正常关闭都产生噪音
      if (import.meta.env.DEV) {
        console.log("WebSocket 连接已关闭");
      }
      // 连接关闭时立即清理心跳定时器，避免对已关闭的 ws 调用 send 抛错或泄漏定时器
      this.clearHeartbeatTimers();
      this.options.onClose();

      // 非手动关闭时尝试重连
      if (!this.isManualClose) {
        this.handleReconnect();
      }
    };
  }

  /**
   * 启动心跳机制
   * 周期性发送 ping 帧，并在发送后启动 pong 等待定时器（仅当 pongTimer 不存在时）
   * 设计原因：网络中间设备（NAT/代理/负载均衡）会因连接长时间无数据传输而静默回收 TCP
   * 客户端 readyState 仍为 OPEN，但实际已断；心跳通过周期性流量维持连接可观测性
   */
  private startHeartbeat(): void {
    // 清理旧定时器，避免重连后多个心跳定时器并存
    this.clearHeartbeatTimers();

    this.heartbeatTimer = setInterval(() => {
      // 心跳发送失败说明连接已断，直接 close 触发重连，无需等待 pong 超时
      if (!this.send({ type: "ping" })) {
        this.clearHeartbeatTimers();
        this.ws?.close();
        return;
      }
      // 仅在 pongTimer 不存在时启动：避免下次心跳重置未超时的 pongTimer
      // 设计原因：若服务端未响应上次心跳，pongTimer 仍在等待，不应被本次心跳重置
      // 服务端响应后 onmessage 会 clear pongTimer，下次心跳时再启动新的等待周期
      if (!this.pongTimer) {
        this.resetPongTimer();
      }
    }, this.options.heartbeatInterval);
  }

  /**
   * 重置 pong 等待定时器
   * 收到任意消息（pong/业务消息/suback）调用此方法，将超时计时向后推移
   * 设计原因：服务端可不必专门实现 pong 帧，任何下行消息都重置超时
   */
  private resetPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
    }
    this.pongTimer = setTimeout(() => {
      // pong 超时：连接被视为静默断开，主动 close 触发 onclose → handleReconnect
      if (import.meta.env.DEV) {
        console.warn("WebSocket pong 超时，主动断开触发重连");
      }
      this.clearHeartbeatTimers();
      this.ws?.close();
    }, this.options.pongTimeout);
  }

  /**
   * 清理心跳相关定时器
   * 在 close/onclose/重连前调用，避免定时器泄漏与对已关闭 ws 的访问
   */
  private clearHeartbeatTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  /**
   * 处理重连逻辑
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      if (import.meta.env.DEV) {
        console.log("已达到最大重连次数，停止重连");
      }
      this.options.onStatusChange("disconnected");
      return;
    }

    this.options.onStatusChange("reconnecting");

    // 根据重连次数选择对应的间隔时间
    const intervalIndex = Math.min(
      this.reconnectAttempts,
      this.options.reconnectIntervals.length - 1
    );
    const delay = this.options.reconnectIntervals[intervalIndex] ?? 5000;

    // 仅开发环境输出重连进度日志，生产环境由 onStatusChange("reconnecting") 驱动 UI 提示
    if (import.meta.env.DEV) {
      console.log(`将在 ${delay / 1000} 秒后进行第 ${this.reconnectAttempts + 1} 次重连`);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  /**
   * 重新订阅所有频道
   */
  private resubscribeAll(): void {
    for (const sub of this.subscriptions) {
      this.send({
        type: "subscribe",
        ...sub.data,
      });
    }
  }

  /**
   * 添加订阅（重连后自动恢复）
   */
  subscribe(type: string, data: Record<string, unknown>): void {
    // 避免重复订阅
    const exists = this.subscriptions.some(
      (s) => s.type === type && JSON.stringify(s.data) === JSON.stringify(data)
    );
    if (!exists) {
      this.subscriptions.push({ type, data });
    }

    // 如果已连接，立即发送订阅
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: "subscribe",
        ...data,
      });
    }
  }

  /**
   * 移除订阅
   */
  unsubscribe(type: string, data?: Record<string, unknown>): void {
    this.subscriptions = this.subscriptions.filter((s) => {
      if (data) {
        return !(s.type === type && JSON.stringify(s.data) === JSON.stringify(data));
      }
      return s.type !== type;
    });

    // 如果已连接，发送取消订阅
    if (this.ws?.readyState === WebSocket.OPEN && data) {
      this.send({
        type: "unsubscribe",
        ...data,
      });
    }
  }

  /**
   * 发送消息
   */
  // data 收紧为 unknown：内部仅做 JSON.stringify，无需访问具体字段，调用方传任意可序列化对象即可
  send(data: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    // 仅开发环境提示调用方错误：生产环境调用方应通过返回值 false 判断发送失败，
    // 避免在用户控制台产生噪音（非系统级错误，属调用方使用不当）
    if (import.meta.env.DEV) {
      console.warn("WebSocket 未连接，消息发送失败");
    }
    return false;
  }

  /**
   * 获取当前连接状态
   */
  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  /**
   * 获取当前重连次数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 手动关闭连接
   */
  close(): void {
    this.isManualClose = true;

    // 清除重连定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // 清理心跳定时器，避免对已关闭 ws 调用 send 抛错或定时器泄漏
    this.clearHeartbeatTimers();

    // 关闭 WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.options.onStatusChange("disconnected");
  }

  /**
   * 重置连接（清除订阅，重新开始）
   */
  reset(): void {
    this.subscriptions = [];
    this.reconnectAttempts = 0;
    this.close();
  }
}