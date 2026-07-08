import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DonateModal from "@/pages/TimeBank/DonateModal";
import { ApiError } from "@/api/client";

// 用 vi.hoisted 提升 mock 引用，避免 vi.mock 工厂引用外部变量触发 TDZ
const { donateTimeMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  // 捐赠 API mock：默认成功 resolve
  donateTimeMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

// mock timeBank API：仅 mock donateTime，避免触发真实网络请求
vi.mock("@/api/timeBank", () => ({
  donateTime: donateTimeMock,
}));

// mock toast：捕获 success/error 调用便于断言
vi.mock("@/components/Toast", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

import { donateTime } from "@/api/timeBank";

// 构造可控 props 的辅助函数
const buildProps = (overrides: Partial<React.ComponentProps<typeof DonateModal>> = {}) => ({
  open: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  ...overrides,
});

// 填写合法表单：与 TransferModal 区别在 placeholder 文案
const fillValidForm = (toUserId = "user-88", amount = "20", remark = "公益捐赠") => {
  fireEvent.change(screen.getByPlaceholderText("请输入受赠用户ID"), {
    target: { value: toUserId },
  });
  fireEvent.change(screen.getByPlaceholderText("请输入捐赠分钟数"), {
    target: { value: amount },
  });
  fireEvent.change(screen.getByPlaceholderText("选填"), {
    target: { value: remark },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  donateTimeMock.mockResolvedValue({});
});

describe("DonateModal 捐赠时间币弹窗", () => {
  it("open=false 时不渲染任何内容", () => {
    render(<DonateModal {...buildProps({ open: false })} />);
    expect(screen.queryByText("捐赠时间")).not.toBeInTheDocument();
  });

  it("open=true 时渲染弹窗标题与三个输入框", () => {
    render(<DonateModal {...buildProps()} />);
    expect(screen.getByText("捐赠时间")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入受赠用户ID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入捐赠分钟数")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("选填")).toBeInTheDocument();
    expect(screen.getByText("确认捐赠")).toBeInTheDocument();
  });

  describe("字段级校验", () => {
    it("受赠用户ID 为空时显示「请输入对方用户ID」错误并禁用按钮", () => {
      render(<DonateModal {...buildProps()} />);
      fireEvent.change(screen.getByPlaceholderText("请输入捐赠分钟数"), {
        target: { value: "20" },
      });
      expect(screen.getByText("请输入对方用户ID")).toBeInTheDocument();
      expect(screen.getByText("确认捐赠").closest("button")).toBeDisabled();
    });

    it("金额为 0/负数/浮点数时均校验失败（仅允许正整数）", () => {
      const { rerender } = render(<DonateModal {...buildProps()} />);
      // 0
      fillValidForm("user-88", "0");
      expect(screen.getByText("捐赠金额必须为正整数")).toBeInTheDocument();
      // 负数
      rerender(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "-10");
      expect(screen.getByText("捐赠金额必须为正整数")).toBeInTheDocument();
      // 浮点数
      rerender(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "2.5");
      expect(screen.getByText("捐赠金额必须为正整数")).toBeInTheDocument();
    });

    it("金额超过 currentBalance 时显示「捐赠金额不能超过当前余额」错误", () => {
      render(<DonateModal {...buildProps({ currentBalance: 50 })} />);
      fillValidForm("user-88", "100");
      expect(screen.getByText("捐赠金额不能超过当前余额")).toBeInTheDocument();
    });

    it("金额等于 currentBalance 时校验通过（边界值）", () => {
      render(<DonateModal {...buildProps({ currentBalance: 50 })} />);
      fillValidForm("user-88", "50");
      expect(screen.queryByText("捐赠金额不能超过当前余额")).not.toBeInTheDocument();
      expect(screen.getByText("确认捐赠").closest("button")).not.toBeDisabled();
    });

    it("未传 currentBalance 时不进行余额校验", () => {
      render(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "999999");
      expect(screen.queryByText("捐赠金额不能超过当前余额")).not.toBeInTheDocument();
      expect(screen.getByText("确认捐赠").closest("button")).not.toBeDisabled();
    });
  });

  describe("提交流程", () => {
    it("提交成功：调用 donateTime 透传参数，触发 toast.success/onSuccess/onClose，清空表单", async () => {
      const onSuccess = vi.fn();
      const onClose = vi.fn();
      render(<DonateModal {...buildProps({ onSuccess, onClose })} />);
      fillValidForm("user-88", "20", "公益捐赠");

      fireEvent.click(screen.getByText("确认捐赠"));

      await waitFor(() => {
        expect(donateTime).toHaveBeenCalledWith("user-88", 20, "公益捐赠");
      });
      expect(toastSuccessMock).toHaveBeenCalledWith("捐赠成功");
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      // 文本输入框清空为 ""，number 输入框清空为 null
      expect(screen.getByPlaceholderText("请输入受赠用户ID")).toHaveValue("");
      expect(screen.getByPlaceholderText("请输入捐赠分钟数")).toHaveValue(null);
      expect(screen.getByPlaceholderText("选填")).toHaveValue("");
    });

    it("备注为纯空格时传 undefined（trim 后为空走 || undefined 分支）", async () => {
      render(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "20", "   ");

      fireEvent.click(screen.getByText("确认捐赠"));

      await waitFor(() => {
        expect(donateTime).toHaveBeenCalledWith("user-88", 20, undefined);
      });
    });

    it("备注含前后空格时传 trim 后的值", async () => {
      render(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "20", "  公益捐赠  ");

      fireEvent.click(screen.getByText("确认捐赠"));

      await waitFor(() => {
        expect(donateTime).toHaveBeenCalledWith("user-88", 20, "公益捐赠");
      });
    });

    it("提交失败为 ApiError 时显示 ApiError.message", async () => {
      donateTimeMock.mockRejectedValueOnce(new ApiError("受赠用户不存在", 404));
      render(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "20");

      fireEvent.click(screen.getByText("确认捐赠"));

      await screen.findByText("受赠用户不存在");
      expect(toastSuccessMock).not.toHaveBeenCalled();
    });

    it("提交失败为普通 Error 时显示兜底文案「捐赠失败，请重试」", async () => {
      donateTimeMock.mockRejectedValueOnce(new Error("网络异常"));
      render(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "20");

      fireEvent.click(screen.getByText("确认捐赠"));

      await screen.findByText("捐赠失败，请重试");
    });

    it("提交中按钮禁用并显示 Loader2 旋转动画与「提交中...」文案", async () => {
      // 用永不 resolve 的 Promise 锁定 submitting 状态
      donateTimeMock.mockImplementationOnce(() => new Promise(() => {}));
      render(<DonateModal {...buildProps()} />);
      fillValidForm("user-88", "20");

      fireEvent.click(screen.getByText("确认捐赠"));

      await waitFor(() => {
        expect(screen.getByText("提交中...")).toBeInTheDocument();
      });
      expect(document.querySelector(".animate-spin")).toBeInTheDocument();
      expect(screen.getByText("提交中...").closest("button")).toBeDisabled();
    });
  });

  describe("关闭与状态清理", () => {
    it("点击关闭按钮触发 onClose", () => {
      const onClose = vi.fn();
      render(<DonateModal {...buildProps({ onClose })} />);
      // 关闭按钮在标题行右侧
      fireEvent.click(screen.getByText("捐赠时间").parentElement!.parentElement!.querySelector("button")!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("提交失败后点击关闭按钮触发 onClose（handleClose 清空 formError）", async () => {
      const onClose = vi.fn();
      donateTimeMock.mockRejectedValueOnce(new ApiError("余额不足", 400));
      render(<DonateModal {...buildProps({ onClose })} />);
      fillValidForm("user-88", "20");

      fireEvent.click(screen.getByText("确认捐赠"));
      await screen.findByText("余额不足");

      // 触发 handleClose：setFormError(null) + onClose()
      fireEvent.click(screen.getByText("捐赠时间").parentElement!.parentElement!.querySelector("button")!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
