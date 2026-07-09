/**
 * NotFound 404 页面单元测试
 *
 * 测试目标：覆盖 404 文案渲染、返回首页链接、返回上一页按钮交互
 * 测试策略：mock useNavigate 捕获 navigate(-1) 调用，MemoryRouter 提供 Link 上下文
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NotFound from '../NotFound';

// vi.hoisted 提升 mockNavigate 避免 TDZ：vi.mock 工厂在模块加载时立即引用
const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

// mock useNavigate：避免依赖真实路由历史，捕获 navigate(-1) 调用
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// 包装组件：注入 MemoryRouter 提供 Link/useNavigate 上下文
// future flag 消除 v7 警告，与项目其他测试保持一致
function renderNotFound() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NotFound />
    </MemoryRouter>
  );
}

describe('NotFound 404 页面', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认真实 timers：userEvent 内部 async act 与 fake timers 不兼容
    vi.useRealTimers();
    user = userEvent.setup();
  });

  it('渲染 404 数字、标题与说明文案', () => {
    renderNotFound();
    // 404 渐变大字
    expect(screen.getByText('404')).toBeInTheDocument();
    // 主标题
    expect(screen.getByText('页面走丢了')).toBeInTheDocument();
    // 说明文案
    expect(screen.getByText('您访问的页面不存在或已被移除')).toBeInTheDocument();
  });

  it('渲染返回首页链接指向 /', () => {
    renderNotFound();
    const homeLink = screen.getByRole('link', { name: /返回首页/ });
    expect(homeLink).toBeInTheDocument();
    // Link to="/" 渲染为 href="/"
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('点击返回上一页按钮调用 navigate(-1)', async () => {
    renderNotFound();
    const backButton = screen.getByRole('button', { name: /返回上一页/ });
    await user.click(backButton);
    // navigate(-1) 回退到浏览器历史上一页
    expect(mockNavigate).toHaveBeenCalledWith(-1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
