import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// 设计原因：userEvent 内部用 async act 包裹交互，自动等待微任务 flush，消除 act 警告
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AddressBookPage from '../AddressBook';
import { ApiError } from '@/api/client';
import type { Address } from '@/api/address';

// vi.hoisted 提升 mock 数据避免 TDZ：覆盖默认地址、非默认地址、空列表
const {
  mockAddresses,
  mockEmptyList,
  mockNavigate,
} = vi.hoisted(() => ({
  // 两条地址：第一条为默认，第二条为非默认（用于验证"设为默认"按钮可见性）
  mockAddresses: [
    {
      id: 'addr-1',
      userId: 'user-self',
      recipient: '张三',
      phone: '13800138000',
      address: '北京市朝阳区阳光小区1号楼',
      isDefault: true,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'addr-2',
      userId: 'user-self',
      recipient: '李四',
      phone: '13900139000',
      address: '上海市浦东新区花园路2号',
      isDefault: false,
      createdAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    },
  ] as Address[],
  // 空列表：用于验证"暂无配送地址"空状态
  mockEmptyList: [] as Address[],
  // useNavigate 返回的 mock 函数：捕获跳转目标
  mockNavigate: vi.fn(),
}));

// mock @/api/address：默认返回 mockAddresses
vi.mock('@/api/address', () => ({
  getAddresses: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: mockAddresses,
  })),
  createAddress: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: mockAddresses[0]!,
  })),
  updateAddress: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: mockAddresses[0]!,
  })),
  deleteAddress: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: null,
  })),
  setDefaultAddress: vi.fn(async () => ({
    code: 0,
    message: 'ok',
    data: null,
  })),
}));

// mock useNavigate：避免依赖真实路由
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '@/api/address';

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文
function renderAddressBook() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AddressBookPage />
    </MemoryRouter>
  );
}

