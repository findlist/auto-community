/**
 * Home/index 首页单元测试
 *
 * 测试目标：覆盖品牌字标渲染、四大模块链接、CTA 链接、/public/stats 与
 *           /public/homepage-image 接口数据加载与格式化展示、接口失败兜底
 * 测试策略：mock @/api/client 的 get 方法按 URL 分流响应、mock useScrollReveal
 *           避免依赖 jsdom 不支持的 IntersectionObserver、MemoryRouter 提供 Link 上下文
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../index';

// vi.hoisted 提升 mock 数据避免 TDZ：vi.mock 工厂在模块加载时立即引用这些变量
const { mockClientGet, mockScrollReveal } = vi.hoisted(() => ({
  // client.get mock：根据 URL 分流返回 /public/stats 或 /public/homepage-image 响应
  // 设计原因：首页 useEffect 并发请求两个接口，需按 URL 精准返回不同结构
  mockClientGet: vi.fn(),
  // useScrollReveal mock：直接返回 visible=true，避免依赖 jsdom 不支持的 IntersectionObserver
  mockScrollReveal: vi.fn(),
}));

// mock @/api/client 默认导出：仅拦截 get 方法
vi.mock('@/api/client', () => ({
  default: { get: mockClientGet },
}));

// mock useScrollReveal：元素直接可见，跳过滚动观察逻辑
// 设计原因：jsdom 未实现 IntersectionObserver，真实 hook 在测试环境会抛错；
// 且动画可见性属视觉层，不影响数据加载与交互断言
vi.mock('@/hooks/useScrollReveal', () => ({
  useScrollReveal: () => mockScrollReveal(),
}));

// 包装组件：注入 MemoryRouter 提供 Link 上下文
// future flag 消除 v7 警告，与项目其他测试保持一致
function renderHome() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Home />
    </MemoryRouter>
  );
}

describe('Home 首页', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // useScrollReveal 默认返回 visible=true，让所有动画元素直接显示
    mockScrollReveal.mockReturnValue({ ref: { current: null }, visible: true });
  });

  it('渲染品牌字标、承诺句、四大模块与 CTA 链接', async () => {
    // 默认接口成功响应：用户数与互助数均返回
    mockClientGet.mockImplementation((url: string) => {
      if (url === '/public/stats') {
        return Promise.resolve({
          code: 0,
          message: 'ok',
          data: { totalUsers: 12345, totalMutualAids: 678 },
        });
      }
      if (url === '/public/homepage-image') {
        return Promise.resolve({ code: 0, message: 'ok', data: { url: null } });
      }
      return Promise.reject(new Error(`未 mock 的 URL: ${url}`));
    });

    renderHome();

    // 品牌字标与承诺句
    expect(screen.getByText('邻里圈')).toBeInTheDocument();
    expect(screen.getByText('让社区，重新有温度。')).toBeInTheDocument();
    expect(screen.getByText('一个平台，四种连接 —— 重建邻里互助的美好时光。')).toBeInTheDocument();

    // 四大模块标题与描述
    expect(screen.getByText('技能交换')).toBeInTheDocument();
    expect(screen.getByText('用你擅长的事，换邻里擅长的事。')).toBeInTheDocument();
    expect(screen.getByText('共享厨房')).toBeInTheDocument();
    expect(screen.getByText('一锅好汤，可以喂饱一整栋楼。')).toBeInTheDocument();
    expect(screen.getByText('时间银行')).toBeInTheDocument();
    expect(screen.getByText('今天存下的一小时，明天变成家人的照护。')).toBeInTheDocument();
    expect(screen.getByText('应急邻里')).toBeInTheDocument();
    expect(screen.getByText('紧急时刻，最近的帮助就在隔壁。')).toBeInTheDocument();

    // Hero 区 CTA：立即体验 → /login、注册账号 → /register
    expect(screen.getByRole('link', { name: /立即体验/ })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: '注册账号' })).toHaveAttribute('href', '/register');
    // 终极 CTA：免费注册 → /register
    expect(screen.getByRole('link', { name: /免费注册/ })).toHaveAttribute('href', '/register');

    // 等待 useEffect 异步接口加载完成，避免 setState 未被 act 包裹的警告
    await waitFor(() => {
      expect(screen.getByText('1.2w+')).toBeInTheDocument();
    });
  });

  it('拉取 /public/stats 成功后格式化展示用户数与互助数', async () => {
    // 12345 → 1.2w+（除以 10000 保留 1 位小数，去除 .0 后缀）
    // 678 → 678+（小于 1000 直接显示原值）
    mockClientGet.mockImplementation((url: string) => {
      if (url === '/public/stats') {
        return Promise.resolve({
          code: 0,
          message: 'ok',
          data: { totalUsers: 12345, totalMutualAids: 678 },
        });
      }
      return Promise.resolve({ code: 0, message: 'ok', data: { url: null } });
    });

    renderHome();

    // 等待接口数据加载并渲染
    await waitFor(() => {
      // 12345 经 formatCount → "1.2w+"
      expect(screen.getByText('1.2w+')).toBeInTheDocument();
      // 678 经 formatCount → "678+"
      expect(screen.getByText('678+')).toBeInTheDocument();
    });
    // 标签文案
    expect(screen.getByText('已注册邻居')).toBeInTheDocument();
    expect(screen.getByText('完成互助')).toBeInTheDocument();
  });

  it('formatCount 边界：1000 显示 1k+，999 显示 999+', async () => {
    // 覆盖 formatCount 三档逻辑：>=10000 w+、>=1000 k+、其余 n+
    mockClientGet.mockImplementation((url: string) => {
      if (url === '/public/stats') {
        return Promise.resolve({
          code: 0,
          message: 'ok',
          data: { totalUsers: 1000, totalMutualAids: 999 },
        });
      }
      return Promise.resolve({ code: 0, message: 'ok', data: { url: null } });
    });

    renderHome();

    await waitFor(() => {
      // 1000 → "1k+"
      expect(screen.getByText('1k+')).toBeInTheDocument();
      // 999 → "999+"
      expect(screen.getByText('999+')).toBeInTheDocument();
    });
  });

  it('拉取 /public/homepage-image 成功且 url 非空时覆盖 hero 图 src', async () => {
    const customHeroUrl = 'https://example.com/custom-hero.jpg';
    mockClientGet.mockImplementation((url: string) => {
      if (url === '/public/stats') {
        return Promise.resolve({
          code: 0,
          message: 'ok',
          data: { totalUsers: 100, totalMutualAids: 50 },
        });
      }
      if (url === '/public/homepage-image') {
        return Promise.resolve({ code: 0, message: 'ok', data: { url: customHeroUrl } });
      }
      return Promise.reject(new Error(`未 mock 的 URL: ${url}`));
    });

    renderHome();

    // hero 图 img 标签：alt 为"邻里在金色时刻的院子里相聚"
    const heroImg = screen.getByAltText('邻里在金色时刻的院子里相聚');
    await waitFor(() => {
      expect(heroImg).toHaveAttribute('src', customHeroUrl);
    });
  });

  it('/public/stats 接口失败时显示默认占位 "——"', async () => {
    // 接口 reject 时 catch 静默处理，state 保持 null，formatCount 未调用显示 "——"
    mockClientGet.mockImplementation((url: string) => {
      if (url === '/public/stats') {
        return Promise.reject(new Error('network error'));
      }
      return Promise.resolve({ code: 0, message: 'ok', data: { url: null } });
    });

    renderHome();

    // 失败兜底：totalUsers/totalMutualAids 保持 null，显示 "——"
    // 页面有两个 "——"（用户数与互助数），用 getAllByText
    await waitFor(() => {
      const placeholders = screen.getAllByText('——');
      expect(placeholders).toHaveLength(2);
    });
  });

  it('四大模块链接指向正确路径', async () => {
    // 模块链接测试不依赖具体数据，但仍需正确分流避免 setState 异常
    mockClientGet.mockImplementation((url: string) => {
      if (url === '/public/stats') {
        return Promise.resolve({
          code: 0,
          message: 'ok',
          data: { totalUsers: 100, totalMutualAids: 50 },
        });
      }
      return Promise.resolve({ code: 0, message: 'ok', data: { url: null } });
    });

    renderHome();

    // 每个模块标题对应一个 Link，断言 href 指向正确路由
    expect(screen.getByRole('link', { name: /技能交换/ })).toHaveAttribute('href', '/skills');
    expect(screen.getByRole('link', { name: /共享厨房/ })).toHaveAttribute('href', '/kitchen');
    expect(screen.getByRole('link', { name: /时间银行/ })).toHaveAttribute('href', '/time-bank');
    expect(screen.getByRole('link', { name: /应急邻里/ })).toHaveAttribute('href', '/emergency');

    // 等待 useEffect 异步接口加载完成，避免 setState 未被 act 包裹的警告
    await waitFor(() => {
      expect(screen.getByText('100+')).toBeInTheDocument();
    });
  });
});
