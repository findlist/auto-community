import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹所有交互，自动等待微任务队列清空，
// 从根本上消除"异步 state 更新未被 act 包裹"警告，与 FamilyBinding/DeleteAccount 测试规范一致。
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Chat from '../Chat';
import type { Message } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：WebSocket 实例、用户信息、路由跳转、Toast、WS options 引用
const {
  // WebSocket 客户端 mock 实例：组件内 wsClientRef.current 指向此对象
  mockWsInstance,
  // 用 ref 容器保存 WebSocketClient 构造时传入的 options，便于测试中手动触发 onMessage/onStatusChange 回调
  // 设计原因：vi.mock 工厂内不能直接引用外部 let 变量（vitest 提升机制限制），用 hoisted 的 ref 对象绕过
  lastWsOptionsRef,
  mockUser,
  mockNavigate,
  mockToastError,
} = vi.hoisted(() => ({
  mockWsInstance: {
    connect: vi.fn(),
    send: vi.fn(() => true),
    close: vi.fn(),
    getReconnectAttempts: vi.fn(() => 0),
  },
  // 类型与真实 WebSocketClientOptions 对齐：onMessage 用 unknown 强制消费方收窄，onStatusChange 用 ConnectionStatus 约束状态字符串
  lastWsOptionsRef: { current: null as null | { onMessage?: (data: unknown) => void; onStatusChange?: (status: ConnectionStatus) => void; onOpen?: () => void } },
  // User 接口必填字段补全，避免 TS2740 类型错误
  mockUser: {
    id: 'user-self',
    phone: '13800000000',
    nickname: '当前用户',
    creditBalance: 100,
    timeBalance: 50,
    reputationScore: 4.5,
    role: 'user' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  mockNavigate: vi.fn(),
  mockToastError: vi.fn(),
}));

// mock @/utils/websocket：WebSocketClient 构造函数把 mockWsInstance 的方法赋给 this，同时把 options 存入 ref 供测试触发回调
// 设计原因：vi.fn 箭头函数不能作为构造函数（is not a constructor），必须用 function 关键字；
// 构造函数内 Object.assign(this, mockWsInstance) 使组件内 wsClientRef.current.send 等方法指向 mock 实例的 vi.fn，
// 既保留 vi.mocked(WebSocketClient).mock.calls 断言能力，又让 mockWsInstance.send 的 mock.calls 记录调用
// _url 前缀下划线表明构造函数签名需匹配真实 WebSocketClient(url, options)，但测试不直接使用 url 参数
vi.mock('@/utils/websocket', () => ({
  // this 类型对齐 mockWsInstance（Object.assign 后 this 持有其全部方法），options 对齐 WebSocketClientOptions
  WebSocketClient: vi.fn(function (this: typeof mockWsInstance, _url: string, options: WebSocketClientOptions) {
    lastWsOptionsRef.current = options;
    Object.assign(this, mockWsInstance);
  }),
}));

// mock @/api/messages：getMessages 默认返回空列表，markMessagesAsRead 默认成功
// 用 let 变量在测试中动态修改返回值（beforeEach 重置）
let mockMessagesList: Message[] = [];

vi.mock('@/api/messages', () => ({
  getMessages: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { list: mockMessagesList, nextCursor: null, hasMore: false },
  })),
  markMessagesAsRead: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
}));

// mock @/hooks/useAuth：默认已登录，token 用于 WebSocket URL 拼接
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  })),
}));

// mock @/components/Toast：捕获 error 调用以便断言加载失败提示
vi.mock('@/components/Toast', () => ({
  toast: { success: vi.fn(), error: mockToastError },
}));

// mock react-router-dom：useParams 提供 orderId，useSearchParams 提供 orderType，useNavigate 提供跳转断言
const { routeParams } = vi.hoisted(() => ({
  // 用 ref 容器保存路由参数，便于测试中动态修改 orderType
  routeParams: { orderId: 'order-1', orderType: 'skill' as string },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ orderId: routeParams.orderId }),
    useSearchParams: () => [new URLSearchParams(`orderType=${routeParams.orderType}`)],
    useNavigate: () => mockNavigate,
  };
});

import { getMessages, markMessagesAsRead } from '@/api/messages';
import { WebSocketClient, type WebSocketClientOptions, type ConnectionStatus } from '@/utils/websocket';

// 包装组件：注入 MemoryRouter 提供路由上下文（future flag 提前适配 v7）
function renderChat() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Chat />
    </MemoryRouter>
  );
}

