import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ApiError } from "@/api/client";

// vi.hoisted 提升 mock 数据与 spy，避免 TDZ 问题
const {
  getHomepageImageMock,
  setHomepageImageMock,
  uploadImageMock,
} = vi.hoisted(() => ({
  getHomepageImageMock: vi.fn(),
  setHomepageImageMock: vi.fn(),
  uploadImageMock: vi.fn(),
}));

// mock @/api/admin：仅 HomepageImage 用到的 2 个接口
vi.mock("@/api/admin", () => ({
  getHomepageImage: getHomepageImageMock,
  setHomepageImage: setHomepageImageMock,
  __esModule: true,
}));

// mock @/api/upload：uploadImage 返回 UploadResult（非 ApiResponse 包裹）
vi.mock("@/api/upload", () => ({
  uploadImage: uploadImageMock,
  __esModule: true,
}));

import HomepageImage from "../HomepageImage";

// 渲染 HomepageImage，无路由依赖
function renderHomepageImage() {
  return render(<HomepageImage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认加载成功，返回已有图片 URL
  getHomepageImageMock.mockResolvedValue({ code: 0, message: "ok", data: { url: "https://example.com/hero.jpg" } });
});

describe("HomepageImage 首页图片配置页", () => {
  it("加载中显示 spinner", async () => {
    // 接口 pending，锁定 loading 态
    getHomepageImageMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderHomepageImage();
    // Loader2 渲染为带 animate-spin 类的 svg
    await waitFor(() => {
      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    });
  });

  it("加载成功且 URL 非空时显示图片预览", async () => {
    renderHomepageImage();
    await waitFor(() => {
      const img = screen.getByAltText("首页展示图片");
      expect(img).toHaveAttribute("src", "https://example.com/hero.jpg");
    });
  });

  it("加载成功但 URL 为空时显示占位文案", async () => {
    getHomepageImageMock.mockResolvedValue({ code: 0, message: "ok", data: { url: null } });
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByText("暂未配置，将使用默认图片")).toBeInTheDocument();
    });
  });

  it("加载失败（ApiError）显示错误信息", async () => {
    getHomepageImageMock.mockRejectedValue(new ApiError("无权限访问", 403));
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByText("无权限访问")).toBeInTheDocument();
    });
  });

  it("加载失败（非 ApiError）显示兜底错误", async () => {
    getHomepageImageMock.mockRejectedValue(new Error("网络错误"));
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });
  });

  it("保存空 URL 时显示校验提示", async () => {
    // 先清空 URL
    getHomepageImageMock.mockResolvedValue({ code: 0, message: "ok", data: { url: "https://example.com/hero.jpg" } });
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByAltText("首页展示图片")).toBeInTheDocument();
    });
    // 清空 URL 输入框
    const input = screen.getByPlaceholderText("粘贴图片 URL，或使用下方按钮上传");
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } });
    });
    // 点击保存
    await act(async () => {
      fireEvent.click(screen.getByText("保存配置"));
    });
    // 显示校验错误，不调用保存接口
    expect(screen.getByText("图片 URL 不能为空")).toBeInTheDocument();
    expect(setHomepageImageMock).not.toHaveBeenCalled();
  });

  it("保存成功显示成功提示", async () => {
    setHomepageImageMock.mockResolvedValue({ code: 0, message: "ok", data: { url: "https://example.com/new.jpg", updatedBy: "admin" } });
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByAltText("首页展示图片")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("保存配置"));
    });
    await waitFor(() => {
      expect(screen.getByText("已保存")).toBeInTheDocument();
    });
    expect(setHomepageImageMock).toHaveBeenCalledWith("https://example.com/hero.jpg");
  });

  it("保存失败（ApiError）显示错误信息", async () => {
    setHomepageImageMock.mockRejectedValue(new ApiError("URL 格式不合法", 400));
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByAltText("首页展示图片")).toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByText("保存配置"));
    });
    await waitFor(() => {
      expect(screen.getByText("URL 格式不合法")).toBeInTheDocument();
    });
  });

  it("上传成功后回填 URL 到输入框", async () => {
    uploadImageMock.mockResolvedValue({ url: "https://cdn.example.com/uploaded.png", filename: "uploaded.png", size: 1024, mimetype: "image/png" });
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByAltText("首页展示图片")).toBeInTheDocument();
    });
    // 模拟文件选择
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "test.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    // 上传成功后 URL 输入框回填为上传后的 URL
    await waitFor(() => {
      expect(screen.getByDisplayValue("https://cdn.example.com/uploaded.png")).toBeInTheDocument();
    });
  });

  it("上传失败（ApiError）显示错误信息", async () => {
    uploadImageMock.mockRejectedValue(new ApiError("文件过大", 413));
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByAltText("首页展示图片")).toBeInTheDocument();
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["dummy"], "big.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    await waitFor(() => {
      expect(screen.getByText("文件过大")).toBeInTheDocument();
    });
  });

  it("保存中按钮显示'保存中...'加载态、disabled 且重复点击不触发第二次 API 调用", async () => {
    // 未决 Promise 锁定 saving 态，模拟弱网下请求挂起
    setHomepageImageMock.mockReturnValue(new Promise(() => {}));
    renderHomepageImage();
    await waitFor(() => {
      expect(screen.getByAltText("首页展示图片")).toBeInTheDocument();
    });
    // 第一次点击"保存配置"按钮
    await act(async () => {
      fireEvent.click(screen.getByText("保存配置"));
    });
    // saving 命中后按钮文案应变为"保存中..."且 disabled
    // 设计原因：三重防御之按钮文案变化 + disabled，让用户感知保存进行中并阻止重复点击
    const savingBtn = await screen.findByText("保存中...");
    expect(savingBtn.closest("button")).toBeDisabled();
    // 第一次点击应触发 setHomepageImage 调用一次
    expect(setHomepageImageMock).toHaveBeenCalledTimes(1);
    // 重复点击"保存中..."按钮：fireEvent 绕过 disabled 直接触发 onClick，
    // 验证入口 if (saving) return 守卫作为第二道防线阻止第二次 API 调用
    await act(async () => {
      fireEvent.click(savingBtn);
    });
    expect(setHomepageImageMock).toHaveBeenCalledTimes(1);
  });
});
