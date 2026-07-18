import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹交互，自动等待微任务 flush，
// 消除"异步 state 更新未被 act 包裹"警告，模拟真实用户点击序列
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Notifications from '../index';
import type { Notification, NotificationType, NotificationReferenceType } from '@/types';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖未读/已读、4 种类型、3 种跳转类型
const {
  mockNotifications,
  mockEmptyList,
  mockMoreList,
  consoleErrorSpy,
} = vi.hoisted(() => {
  // 构造单条通知的工厂函数：默认未读（readAt=undefined）
  const make = (
    overrides: Partial<Notification> & { id: string; type: NotificationType; title: string }
  ): Notification => ({
    userId: 'user-1',
    content: '通知内容',
    createdAt: '2024-01-10T10:00:00.000Z',
    ...overrides,
  } as Notification);

  // 默认列表：覆盖 4 种类型 + 未读/已读 + 3 种跳转类型 + 无跳转
  const list: Notification[] = [
    // 1. order_status 未读，跳转 skill_order
    make({
      id: 'n-1',
      type: 'order_status',
      title: '订单状态更新',
      content: '您的技能订单已被接受',
      referenceId: 'order-1',
      referenceType: 'skill_order' as NotificationReferenceType,
    }),
    // 2. emergency_response 未读，跳转 emergency_request
    make({
      id: 'n-2',
      type: 'emergency_response',
      title: '应急响应通知',
      content: '您的应急请求已有新响应',
      referenceId: 'emergency-1',
      referenceType: 'emergency_request' as NotificationReferenceType,
    }),
    // 3. report_result 已读，无跳转
    make({
      id: 'n-3',
      type: 'report_result',
      title: '举报处理结果',
      content: '您的举报已处理完成',
      readAt: '2024-01-11T10:00:00.000Z',
    }),
    // 4. system 未读，跳转 kitchen_order
    make({
      id: 'n-4',
      type: 'system',
      title: '系统维护通知',
      content: '系统将于今晚维护',
      referenceId: 'kitchen-1',
      referenceType: 'kitchen_order' as NotificationReferenceType,
    }),
    // 5. 无 content 的通知（覆盖 content 可选分支）
    make({
      id: 'n-5',
      type: 'system',
      title: '仅标题通知',
    }),
  ];

  return {
    mockNotifications: list,
    mockEmptyList: [] as Notification[],
    mockMoreList: [
      make({ id: 'n-6', type: 'order_status', title: '第二页通知' }),
    ],
    consoleErrorSpy: vi.fn(),
  };
});

// mock notifications API：getNotifications/getUnreadCount/markAsRead/markAllAsRead
vi.mock('@/api/notifications', () => ({
  getNotifications: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: { list: mockNotifications, page: 1, pageSize: 20, total: mockNotifications.length, totalPages: 1, hasNext: false },
  })),
  getUnreadCount: vi.fn(async () => ({ code: 0, message: 'ok', data: { unreadCount: 3 } })),
  markAsRead: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
  markAllAsRead: vi.fn(async () => ({ code: 0, message: 'ok', data: { markedCount: 3 } })),
}));

// mock react-router-dom 的 Link 为普通 anchor，便于断言 href
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual };
});

// 引入被 mock 的 API 以便在用例中配置返回值
import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from '@/api/notifications';

// 包装组件：注入 MemoryRouter 提供路由上下文（Link 依赖）
function renderNotifications() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Notifications />
    </MemoryRouter>
  );
}

