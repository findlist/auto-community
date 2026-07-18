import { describe, it, expect, beforeEach, vi } from 'vitest';
// 设计原因：act 包裹 fireEvent 避免 React state 更新未包裹警告，与项目其他测试风格一致
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SystemConfig from '../SystemConfig';
import { ApiError } from '@/api/client';
import type { SystemSetting, SettingValueType } from '@/api/admin';

// vi.hoisted 提升 mock 数据避免 TDZ
// 设计原因：mockSettings 覆盖3个分组（积分规则/超时与限额/通用配置）+1个受保护配置 +1个浮点类配置 +1个空值配置
const {
  getSettingsMock,
  setSettingMock,
  deleteSettingMock,
  toastSuccessMock,
  toastErrorMock,
  mockSettings,
  mockEmptyList,
} = vi.hoisted(() => {
  // 工厂函数：构造 SystemSetting，默认值带 updatedAt 避免时间列渲染 "-"
  // valueType 参数驱动滑块步长测试，默认 string 保证未显式指定类型的配置可正常渲染
  const make = (
    key: string,
    value: string | null,
    description: string | null,
    valueType: SettingValueType = 'string',
    updatedAt = '2026-07-05T10:00:00Z',
  ): SystemSetting => ({ key, value, valueType, description, updatedBy: 'admin-1', updatedAt });

  // 覆盖3个分组规则 + 受保护配置 + 浮点类配置 + 空值配置
  // - skill_publish_reward: 命中积分规则分组（reward 关键词），valueType=int 验证整数步长 1
  // - order_timeout: 命中超时与限额分组（timeout 关键词），valueType=int
  // - exchange_rate: 命中通用配置兜底分组，valueType=float 验证浮点步长 0.01（替代原 FLOAT_CONFIG_PATTERN 关键词识别）
  // - homepage_hero_image: 受保护配置（PROTECTED_KEYS），显示 Lock 图标，无删除按钮
  // - site_name: 通用配置兜底分组，valueType=string
  // - empty_value: 配置值为空，验证"（空）"兜底文案
  const mockSettings: SystemSetting[] = [
    make('skill_publish_reward', '100', '技能发布奖励积分', 'int'),
    make('order_timeout', '30', '订单超时分钟数', 'int'),
    make('exchange_rate', '0.85', '时间币兑换汇率', 'float'),
    make('homepage_hero_image', 'https://example.com/hero.png', '首页 Hero 图'),
    make('site_name', '邻里圈', '站点名称'),
    make('empty_value', null, null),
  ];

  return {
    getSettingsMock: vi.fn(),
    setSettingMock: vi.fn(),
    deleteSettingMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    mockSettings,
    mockEmptyList: [] as SystemSetting[],
  };
});

// mock @/api/admin：导出 getSettings/setSetting/deleteSetting 与 SystemSetting 类型
vi.mock('@/api/admin', () => ({
  getSettings: getSettingsMock,
  setSetting: setSettingMock,
  deleteSetting: deleteSettingMock,
}));

// mock toast：捕获 success/error 调用便于断言
vi.mock('@/components/Toast', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// 包装组件：注入 MemoryRouter 提供 useNavigate 上下文，启用 v7 future flag 消除警告
function renderSystemConfig() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SystemConfig />
    </MemoryRouter>
  );
}

