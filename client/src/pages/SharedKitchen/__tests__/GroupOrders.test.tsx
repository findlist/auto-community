import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GroupOrders from "@/pages/SharedKitchen/GroupOrders";
import { getGroupOrders, createGroupOrder, joinGroupOrder } from "@/api/kitchen";
import { toast } from "@/components/Toast";
import type { GroupOrder, PaginatedResponse } from "@/types";

// 用 vi.hoisted 提升 mock 数据，避免 vi.mock 工厂引用外部变量触发 TDZ
const { mockOrders, mockEmptyList, mockMoreList, navigateMock, makePage } = vi.hoisted(() => {
  // 工厂函数构造拼单数据，默认 open 状态
  const make = (overrides: Partial<GroupOrder>): GroupOrder => ({
    id: "order-1",
    initiatorId: "user-1",
    title: "拼单买海鲜",
    description: "新鲜直达",
    targetAmount: 200,
    currentAmount: 50,
    minParticipants: 3,
    maxParticipants: 10,
    currentParticipants: 2,
    address: "小区南门",
    deadline: "2026-12-31T00:00:00.000Z",
    status: "open",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });

  // 工厂函数构造完整 PaginatedResponse，集中补全 total/page/pageSize/totalPages 字段
  // 设计原因：PaginatedResponse 接口要求 6 个字段，逐处手写易遗漏触发 TS2739，工厂统一构造保证类型完整
  const makePage = (list: GroupOrder[], hasNext: boolean): PaginatedResponse<GroupOrder> => ({
    list,
    total: list.length,
    page: 1,
    pageSize: 20,
    totalPages: hasNext ? 2 : 1,
    hasNext,
  });

  return {
    // 覆盖 5 种状态，便于验证按钮可见性与进度渲染
    mockOrders: [
      make({ id: "order-1", title: "拼单买海鲜", status: "open", currentAmount: 50, targetAmount: 200, currentParticipants: 2, maxParticipants: 10 }),
      make({ id: "order-2", title: "团购水果", status: "full", currentAmount: 300, targetAmount: 300, currentParticipants: 6, maxParticipants: 6 }),
      make({ id: "order-3", title: "拼单牛奶", status: "ongoing", currentAmount: 100, targetAmount: 500, currentParticipants: 3, maxParticipants: 8 }),
      make({ id: "order-4", title: " completed 拼单", status: "completed", currentAmount: 200, targetAmount: 200, currentParticipants: 5, maxParticipants: 5 }),
      make({ id: "order-5", title: "已取消拼单", status: "cancelled", currentAmount: 0, targetAmount: 100, currentParticipants: 0, maxParticipants: 5 }),
    ],
    mockEmptyList: makePage([], false),
    mockMoreList: [
      make({ id: "order-6", title: "第二页拼单", status: "open", currentAmount: 80, targetAmount: 400, currentParticipants: 4, maxParticipants: 10 }),
    ],
    navigateMock: vi.fn(),
    makePage,
  };
});

// mock kitchen API：getGroupOrders 默认返回第一页，createGroupOrder/joinGroupOrder 默认成功
vi.mock("@/api/kitchen", () => ({
  getGroupOrders: vi.fn(),
  createGroupOrder: vi.fn(),
  joinGroupOrder: vi.fn(),
}));

// mock Toast，避免真实 UI 干扰断言
vi.mock("@/components/Toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// mock react-router-dom，仅 useNavigate 用 mock，其余保留真实行为
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

// 抑制组件加载失败的 console.error 噪音，便于失败定位
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  consoleErrorSpy.mockClear();
  // 默认返回第一页（hasNext=true 便于分页测试）
  vi.mocked(getGroupOrders).mockResolvedValue({ code: 0, message: "ok", data: makePage(mockOrders, true) });
  vi.mocked(createGroupOrder).mockResolvedValue({ code: 0, message: "ok", data: mockOrders[0]! });
  vi.mocked(joinGroupOrder).mockResolvedValue({ code: 0, message: "ok", data: { id: "order-1", currentAmount: 100, currentParticipants: 3, status: "open" } });
});

const renderGroupOrders = () => {
  // 启用 React Router v7 future flag，提前适配 v7 行为变更并消除测试噪音
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <GroupOrders />
    </MemoryRouter>
  );
};

// 定位截止时间输入框：源码 label 未关联 htmlFor，描述 textarea 与 datetime-local 同时为空值
// getByDisplayValue("") 会多元素匹配，改用 type 选择器精准定位 datetime-local input
const getDeadlineInput = () => {
  const input = document.querySelector('input[type="datetime-local"]');
  if (!input) throw new Error("未找到截止时间输入框");
  return input as HTMLInputElement;
};

