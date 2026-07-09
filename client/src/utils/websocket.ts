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
  private subscriptions: Subscription[] = [];
  private isManualClose = false;

  constructor(url: string, options: WebSocketClientOptions = {}) {
    this.url = url;
    this.options = {
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectIntervals: options.reconnectIntervals ?? [1000, 2000, 5000],
      onOpen: options.onOpen ?? (() => {}),
      onClose: options.onClose ?? (() => {}),
      onError: options.onError ?? (() => {}),
      onMessage: options.onMessage ?? (() => {}),
      onStatusChange: options.onStatusChange ?? (() => {}),
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
      this.options.onOpen();

      // 重连成功后恢复之前的订阅
      if (wasReconnecting) {
        this.resubscribeAll();
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.options.onMessage(data);
      } catch (error) {
        console.error("解析消息失败:", error);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket 错误:", error);
      this.options.onError(error);
    };

    this.ws.onclose = () => {
      console.log("WebSocket 连接已关闭");
      this.options.onClose();

      // 非手动关闭时尝试重连
      if (!this.isManualClose) {
        this.handleReconnect();
      }
    };
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

    console.log(`将在 ${delay / 1000} 秒后进行第 ${this.reconnectAttempts + 1} 次重连`);

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
    console.warn("WebSocket 未连接，消息发送失败");
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