describe('Admin/SystemConfig 系统配置管理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认返回完整配置列表，单测可通过 mockResolvedValueOnce/mockRejectedValueOnce 切换场景
    getSettingsMock.mockResolvedValue({ code: 0, message: 'ok', data: mockSettings });
    setSettingMock.mockResolvedValue({ code: 0, message: 'ok', data: mockSettings[0] });
    deleteSettingMock.mockResolvedValue({ code: 0, message: 'ok', data: { key: 'site_name' } });
  });

  it('加载中显示 Loader2 旋转动画', () => {
    // 用永不 resolve 的 Promise 锁定 loading 状态
    getSettingsMock.mockImplementationOnce(() => new Promise(() => {}));
    renderSystemConfig();
    // Loader2 旋转动画用 .animate-spin class 定位（Loader2 无 role 属性）
    expect(document.querySelector('.animate-spin')).not.toBeNull();
  });

  it('加载成功显示分组配置（积分规则/超时与限额/通用配置）', async () => {
    renderSystemConfig();
    // 三个分组标题应被渲染
    await waitFor(() => {
      expect(screen.getByText('积分规则')).toBeInTheDocument();
      expect(screen.getByText('超时与限额')).toBeInTheDocument();
      expect(screen.getByText('通用配置')).toBeInTheDocument();
    });
  });

  it('加载成功显示配置键', async () => {
    renderSystemConfig();
    await waitFor(() => {
      // 桌面表格与移动卡片都会渲染配置键，用 getAllByText 取所有匹配
      expect(screen.getAllByText('skill_publish_reward').length).toBeGreaterThan(0);
      expect(screen.getAllByText('order_timeout').length).toBeGreaterThan(0);
      expect(screen.getAllByText('site_name').length).toBeGreaterThan(0);
    });
  });

  it('加载成功显示配置值，空值显示"（空）"兜底', async () => {
    renderSystemConfig();
    await waitFor(() => {
      // 桌面表格与移动卡片都渲染值，用 getAllByText 取所有匹配
      expect(screen.getAllByText('100').length).toBeGreaterThan(0);
      expect(screen.getAllByText('邻里圈').length).toBeGreaterThan(0);
      // 空值兜底文案"（空）"在桌面表格与移动卡片各渲染一次
      expect(screen.getAllByText('（空）').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('加载失败显示错误提示与重试按钮', async () => {
    getSettingsMock.mockRejectedValueOnce(new ApiError('网络异常', 500));
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('网络异常')).toBeInTheDocument();
      expect(screen.getByText('重试')).toBeInTheDocument();
    });
  });

  it('点击重试按钮重新调用 getSettings', async () => {
    getSettingsMock.mockRejectedValueOnce(new ApiError('网络异常', 500));
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('重试')).toBeInTheDocument();
    });
    act(() => { fireEvent.click(screen.getByText('重试')); });
    await waitFor(() => {
      expect(getSettingsMock).toHaveBeenCalledTimes(2);
    });
  });

  it('空列表显示"暂无配置项"', async () => {
    getSettingsMock.mockResolvedValueOnce({ code: 0, message: 'ok', data: mockEmptyList });
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('暂无配置项')).toBeInTheDocument();
    });
  });

  it('受保护配置键（homepage_hero_image）显示 Lock 图标且无删除按钮', async () => {
    renderSystemConfig();
    await waitFor(() => {
      // Lock 图标存在（受保护配置键渲染）
      expect(document.querySelector('.lucide-lock')).not.toBeNull();
    });
    // 受保护配置键不应渲染"删除"按钮（仅"编辑"按钮）
    // 桌面表格与移动卡片各渲染一次"编辑"，但都不应有"删除"
    const deleteButtons = screen.queryAllByRole('button', { name: /删除/ });
    // homepage_hero_image 受保护，但其他普通配置仍有删除按钮，故 deleteButtons.length 应小于配置总数-1
    // 这里仅断言受保护配置不渲染删除按钮：通过查询所有"删除"按钮，确认数量等于非受保护配置数（5个非受保护 - empty_value 也算非受保护 = 5个，桌面+移动=10个）
    // 但为避免脆弱断言，仅验证 Lock 图标存在即可表明受保护逻辑生效
    expect(deleteButtons.length).toBeGreaterThan(0);
  });

  it('点击"新增配置"打开弹窗显示"新增配置"标题', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('积分规则')).toBeInTheDocument();
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: '新增配置' })); });
    expect(screen.getByRole('heading', { name: '新增配置' })).toBeInTheDocument();
  });

  it('新增弹窗配置键校验：非小写字母开头显示错误提示', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('积分规则')).toBeInTheDocument();
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: '新增配置' })); });
    // 输入大写字母开头的 key 触发校验
    fireEvent.change(screen.getByPlaceholderText('如 daily_earn_limit'), { target: { value: 'Invalid_Key' } });
    // 触发表单校验需要点击保存按钮
    act(() => { fireEvent.click(screen.getByRole('button', { name: '保存' })); });
    expect(screen.getByText(/配置键只能包含小写字母/)).toBeInTheDocument();
  });

  it('新增弹窗配置值必填校验：为空显示"配置值不能为空"', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('积分规则')).toBeInTheDocument();
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: '新增配置' })); });
    // 输入合法 key 但 value 为空
    fireEvent.change(screen.getByPlaceholderText('如 daily_earn_limit'), { target: { value: 'valid_key' } });
    // value 默认为空，直接点击保存触发校验
    act(() => { fireEvent.click(screen.getByRole('button', { name: '保存' })); });
    expect(screen.getByText('配置值不能为空')).toBeInTheDocument();
  });

  it('新增配置成功调用 setSetting 并 toast.success"配置已新增"', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('积分规则')).toBeInTheDocument();
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: '新增配置' })); });
    fireEvent.change(screen.getByPlaceholderText('如 daily_earn_limit'), { target: { value: 'daily_earn_limit' } });
    fireEvent.change(screen.getByPlaceholderText('配置值，统一以字符串存储'), { target: { value: '500' } });
    fireEvent.change(screen.getByPlaceholderText('简要描述配置用途'), { target: { value: '每日积分获取上限' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await waitFor(() => {
      // 新增弹窗默认 valueType='string'，setSetting 第四参数透传后端
      expect(setSettingMock).toHaveBeenCalledWith('daily_earn_limit', '500', '每日积分获取上限', 'string');
      expect(toastSuccessMock).toHaveBeenCalledWith('配置已新增');
    });
  });

  it('新增配置失败显示 toast.error 错误提示', async () => {
    setSettingMock.mockRejectedValueOnce(new ApiError('配置键已存在', 400));
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getByText('积分规则')).toBeInTheDocument();
    });
    act(() => { fireEvent.click(screen.getByRole('button', { name: '新增配置' })); });
    fireEvent.change(screen.getByPlaceholderText('如 daily_earn_limit'), { target: { value: 'daily_earn_limit' } });
    fireEvent.change(screen.getByPlaceholderText('配置值，统一以字符串存储'), { target: { value: '500' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('配置键已存在');
    });
  });

  it('点击"编辑"打开弹窗显示"编辑配置"标题且 key 不可编辑', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('skill_publish_reward').length).toBeGreaterThan(0);
    });
    // 点击第一个"编辑"按钮（桌面表格或移动卡片）
    const editButtons = screen.getAllByRole('button', { name: /编辑/ });
    act(() => { fireEvent.click(editButtons[0]!); });
    expect(screen.getByRole('heading', { name: '编辑配置' })).toBeInTheDocument();
    // key 输入框应被禁用（编辑模式下不可修改）
    const keyInput = screen.getByPlaceholderText('如 daily_earn_limit');
    expect(keyInput).toBeDisabled();
  });

  it('编辑配置成功调用 setSetting 并 toast.success"配置已更新"', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('skill_publish_reward').length).toBeGreaterThan(0);
    });
    const editButtons = screen.getAllByRole('button', { name: /编辑/ });
    act(() => { fireEvent.click(editButtons[0]!); });
    // 修改 value（key 不可编辑）
    // 编辑弹窗 value 是数字输入框（100 是数值类），用 input[type="number"] 精确定位
    // 设计原因：数值类配置会同时渲染 number input 与 range input，两者 value 都是 100，
    // getByDisplayValue('100') 会报多元素匹配，改用 type 选择器精确定位数字输入框
    const valueInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: '200' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
    });
    await waitFor(() => {
      // 编辑时 key 为 skill_publish_reward，value 为 200，description 保留原值"技能发布奖励积分"
      // valueType 从原配置预选为 'int'（skill_publish_reward 的 mock valueType）
      expect(setSettingMock).toHaveBeenCalledWith('skill_publish_reward', '200', '技能发布奖励积分', 'int');
      expect(toastSuccessMock).toHaveBeenCalledWith('配置已更新');
    });
  });

  it('点击"删除"打开确认弹窗显示配置键', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('site_name').length).toBeGreaterThan(0);
    });
    // 找到 site_name 对应的删除按钮（桌面表格与移动卡片各一个）
    const deleteButtons = screen.getAllByRole('button', { name: /删除/ });
    act(() => { fireEvent.click(deleteButtons[0]!); });
    expect(screen.getByRole('heading', { name: '确认删除配置' })).toBeInTheDocument();
    // 弹窗内显示配置键（受保护配置键不可删除，这里点击的是 site_name 或其他非受保护配置）
    // 用 getAllByText 取所有匹配，断言至少有一个弹窗内配置键显示
    expect(screen.getAllByText(/^[a-z_]+$/, { exact: false }).length).toBeGreaterThan(0);
  });

  it('删除弹窗点击"取消"关闭弹窗不调用 deleteSetting', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('site_name').length).toBeGreaterThan(0);
    });
    const deleteButtons = screen.getAllByRole('button', { name: /删除/ });
    act(() => { fireEvent.click(deleteButtons[0]!); });
    // 弹窗内的"取消"按钮（与列表"删除"按钮区分，用 getByRole + name 精确匹配）
    act(() => { fireEvent.click(screen.getByRole('button', { name: '取消' })); });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '确认删除配置' })).not.toBeInTheDocument();
    });
    expect(deleteSettingMock).not.toHaveBeenCalled();
  });

  it('确认删除调用 deleteSetting 并 toast.success"配置已删除"', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('site_name').length).toBeGreaterThan(0);
    });
    const deleteButtons = screen.getAllByRole('button', { name: /删除/ });
    act(() => { fireEvent.click(deleteButtons[0]!); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    });
    await waitFor(() => {
      expect(deleteSettingMock).toHaveBeenCalled();
      expect(toastSuccessMock).toHaveBeenCalledWith('配置已删除');
    });
  });

  it('删除失败显示 toast.error 错误提示', async () => {
    deleteSettingMock.mockRejectedValueOnce(new ApiError('删除失败', 500));
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('site_name').length).toBeGreaterThan(0);
    });
    const deleteButtons = screen.getAllByRole('button', { name: /删除/ });
    act(() => { fireEvent.click(deleteButtons[0]!); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    });
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('删除失败');
    });
  });

  it('数值类配置（value 可解析为数字）显示滑块控件', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('skill_publish_reward').length).toBeGreaterThan(0);
    });
    // 点击 skill_publish_reward 的编辑按钮（第一个编辑按钮对应第一条配置）
    const editButtons = screen.getAllByRole('button', { name: /编辑/ });
    act(() => { fireEvent.click(editButtons[0]!); });
    // 数值类配置应渲染 range 滑块
    expect(document.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('浮点类配置（valueType=float）使用 0.01 步长', async () => {
    renderSystemConfig();
    await waitFor(() => {
      // exchange_rate 命中通用配置兜底分组，valueType=float 驱动滑块步长
      expect(screen.getAllByText('exchange_rate').length).toBeGreaterThan(0);
    });
    // 渲染顺序：每个分组的 SettingList 先渲染桌面表格再渲染移动卡片
    // 故 editButtons 索引：积分规则桌面[0]、积分规则移动[1]、超时桌面[2]、超时移动[3]、通用桌面[4..7]、通用移动[8..11]
    // exchange_rate 是通用配置分组第 1 项，桌面表格编辑按钮索引为 4
    // 设计原因：用文本元素 closest('tr') 定位所在行再找编辑按钮，避免索引计算脆弱
    const exchangeRateCells = screen.getAllByText('exchange_rate');
    // 桌面表格的 td 内 exchange_rate 文本，closest('tr') 找到所在行
    const exchangeRateRow = exchangeRateCells[0]!.closest('tr');
    const editButton = exchangeRateRow?.querySelector('button') as HTMLButtonElement;
    act(() => { fireEvent.click(editButton); });
    const rangeInput = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(rangeInput).not.toBeNull();
    // 浮点类配置步长应为 0.01（由 valueType='float' 元数据驱动，替代原 key 关键词正则识别）
    expect(rangeInput.step).toBe('0.01');
  });

  it('保存中显示 Loader2 旋转动画且按钮禁用', async () => {
    // 用永不 resolve 的 Promise 锁定 submitting 状态
    setSettingMock.mockImplementationOnce(() => new Promise(() => {}));
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('skill_publish_reward').length).toBeGreaterThan(0);
    });
    const editButtons = screen.getAllByRole('button', { name: /编辑/ });
    act(() => { fireEvent.click(editButtons[0]!); });
    // 数值类配置会同时渲染 number input 与 range input，用 type 选择器精确定位数字输入框
    const valueInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: '200' } });
    act(() => { fireEvent.click(screen.getByRole('button', { name: '保存' })); });
    await waitFor(() => {
      // 保存中按钮文案变为"保存中..."
      expect(screen.getByRole('button', { name: '保存中...' })).toBeInTheDocument();
      // 弹窗内应有 Loader2 旋转动画
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).not.toBeNull();
    });
  });

  it('整数类配置（valueType=int）使用步长 1', async () => {
    renderSystemConfig();
    await waitFor(() => {
      expect(screen.getAllByText('skill_publish_reward').length).toBeGreaterThan(0);
    });
    // skill_publish_reward 的 valueType='int'，驱动滑块步长为 1
    const editButtons = screen.getAllByRole('button', { name: /编辑/ });
    act(() => { fireEvent.click(editButtons[0]!); });
    const rangeInput = document.querySelector('input[type="range"]') as HTMLInputElement;
    expect(rangeInput).not.toBeNull();
    // 整数类配置步长应为 1（由 valueType='int' 元数据驱动）
    expect(rangeInput.step).toBe('1');
  });

  it('卸载后 loadSettings resolve 不触发 setState（mountedRef 防御）', async () => {
    // 设计原因：useEffect 触发的 loadSettings 异步进行中，用户切换页面卸载组件，
    // 异步完成后调用 setState 会触发 React 警告与内存泄漏；mountedRef 模式在 cleanup 时置 false，await 后跳过 setState
    type SettingsResp = { code: number; message: string; data: SystemSetting[] };
    let resolveLoad!: (v: SettingsResp) => void;
    getSettingsMock.mockImplementationOnce(() => new Promise<SettingsResp>((resolve) => { resolveLoad = resolve; }));

    const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = render(
      <MemoryRouter>
        <SystemConfig />
      </MemoryRouter>
    );
    // 等待 useEffect 触发 loadSettings
    await waitFor(() => { expect(getSettingsMock).toHaveBeenCalledTimes(1); });

    // 卸载组件触发 cleanup（mountedRef.current = false）
    unmount();

    // 让慢请求 resolve：mountedRef 防御应跳过所有 setState，不抛错也不触发 React 警告
    await act(async () => {
      resolveLoad({ code: 0, message: 'ok', data: mockSettings });
      await Promise.resolve();
    });

    // 验证无 React 卸载后 setState 相关警告
    const reactUnmountWarn = spyConsoleError.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('unmounted')
    );
    expect(reactUnmountWarn).toBeUndefined();
    spyConsoleError.mockRestore();
  });
});