// 构造历史消息 mock 数据：自己/对方各一条，便于验证左右分布
function buildMockMessages(): Message[] {
  return [
    {
      id: 'msg-1',
      senderId: 'user-other',
      receiverId: 'user-self',
      content: '你好，对方消息',
      type: 'text',
      orderType: 'skill',
      read: false,
      createdAt: '2024-01-01T10:00:00.000Z',
    },
    {
      id: 'msg-2',
      senderId: 'user-self',
      receiverId: 'user-other',
      content: '你好，自己消息',
      type: 'text',
      orderType: 'skill',
      read: false,
      createdAt: '2024-01-01T10:01:00.000Z',
    },
  ];
}

describe('Chat 聊天交互', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置动态变量：消息列表为空、路由参数默认 skill
    mockMessagesList = [];
    routeParams.orderId = 'order-1';
    routeParams.orderType = 'skill';
    lastWsOptionsRef.current = null;
    // jsdom 未实现 scrollIntoView，组件挂载时 scrollToBottom 会调用它，需手动 mock 避免报错
    Element.prototype.scrollIntoView = vi.fn();
    // 设计原因：vi.clearAllMocks 只清 mock.calls，不清 mockImplementation；
    // "加载中"测试用 mockImplementation 覆盖为永远 pending，若不重置会泄漏到后续测试导致 getMessages 卡住
    vi.mocked(getMessages).mockImplementation(async () => ({
      code: 0,
      message: 'ok',
      data: { list: mockMessagesList, nextCursor: null, hasMore: false },
    }));
    vi.mocked(markMessagesAsRead).mockImplementation(async () => ({
      code: 0,
      message: 'ok',
      data: null,
    }));
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中显示加载动画与"加载中..."文案', async () => {
    // 故意延迟返回，保证 loading 状态渲染
    vi.mocked(getMessages).mockImplementation(() => new Promise(() => {}));

    renderChat();

    expect(screen.getByText('加载中...')).toBeInTheDocument();
    // spinner 动画 class 检测
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('加载完成显示历史消息，自己消息靠右、对方消息靠左', async () => {
    mockMessagesList = buildMockMessages();

    renderChat();

    // 等待消息渲染
    await screen.findByText('你好，对方消息');
    expect(screen.getByText('你好，自己消息')).toBeInTheDocument();

    // 自己消息容器靠右（justify-end），对方消息容器靠左（justify-start）
    const myMessageWrapper = screen.getByText('你好，自己消息').closest('div.flex');
    expect(myMessageWrapper?.className).toContain('justify-end');
    const otherMessageWrapper = screen.getByText('你好，对方消息').closest('div.flex');
    expect(otherMessageWrapper?.className).toContain('justify-start');

    // 自己消息气泡为 emerald 背景，对方消息气泡为白色背景
    const myBubble = screen.getByText('你好，自己消息');
    expect(myBubble.className).toContain('bg-emerald-500');
    const otherBubble = screen.getByText('你好，对方消息');
    expect(otherBubble.className).toContain('bg-white');
  });

  it('加载失败显示 toast.error 错误提示', async () => {
    vi.mocked(getMessages).mockRejectedValue(new Error('加载消息失败'));

    renderChat();

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('加载消息失败');
    });
  });

  it('空消息列表显示"暂无消息"空状态', async () => {
    renderChat();

    await screen.findByText('暂无消息');
    expect(screen.getByText('暂无消息')).toBeInTheDocument();
  });

  it('输入为空时发送按钮禁用', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    // 页面含返回按钮+发送按钮两个 button，用 input 同级容器定位发送按钮
    // input 经 getByPlaceholderText 取得必存在，且渲染在容器内 parentElement 必非空，故用非空断言而非可选链
    const input = screen.getByPlaceholderText('输入消息...');
    const sendButton = input.parentElement!.querySelector('button') as HTMLButtonElement;
    expect(sendButton).toBeDisabled();
  });

  it('输入消息后发送按钮启用', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    await user.type(screen.getByPlaceholderText('输入消息...'), '测试消息');

    const input = screen.getByPlaceholderText('输入消息...');
    const sendButton = input.parentElement!.querySelector('button') as HTMLButtonElement;
    expect(sendButton).toBeEnabled();
  });

  it('点击发送按钮调用 wsClient.send 并清空输入框', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    const input = screen.getByPlaceholderText('输入消息...') as HTMLInputElement;
    await user.type(input, '你好');
    // 发送按钮在 input 同级容器内（返回按钮在顶栏，不在同一容器）
    // input 已断言为 HTMLInputElement 且渲染在容器内，parentElement 必非空，用非空断言避免可选链+非空断言的矛盾写法
    const sendButton = input.parentElement!.querySelector('button') as HTMLButtonElement;
    await user.click(sendButton);

    // send 被调用，参数含 content 与 orderId
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chat',
        orderId: 'order-1',
        orderType: 'skill',
        content: '你好',
        msgType: 'text',
      })
    );
    // 输入框清空
    expect(input.value).toBe('');
  });

  it('按 Enter 键发送消息', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    const input = screen.getByPlaceholderText('输入消息...');
    await user.type(input, '回车发送');
    await user.keyboard('{Enter}');

    expect(mockWsInstance.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: '回车发送' })
    );
  });

  it('按 Shift+Enter 不触发发送', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    const input = screen.getByPlaceholderText('输入消息...');
    await user.type(input, '不发送');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(mockWsInstance.send).not.toHaveBeenCalled();
  });

  it('点击返回按钮调用 navigate(-1)', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    // 顶栏返回按钮（ArrowLeft 图标按钮）
    // 设计原因：getAllByRole 返回 HTMLElement[]，数组下标访问为 HTMLElement | undefined，
    // user.click 需要 Element，用非空断言 ! 表明此处确定存在
    const backButton = screen.getAllByRole('button')[0]!;
    await user.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('WebSocket 接收 chat 类型消息追加到列表', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    // 手动触发 onMessage 回调，模拟收到新消息
    act(() => {
      lastWsOptionsRef.current?.onMessage?.({
        type: 'chat',
        data: {
          id: 'msg-ws-1',
          senderId: 'user-other',
          receiverId: 'user-self',
          content: 'WebSocket 推送的消息',
          type: 'text',
          orderType: 'skill',
          createdAt: '2024-01-01T10:02:00.000Z',
        },
      });
    });

    expect(screen.getByText('WebSocket 推送的消息')).toBeInTheDocument();
  });

  it('WebSocket 非 chat 类型消息不追加到列表', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    act(() => {
      lastWsOptionsRef.current?.onMessage?.({
        type: 'notification',
        data: { id: 'msg-other', content: '不应出现' },
      });
    });

    expect(screen.queryByText('不应出现')).not.toBeInTheDocument();
  });

  it('WebSocket 重连状态显示"重连中"提示', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    // 模拟 getReconnectAttempts 返回 2 次，触发重连提示
    mockWsInstance.getReconnectAttempts.mockReturnValue(2);

    act(() => {
      lastWsOptionsRef.current?.onStatusChange?.('reconnecting');
    });

    expect(screen.getByText(/重连中/)).toBeInTheDocument();
    expect(screen.getByText(/第 2 次/)).toBeInTheDocument();
  });

  it('WebSocket 断开状态显示"连接已断开"提示', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    act(() => {
      lastWsOptionsRef.current?.onStatusChange?.('disconnected');
    });

    expect(screen.getByText('连接已断开，请刷新页面')).toBeInTheDocument();
  });

  it('orderType 从 URL 解析为 kitchen', async () => {
    routeParams.orderType = 'kitchen';

    renderChat();

    await screen.findByText('暂无消息');

    // getMessages 调用参数应包含 orderType: 'kitchen'
    expect(getMessages).toHaveBeenCalledWith('order-1', undefined, 50, 'kitchen');
    // markMessagesAsRead 在 getMessages 之后异步调用，需 waitFor 等待
    await waitFor(() => {
      expect(markMessagesAsRead).toHaveBeenCalledWith('order-1', 'kitchen');
    });
  });

  it('非法 orderType 回退为 skill', async () => {
    routeParams.orderType = 'invalid_type';

    renderChat();

    await screen.findByText('暂无消息');

    // 非法值回退为 skill（VALID_ORDER_TYPES 校验）
    expect(getMessages).toHaveBeenCalledWith('order-1', undefined, 50, 'skill');
  });

  it('组件卸载时调用 wsClient.close 清理连接', async () => {
    const { unmount } = renderChat();

    await screen.findByText('暂无消息');

    unmount();

    expect(mockWsInstance.close).toHaveBeenCalled();
  });

  it('WebSocketClient 构造使用 token 与正确 URL', async () => {
    renderChat();

    await screen.findByText('暂无消息');

    expect(WebSocketClient).toHaveBeenCalledWith(
      expect.stringContaining('ws://'),
      expect.objectContaining({
        maxReconnectAttempts: 5,
        reconnectIntervals: [1000, 2000, 5000, 5000, 5000],
      })
    );
    // URL 应包含 token
    const callArgs = vi.mocked(WebSocketClient).mock.calls[0];
    expect(callArgs?.[0]).toContain('token=test-token');
  });
});