describe("SharedKitchen/GroupOrders 拼单列表", () => {
  it("列表加载成功显示拼单数据（标题/金额/人数）", async () => {
    renderGroupOrders();
    // 等待列表渲染完成（用第一个拼单标题作为标志）
    await screen.findByText("拼单买海鲜");
    expect(screen.getByText("¥50 / ¥200")).toBeInTheDocument();
    expect(screen.getByText("2/10 人")).toBeInTheDocument();
  });

  it("列表渲染多条拼单数据", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    expect(screen.getByText("团购水果")).toBeInTheDocument();
    expect(screen.getByText("拼单牛奶")).toBeInTheDocument();
  });

  it("加载失败调用 console.error 兜底（无 UI 错误提示）", async () => {
    vi.mocked(getGroupOrders).mockRejectedValue(new Error("网络异常"));
    renderGroupOrders();
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  it("空列表显示'暂无拼单'空状态", async () => {
    vi.mocked(getGroupOrders).mockResolvedValue({ code: 0, message: "ok", data: mockEmptyList });
    renderGroupOrders();
    await screen.findByText("暂无拼单");
  });

  it("open 状态'参与拼单'按钮可点击", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    // open 状态按钮不含 disabled 样式
    const joinButtons = screen.getAllByRole("button", { name: "参与拼单" });
    expect(joinButtons[0]).not.toBeDisabled();
  });

  it("非 open 状态'参与拼单'按钮禁用", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    const joinButtons = screen.getAllByRole("button", { name: "参与拼单" });
    // 第2条为 full 状态，按钮应禁用
    expect(joinButtons[1]).toBeDisabled();
  });

  it("点击'参与拼单'打开参与弹窗显示拼单标题与建议金额", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getAllByRole("button", { name: "参与拼单" })[0]!);
    // 弹窗标题
    expect(screen.getByRole("heading", { name: "参与拼单" })).toBeInTheDocument();
    // 弹窗内显示拼单标题（列表卡片 h3 与弹窗 p 都含该文本，用 getAllByText 断言弹窗内也存在）
    expect(screen.getAllByText("拼单买海鲜").length).toBeGreaterThanOrEqual(2);
    // 建议金额 = ceil(200/10) = 20
    expect(screen.getByText("建议: ¥20")).toBeInTheDocument();
  });

  it("参与弹窗点击'确认参与'调用 joinGroupOrder 并 toast.success", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getAllByRole("button", { name: "参与拼单" })[0]!);
    // 默认分摊金额 = ceil(200/10) = 20
    fireEvent.click(screen.getByRole("button", { name: "确认参与" }));
    await waitFor(() => {
      expect(joinGroupOrder).toHaveBeenCalledWith("order-1", 20);
      expect(toast.success).toHaveBeenCalledWith("参与成功");
    });
  });

  it("参与成功后关闭弹窗并刷新列表", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getAllByRole("button", { name: "参与拼单" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "确认参与" }));
    await waitFor(() => {
      // 弹窗关闭：参与拼单标题从弹窗内消失（仅剩列表卡片内的标题）
      expect(screen.getAllByText("参与拼单").length).toBeLessThanOrEqual(5);
    });
    // 刷新列表：getGroupOrders 至少被调用 2 次（初始 + 刷新）
    expect(vi.mocked(getGroupOrders).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("参与失败显示 toast.error 错误提示", async () => {
    vi.mocked(joinGroupOrder).mockRejectedValue(new Error("已满员"));
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getAllByRole("button", { name: "参与拼单" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "确认参与" }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("参与失败");
    });
  });

  it("参与弹窗点击'取消'关闭弹窗不调用 API", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getAllByRole("button", { name: "参与拼单" })[0]!);
    // 弹窗内的取消按钮
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "参与拼单" })).toBeNull();
    });
    expect(joinGroupOrder).not.toHaveBeenCalled();
  });

  it("点击'查看详情'跳转到详情页", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getAllByRole("button", { name: "查看详情" })[0]!);
    expect(navigateMock).toHaveBeenCalledWith("/kitchen/group-orders/order-1");
  });

  it("点击'发起拼单'打开创建弹窗", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getByRole("button", { name: /发起拼单/ }));
    expect(screen.getByRole("heading", { name: "发起拼单" })).toBeInTheDocument();
  });

  it("创建弹窗必填校验：标题为空提示'请填写必填信息'", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getByRole("button", { name: /发起拼单/ }));
    // 不填写任何字段直接点击创建
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    expect(toast.error).toHaveBeenCalledWith("请填写必填信息");
    expect(createGroupOrder).not.toHaveBeenCalled();
  });

  it("创建成功调用 createGroupOrder + toast.success + 关闭弹窗 + 刷新列表", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getByRole("button", { name: /发起拼单/ }));
    // 填写必填字段
    fireEvent.change(screen.getByPlaceholderText("如：拼单买海鲜"), { target: { value: "拼单买海鲜" } });
    fireEvent.change(screen.getByPlaceholderText("如：小区南门"), { target: { value: "小区北门" } });
    // 目标金额默认 100，截止时间需手动设置
    // 设计原因：描述 textarea 与 datetime-local input 同时为空值，
    // getByDisplayValue("") 会多元素匹配，改用 type 选择器精准定位
    fireEvent.change(getDeadlineInput(), { target: { value: "2026-12-31T18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(createGroupOrder).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("创建成功");
    });
    // 弹窗关闭
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "发起拼单" })).toBeNull();
    });
  });

  it("创建失败显示 toast.error 错误提示", async () => {
    vi.mocked(createGroupOrder).mockRejectedValue(new Error("创建失败"));
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getByRole("button", { name: /发起拼单/ }));
    fireEvent.change(screen.getByPlaceholderText("如：拼单买海鲜"), { target: { value: "拼单买海鲜" } });
    fireEvent.change(screen.getByPlaceholderText("如：小区南门"), { target: { value: "小区北门" } });
    // 同上：用 type 选择器定位截止时间输入框，避免空值多元素匹配
    fireEvent.change(getDeadlineInput(), { target: { value: "2026-12-31T18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("创建失败");
    });
  });

  it("创建弹窗点击'取消'关闭弹窗不调用 API", async () => {
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getByRole("button", { name: /发起拼单/ }));
    // 创建弹窗内的取消按钮
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "发起拼单" })).toBeNull();
    });
    expect(createGroupOrder).not.toHaveBeenCalled();
  });

  it("hasMore=true 时显示'加载更多'按钮，点击触发分页加载", async () => {
    // 第一次返回第一页 hasNext=true，第二次返回第二页 hasNext=false
    vi.mocked(getGroupOrders)
      .mockResolvedValueOnce({ code: 0, message: "ok", data: makePage(mockOrders, true) })
      .mockResolvedValueOnce({ code: 0, message: "ok", data: makePage(mockMoreList, false) });
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    // 点击加载更多
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => {
      expect(screen.getByText("第二页拼单")).toBeInTheDocument();
    });
    // 第二次调用 page=2
    expect(vi.mocked(getGroupOrders).mock.calls[1]?.[0]?.page).toBe(2);
  });

  it("hasMore=false 时不显示'加载更多'按钮", async () => {
    vi.mocked(getGroupOrders).mockResolvedValue({ code: 0, message: "ok", data: makePage(mockOrders, false) });
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });

  it("创建中按钮禁用且文案变为'创建中...'，避免重复提交", async () => {
    // createGroupOrder 永不 resolve，锁定 creating 状态验证守卫
    vi.mocked(createGroupOrder).mockReturnValue(new Promise(() => {}));
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getByRole("button", { name: /发起拼单/ }));
    fireEvent.change(screen.getByPlaceholderText("如：拼单买海鲜"), { target: { value: "拼单买海鲜" } });
    fireEvent.change(screen.getByPlaceholderText("如：小区南门"), { target: { value: "小区北门" } });
    fireEvent.change(getDeadlineInput(), { target: { value: "2026-12-31T18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));
    // 等待 creating 状态生效
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "创建中..." })).toBeDisabled();
    });
    // 重复点击不应再次触发 createGroupOrder
    fireEvent.click(screen.getByRole("button", { name: "创建中..." }));
    expect(vi.mocked(createGroupOrder)).toHaveBeenCalledTimes(1);
  });

  it("参与中按钮禁用且文案变为'参与中...'，避免重复提交", async () => {
    // joinGroupOrder 永不 resolve，锁定 joining 状态验证守卫
    vi.mocked(joinGroupOrder).mockReturnValue(new Promise(() => {}));
    renderGroupOrders();
    await screen.findByText("拼单买海鲜");
    fireEvent.click(screen.getAllByRole("button", { name: "参与拼单" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "确认参与" }));
    // 等待 joining 状态生效
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "参与中..." })).toBeDisabled();
    });
    // 重复点击不应再次触发 joinGroupOrder
    fireEvent.click(screen.getByRole("button", { name: "参与中..." }));
    expect(vi.mocked(joinGroupOrder)).toHaveBeenCalledTimes(1);
  });
});
