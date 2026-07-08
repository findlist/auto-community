/**
 * SystemStatus 端到端测试
 *
 * 测试目标：
 * - 加载成功显示数据库/Redis/服务器状态卡片与指标值
 * - 加载中显示 Loader2 旋转动画
 * - 加载失败显示错误提示与重试按钮
 * - 数据库异常/Redis 断开状态正确渲染
 * - 告警日志列表显示/空列表/清除告警全流程
 * - 刷新按钮重新加载指标
 *
 * 测试策略：vi.hoisted 提升 mock 数据避免 TDZ，mock @/api/admin 与 @/components/Toast，
 *           act 包裹 render 避免 state 更新警告，waitFor 等待异步加载完成。
 *           不使用 fake timers：组件内 10 秒 setInterval 在单测 5 秒超时内不会触发额外加载。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import type { MetricsResponse } from '@/api/admin';
import SystemStatus from '../SystemStatus';

// vi.hoisted 提升 mock 数据避免 TDZ
// 设计原因：4 套 metrics 覆盖 healthy/unhealthy × connected/disconnected 组合，便于精确验证状态标签
const {
  mockMetrics,
  mockEmptyAlerts,
  mockUnhealthyMetrics,
  mockDisconnectedRedis,
} = vi.hoisted((): {
  mockMetrics: MetricsResponse;
  mockEmptyAlerts: MetricsResponse;
  mockUnhealthyMetrics: MetricsResponse;
  mockDisconnectedRedis: MetricsResponse;
} => {
  // 基础服务器指标：heapUsed 50MB / heapTotal 100MB = 50% 内存使用率，不触发 >80% 警告样式
  const baseServer = {
    uptime: 3661, // 1小时 1分钟 1秒
    memoryUsage: {
      heapUsed: 50 * 1024 * 1024,
      heapTotal: 100 * 1024 * 1024,
      rss: 200 * 1024 * 1024,
    },
    requestQueueLength: 0,
  };
  const baseDatabase = {
    status: 'healthy' as const,
    poolSize: 10,
    idleConnections: 5,
    waitingCount: 0,
  };
  const baseRedis = {
    status: 'healthy' as const,
    connected: true,
    memoryUsage: '2.5MB',
  };
  return {
    // 默认场景：全健康 + 2 条告警（warning + critical，覆盖两种等级标签）
    mockMetrics: {
      metrics: { database: baseDatabase, redis: baseRedis, server: baseServer },
      alerts: [
        {
          timestamp: '2024-01-01T10:00:00.000Z',
          type: 'database' as const,
          level: 'warning' as const,
          message: '连接池接近上限',
          details: {},
        },
        {
          timestamp: '2024-01-02T11:00:00.000Z',
          type: 'redis' as const,
          level: 'critical' as const,
          message: 'Redis 断开告警',
          details: {},
        },
      ],
    },
    // 空告警场景：用于验证"暂无告警日志"与"清除告警"按钮禁用
    mockEmptyAlerts: {
      metrics: { database: baseDatabase, redis: baseRedis, server: baseServer },
      alerts: [],
    },
    // 数据库异常场景：waitingCount=15 触发 >10 红色警告样式
    mockUnhealthyMetrics: {
      metrics: {
        database: {
          status: 'unhealthy' as const,
          poolSize: 10,
          idleConnections: 0,
          waitingCount: 15,
        },
        redis: baseRedis,
        server: baseServer,
      },
      alerts: [],
    },
    // Redis 断开场景：connected=false 触发红色"断开"文案
    mockDisconnectedRedis: {
      metrics: {
        database: baseDatabase,
        redis: { status: 'unhealthy' as const, connected: false, memoryUsage: '0MB' },
        server: baseServer,
      },
      alerts: [],
    },
  };
});

// mock admin API：getSystemMetrics 默认返回 mockMetrics，clearAlertLogs 默认成功
vi.mock('@/api/admin', () => ({
  getSystemMetrics: vi.fn(async () => ({ code: 0, message: 'ok', data: mockMetrics })),
  clearAlertLogs: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
}));

// mock Toast：避免真实 DOM 渲染依赖，仅记录调用
vi.mock('@/components/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { getSystemMetrics, clearAlertLogs } from '@/api/admin';
import { toast } from '@/components/Toast';

// 包装组件：SystemStatus 未使用路由 hook，无需 MemoryRouter
function renderSystemStatus() {
  return render(<SystemStatus />);
}

describe('SystemStatus 系统状态监控', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mock window.confirm：handleClearAlerts 调用 confirm 弹窗确认
    window.confirm = vi.fn(() => true);
    // 每个用例前重置默认 mock 返回值
    vi.mocked(getSystemMetrics).mockResolvedValue({ code: 0, message: 'ok', data: mockMetrics });
    vi.mocked(clearAlertLogs).mockResolvedValue({ code: 0, message: 'ok', data: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载成功显示数据库/Redis/服务器状态卡片', async () => {
    await act(async () => {
      renderSystemStatus();
    });
    // 等待异步加载完成：连接池大小出现代表 metrics 已渲染
    // 设计原因："数据库"标题与告警类型标签同名会多元素匹配，用"连接池大小"精确等待
    await waitFor(() => {
      expect(screen.getByText('连接池大小')).toBeInTheDocument();
    });
    // 数据库卡片指标
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('空闲连接')).toBeInTheDocument();
    expect(screen.getByText('等待请求数')).toBeInTheDocument();
    // Redis 卡片指标（"Redis"标题与告警类型标签同名，用"连接状态"验证卡片渲染）
    expect(screen.getByText('连接状态')).toBeInTheDocument();
    expect(screen.getByText('已连接')).toBeInTheDocument();
    expect(screen.getByText('2.5MB')).toBeInTheDocument();
    // 服务器卡片
    expect(screen.getByText('服务器')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
  });

  it('加载成功显示服务器运行时间与内存使用率', async () => {
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      expect(screen.getByText('运行时间')).toBeInTheDocument();
    });
    // formatUptime(3661) = "1小时 1分钟 1秒"
    expect(screen.getByText('1小时 1分钟 1秒')).toBeInTheDocument();
    // 内存使用率 50.0%（heapUsed 50MB / heapTotal 100MB）
    expect(screen.getByText('50.0%')).toBeInTheDocument();
    // 堆内存 50.00 MB / 100.00 MB（formatBytes 保留两位小数）
    // 设计原因：堆内存 span 内文本节点合并为 "50.00 MB / 100.00 MB"，用正则部分匹配
    expect(screen.getByText(/50\.00 MB/)).toBeInTheDocument();
    expect(screen.getByText(/100\.00 MB/)).toBeInTheDocument();
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 让 getSystemMetrics 永不 resolve，保持 loading 状态
    vi.mocked(getSystemMetrics).mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      renderSystemStatus();
    });
    // Loader2 是 svg.animate-spin，用 class 选择器定位
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('加载失败显示错误提示与重试按钮', async () => {
    // 抛出普通 Error，SystemStatus 错误处理为 err instanceof ApiError ? err.message : "加载失败"
    vi.mocked(getSystemMetrics).mockRejectedValue(new Error('网络错误'));
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      // 非 ApiError 时显示兜底文案"加载失败"
      expect(screen.getByText('加载失败')).toBeInTheDocument();
    });
    // 错误状态下应显示"重试"按钮
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('点击"重试"按钮重新调用 getSystemMetrics', async () => {
    // 先失败一次触发错误状态
    vi.mocked(getSystemMetrics).mockRejectedValueOnce(new Error('网络错误'));
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument();
    });
    const initialCallCount = vi.mocked(getSystemMetrics).mock.calls.length;
    // 点击"重试"按钮重新加载
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试' }));
    });
    // 应再次调用 getSystemMetrics
    await waitFor(() => {
      expect(vi.mocked(getSystemMetrics).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('数据库异常状态显示"异常"标签', async () => {
    vi.mocked(getSystemMetrics).mockResolvedValue({ code: 0, message: 'ok', data: mockUnhealthyMetrics });
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      // StatusIndicator 在 unhealthy 时显示"异常"文案
      expect(screen.getByText('异常')).toBeInTheDocument();
    });
    // waitingCount=15 > 10，应同时显示 AlertTriangle 警告图标（不验证图标，仅验证数值渲染）
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('Redis 断开状态显示"断开"', async () => {
    vi.mocked(getSystemMetrics).mockResolvedValue({ code: 0, message: 'ok', data: mockDisconnectedRedis });
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      // connected=false 时显示"断开"文案
      expect(screen.getByText('断开')).toBeInTheDocument();
    });
  });

  it('告警日志列表显示告警项与数量徽章', async () => {
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      // 告警数量徽章显示"2"
      expect(screen.getByText('2')).toBeInTheDocument();
    });
    // 两条告警消息均应渲染
    expect(screen.getByText('连接池接近上限')).toBeInTheDocument();
    expect(screen.getByText('Redis 断开告警')).toBeInTheDocument();
    // 告警等级标签：critical→"严重"，warning→"警告"
    expect(screen.getByText('严重')).toBeInTheDocument();
    expect(screen.getByText('警告')).toBeInTheDocument();
  });

  it('空告警显示"暂无告警日志"且"清除告警"按钮禁用', async () => {
    vi.mocked(getSystemMetrics).mockResolvedValue({ code: 0, message: 'ok', data: mockEmptyAlerts });
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      expect(screen.getByText('暂无告警日志')).toBeInTheDocument();
    });
    // alerts.length===0 时"清除告警"按钮应禁用
    const clearBtn = screen.getByRole('button', { name: /清除告警/ });
    expect(clearBtn).toBeDisabled();
  });

  it('点击"刷新"按钮重新加载指标', async () => {
    await act(async () => {
      renderSystemStatus();
    });
    // 等待异步加载完成：用"连接池大小"精确等待，避免"数据库"标题与告警类型标签多元素匹配
    await waitFor(() => {
      expect(screen.getByText('连接池大小')).toBeInTheDocument();
    });
    const initialCallCount = vi.mocked(getSystemMetrics).mock.calls.length;
    // 点击"刷新"按钮
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
    });
    // 应再次调用 getSystemMetrics
    await waitFor(() => {
      expect(vi.mocked(getSystemMetrics).mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  it('点击"清除告警"清除告警列表', async () => {
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      expect(screen.getByText('连接池接近上限')).toBeInTheDocument();
    });
    // 点击"清除告警"按钮
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /清除告警/ }));
    });
    // 应调用 clearAlertLogs
    await waitFor(() => {
      expect(clearAlertLogs).toHaveBeenCalled();
    });
    // 告警列表应被清空，显示"暂无告警日志"
    await waitFor(() => {
      expect(screen.getByText('暂无告警日志')).toBeInTheDocument();
    });
  });

  it('清除告警失败显示错误提示', async () => {
    vi.mocked(clearAlertLogs).mockRejectedValue(new Error('清除失败'));
    await act(async () => {
      renderSystemStatus();
    });
    await waitFor(() => {
      expect(screen.getByText('连接池接近上限')).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /清除告警/ }));
    });
    // 非 ApiError 时走兜底分支，toast.error 提示"清除失败"
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('清除失败');
    });
  });
});
