import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TimeAccountPage from "@/pages/TimeBank/TimeAccount";
import type { TimeAccount, TimeTransaction, User } from "@/types";

// 用 vi.hoisted 提升 mock 数据，避免 vi.mock 工厂引用外部变量触发 TDZ
const { mockAccount, mockTransactions, mockEmptyList, mockMoreList, mockUser, navigateMock } = vi.hoisted(() => {
  // 工厂函数构造交易记录，默认 earn 类型
  const make = (overrides: Partial<TimeTransaction>): TimeTransaction => ({
    id: "tx-1",
    fromUserId: "user-a",
    toUserId: "user-b",
    amount: 60,
    type: "earn",
    status: "completed",
    remark: "服务报酬",
    createdAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  });

  return {
    // 余额 120 分钟 = 2 小时，累计赚取 300 分钟 = 5 小时，累计消费 180 分钟 = 3 小时
    mockAccount: {
      id: "acc-1",
      userId: "user-1",
      balance: 120,
      totalEarned: 300,
      totalSpent: 180,
      updatedAt: "2026-07-05T00:00:00.000Z",
    } as TimeAccount,
    // 覆盖 4 种 type，便于验证标签与金额符号
    mockTransactions: [
      make({ id: "tx-1", type: "earn", amount: 60, remark: "技能服务报酬" }),
      make({ id: "tx-2", type: "spend", amount: 30, remark: "消费时间币" }),
      make({ id: "tx-3", type: "transfer", amount: 20, remark: "转赠给邻居" }),
      make({ id: "tx-4", type: "donate", amount: 10, remark: "公益捐赠" }),
    ],
    mockEmptyList: { list: [], nextCursor: null, hasMore: false },
    mockMoreList: [make({ id: "tx-5", type: "earn", amount: 50, remark: "第二页交易" })],
    // 补全 User 接口必填字段，避免 useAuth mockReturnValue 类型不匹配
    mockUser: {
      id: "user-1",
      phone: "13800000000",
      nickname: "测试用户",
      creditBalance: 0,
      timeBalance: 0,
      reputationScore: 0,
      role: "user" as const,
      createdAt: "2024-01-01T00:00:00.000Z",
    } as User,
    navigateMock: vi.fn(),
  };
});

// mock timeBank API：getAccount/getTransactions 默认成功
vi.mock("@/api/timeBank", () => ({
  getAccount: vi.fn(),
  getTransactions: vi.fn(),
}));

// mock useAuth，避免依赖真实 AuthProvider 上下文
vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, user: mockUser })),
}));

// mock TransferModal 为静态可控组件：按 open prop 控制渲染，暴露 onSuccess 触发点
// 设计原因：聚焦 TimeAccount 本身行为，避免依赖真实 Modal 的复杂表单交互
vi.mock("@/pages/TimeBank/TransferModal", () => ({
  default: ({ open, onSuccess }: { open: boolean; onSuccess: () => void }) => {
    if (!open) return null;
    return (
      <div data-testid="transfer-modal">
        <span>转赠弹窗</span>
        <button onClick={onSuccess}>触发转赠成功</button>
      </div>
    );
  },
}));

// mock DonateModal 为静态可控组件，与 TransferModal 同模式
vi.mock("@/pages/TimeBank/DonateModal", () => ({
  default: ({ open, onSuccess }: { open: boolean; onSuccess: () => void }) => {
    if (!open) return null;
    return (
      <div data-testid="donate-modal">
        <span>捐赠弹窗</span>
        <button onClick={onSuccess}>触发捐赠成功</button>
      </div>
    );
  },
}));

// mock react-router-dom，仅 useNavigate 用 mock，其余保留真实行为
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

import { getAccount, getTransactions } from "@/api/timeBank";
import { useAuth } from "@/hooks/useAuth";

// 构造完整的 useAuth 返回值，补全 mock 未提供的 token/login/logout/setUser 字段
// 设计原因：useAuth 返回类型要求所有字段，mockReturnValue 必须提供完整对象，
// 用 as any 绕过类型检查会违反 no-explicit-any 规则，故用工厂函数集中补全默认值
function makeAuthValue(overrides: Partial<ReturnType<typeof useAuth>>): ReturnType<typeof useAuth> {
  return {
    user: null,
    token: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    setUser: vi.fn(),
    ...overrides,
  };
}

const renderPage = () => {
  // 启用 React Router v7 future flag，提前适配 v7 行为变更并消除测试噪音
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <TimeAccountPage />
    </MemoryRouter>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue(makeAuthValue({ user: mockUser, isAuthenticated: true }));
  vi.mocked(getAccount).mockResolvedValue({ code: 0, message: "ok", data: mockAccount });
  vi.mocked(getTransactions).mockResolvedValue({ code: 0, message: "ok", data: { list: mockTransactions, nextCursor: null, hasMore: false } });
});

