import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getMessages, markMessagesAsRead, type OrderType } from "@/api/messages";
import { WebSocketClient, type ConnectionStatus } from "@/utils/websocket";
import type { Message } from "@/types";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

// 合法的订单类型集合，用于校验 URL 传入的 orderType
const VALID_ORDER_TYPES: OrderType[] = ["skill", "kitchen", "time", "emergency"];

// WebSocket 推送的聊天消息载荷结构：仅声明本组件消费的字段，其余字段忽略
// 设计原因：WebSocket 消息为动态结构，用类型守卫收窄避免 any 逃逸到组件内部
interface ChatWSMessage {
  type: string;
  data?: {
    id: string;
    senderId: string;
    receiverId?: string;
    content: string;
    type?: string;
    orderType: OrderType;
    createdAt: string;
  };
}

// 类型守卫：判断未知 data 是否为聊天消息结构
function isChatWSMessage(data: unknown): data is ChatWSMessage {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.type === "string";
}

export default function Chat() {
  const { orderId } = useParams<{ orderId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputContent, setInputContent] = useState("");
  const [loading, setLoading] = useState(false);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // WebSocket 连接状态
  const [reconnectCount, setReconnectCount] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");

  // 从 URL query string 解析 orderType，默认 skill；非法值回退为 skill
  const orderType: OrderType = (() => {
    const raw = searchParams.get("orderType");
    if (raw && VALID_ORDER_TYPES.includes(raw as OrderType)) {
      return raw as OrderType;
    }
    return "skill";
  })();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 加载历史消息
  useEffect(() => {
    if (!orderId) return;

    const loadMessages = async () => {
      setLoading(true);
      try {
        // 游标分页：第一页 cursor 为空，查询最新记录
        const res = await getMessages(orderId, undefined, 50, orderType);
        setMessages(res.data.list);
        await markMessagesAsRead(orderId, orderType);
      } catch (error) {
        toast.error(getErrorMessage(error, "加载消息失败"));
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, [orderId, orderType]);

  // WebSocket 连接（使用封装的 WebSocketClient）
  useEffect(() => {
    if (!orderId || !token) return;

    let wasReconnecting = false;

    // 创建 WebSocketClient 实例
    // 使用 protocol-relative host（不含端口），避免经过反向代理时泄漏内部端口
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsClient = new WebSocketClient(`${wsProtocol}//${window.location.host.split(':')[0]}/ws?token=${token}`, {
      maxReconnectAttempts: 5,
      reconnectIntervals: [1000, 2000, 5000, 5000, 5000],
      onOpen: () => {
        // 重连成功后补齐离线期间错过的消息
        if (wasReconnecting) {
          getMessages(orderId, undefined, 50, orderType)
            .then((res) => {
              if (res.data?.list) {
                setMessages(res.data.list);
              }
              return markMessagesAsRead(orderId, orderType);
            })
            .catch((error) => {
              console.error("拉取离线消息失败:", error);
            });
        }
        wasReconnecting = false;
        setReconnectCount(0);
      },
      onMessage: (data) => {
        // 用类型守卫替代隐式 any 访问，避免运行时因消息结构异常抛错
        if (!isChatWSMessage(data) || data.type !== "chat" || !data.data) return;
        const payload = data.data;
        const newMessage: Message = {
          id: payload.id,
          senderId: payload.senderId,
          receiverId: payload.receiverId || "",
          content: payload.content,
          type: payload.type || "text",
          orderType: payload.orderType,
          read: false,
          createdAt: payload.createdAt,
        };
        setMessages((prev) => [...prev, newMessage]);
      },
      onStatusChange: (status) => {
        setConnectionStatus(status);
        if (status === "reconnecting") {
          wasReconnecting = true;
          setReconnectCount(wsClient.getReconnectAttempts());
        }
      },
    });

    wsClientRef.current = wsClient;
    wsClient.connect();

    return () => {
      wsClient.close();
      wsClientRef.current = null;
    };
  }, [orderId, token, orderType]);

  const handleSendMessage = () => {
    if (!inputContent.trim() || !orderId || !wsClientRef.current) return;

    const messageData = {
      type: "chat",
      orderId,
      orderType,
      content: inputContent.trim(),
      msgType: "text",
    };

    wsClientRef.current.send(messageData);
    setInputContent("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isMyMessage = (message: Message) => message.senderId === user?.id;

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) +
      " " +
      date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">聊天</h1>
      </div>

      {/* 连接状态提示：重连中显示黄色，断开显示红色，已连接不显示 */}
      {connectionStatus === "reconnecting" && (
        <div className="bg-yellow-100 text-yellow-800 text-center text-sm py-2 px-4">
          重连中...（第 {reconnectCount} 次）
        </div>
      )}
      {connectionStatus === "disconnected" && (
        <div className="bg-red-100 text-red-800 text-center text-sm py-2 px-4">
          连接已断开，请刷新页面
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && (
          <div className="text-center py-8 text-gray-500">
            <span className="animate-spin inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full mr-2" />
            加载中...
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p>暂无消息</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex mb-4 ${isMyMessage(message) ? "justify-end" : "justify-start"}`}
          >
            <div className={`max-w-[70%] ${isMyMessage(message) ? "order-2" : "order-1"}`}>
              <div
                className={`px-4 py-2 rounded-lg ${
                  isMyMessage(message)
                    ? "bg-emerald-500 text-white"
                    : "bg-white text-gray-900"
                }`}
              >
                {message.content}
              </div>
              <div
                className={`text-xs text-gray-400 mt-1 ${
                  isMyMessage(message) ? "text-right" : "text-left"
                }`}
              >
                {formatTime(message.createdAt)}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="bg-white border-t border-gray-200 px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="输入消息..."
            className="flex-1 px-4 py-2 bg-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputContent.trim()}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-600"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
