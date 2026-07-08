/**
 * ExportButton 下拉导出组件单测
 * 测试目标：覆盖菜单展开/收起、CSV/Excel 双格式调用、加载态、错误分支、外部点击关闭
 * 测试策略：mock @/api/admin 的 exportData 与 Toast，断言调用参数与 UI 反馈
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExportButton from "@/components/ExportButton";
import { ApiError } from "@/api/client";

// 用 vi.hoisted 提升 mock，避免 TDZ
const exportDataMock = vi.hoisted(() => vi.fn());
vi.mock("@/api/admin", () => ({
  exportData: exportDataMock,
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/components/Toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

beforeEach(() => {
  exportDataMock.mockReset();
  exportDataMock.mockResolvedValue(undefined);
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("ExportButton 下拉导出", () => {
  it('渲染触发按钮，默认文案为"导出数据"', () => {
    render(<ExportButton type="users" />);
    expect(screen.getByRole("button", { name: /导出数据/ })).toBeInTheDocument();
  });

  it("点击触发按钮展开菜单，显示 CSV 与 Excel 两个选项", () => {
    render(<ExportButton type="users" />);
    fireEvent.click(screen.getByRole("button", { name: /导出数据/ }));
    expect(screen.getByRole("menuitem", { name: /导出 CSV/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /导出 Excel/ })).toBeInTheDocument();
  });

  it('点击"导出 CSV"以 format=csv 调用 exportData 并提示成功', async () => {
    render(<ExportButton type="users" params={{ status: "active" }} />);
    fireEvent.click(screen.getByRole("button", { name: /导出数据/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /导出 CSV/ }));
    await waitFor(() => {
      expect(exportDataMock).toHaveBeenCalledWith("users", { status: "active" }, "csv");
    });
    expect(toastSuccess).toHaveBeenCalledWith("导出成功，请查看下载文件");
  });

  it('点击"导出 Excel"以 format=xlsx 调用 exportData', async () => {
    render(<ExportButton type="orders" params={{ orderType: "skill" }} />);
    fireEvent.click(screen.getByRole("button", { name: /导出数据/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /导出 Excel/ }));
    await waitFor(() => {
      expect(exportDataMock).toHaveBeenCalledWith("orders", { orderType: "skill" }, "xlsx");
    });
  });

  it('导出中按钮禁用并显示"导出CSV中..."，完成后恢复', async () => {
    // 用可控 Promise 模拟挂起的导出请求
    let resolveExport: () => void = () => {};
    exportDataMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveExport = resolve;
      }),
    );
    render(<ExportButton type="users" />);
    fireEvent.click(screen.getByRole("button", { name: /导出数据/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /导出 CSV/ }));

    await waitFor(() => {
      expect(screen.getByRole("button")).toBeDisabled();
    });
    expect(screen.getByRole("button")).toHaveTextContent("导出CSV中...");

    resolveExport();
    await waitFor(() => {
      expect(screen.getByRole("button")).not.toBeDisabled();
    });
  });

  it("导出失败为 ApiError 时显示其 message", async () => {
    exportDataMock.mockRejectedValue(new ApiError("服务器错误", 500));
    render(<ExportButton type="users" />);
    fireEvent.click(screen.getByRole("button", { name: /导出数据/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /导出 Excel/ }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("服务器错误");
    });
  });

  it("导出失败为未知错误时显示通用提示", async () => {
    exportDataMock.mockRejectedValue(new Error("network down"));
    render(<ExportButton type="users" />);
    fireEvent.click(screen.getByRole("button", { name: /导出数据/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /导出 CSV/ }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("导出失败，请稍后重试");
    });
  });

  it("点击组件外部关闭菜单", () => {
    render(
      <div>
        <ExportButton type="users" />
        <div data-testid="outside">外部区域</div>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /导出数据/ }));
    expect(screen.getByRole("menuitem", { name: /导出 CSV/ })).toBeInTheDocument();
    // mousedown 冒泡至 document，触发外部点击关闭逻辑
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menuitem", { name: /导出 CSV/ })).not.toBeInTheDocument();
  });

  it("自定义 label 作为触发按钮文案", () => {
    render(<ExportButton type="users" label="导出用户" />);
    expect(screen.getByRole("button", { name: /导出用户/ })).toBeInTheDocument();
  });
});
