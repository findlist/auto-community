import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹交互，自动等待微任务 flush，
// 消除"异步 state 更新未被 act 包裹"警告，模拟真实用户点击序列
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Detail from '../Detail';
import type { SkillPost, User } from '@/types';
import { ApiError } from '@/api/client';

// vi.hoisted 提升 mock 数据避免 TDZ：mock 当前用户与多种帖子数据
const { mockOwner, mockOtherUser, mockActivePost, mockClosedPost } = vi.hoisted(() => {
  // 帖子发布者：作为 post.userId 出现，验证发布者本人编辑/删除入口
  const owner: User = {
    id: 'user-owner',
    phone: '13800000001',
    nickname: '发布者老张',
    creditBalance: 100,
    timeBalance: 50,
    reputationScore: 4.8,
    role: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
  // 其他用户：用于验证非发布者视角的"发起交易"按钮
  const other: User = {
    id: 'user-other',
    phone: '13800000002',
    nickname: '浏览者小李',
    creditBalance: 80,
    timeBalance: 30,
    reputationScore: 4.5,
    role: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
  // active 帖子：发布者本人视角可见编辑/删除，他人视角可见可点击的"发起交易"
  const activePost = {
    id: 'post-active-1',
    userId: 'user-owner',
    type: 'offer' as const,
    title: '吉他教学服务',
    description: '提供专业吉他入门教学，十年教学经验，适合零基础学员。',
    category: '音乐培训',
    creditPrice: 50,
    location: '北京市朝阳区',
    images: [],
    status: 'active' as const,
    createdAt: '2024-01-10T10:00:00.000Z',
    updatedAt: '2024-01-10T10:00:00.000Z',
    user: { id: 'user-owner', nickname: '发布者老张', avatar: undefined, reputationScore: 4.8 },
  };
  // closed 帖子：他人视角"发起交易"按钮应禁用
  const closedPost = {
    ...activePost,
    id: 'post-closed-1',
    title: '已关闭的吉他教学',
    status: 'closed' as const,
  };
  return { mockOwner: owner, mockOtherUser: other, mockActivePost: activePost, mockClosedPost: closedPost };
});

// mock skills API：getPost 默认返回 mockActivePost，createOrder/deletePost 默认成功
vi.mock('@/api/skills', () => ({
  getPost: vi.fn(async () => ({ code: 0, message: 'ok', data: mockActivePost })),
  createOrder: vi.fn(async () => ({ code: 0, message: 'ok', data: { id: 'order-1' } })),
  deletePost: vi.fn(async () => ({ code: 0, message: 'ok', data: null })),
}));

// mock useAuth：默认返回发布者视角
const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: useAuthMock,
}));

// mock AIRecommend：避免依赖 matchSkill 真实 API 调用
vi.mock('@/components/AIRecommend', () => ({
  default: () => <div data-testid="ai-recommend-mock">AI推荐</div>,
}));