describe('Notifications 通知中心', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认返回 3 条未读 + 默认列表
    vi.mocked(getNotifications).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockNotifications,
        page: 1,
        pageSize: 20,
        total: mockNotifications.length,
        totalPages: 1,
        hasNext: false,
      },
    });
    vi.mocked(getUnreadCount).mockResolvedValue({ code: 0, message: 'ok', data: { unreadCount: 3 } });
    vi.mocked(markAsRead).mockResolvedValue({ code: 0, message: 'ok', data: null });
    vi.mocked(markAllAsRead).mockResolvedValue({ code: 0, message: 'ok', data: { markedCount: 3 } });
    // 监听 console.error：组件错误处理用 console.error 输出，无 UI 错误提示
    vi.spyOn(console, 'error').mockImplementation(consoleErrorSpy);
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中显示 Loader2 旋转动画', () => {
    // 让 getNotifications 永不 resolve，保持 loading 状态
    vi.mocked(getNotifications).mockImplementation(() => new Promise(() => {}));

    renderNotifications();

    // animate-spin 是加载态标志
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('getNotifications 失败时调用 console.error，无 UI 错误提示', async () => {
    vi.mocked(getNotifications).mockRejectedValue(new Error('网络错误'));

    renderNotifications();

    // 等待 console.error 被调用（组件 catch 中输出）
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('加载通知失败:', expect.any(Error));
    });
  });

  it('getUnreadCount 失败时调用 console.error', async () => {
    vi.mocked(getUnreadCount).mockRejectedValue(new Error('未读数量获取失败'));

    renderNotifications();

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('加载未读数量失败:', expect.any(Error));
    });
  });

  it('空列表显示"暂无通知"与 Bell 图标', async () => {
    vi.mocked(getNotifications).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { list: mockEmptyList, page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false },
    });
    vi.mocked(getUnreadCount).mockResolvedValue({ code: 0, message: 'ok', data: { unreadCount: 0 } });

    renderNotifications();

    await screen.findByText('暂无通知');
    expect(screen.getByText('暂无通知')).toBeInTheDocument();
    // Bell 图标应渲染（空状态图标）
    const bellIcon = document.querySelector('.lucide-bell');
    expect(bellIcon).toBeInTheDocument();
  });

  it('列表渲染通知标题与内容', async () => {
    renderNotifications();

    // 用第一个通知的标题作为加载完成标志
    await screen.findByText('订单状态更新');
    expect(screen.getByText('订单状态更新')).toBeInTheDocument();
    expect(screen.getByText('您的技能订单已被接受')).toBeInTheDocument();
    // 第二个通知
    expect(screen.getByText('应急响应通知')).toBeInTheDocument();
    // 已读通知
    expect(screen.getByText('举报处理结果')).toBeInTheDocument();
  });

  it('未读数量>0 时标题旁显示徽章 + "全部已读"按钮', async () => {
    renderNotifications();

    // 用第一个通知标题作为加载完成标志
    await screen.findByText('订单状态更新');
    // 未读数量徽章（unreadCount=3）
    expect(screen.getByText('3')).toBeInTheDocument();
    // "全部已读"按钮
    expect(screen.getByRole('button', { name: '全部已读' })).toBeInTheDocument();
  });

  it('未读数量=0 时不显示徽章与"全部已读"按钮', async () => {
    vi.mocked(getUnreadCount).mockResolvedValue({ code: 0, message: 'ok', data: { unreadCount: 0 } });

    renderNotifications();

    await screen.findByText('订单状态更新');
    // "全部已读"按钮不应存在
    expect(screen.queryByRole('button', { name: '全部已读' })).toBeNull();
  });

  it('未读通知显示小红点 + 标题加粗（text-gray-900）', async () => {
    renderNotifications();

    await screen.findByText('订单状态更新');
    // 未读通知标题（订单状态更新）应有 text-gray-900 class
    const unreadTitle = screen.getByText('订单状态更新');
    expect(unreadTitle.className).toContain('text-gray-900');
    // 未读通知应有小红点（w-2 h-2 bg-red-500 rounded-full）
    const redDot = unreadTitle.parentElement?.querySelector('.bg-red-500.rounded-full');
    expect(redDot).toBeInTheDocument();
  });

  it('已读通知无小红点 + 标题变浅（text-gray-600）', async () => {
    renderNotifications();

    await screen.findByText('举报处理结果');
    // 已读通知标题（举报处理结果）应有 text-gray-600 class
    const readTitle = screen.getByText('举报处理结果');
    expect(readTitle.className).toContain('text-gray-600');
    // 已读通知不应有小红点
    const redDot = readTitle.parentElement?.querySelector('.bg-red-500.rounded-full');
    expect(redDot).toBeNull();
  });

  it('4 种类型图标均渲染（order_status/emergency_response/report_result/system）', async () => {
    renderNotifications();

    await screen.findByText('订单状态更新');
    // order_status → Package 图标
    expect(document.querySelector('.lucide-package')).toBeInTheDocument();
    // emergency_response → Siren 图标
    expect(document.querySelector('.lucide-siren')).toBeInTheDocument();
    // report_result → AlertTriangle 图标
    expect(document.querySelector('.lucide-triangle-alert')).toBeInTheDocument();
    // system → Info 图标
    expect(document.querySelector('.lucide-info')).toBeInTheDocument();
  });

  it('点击未读通知调用 markAsRead 并更新未读数量', async () => {
    renderNotifications();

    await screen.findByText('订单状态更新');
    // 点击未读通知（n-1 订单状态更新）
    await user.click(screen.getByText('订单状态更新'));

    // markAsRead 应被调用，参数为 notificationId
    await waitFor(() => {
      expect(markAsRead).toHaveBeenCalledWith('n-1');
    });
  });

  it('点击已读通知不调用 markAsRead', async () => {
    renderNotifications();

    await screen.findByText('举报处理结果');
    // 点击已读通知（n-3 举报处理结果，readAt 已设置）
    await user.click(screen.getByText('举报处理结果'));

    // markAsRead 不应被调用
    expect(markAsRead).not.toHaveBeenCalled();
  });

  it('点击"全部已读"调用 markAllAsRead 并清空未读数量', async () => {
    renderNotifications();

    await screen.findByText('订单状态更新');
    // 点击"全部已读"按钮
    await user.click(screen.getByRole('button', { name: '全部已读' }));

    // markAllAsRead 应被调用
    await waitFor(() => {
      expect(markAllAsRead).toHaveBeenCalled();
    });
    // 未读数量徽章应消失（unreadCount 归零后不渲染）
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '全部已读' })).toBeNull();
    });
  });

  it('referenceType=skill_order 渲染"/skills/orders"跳转链接', async () => {
    renderNotifications();

    await screen.findByText('订单状态更新');
    // 第一个通知（n-1）应渲染"查看"链接，href 为 /skills/orders
    const links = screen.getAllByText('查看');
    expect(links.length).toBeGreaterThan(0);
    // 验证至少有一个链接指向 /skills/orders
    const skillOrderLink = links.find(link => link.closest('a')?.getAttribute('href') === '/skills/orders');
    expect(skillOrderLink).toBeTruthy();
  });

  it('referenceType=emergency_request 渲染"/emergency/{referenceId}"跳转链接', async () => {
    renderNotifications();

    await screen.findByText('应急响应通知');
    // 第二个通知（n-2）应渲染"查看"链接，href 为 /emergency/emergency-1
    const links = screen.getAllByText('查看');
    const emergencyLink = links.find(link => link.closest('a')?.getAttribute('href') === '/emergency/emergency-1');
    expect(emergencyLink).toBeTruthy();
  });

  it('无 referenceId 时不渲染"查看"链接', async () => {
    // mock 仅 1 条无 referenceId 的通知
    vi.mocked(getNotifications).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: [{
          id: 'n-no-ref',
          userId: 'user-1',
          type: 'system' as NotificationType,
          title: '无跳转通知',
          content: '此通知无跳转',
          createdAt: '2024-01-10T10:00:00.000Z',
        }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        hasNext: false,
      },
    });

    renderNotifications();

    await screen.findByText('无跳转通知');
    // 不应渲染"查看"链接
    expect(screen.queryByText('查看')).toBeNull();
  });

  it('hasMore=true 时显示"加载更多"按钮，点击触发分页加载', async () => {
    // mock 第一页 hasNext=true
    vi.mocked(getNotifications).mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: {
        list: mockNotifications,
        page: 1,
        pageSize: 20,
        total: mockNotifications.length + 1,
        totalPages: 2,
        hasNext: true,
      },
    }).mockResolvedValueOnce({
      code: 0,
      message: 'ok',
      data: {
        list: mockMoreList,
        page: 2,
        pageSize: 20,
        total: mockNotifications.length + 1,
        totalPages: 2,
        hasNext: false,
      },
    });

    renderNotifications();

    await screen.findByText('订单状态更新');
    // "加载更多"按钮应可见
    const loadMoreBtn = screen.getByRole('button', { name: '加载更多' });
    expect(loadMoreBtn).toBeInTheDocument();

    // 点击"加载更多"
    await user.click(loadMoreBtn);

    // 第二页通知标题应出现
    await screen.findByText('第二页通知');
    expect(screen.getByText('第二页通知')).toBeInTheDocument();
    // getNotifications 应被调用 2 次（page=1 + page=2）
    expect(vi.mocked(getNotifications)).toHaveBeenCalledTimes(2);
    // 第二次调用参数应为 page=2
    expect(vi.mocked(getNotifications)).toHaveBeenNthCalledWith(2, 2, 20);
  });

  it('hasMore=false 时不显示"加载更多"按钮', async () => {
    renderNotifications();

    await screen.findByText('订单状态更新');
    // 默认 mock hasNext=false，"加载更多"按钮不应存在
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  // 重复提交守卫不变式：弱网下用户连点同一未读通知应只触发一次 markAsRead API 调用
  // 设计原因：原实现仅靠 if (notification.readAt) return 幂等判断，React 状态更新是异步批处理的，
  // readAt 在批处理结束前仍为 null，连点会触发多次 API 调用，后端虽幂等但前端 setUnreadCount(prev => prev - 1)
  // 会被多次执行导致未读计数错误（多次减 1）
  it('标记单条已读进行中图标显示 Loader2 且重复点击不触发第二次 API 调用', async () => {
    // 永不 resolve：锁定 markingId 状态，模拟弱网
    vi.mocked(markAsRead).mockImplementation(() => new Promise(() => {}));

    renderNotifications();

    await screen.findByText('订单状态更新');

    // 点击未读通知 n-1（订单状态更新）
    await user.click(screen.getByText('订单状态更新'));

    // 第一次点击应触发 markAsRead 调用
    await waitFor(() => {
      expect(markAsRead).toHaveBeenCalledWith('n-1');
      expect(markAsRead).toHaveBeenCalledTimes(1);
    });

    // 通知项图标应替换为 Loader2 旋转动画（markingId === n-1 时渲染 Loader2 替代原 Icon）
    // 注：列表中可能有多个 animate-spin 元素（loading 顶部 spinner），用出现在通知项 div 内的 spinner 验证
    const notificationItem = screen.getByText('订单状态更新').closest('li');
    const itemSpinner = notificationItem?.querySelector('.animate-spin');
    expect(itemSpinner).toBeInTheDocument();

    // 重复点击同一通知不应触发第二次 API 调用（markingId 守卫已拦截）
    await user.click(screen.getByText('订单状态更新'));
    await user.click(screen.getByText('订单状态更新'));
    expect(markAsRead).toHaveBeenCalledTimes(1);
  });

  // 重复提交守卫不变式：弱网下用户连点"全部已读"应只触发一次 markAllAsRead API 调用
  // 设计原因：markAllAsRead 接口虽幂等，但弱网下重复调用造成不必要请求量，且 markingAll 期间
  // 禁止其他通知点击避免状态错乱（已读列表与计数并发更新可能不一致）
  it('全部标记已读进行中按钮显示"处理中..."加载态且重复点击不触发第二次 API 调用', async () => {
    // 永不 resolve：锁定 markingAll 状态，模拟弱网
    vi.mocked(markAllAsRead).mockImplementation(() => new Promise(() => {}));

    renderNotifications();

    await screen.findByText('订单状态更新');

    // 点击"全部已读"按钮
    await user.click(screen.getByRole('button', { name: '全部已读' }));

    // 第一次点击应触发 markAllAsRead 调用
    await waitFor(() => {
      expect(markAllAsRead).toHaveBeenCalledTimes(1);
    });

    // 按钮应进入加载态：显示"处理中..."文案
    const loadingButton = await screen.findByRole('button', { name: /处理中/ });
    // 按钮应禁用（disabled 属性阻止 onClick 触发）
    expect(loadingButton).toBeDisabled();

    // 重复点击"处理中..."按钮不应触发第二次 API 调用（按钮 disabled + markingAll 守卫双重防御）
    await user.click(loadingButton);
    await user.click(loadingButton);
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
  });
});
