import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "@/api/client";
import type { FoodReview, KitchenPost } from "@/types";

// vi.hoisted 提升 mock 数据与 spy，避免 TDZ（Temporal Dead Zone）问题
const {
  mockPost,
  mockReviews,
  mockEmptyReviews,
  getFoodShareByIdMock,
  getFoodReviewsMock,
  completeFoodOrderMock,
} = vi.hoisted(() => {
  // 被评价的帖子：FoodReviewPage 首次加载时获取，确定被评价者 userId
  // 设计原因：补全 KitchenPost 全部必填字段，避免 noUncheckedIndexedAccess 下 tsc 报错
  const mockPost: KitchenPost = {
    id: "post-1",
    userId: "user-1",
    user: { id: "user-1", nickname: "厨师老王", reputationScore: 80 },
    type: "offer",
    title: "手工水饺",
    description: "妈妈的味道",
    category: "主食",
    price: 15,
    quantity: 10,
    remaining: 8,
    pickupTime: "2026-07-10 12:00",
    pickupLocation: "小区西门",
    pickupType: "self_pickup",
    images: [],
    healthCert: true,
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
  // 评价列表：覆盖有头像/无头像、有内容/无内容两种 reviewer 分支
  const mockReviews: FoodReview[] = [
    {
      id: "review-1",
      reviewerId: "reviewer-1",
      reviewer: { nickname: "张三", avatar: "https://example.com/a.png" },
      reviewedId: "user-1",
      orderId: "order-1",
      rating: 5,
      content: "非常好吃",
      createdAt: "2026-07-01T10:00:00.000Z",
    },
    {
      id: "review-2",
      reviewerId: "reviewer-2",
      // 无头像，验证首字母占位分支
      reviewer: { nickname: "李四" },
      reviewedId: "user-1",
      orderId: "order-2",
      rating: 4,
      createdAt: "2026-07-02T11:00:00.000Z",
    },
  ];
  return {
    mockPost,
    mockReviews,
    mockEmptyReviews: [] as FoodReview[],
    getFoodShareByIdMock: vi.fn(),
    getFoodReviewsMock: vi.fn(),
    completeFoodOrderMock: vi.fn(),
  };
});

// mock @/api/kitchen：覆盖 FoodReviewPage 与 ReviewSubmitModal 用到的 3 个接口
// 设计原因：ReviewSubmitModal 通过 dynamic import 获取 completeFoodOrder，
// vi.mock 会替换模块注册表中的模块，dynamic import 同样命中 mock
vi.mock("@/api/kitchen", () => ({
  getFoodShareById: getFoodShareByIdMock,
  getFoodReviews: getFoodReviewsMock,
  completeFoodOrder: completeFoodOrderMock,
  __esModule: true,
}));

import FoodReviewPage, { ReviewSubmitModal } from "../FoodReview";

// 渲染 FoodReviewPage：用 MemoryRouter + /kitchen/:postId/reviews 路由注入 postId 参数
// future flag 提前适配 React Router v7，消除 future flag 警告（对齐项目其他测试文件）
function renderFoodReviewPage(postId = "post-1") {
  return render(
    <MemoryRouter initialEntries={[`/kitchen/${postId}/reviews`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/kitchen/:postId/reviews" element={<FoodReviewPage />} />
      </Routes>
    </MemoryRouter>
  );
}

// 构造分页响应结构，对齐 PaginatedResponse<FoodReview>
function makeReviewsResponse(list: FoodReview[], page: number, totalPages: number, total: number) {
  return {
    code: 0,
    message: "ok",
    data: { list, page, pageSize: 10, total, totalPages },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认成功返回帖子 + 评价列表
  getFoodShareByIdMock.mockResolvedValue({ code: 0, message: "ok", data: mockPost });
  getFoodReviewsMock.mockResolvedValue(makeReviewsResponse(mockReviews, 1, 1, mockReviews.length));
});

describe("FoodReviewPage 评价列表页", () => {
  it("加载中显示 spinner", async () => {
    // 接口 pending，锁定 loading 态
    getFoodShareByIdMock.mockReturnValue(new Promise(() => {}));
    getFoodReviewsMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderFoodReviewPage();
    // Loader2 渲染为带 animate-spin 类的 svg，无显式 role，按类名查询
    await waitFor(() => {
      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    });
  });

  it("加载成功显示帖子信息、平均分与评价列表", async () => {
    renderFoodReviewPage();
    // 等待评价列表渲染完成
    await waitFor(() => {
      expect(screen.getByText("非常好吃")).toBeInTheDocument();
    });
    // 帖子标题与提供者
    expect(screen.getByText("手工水饺")).toBeInTheDocument();
    expect(screen.getByText(/厨师老王/)).toBeInTheDocument();
    // 平均分：(5+4)/2 = 4.5
    expect(screen.getByText("4.5")).toBeInTheDocument();
    // 评价总数
    expect(screen.getByText(/共 2 条评价/)).toBeInTheDocument();
    // reviewer 昵称
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
  });

  it("无评价时显示空状态", async () => {
    getFoodReviewsMock.mockResolvedValue(makeReviewsResponse(mockEmptyReviews, 1, 1, 0));
    renderFoodReviewPage();
    await waitFor(() => {
      expect(screen.getByText("暂无评价")).toBeInTheDocument();
    });
  });

  it("加载帖子失败（ApiError）显示错误信息", async () => {
    getFoodShareByIdMock.mockRejectedValue(new ApiError("帖子不存在", 404));
    renderFoodReviewPage();
    await waitFor(() => {
      expect(screen.getByText("帖子不存在")).toBeInTheDocument();
    });
  });

  it("加载评价失败（非 ApiError）显示兜底错误", async () => {
    // getFoodReviews 抛原生 Error，验证 fallback 文案
    getFoodReviewsMock.mockRejectedValue(new Error("网络错误"));
    renderFoodReviewPage();
    await waitFor(() => {
      expect(screen.getByText("加载评价失败")).toBeInTheDocument();
    });
  });

  it("分页按钮正常翻页", async () => {
    // 模拟 2 页数据：第 1 页返回 totalPages=2，第 2 页返回不同评价
    const page2Review: FoodReview = {
      id: "review-3",
      reviewerId: "reviewer-3",
      reviewer: { nickname: "王五" },
      reviewedId: "user-1",
      orderId: "order-3",
      rating: 3,
      content: "一般般",
      createdAt: "2026-07-03T12:00:00.000Z",
    };
    getFoodReviewsMock.mockImplementation(async (params?: { page?: number }) => {
      const page = params?.page ?? 1;
      if (page === 1) return makeReviewsResponse(mockReviews, 1, 2, 2);
      return makeReviewsResponse([page2Review], 2, 2, 2);
    });
    renderFoodReviewPage();
    // 等待首页渲染
    await waitFor(() => {
      expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    });
    // 第 1 页时"上一页"禁用
    expect(screen.getByText("上一页").closest("button")).toBeDisabled();
    // 点击"下一页"
    await act(async () => {
      fireEvent.click(screen.getByText("下一页"));
    });
    // 第 2 页评价内容渲染
    await waitFor(() => {
      expect(screen.getByText("一般般")).toBeInTheDocument();
    });
    // 第 2 页时"下一页"禁用
    expect(screen.getByText("下一页").closest("button")).toBeDisabled();
  });
});

describe("ReviewSubmitModal 评价提交弹窗", () => {
  const baseProps = {
    orderId: "order-1",
    onClose: vi.fn(),
    onSuccess: vi.fn(),
  };

  it("visible=false 时不渲染", () => {
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewSubmitModal {...baseProps} visible={false} />
      </MemoryRouter>
    );
    expect(container.firstChild).toBeNull();
  });

  it("visible=true 时渲染弹窗标题与表单", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewSubmitModal {...baseProps} visible={true} />
      </MemoryRouter>
    );
    expect(screen.getByText("评价订单")).toBeInTheDocument();
    expect(screen.getByText("评分")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("分享您的用餐体验...")).toBeInTheDocument();
    expect(screen.getByText("提交评价")).toBeInTheDocument();
  });

  it("选择评分后提交成功调用 completeFoodOrder 与回调", async () => {
    completeFoodOrderMock.mockResolvedValue({ code: 0, message: "ok", data: null });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewSubmitModal {...baseProps} visible={true} />
      </MemoryRouter>
    );
    // 默认 rating=5，点击第 3 颗星改为 3 分
    const starButtons = screen.getAllByRole("button").filter((btn) => btn.querySelector("svg.lucide-star"));
    // noUncheckedIndexedAccess 下数组索引返回 T | undefined，需非空断言
    const thirdStar = starButtons[2]!;
    await act(async () => {
      fireEvent.click(thirdStar);
    });
    // 填写评价内容
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("分享您的用餐体验..."), { target: { value: "味道不错" } });
    });
    // 提交
    await act(async () => {
      fireEvent.click(screen.getByText("提交评价"));
    });
    await waitFor(() => {
      expect(completeFoodOrderMock).toHaveBeenCalledWith("order-1", { rating: 3, content: "味道不错" });
      expect(baseProps.onSuccess).toHaveBeenCalled();
      expect(baseProps.onClose).toHaveBeenCalled();
    });
  });

  it("提交失败（ApiError）显示错误信息", async () => {
    completeFoodOrderMock.mockRejectedValue(new ApiError("订单已完成评价", 400));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewSubmitModal {...baseProps} visible={true} />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByText("提交评价"));
    });
    await waitFor(() => {
      expect(screen.getByText("订单已完成评价")).toBeInTheDocument();
    });
    // 失败时不调用成功回调
    expect(baseProps.onSuccess).not.toHaveBeenCalled();
  });

  it("提交失败（非 ApiError）显示兜底错误", async () => {
    completeFoodOrderMock.mockRejectedValue(new Error("网络异常"));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewSubmitModal {...baseProps} visible={true} />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByText("提交评价"));
    });
    await waitFor(() => {
      expect(screen.getByText("评价失败")).toBeInTheDocument();
    });
  });

  it("提交中按钮禁用并显示提交中文案", async () => {
    // 未决 Promise 锁定 submitting 态
    completeFoodOrderMock.mockReturnValue(new Promise(() => {}));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ReviewSubmitModal {...baseProps} visible={true} />
      </MemoryRouter>
    );
    await act(async () => {
      fireEvent.click(screen.getByText("提交评价"));
    });
    await waitFor(() => {
      expect(screen.getByText("提交中...")).toBeInTheDocument();
    });
    // 提交中按钮禁用
    expect(screen.getByText("提交中...").closest("button")).toBeDisabled();
  });
});
