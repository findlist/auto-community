import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResourceMap from '../ResourceMap';

// vi.hoisted 提升 mock 数据避免 TDZ：mock 资源列表与空列表分别用于不同用例
const { mockResources, mockEmptyList } = vi.hoisted(() => ({
  // 模拟应急资源列表：覆盖 AED/灭火器/急救箱 三类，含可用/维护中两种状态
  mockResources: [
    {
      id: 'res-1',
      type: 'aed',
      name: 'AED 设备 1 号',
      location: '(116.40, 39.91)',
      address: '社区中心 1 楼',
      contactPhone: '010-12345678',
      status: 'available' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'res-2',
      type: 'fire_extinguisher',
      name: '灭火器 2 号',
      location: '(116.41, 39.92)',
      address: '社区东门',
      status: 'maintenance' as const,
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'res-3',
      type: 'first_aid',
      name: '急救箱 3 号',
      // 缺失 location 字段，覆盖坐标解析失败的兜底分支
      location: undefined,
      address: '社区南门',
      status: 'available' as const,
      createdAt: '2024-01-03T00:00:00.000Z',
    },
  ],
  mockEmptyList: [],
}));

// mock getResources：默认返回 mockResources，可在测试中覆盖实现
vi.mock('@/api/emergency', () => ({
  getResources: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    // 补全 PaginatedResponse 全字段，避免 TS 类型校验报错
    data: {
      list: mockResources,
      total: mockResources.length,
      page: 1,
      pageSize: 200,
      totalPages: 1,
      hasNext: false,
    },
  })),
}));

// mock useNavigate：避免 MemoryRouter 之外的真实路由依赖
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

// 引入被 mock 的 getResources 以便在用例中配置返回值
import { getResources } from '@/api/emergency';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderResourceMap() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ResourceMap />
    </MemoryRouter>
  );
}

describe('ResourceMap 组件', () => {
  beforeEach(() => {
    // 每个用例前重置 mock 调用记录与默认返回值
    vi.clearAllMocks();
    vi.mocked(getResources).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        list: mockResources,
        total: mockResources.length,
        page: 1,
        pageSize: 200,
        totalPages: 1,
        hasNext: false,
      },
    });
  });

  afterEach(() => {
    // 清理 window 全局态与 geolocation mock，避免用例间状态污染
    delete (window as unknown as { _AMAP_KEY?: string })._AMAP_KEY;
    vi.restoreAllMocks();
  });

  it('降级模式：无 _AMAP_KEY 时显示降级提示卡片而非地图容器', async () => {
    // 不设置 window._AMAP_KEY，触发降级模式
    renderResourceMap();

    // 降级提示卡片的关键文案应出现
    expect(await screen.findByText('未配置高德地图 Key')).toBeInTheDocument();
    // 引导文案也应出现：源码中 window._AMAP_KEY 被 <code> 标签包裹，
    // testing-library 默认不跨元素匹配，故直接以 <code> 元素文本作为锚点
    expect(screen.getByText('window._AMAP_KEY')).toBeInTheDocument();
    // 尾部引导文案"后即可启用地图渲染"作为独立文本节点存在
    expect(screen.getByText(/后即可启用地图渲染/)).toBeInTheDocument();

    // 降级模式下不应发起高德地图脚本请求（无 script 标签注入）
    const amapScript = document.querySelector('script[src*="webapi.amap.com"]');
    expect(amapScript).toBeNull();
  });

  it('降级模式：资源列表完整渲染，业务逻辑保留', async () => {
    renderResourceMap();

    // 等待资源加载完成
    await waitFor(() => {
      expect(screen.getByText('AED 设备 1 号')).toBeInTheDocument();
    });

    // 三条资源均应渲染，验证降级模式保留列表展示能力
    expect(screen.getByText('AED 设备 1 号')).toBeInTheDocument();
    expect(screen.getByText('灭火器 2 号')).toBeInTheDocument();
    expect(screen.getByText('急救箱 3 号')).toBeInTheDocument();

    // 资源计数应显示为 (3)
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('资源加载中显示骨架屏', async () => {
    // 让 getResources 永不 resolve，保持 loading 状态
    vi.mocked(getResources).mockImplementation(() => new Promise(() => {}));

    renderResourceMap();

    // 加载中应显示 3 个骨架卡片（animate-pulse 类）
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it('资源加载失败显示错误提示与重试按钮', async () => {
    // mock getResources 抛错
    vi.mocked(getResources).mockRejectedValue(new Error('网络异常'));

    renderResourceMap();

    // 等待错误提示出现
    await waitFor(() => {
      expect(screen.getByText('网络异常')).toBeInTheDocument();
    });

    // 重试按钮应可见
    expect(screen.getByText('重试')).toBeInTheDocument();
  });

  it('资源列表为空显示空状态', async () => {
    vi.mocked(getResources).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { list: mockEmptyList, total: 0, page: 1, pageSize: 200, totalPages: 0, hasNext: false },
    });

    renderResourceMap();

    // 等待空状态文案出现
    await waitFor(() => {
      expect(screen.getByText('暂无应急资源')).toBeInTheDocument();
    });
    // 引导文案也应出现
    expect(screen.getByText('可尝试切换筛选条件')).toBeInTheDocument();
  });

  it('点击类型筛选按钮触发 getResources 重新拉取', async () => {
    renderResourceMap();

    // 等待初始加载完成
    await waitFor(() => {
      expect(screen.getByText('AED 设备 1 号')).toBeInTheDocument();
    });

    // 初始加载调用一次
    expect(getResources).toHaveBeenCalledTimes(1);

    // 点击 AED 筛选按钮
    const aedFilterBtn = screen.getByRole('button', { name: 'AED' });
    fireEvent.click(aedFilterBtn);

    // 应触发第二次调用，且参数包含 type: 'aed'
    await waitFor(() => {
      expect(getResources).toHaveBeenCalledTimes(2);
    });
    expect(getResources).toHaveBeenLastCalledWith({ type: 'aed', pageSize: 200 });
  });

  it('坐标缺失的资源显示"未设置位置"提示', async () => {
    renderResourceMap();

    await waitFor(() => {
      expect(screen.getByText('急救箱 3 号')).toBeInTheDocument();
    });

    // res-3 的 location 为 undefined，应显示位置缺失提示
    expect(screen.getByText('未设置位置，无法在地图展示')).toBeInTheDocument();
  });

  it('点击"全部"筛选按钮触发无 type 参数的 getResources 调用', async () => {
    renderResourceMap();

    await waitFor(() => {
      expect(screen.getByText('AED 设备 1 号')).toBeInTheDocument();
    });

    // 先切换到 AED，再切回全部
    fireEvent.click(screen.getByRole('button', { name: 'AED' }));
    await waitFor(() => {
      expect(getResources).toHaveBeenLastCalledWith({ type: 'aed', pageSize: 200 });
    });

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    await waitFor(() => {
      // 切回全部时应不带 type 参数
      expect(getResources).toHaveBeenLastCalledWith({ pageSize: 200 });
    });
  });
});