describe("TimeBank/TimeAccount 时间账户", () => {
  it("未登录跳转 /login", () => {
    vi.mocked(useAuth).mockReturnValue(makeAuthValue({ user: null, isAuthenticated: false }));
    renderPage();
    expect(navigateMock).toHaveBeenCalledWith("/login");
  });

  it("加载中显示 Loader2 旋转动画", () => {
    // 用永不 resolve 的 Promise 锁定 loading 状态
    vi.mocked(getAccount).mockImplementation(() => new Promise(() => {}));
    vi.mocked(getTransactions).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("账户加载失败显示错误提示与重试按钮", async () => {
    vi.mocked(getAccount).mockRejectedValue(new Error("网络异常"));
    renderPage();
    await screen.findByText("加载账户信息失败");
    expect(screen.getByText("重试")).toBeInTheDocument();
  });

  it("交易记录加载失败显示错误提示", async () => {
    vi.mocked(getTransactions).mockRejectedValue(new Error("网络异常"));
    renderPage();
    await screen.findByText("加载交易记录失败");
  });

  it("点击重试按钮重新加载账户与交易记录", async () => {
    vi.mocked(getAccount).mockRejectedValueOnce(new Error("网络异常"));
    renderPage();
    await screen.findByText("加载账户信息失败");
    // 首次加载失败调用 1 次
    const initialCalls = vi.mocked(getAccount).mock.calls.length;
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(vi.mocked(getAccount).mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it("加载成功显示账户余额（formatTime 转换 120 分钟 = 2小时）", async () => {
    renderPage();
    await screen.findByText("2小时");
  });

  it("加载成功显示累计赚取（300 分钟 = 5小时）", async () => {
    renderPage();
    await screen.findByText("5小时");
  });

  it("加载成功显示累计消费（180 分钟 = 3小时）", async () => {
    renderPage();
    await screen.findByText("3小时");
  });

  it("加载成功显示交易记录列表", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    expect(screen.getByText("消费时间币")).toBeInTheDocument();
    expect(screen.getByText("转赠给邻居")).toBeInTheDocument();
    expect(screen.getByText("公益捐赠")).toBeInTheDocument();
  });

  it("交易记录类型标签渲染（赚取/消费/转赠/捐赠）", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    expect(screen.getByText("赚取")).toBeInTheDocument();
    expect(screen.getByText("消费")).toBeInTheDocument();
    expect(screen.getByText("转赠")).toBeInTheDocument();
    expect(screen.getByText("捐赠")).toBeInTheDocument();
  });

  it("spend 类型金额显示 - 号，其他类型显示 + 号", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    // spend 类型 30 分钟 = 30分钟，显示 -30分钟
    expect(screen.getByText("-30分钟")).toBeInTheDocument();
    // earn 类型 60 分钟 = 1小时，显示 +1小时
    expect(screen.getByText("+1小时")).toBeInTheDocument();
  });

  it("空交易记录显示'暂无交易记录'", async () => {
    vi.mocked(getTransactions).mockResolvedValue({ code: 0, message: "ok", data: mockEmptyList });
    renderPage();
    await screen.findByText("暂无交易记录");
  });

  it("点击'转赠时间'打开 TransferModal", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    fireEvent.click(screen.getByRole("button", { name: /转赠时间/ }));
    expect(screen.getByTestId("transfer-modal")).toBeInTheDocument();
  });

  it("点击'捐赠时间'打开 DonateModal", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    fireEvent.click(screen.getByRole("button", { name: /捐赠时间/ }));
    expect(screen.getByTestId("donate-modal")).toBeInTheDocument();
  });

  it("TransferModal 成功后刷新账户与交易记录", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    fireEvent.click(screen.getByRole("button", { name: /转赠时间/ }));
    const initialAccountCalls = vi.mocked(getAccount).mock.calls.length;
    const initialTxCallNames = vi.mocked(getTransactions).mock.calls.length;
    fireEvent.click(screen.getByText("触发转赠成功"));
    await waitFor(() => {
      expect(vi.mocked(getAccount).mock.calls.length).toBeGreaterThan(initialAccountCalls);
      expect(vi.mocked(getTransactions).mock.calls.length).toBeGreaterThan(initialTxCallNames);
    });
  });

  it("DonateModal 成功后刷新账户与交易记录", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    fireEvent.click(screen.getByRole("button", { name: /捐赠时间/ }));
    const initialAccountCalls = vi.mocked(getAccount).mock.calls.length;
    fireEvent.click(screen.getByText("触发捐赠成功"));
    await waitFor(() => {
      expect(vi.mocked(getAccount).mock.calls.length).toBeGreaterThan(initialAccountCalls);
    });
  });

  it("hasMore=true 显示'加载更多'按钮，点击触发分页加载", async () => {
    // 第一次返回第一页 hasMore=true，第二次返回第二页 hasMore=false
    vi.mocked(getTransactions)
      .mockResolvedValueOnce({ code: 0, message: "ok", data: { list: mockTransactions, nextCursor: "cursor-1", hasMore: true } })
      .mockResolvedValueOnce({ code: 0, message: "ok", data: { list: mockMoreList, nextCursor: null, hasMore: false } });
    renderPage();
    await screen.findByText("技能服务报酬");
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() => {
      expect(screen.getByText("第二页交易")).toBeInTheDocument();
    });
  });

  it("hasMore=false 不显示'加载更多'按钮", async () => {
    renderPage();
    await screen.findByText("技能服务报酬");
    expect(screen.queryByRole("button", { name: "加载更多" })).toBeNull();
  });
});