describe('AddressBook 配送地址簿', () => {
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAddresses).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockAddresses,
    });
    vi.mocked(createAddress).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockAddresses[0]!,
    });
    vi.mocked(updateAddress).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockAddresses[0]!,
    });
    vi.mocked(deleteAddress).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: null,
    });
    vi.mocked(setDefaultAddress).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: null,
    });
    // 默认 confirm=true，便于删除用例按需覆盖
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    user = userEvent.setup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('加载中显示 Loader2 旋转动画', async () => {
    // 故意延迟返回，保证 loading 状态渲染
    vi.mocked(getAddresses).mockImplementation(() => new Promise(() => {}));

    renderAddressBook();

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('加载失败显示错误提示', async () => {
    vi.mocked(getAddresses).mockRejectedValue(new ApiError('加载失败', 500));

    renderAddressBook();

    await screen.findByText('加载失败');
    expect(screen.getByText('加载失败')).toBeInTheDocument();
  });

  it('空列表显示"暂无配送地址"与"添加第一个地址"按钮', async () => {
    vi.mocked(getAddresses).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockEmptyList,
    });

    renderAddressBook();

    await screen.findByText('暂无配送地址');
    expect(screen.getByText('添加第一个地址')).toBeInTheDocument();
  });

  it('空列表点击"添加第一个地址"打开新增弹窗', async () => {
    vi.mocked(getAddresses).mockResolvedValue({
      code: 0,
      message: 'ok',
      data: mockEmptyList,
    });

    renderAddressBook();

    await screen.findByText('暂无配送地址');

    await user.click(screen.getByText('添加第一个地址'));

    // 弹窗标题应为"新增地址"
    await screen.findByText('新增地址');
  });

  it('列表加载成功显示地址数据（收件人/手机号/详细地址）', async () => {
    renderAddressBook();

    await screen.findByText('张三');
    expect(screen.getByText('13800138000')).toBeInTheDocument();
    expect(screen.getByText('北京市朝阳区阳光小区1号楼')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
  });

  it('默认地址显示"默认"徽章', async () => {
    renderAddressBook();

    await screen.findByText('张三');
    expect(screen.getByText('默认')).toBeInTheDocument();
  });

  it('非默认地址显示"设为默认"按钮', async () => {
    renderAddressBook();

    await screen.findByText('李四');
    expect(screen.getByRole('button', { name: /设为默认/ })).toBeInTheDocument();
  });

  it('点击"新增"打开弹窗显示"新增地址"标题', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: /新增/ }));

    await screen.findByText('新增地址');
    expect(screen.getByPlaceholderText('请输入收件人姓名')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入手机号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入详细地址')).toBeInTheDocument();
  });

  it('点击"编辑"打开弹窗显示"编辑地址"标题与预填数据', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    // 点击第一个地址的"编辑"按钮
    await user.click(screen.getAllByRole('button', { name: /编辑/ })[0]!);

    // 弹窗标题应为"编辑地址"
    await screen.findByText('编辑地址');
    // 预填数据应正确
    expect((screen.getByPlaceholderText('请输入收件人姓名') as HTMLInputElement).value).toBe('张三');
    expect((screen.getByPlaceholderText('请输入手机号') as HTMLInputElement).value).toBe('13800138000');
  });

  it('收件人为空时点击"保存"显示字段错误提示', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    // 打开新增弹窗
    await user.click(screen.getByRole('button', { name: /新增/ }));
    await screen.findByText('新增地址');

    // 不填任何字段，直接点击保存
    await user.click(screen.getByRole('button', { name: '保存' }));

    // 应显示收件人校验错误
    expect(screen.getByText('请输入收件人姓名')).toBeInTheDocument();
    // 不应调用 API
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('手机号格式错误时显示字段错误提示', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: /新增/ }));
    await screen.findByText('新增地址');

    // 填入合法收件人但非法手机号
    await user.type(screen.getByPlaceholderText('请输入收件人姓名'), '王五');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '12345');

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('请输入正确的手机号')).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('详细地址为空时显示字段错误提示', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: /新增/ }));
    await screen.findByText('新增地址');

    // 仅填收件人与合法手机号，详细地址留空
    await user.type(screen.getByPlaceholderText('请输入收件人姓名'), '王五');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800138001');

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByText('请输入详细地址')).toBeInTheDocument();
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('保存新增调用 createAddress 并刷新列表', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: /新增/ }));
    await screen.findByText('新增地址');

    // 填入合法数据
    await user.type(screen.getByPlaceholderText('请输入收件人姓名'), '王五');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800138001');
    await user.type(screen.getByPlaceholderText('请输入详细地址'), '深圳市南山区科技园');

    await user.click(screen.getByRole('button', { name: '保存' }));

    // 应调用 createAddress
    await waitFor(() => {
      expect(createAddress).toHaveBeenCalledWith({
        recipient: '王五',
        phone: '13800138001',
        address: '深圳市南山区科技园',
        isDefault: false,
      });
    });
    // 应刷新列表（getAddresses 被再次调用）
    await waitFor(() => {
      expect(getAddresses).toHaveBeenCalledTimes(2);
    });
  });

  it('保存编辑调用 updateAddress 并刷新列表', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    // 打开编辑弹窗
    await user.click(screen.getAllByRole('button', { name: /编辑/ })[0]!);
    await screen.findByText('编辑地址');

    // 修改收件人姓名
    const recipientInput = screen.getByPlaceholderText('请输入收件人姓名') as HTMLInputElement;
    await user.clear(recipientInput);
    await user.type(recipientInput, '张三丰');

    await user.click(screen.getByRole('button', { name: '保存' }));

    // 应调用 updateAddress
    await waitFor(() => {
      expect(updateAddress).toHaveBeenCalledWith('addr-1', expect.objectContaining({
        recipient: '张三丰',
      }));
    });
  });

  it('保存失败显示错误提示', async () => {
    vi.mocked(createAddress).mockRejectedValue(new ApiError('保存失败', 500));

    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: /新增/ }));
    await screen.findByText('新增地址');

    await user.type(screen.getByPlaceholderText('请输入收件人姓名'), '王五');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800138001');
    await user.type(screen.getByPlaceholderText('请输入详细地址'), '深圳市南山区科技园');

    await user.click(screen.getByRole('button', { name: '保存' }));

    await screen.findByText('保存失败');
  });

  it('保存中显示 Loader2 旋转动画并禁用按钮', async () => {
    // 延迟返回保证 saving 状态可见
    vi.mocked(createAddress).mockImplementation(() => new Promise(() => {}));

    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: /新增/ }));
    await screen.findByText('新增地址');

    await user.type(screen.getByPlaceholderText('请输入收件人姓名'), '王五');
    await user.type(screen.getByPlaceholderText('请输入手机号'), '13800138001');
    await user.type(screen.getByPlaceholderText('请输入详细地址'), '深圳市南山区科技园');

    await user.click(screen.getByRole('button', { name: '保存' }));

    // 弹窗内应出现 Loader2 旋转动画
    await waitFor(() => {
      // 弹窗内 spinner（区别于列表加载 spinner）
      const modal = screen.getByText('新增地址').closest('.bg-white');
      expect(modal?.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  it('点击"取消"关闭弹窗不调用 API', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getByRole('button', { name: /新增/ }));
    await screen.findByText('新增地址');

    // 点击取消按钮
    await user.click(screen.getByRole('button', { name: '取消' }));

    // 弹窗应消失
    await waitFor(() => {
      expect(screen.queryByText('新增地址')).toBeNull();
    });
    expect(createAddress).not.toHaveBeenCalled();
  });

  it('点击"设为默认"调用 setDefaultAddress 并刷新列表', async () => {
    renderAddressBook();

    await screen.findByText('李四');

    await user.click(screen.getByRole('button', { name: /设为默认/ }));

    await waitFor(() => {
      expect(setDefaultAddress).toHaveBeenCalledWith('addr-2');
    });
    // 应刷新列表
    await waitFor(() => {
      expect(getAddresses).toHaveBeenCalledTimes(2);
    });
  });

  it('设为默认失败显示错误提示', async () => {
    vi.mocked(setDefaultAddress).mockRejectedValue(new ApiError('设置失败', 500));

    renderAddressBook();

    await screen.findByText('李四');

    await user.click(screen.getByRole('button', { name: /设为默认/ }));

    await screen.findByText('设置失败');
  });

  it('点击"删除"在 confirm=true 时调用 deleteAddress', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    // 点击第一个地址的删除按钮
    await user.click(screen.getAllByRole('button', { name: /删除/ })[0]!);

    // window.confirm 默认返回 true
    await waitFor(() => {
      expect(deleteAddress).toHaveBeenCalledWith('addr-1');
    });
    // 应刷新列表
    await waitFor(() => {
      expect(getAddresses).toHaveBeenCalledTimes(2);
    });
  });

  it('点击"删除"在 confirm=false 时不调用 deleteAddress', async () => {
    // 用户取消确认
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getAllByRole('button', { name: /删除/ })[0]!);

    // 不应调用 deleteAddress
    expect(deleteAddress).not.toHaveBeenCalled();
  });

  it('删除失败显示错误提示', async () => {
    vi.mocked(deleteAddress).mockRejectedValue(new ApiError('删除失败', 500));

    renderAddressBook();

    await screen.findByText('张三');

    await user.click(screen.getAllByRole('button', { name: /删除/ })[0]!);

    await screen.findByText('删除失败');
  });

  it('点击顶部返回按钮调用 navigate(-1)', async () => {
    renderAddressBook();

    await screen.findByText('张三');

    // 点击顶部返回按钮（ArrowLeft 图标按钮）
    await user.click(screen.getByRole('button', { name: '' }));

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });
});
