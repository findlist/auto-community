import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import ImageUpload from "../Upload/ImageUpload";
import { ApiError } from "@/api/client";

// vi.hoisted 提升 mock：控制 uploadImages 返回值与 spy
const { uploadImagesMock } = vi.hoisted(() => ({
  uploadImagesMock: vi.fn(),
}));

// mock @/api/upload：仅 mock uploadImages，uploadImage 不在 ImageUpload 使用范围
vi.mock("@/api/upload", () => ({
  uploadImages: uploadImagesMock,
}));

// mock URL.createObjectURL / revokeObjectURL：jsdom 对 Blob URL 支持不稳定
const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-url");
const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

// 构造合法图片文件
function makeImageFile(name: string, type = "image/jpeg", size = 1024) {
  const file = new File(["mock"], name, { type });
  Object.defineProperty(file, "size", { value: size, writable: false });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadImagesMock.mockResolvedValue({
    images: [{ url: "https://cdn.example.com/uploaded.jpg", filename: "uploaded.jpg", size: 1024, mimetype: "image/jpeg" }],
  });
});

describe("ImageUpload 图片上传组件", () => {
  it("无图片时渲染上传区域", () => {
    render(<ImageUpload />);
    expect(screen.getByText("点击或拖拽上传图片")).toBeInTheDocument();
    expect(screen.getByText("支持 JPEG、PNG、GIF，最大 5MB")).toBeInTheDocument();
  });

  it("value 非空时渲染已有图片预览", () => {
    render(<ImageUpload value={["https://cdn.example.com/existing.jpg"]} />);
    // 已有图片渲染 img 标签
    const img = document.querySelector("img");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/existing.jpg");
  });

  it("上传成功后调用 onChange 回传 URL 列表", async () => {
    const onChange = vi.fn();
    render(<ImageUpload onChange={onChange} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile("test.jpg");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["https://cdn.example.com/uploaded.jpg"]);
    });
  });

  it("上传中显示 loading 动画", async () => {
    // uploadImages 永不 resolve，锁定 uploading 状态
    uploadImagesMock.mockReturnValue(new Promise(() => {}));
    render(<ImageUpload />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile("test.jpg");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    // 上传区域显示旋转动画
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("不支持的文件类型触发 onError", async () => {
    const onError = vi.fn();
    render(<ImageUpload onError={onError} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile("test.bmp", "image/bmp");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onError).toHaveBeenCalledWith("不支持的文件类型，仅支持 JPEG、PNG、GIF");
    // uploadImages 不应被调用
    expect(uploadImagesMock).not.toHaveBeenCalled();
  });

  it("文件超过 5MB 触发 onError", async () => {
    const onError = vi.fn();
    render(<ImageUpload onError={onError} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile("big.jpg", "image/jpeg", 6 * 1024 * 1024);
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(onError).toHaveBeenCalledWith("文件大小超过限制，最大允许 5MB");
    expect(uploadImagesMock).not.toHaveBeenCalled();
  });

  it("达到最大数量后隐藏上传区域", () => {
    // 5 张图片已满（默认 maxCount=5），上传区域不应显示
    const urls = Array.from({ length: 5 }, (_, i) => `https://cdn.example.com/img-${i}.jpg`);
    render(<ImageUpload value={urls} />);

    expect(screen.queryByText("点击或拖拽上传图片")).not.toBeInTheDocument();
  });

  it("上传失败（ApiError）调用 onError 并传递错误消息", async () => {
    const onError = vi.fn();
    uploadImagesMock.mockRejectedValue(new ApiError("服务器错误", 500));
    render(<ImageUpload onError={onError} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile("test.jpg");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("服务器错误");
    });
  });

  it("上传失败（非 ApiError）调用 onError 并显示兜底消息", async () => {
    const onError = vi.fn();
    uploadImagesMock.mockRejectedValue(new Error("网络中断"));
    render(<ImageUpload onError={onError} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile("test.jpg");
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("上传失败，请稍后重试");
    });
  });

  it("点击删除按钮移除图片并调用 onChange", async () => {
    const onChange = vi.fn();
    render(<ImageUpload value={["https://cdn.example.com/existing.jpg"]} onChange={onChange} />);

    // 点击删除按钮
    const deleteBtn = document.querySelector('button[class*="bg-black"]') as HTMLButtonElement;
    expect(deleteBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    // onChange 被调用，返回空数组
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("disabled 时隐藏上传区域与删除按钮", () => {
    render(<ImageUpload value={["https://cdn.example.com/existing.jpg"]} disabled />);

    // 上传区域不显示（已有 1 张但 maxCount=5，canAddMore 取决于 disabled）
    expect(screen.queryByText("点击或拖拽上传图片")).not.toBeInTheDocument();
    // 删除按钮不显示
    expect(document.querySelector('button[class*="bg-black"]')).toBeNull();
  });
});