// mock toast：捕获 success/error 调用便于断言
const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('@/components/Toast', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// mock useNavigate：捕获跳转调用便于断言
const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// 引入被 mock 的 API 以便在用例中配置返回值
import { getPost, createOrder, deletePost } from '@/api/skills';

// 包装组件：注入 MemoryRouter + Route 提供 useParams 上下文
// 设计原因：useParams 依赖路由匹配，必须用 Route path="/skills/:id" 才能正确解析 id
function renderDetail(postId = 'post-active-1') {
  return render(
    <MemoryRouter initialEntries={[`/skills/${postId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/skills/:id" element={<Detail />} />
      </Routes>
    </MemoryRouter>
  );
}

// 切换当前用户视角：owner 视角看编辑/删除，other 视角看发起交易
function switchUser(user: User) {
  useAuthMock.mockReturnValue({
    user,
    isAuthenticated: true,
    token: 'test-token',
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
  });
}

describe('SkillExchange/Detail 帖子详情', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认发布者视角 + active 帖子
    switchUser(mockOwner);
    // mockActivePost.user 仅含测试必要子集（缺少 phone/creditBalance 等），用双重断言绕过 User 完整性校验
    vi.mocked(getPost).mockResolvedValue({ code: 0, message: 'ok', data: mockActivePost as unknown as SkillPost });
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中显示骨架屏 animate-pulse', async () => {
    // 让 getPost 永不 resolve，保持 loading 状态
    vi.mocked(getPost).mockImplementation(() => new Promise(() => {}));

    renderDetail();

    // 骨架屏应可见（animate-pulse 是 className，无法直接断言，验证骨架元素存在）
    // 骨架屏由 3 个 bg-gray-200 rounded div 组成
    const skeletonBlocks = document.querySelectorAll('.animate-pulse');
    expect(skeletonBlocks.length).toBeGreaterThan(0);
  });

  it('加载完成显示帖子详情（标题/分类/积分/描述/位置）', async () => {
    renderDetail();

    // 设计原因：标题在 h1（顶栏）和 h2（正文）中均渲染，findByText 会报多元素匹配，
    // 改用 findAllByText 断言存在，再用独特文本（分类/价格）等待加载完成
    // 用分类标签"音乐培训"作为加载完成标志（页面唯一）
    await screen.findByText('音乐培训');
    // 标题应出现至少1次（h1 + h2）
    expect(screen.getAllByText('吉他教学服务').length).toBeGreaterThan(0);
    // 积分价格拆分为数字节点 + 单位节点（与列表页编辑式风格一致），分别断言
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('积分')).toBeInTheDocument();
    // 详细描述
    expect(screen.getByText('提供专业吉他入门教学，十年教学经验，适合零基础学员。')).toBeInTheDocument();
    // 位置信息
    expect(screen.getByText('北京市朝阳区')).toBeInTheDocument();
    // 发布者昵称
    expect(screen.getByText('发布者老张')).toBeInTheDocument();
  });

  it('offer 类型显示"提供技能"文案', async () => {
    renderDetail();

    // 用"提供技能"文案作为加载完成标志（type=offer 时渲染）
    await screen.findByText('提供技能');
    expect(screen.getAllByText('吉他教学服务').length).toBeGreaterThan(0);
  });

  it('request 类型显示"需求技能"文案', async () => {
    // mock type=request 的帖子
    vi.mocked(getPost).mockResolvedValue({
      code: 0, message: 'ok',
      data: { ...mockActivePost, type: 'request' as const, title: '求购钢琴陪练' } as unknown as SkillPost,
    });

    renderDetail();

    // 用"需求技能"文案作为加载完成标志
    await screen.findByText('需求技能');
    expect(screen.getAllByText('求购钢琴陪练').length).toBeGreaterThan(0);
  });

  it('加载失败显示错误提示与"返回列表"按钮', async () => {
    // mock getPost 抛错，组件 catch 后记录 error，post 仍为 null，走加载错误分支
    vi.mocked(getPost).mockRejectedValue(new Error('not found'));

    renderDetail();

    // findByText 等待加载错误标题出现（非 ApiError 走"加载失败"兜底文案作为 description）
    await screen.findByText('帖子加载失败');
    // "返回列表"按钮应可见
    expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument();
  });

  it('发布者本人 + active 状态显示"编辑/删除"按钮', async () => {
    renderDetail();

    // 用"编辑"按钮作为加载完成标志
    await screen.findByRole('button', { name: /编辑/ });
    // 发布者视角应显示"编辑"和"删除"按钮
    expect(screen.getByRole('button', { name: /删除/ })).toBeInTheDocument();
  });

  it('非发布者显示"发起交易"按钮', async () => {
    // 切换到其他用户视角
    switchUser(mockOtherUser);

    renderDetail();

    // 用"发起交易"按钮作为加载完成标志
    await screen.findByRole('button', { name: '发起交易' });
  });

  it('active 状态"发起交易"按钮可点击', async () => {
    switchUser(mockOtherUser);

    renderDetail();

    await screen.findByRole('button', { name: '发起交易' });
    // active 状态按钮应未禁用
    expect(screen.getByRole('button', { name: '发起交易' })).not.toBeDisabled();
  });

  it('closed 状态"发起交易"按钮禁用', async () => {
    switchUser(mockOtherUser);
    vi.mocked(getPost).mockResolvedValue({
      code: 0, message: 'ok',
      data: mockClosedPost as unknown as SkillPost,
    });

    renderDetail();

    // 用"已关闭的吉他教学"标题（h1唯一）作为加载完成标志
    // 注：closed 帖子标题与 active 不同，避免多元素匹配干扰
    await screen.findByRole('button', { name: '发起交易' });
    // closed 状态按钮应禁用
    expect(screen.getByRole('button', { name: '发起交易' })).toBeDisabled();
  });

  it('点击"发起交易"调用 createOrder 并跳转', async () => {
    switchUser(mockOtherUser);

    renderDetail();

    await screen.findByRole('button', { name: '发起交易' });

    // 点击"发起交易"
    await user.click(screen.getByRole('button', { name: '发起交易' }));

    // 应调用 createOrder，参数包含 postId
    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledWith({ postId: 'post-active-1' });
    });
    // 应显示成功提示
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('交易发起成功！');
    });
    // 应跳转到 /skills
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/skills');
    });
  });

  it('交易失败显示 toast.error 错误提示', async () => {
    switchUser(mockOtherUser);
    // 业务错误应用 ApiError 模拟，对齐拦截器转换后的结构
    vi.mocked(createOrder).mockRejectedValue(new ApiError('余额不足', 400));

    renderDetail();

    await screen.findByRole('button', { name: '发起交易' });

    await user.click(screen.getByRole('button', { name: '发起交易' }));

    // 应显示错误提示
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('余额不足');
    });
  });

  it('点击"编辑"跳转到编辑页', async () => {
    renderDetail();

    await screen.findByRole('button', { name: /编辑/ });

    // 点击"编辑"按钮
    await user.click(screen.getByRole('button', { name: /编辑/ }));

    // 应跳转到编辑页（带 edit 查询参数）
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/skills/create?edit=post-active-1');
    });
  });

  it('点击"删除"打开弹窗，确认后调用 deletePost 并跳转', async () => {
    renderDetail();

    await screen.findByRole('button', { name: /删除/ });

    // 点击"删除"按钮打开弹窗
    await user.click(screen.getByRole('button', { name: /删除/ }));

    // 弹窗出现后，用 within 精确定位弹窗内的"删除"按钮并点击确认
    const dialog = await screen.findByRole('dialog', { name: '删除确认' });
    await user.click(within(dialog).getByRole('button', { name: '删除' }));

    // 应调用 deletePost
    await waitFor(() => {
      expect(deletePost).toHaveBeenCalledWith('post-active-1');
    });
    // 应显示成功提示
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('删除成功');
    });
    // 应跳转到 /skills
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/skills');
    });
  });

  it('点击"删除"打开弹窗，取消时不调用 deletePost', async () => {
    renderDetail();

    await screen.findByRole('button', { name: /删除/ });

    // 点击"删除"按钮打开弹窗
    await user.click(screen.getByRole('button', { name: /删除/ }));

    // 弹窗出现后点击"取消"放弃操作
    const dialog = await screen.findByRole('dialog', { name: '删除确认' });
    await user.click(within(dialog).getByRole('button', { name: '取消' }));

    // 不应调用 deletePost
    expect(deletePost).not.toHaveBeenCalled();
  });

  // 重复提交守卫不变式：弱网下用户在删除确认弹窗内连点"删除"应只触发一次 API 调用
  // 设计原因：deletePost 后端按 id 删除，第二次调用会 404，前端 toast.error 显示"删除失败" 体验混乱；
  // 三重防御（deleting 状态守卫 + 按钮 disabled + 文案变化）确保 deleting 期间无法触发第二次调用
  it('删除进行中按钮显示"删除中..."加载态且重复点击不触发第二次 API 调用', async () => {
    // 永不 resolve：锁定 deleting 状态，模拟弱网
    vi.mocked(deletePost).mockImplementation(() => new Promise(() => {}));

    renderDetail();

    await screen.findByRole('button', { name: /删除/ });

    // 点击底部"删除"按钮打开弹窗
    await user.click(screen.getByRole('button', { name: /删除/ }));

    // 弹窗出现后，用 within 精确定位弹窗内的"删除"按钮并点击确认
    const dialog = await screen.findByRole('dialog', { name: '删除确认' });
    await user.click(within(dialog).getByRole('button', { name: '删除' }));

    // 第一次点击应触发 API 调用
    await waitFor(() => {
      expect(deletePost).toHaveBeenCalledTimes(1);
    });

    // 按钮应进入加载态：显示"删除中..."文案
    await screen.findByText('删除中...');

    // 重复点击"删除中..."按钮不应触发第二次 API 调用（按钮已禁用，userEvent 不会触发 disabled 按钮的 onClick）
    await user.click(within(dialog).getByRole('button', { name: '删除中...' }));
    expect(deletePost).toHaveBeenCalledTimes(1);
  });

  it('location 不存在时不渲染位置信息', async () => {
    vi.mocked(getPost).mockResolvedValue({
      code: 0, message: 'ok',
      data: { ...mockActivePost, location: undefined } as unknown as SkillPost,
    });

    renderDetail();

    // 用分类标签作为加载完成标志
    await screen.findByText('音乐培训');
    // 位置"北京市朝阳区"不应渲染
    expect(screen.queryByText('北京市朝阳区')).toBeNull();
  });

  it('渲染 AI 推荐组件', async () => {
    renderDetail();

    // 用分类标签作为加载完成标志
    await screen.findByText('音乐培训');
    // AI 推荐组件应渲染
    expect(screen.getByTestId('ai-recommend-mock')).toBeInTheDocument();
  });

  // 重复提交守卫不变式：弱网下用户连点"发起交易"应只触发一次 createOrder
  // 设计原因：React 状态更新是异步批处理的，submitting 在批处理结束前仍为 false，
  // 三重防御（入口 if 守卫 + 按钮 disabled + 文案变化）确保 submitting 期间无法触发第二次调用
  // 验证方式：fireEvent.click 绕过 disabled 检查直接触发 onClick，验证入口 if 守卫作为第二道防线
  it('发起交易进行中按钮显示"提交中..."且 fireEvent 绕过 disabled 重复点击不触发第二次 createOrder', async () => {
    // 切换到非发布者视角，否则看不到"发起交易"按钮
    switchUser(mockOtherUser);
    // 永不 resolve：锁定 submitting 状态，模拟弱网
    vi.mocked(createOrder).mockImplementation(() => new Promise(() => {}));

    renderDetail();

    await screen.findByRole('button', { name: '发起交易' });

    // 第一次点击触发 createOrder
    await user.click(screen.getByRole('button', { name: '发起交易' }));
    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    // 按钮应进入加载态：显示"提交中..."文案
    await screen.findByText('提交中...');

    // fireEvent.click 绕过 disabled 检查直接触发 onClick，验证入口 if 守卫阻断连点
    const submitButton = screen.getByRole('button', { name: '提交中...' });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    // 重复点击不应触发第二次 createOrder（入口 if 守卫已阻断）
    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});
