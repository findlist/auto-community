/**
 * ABTestResults 端到端测试
 *
 * 测试目标：覆盖 A/B 测试结果页的加载状态、错误状态分离（configError vs resultsError）、
 *           测试信息卡片渲染、变体对比表格、统计显著性卡片、结论建议生成
 * 测试策略：mock @/api/ab-test 的 getTestConfig/getTestResults，验证并行加载错误独立性与数据渲染
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ABTestResults from '../ABTestResults';
import { ApiError } from '@/api/client';

// vi.hoisted 提升 mock 数据与 spy，避免 TDZ（临时死区）导致引用未初始化
const { mockConfig, mockResults, mockEmptyResults, getTestConfigMock, getTestResultsMock } = vi.hoisted(() => {
  // 完整配置 mock：覆盖 active 状态、双变体 50/50 分配、起止时间字段
  const mockConfig = {
    id: 1,
    testName: 'ai_recommendation_vs_keyword',
    description: 'AI 推荐算法对比测试：类别匹配 vs 完整 AI 匹配',
    variants: { control: 50, treatment: 50 },
    status: 'active',
    startDate: '2026-07-01',
    endDate: null,
    createdAt: '2026-07-01',
    updatedAt: '2026-07-01',
  };
  // 完整结果 mock：control 点击率 10%、转化率 1%；treatment 点击率 15%、转化率 2%
  // 设计原因：treatment 各项指标均高于 control，验证结论生成"提升"文案
  const mockResults = {
    testName: 'ai_recommendation_vs_keyword',
    variants: [
      {
        variant: 'control',
        eventCounts: { impression: 1000, click: 100, conversion: 10 },
        totalEvents: 1110,
        conversionRate: 1.0,
      },
      {
        variant: 'treatment',
        eventCounts: { impression: 1000, click: 150, conversion: 20 },
        totalEvents: 1170,
        conversionRate: 2.0,
      },
    ],
    totalParticipants: 2000,
  };
  // 空结果 mock：variants 为空数组，验证无变体数据时的边界渲染
  const mockEmptyResults = {
    testName: 'ai_recommendation_vs_keyword',
    variants: [],
    totalParticipants: 0,
  };
  return {
    mockConfig,
    mockResults,
    mockEmptyResults,
    getTestConfigMock: vi.fn(),
    getTestResultsMock: vi.fn(),
  };
});

// mock ab-test API：getTestConfig/getTestResults 用 spy 便于每个用例自定义返回值
vi.mock('@/api/ab-test', () => ({
  getTestConfig: getTestConfigMock,
  getTestResults: getTestResultsMock,
}));

beforeEach(() => {
  getTestConfigMock.mockReset();
  getTestResultsMock.mockReset();
  // 默认返回成功数据，单个用例可用 mockResolvedValueOnce 覆盖
  getTestConfigMock.mockResolvedValue({ data: mockConfig });
  getTestResultsMock.mockResolvedValue({ data: mockResults });
});

describe('ABTestResults 端到端测试', () => {
  it('加载中显示"加载中..."提示', () => {
    // 不 resolve 任何 mock，让组件停留在 loading 状态
    getTestConfigMock.mockReturnValue(new Promise(() => {}));
    getTestResultsMock.mockReturnValue(new Promise(() => {}));
    render(<ABTestResults />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('加载成功显示页面标题"A/B 测试结果"', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'A/B 测试结果' })).toBeInTheDocument();
    });
  });

  it('加载成功显示测试信息卡片（testName）', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      // testName 作为 h2 渲染在测试信息卡片中
      expect(screen.getByRole('heading', { name: 'ai_recommendation_vs_keyword' })).toBeInTheDocument();
    });
  });

  it('active 状态显示"进行中"标签', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByText('进行中')).toBeInTheDocument();
    });
  });

  it('paused 状态显示"已暂停"标签', async () => {
    getTestConfigMock.mockResolvedValueOnce({ data: { ...mockConfig, status: 'paused' } });
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByText('已暂停')).toBeInTheDocument();
    });
  });

  it('completed 状态显示"已结束"标签', async () => {
    getTestConfigMock.mockResolvedValueOnce({ data: { ...mockConfig, status: 'completed' } });
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByText('已结束')).toBeInTheDocument();
    });
  });

  it('加载成功显示变体对比表格的 Control 与 Treatment 行', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByText('Control（类别匹配）')).toBeInTheDocument();
      expect(screen.getByText('Treatment（AI 匹配）')).toBeInTheDocument();
    });
  });

  it('变体对比表格正确渲染曝光数、点击数、转化数', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      // control 与 treatment 的 impression 均为 1000，用 getAllByText 断言 2 处匹配
      expect(screen.getAllByText('1000')).toHaveLength(2);
      // control: click=100, conversion=10（唯一值可用 getByText）
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('10')).toBeInTheDocument();
      // treatment: click=150, conversion=20
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();
    });
  });

  it('点击率计算正确：Control 10.00%、Treatment 15.00%', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      // controlCTR = 100/1000*100 = 10.00%
      expect(screen.getByText('10.00%')).toBeInTheDocument();
      // treatmentCTR = 150/1000*100 = 15.00%
      expect(screen.getByText('15.00%')).toBeInTheDocument();
    });
  });

  it('加载成功显示统计显著性卡片（点击率差异、转化率差异）', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByText('点击率差异')).toBeInTheDocument();
      expect(screen.getByText('转化率差异')).toBeInTheDocument();
    });
  });

  it('加载成功显示结论与建议区域', async () => {
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '结论与建议' })).toBeInTheDocument();
    });
  });

  it('config 失败但 results 成功时，显示错误条但结果表格正常渲染', async () => {
    // 实际运行时拦截器已将 HTTP 错误转为 ApiError，mock 需对齐该结构
    getTestConfigMock.mockRejectedValueOnce(new ApiError('配置接口异常', 500));
    render(<ABTestResults />);
    await waitFor(() => {
      // 错误条显示 config 错误信息
      expect(screen.getByText('配置接口异常')).toBeInTheDocument();
      // results 表格仍正常渲染（错误条非阻塞，与已成功数据并存）
      expect(screen.getByText('Control（类别匹配）')).toBeInTheDocument();
    });
  });

  it('results 失败但 config 成功时，显示错误条但配置卡片正常渲染', async () => {
    getTestResultsMock.mockRejectedValueOnce(new ApiError('结果接口异常', 500));
    render(<ABTestResults />);
    await waitFor(() => {
      // 错误条显示 results 错误信息
      expect(screen.getByText('结果接口异常')).toBeInTheDocument();
      // config 信息卡片仍正常渲染
      expect(screen.getByRole('heading', { name: 'ai_recommendation_vs_keyword' })).toBeInTheDocument();
    });
  });

  it('config 与 results 都失败时，错误条优先展示 config 错误（configError ?? resultsError）', async () => {
    getTestConfigMock.mockRejectedValueOnce(new ApiError('配置错误', 500));
    getTestResultsMock.mockRejectedValueOnce(new ApiError('结果错误', 500));
    render(<ABTestResults />);
    await waitFor(() => {
      // 派生 error = configError ?? resultsError，config 错误优先
      expect(screen.getByText('配置错误')).toBeInTheDocument();
      expect(screen.queryByText('结果错误')).not.toBeInTheDocument();
    });
  });

  it('点击重试按钮重新加载 config 与 results', async () => {
    // 首次加载失败
    getTestConfigMock.mockRejectedValueOnce(new ApiError('首次失败', 500));
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByText('首次失败')).toBeInTheDocument();
    });
    // 点击重试，第二次加载成功（mockReset 后默认返回成功数据）
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => {
      // 重试后错误条消失，正常数据渲染
      expect(screen.queryByText('首次失败')).not.toBeInTheDocument();
      expect(screen.getByText('Control（类别匹配）')).toBeInTheDocument();
    });
    // 验证 getTestConfig 被调用 2 次（初始 + 重试）
    expect(getTestConfigMock).toHaveBeenCalledTimes(2);
    expect(getTestResultsMock).toHaveBeenCalledTimes(2);
  });

  it('样本量不足时（< 100 次曝光）结论显示"样本量不足"提示', async () => {
    // 两侧 impression 总和 < 100，触发 generateConclusion 的样本量不足分支
    getTestResultsMock.mockResolvedValueOnce({
      data: {
        ...mockResults,
        variants: [
          { variant: 'control', eventCounts: { impression: 30, click: 3, conversion: 0 }, totalEvents: 33, conversionRate: 0 },
          { variant: 'treatment', eventCounts: { impression: 30, click: 4, conversion: 1 }, totalEvents: 35, conversionRate: 3.33 },
        ],
        totalParticipants: 60,
      },
    });
    render(<ABTestResults />);
    await waitFor(() => {
      expect(screen.getByText(/样本量不足/)).toBeInTheDocument();
    });
  });

  it('无变体数据时（variants 空数组）表格仍渲染但数据全为 0', async () => {
    // 组件行为：results 存在即渲染结果表格，variants 为空时 controlData/treatmentData 为 undefined
    // 各数字字段兜底为 0，百分比兜底为 0.00%，结论触发"样本量不足"分支（totalImpressions=0 < 100）
    getTestResultsMock.mockResolvedValueOnce({ data: mockEmptyResults });
    render(<ABTestResults />);
    await waitFor(() => {
      // 配置卡片仍渲染
      expect(screen.getByRole('heading', { name: 'ai_recommendation_vs_keyword' })).toBeInTheDocument();
      // 结果表格仍渲染（Control/Treatment 行标签存在）
      expect(screen.getByText('Control（类别匹配）')).toBeInTheDocument();
      expect(screen.getByText('Treatment（AI 匹配）')).toBeInTheDocument();
      // 所有数据字段为 0（曝光/点击/转化各 2 变体 = 6 处）
      expect(screen.getAllByText('0')).toHaveLength(6);
      // 所有百分比为 0.00%（点击率/转化率各 2 变体 = 4 处）
      expect(screen.getAllByText('0.00%')).toHaveLength(4);
      // 样本量不足提示（totalImpressions=0 < 100 触发）
      expect(screen.getByText(/样本量不足/)).toBeInTheDocument();
    });
  });
});
