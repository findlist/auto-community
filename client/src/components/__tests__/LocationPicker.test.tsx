import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// vi.hoisted 提升 mock 函数避免 TDZ
const { geocodeMock, regeoMock } = vi.hoisted(() => ({
  geocodeMock: vi.fn(),
  regeoMock: vi.fn(),
}));

// mock geocode/regeo 接口：控制 resolve/reject 与返回数据
vi.mock("@/api/emergency", () => ({
  geocode: geocodeMock,
  regeo: regeoMock,
}));

import LocationPicker from "../Map/LocationPicker";

// AMap 全局对象引用：保留 marker 实例便于触发 dragend 回调
interface AMapMockRefs {
  markerInstance: {
    setMap: ReturnType<typeof vi.fn>;
    getPosition: ReturnType<typeof vi.fn>;
    setPosition: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    _dragendCb?: (...args: unknown[]) => void;
  };
  mapInstance: {
    getCenter: ReturnType<typeof vi.fn>;
    setCenter: ReturnType<typeof vi.fn>;
    plugin: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
}

// 构造 AMap mock 并安装到 window.AMap
// 设计原因：每个测试用例需要独立 mock 实例，避免状态泄漏
// 用 any 类型断言绕过 amap.d.ts 严格构造函数签名检查
function setupAMapMock(): AMapMockRefs {
  const mapInstance = {
    getCenter: vi.fn(() => ({ lng: 116.397428, lat: 39.90923 })),
    setCenter: vi.fn(),
    plugin: vi.fn((_name: string, cb: () => void) => cb()),
    destroy: vi.fn(),
    on: vi.fn(),
  };
  const markerInstance = {
    setMap: vi.fn(),
    getPosition: vi.fn(() => ({ lng: 116.397428, lat: 39.90923 })),
    setPosition: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      // 暴露 dragend 回调到实例便于测试触发
      if (event === "dragend") {
        markerInstance._dragendCb = cb;
      }
    }),
    _dragendCb: undefined as ((...args: unknown[]) => void) | undefined,
  };

  // 构造函数必须用 function 关键字定义，箭头函数无法被 new 调用
  // 使用 any 类型断言绕过 amap.d.ts 的严格构造函数签名
  const AMapNamespace = {
    Map: function MapCtor() {
      return mapInstance;
    },
    Marker: function MarkerCtor() {
      return markerInstance;
    },
    Geolocation: function GeolocationCtor() {
      return { getCurrentPosition: vi.fn() };
    },
  } as unknown as typeof window.AMap;

  (window as Window & typeof globalThis).AMap = AMapNamespace;

  return { mapInstance, markerInstance };
}

describe("LocationPicker 位置选择器", () => {
  let originalAMap: typeof window.AMap | undefined;
  let originalAMapKey: typeof window._AMAP_KEY | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    geocodeMock.mockResolvedValue({ data: null });
    regeoMock.mockResolvedValue({ data: "" });

    // 备份原始 window.AMap
    originalAMap = window.AMap;
    originalAMapKey = window._AMAP_KEY;
  });

  afterEach(() => {
    // 恢复原始值
    if (originalAMap === undefined) {
      // delete 操作符需要可选属性，用 Reflect.deleteProperty 替代
      Reflect.deleteProperty(window as unknown as Record<string, unknown>, "AMap");
    } else {
      (window as Window & typeof globalThis).AMap = originalAMap;
    }
    if (originalAMapKey === undefined) {
      Reflect.deleteProperty(window as unknown as Record<string, unknown>, "_AMAP_KEY");
    } else {
      window._AMAP_KEY = originalAMapKey;
    }
  });

  it("渲染搜索框（showSearch 默认 true）", () => {
    setupAMapMock();
    render(<LocationPicker />);
    expect(screen.getByPlaceholderText("搜索地址...")).toBeInTheDocument();
    expect(screen.getByText("搜索")).toBeInTheDocument();
  });

  it("showSearch=false 不渲染搜索框", () => {
    setupAMapMock();
    render(<LocationPicker showSearch={false} />);
    expect(screen.queryByPlaceholderText("搜索地址...")).toBeNull();
    expect(screen.queryByText("搜索")).toBeNull();
  });

  it("渲染「拖拽地图上的标记点选择位置」提示", () => {
    setupAMapMock();
    render(<LocationPicker />);
    expect(screen.getByText("拖拽地图上的标记点选择位置")).toBeInTheDocument();
  });

  it("无初始位置时显示「未选择位置」", () => {
    setupAMapMock();
    render(<LocationPicker initialLocation={undefined} />);
    expect(screen.getByText("未选择位置")).toBeInTheDocument();
  });

  it("提供 initialLocation 时显示经纬度", () => {
    setupAMapMock();
    render(<LocationPicker initialLocation={{ lng: 116.404, lat: 39.915 }} />);
    expect(screen.getByText(/116\.404000, 39\.915000/)).toBeInTheDocument();
  });

  it("提供 initialAddress 时显示初始地址", () => {
    setupAMapMock();
    render(<LocationPicker initialAddress="北京市朝阳区" />);
    expect(screen.getByText("北京市朝阳区")).toBeInTheDocument();
  });

  it("输入搜索文本后启用搜索按钮", () => {
    setupAMapMock();
    render(<LocationPicker />);
    const searchInput = screen.getByPlaceholderText("搜索地址...");
    const searchBtn = screen.getByText("搜索");
    expect(searchBtn).toBeDisabled();
    fireEvent.change(searchInput, { target: { value: "北京市" } });
    expect(searchBtn).not.toBeDisabled();
  });

  it("输入文本后显示清除按钮（X）", () => {
    setupAMapMock();
    render(<LocationPicker />);
    fireEvent.change(screen.getByPlaceholderText("搜索地址..."), { target: { value: "test" } });
    // 清除按钮存在
    expect(document.querySelector("button")).not.toBeNull();
  });

  it("点击搜索按钮调用 geocode 接口", async () => {
    setupAMapMock();
    geocodeMock.mockResolvedValue({ data: { lng: 116.404, lat: 39.915 } });
    render(<LocationPicker />);
    fireEvent.change(screen.getByPlaceholderText("搜索地址..."), {
      target: { value: "北京市朝阳区" },
    });
    fireEvent.click(screen.getByText("搜索"));
    await waitFor(() => {
      expect(geocodeMock).toHaveBeenCalledWith("北京市朝阳区");
    });
  });

  it("geocode 返回 null 时显示「未找到该地址」错误", async () => {
    setupAMapMock();
    geocodeMock.mockResolvedValue({ data: null });
    render(<LocationPicker />);
    fireEvent.change(screen.getByPlaceholderText("搜索地址..."), {
      target: { value: "不存在的地方" },
    });
    fireEvent.click(screen.getByText("搜索"));
    await waitFor(() => {
      expect(screen.getByText("未找到该地址")).toBeInTheDocument();
    });
  });

  it("geocode 异常时显示「搜索失败，请重试」", async () => {
    setupAMapMock();
    geocodeMock.mockRejectedValue(new Error("网络错误"));
    render(<LocationPicker />);
    fireEvent.change(screen.getByPlaceholderText("搜索地址..."), {
      target: { value: "测试地址" },
    });
    fireEvent.click(screen.getByText("搜索"));
    await waitFor(() => {
      expect(screen.getByText("搜索失败，请重试")).toBeInTheDocument();
    });
  });

  it("搜索成功后调用 onLocationChange 回调", async () => {
    setupAMapMock();
    const onLocationChange = vi.fn();
    geocodeMock.mockResolvedValue({ data: { lng: 116.404, lat: 39.915 } });
    render(<LocationPicker onLocationChange={onLocationChange} />);
    fireEvent.change(screen.getByPlaceholderText("搜索地址..."), {
      target: { value: "北京" },
    });
    fireEvent.click(screen.getByText("搜索"));
    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalledWith(
        { lng: 116.404, lat: 39.915 },
        "北京"
      );
    });
  });

  it("Enter 键触发搜索", async () => {
    setupAMapMock();
    geocodeMock.mockResolvedValue({ data: { lng: 116.404, lat: 39.915 } });
    render(<LocationPicker />);
    const searchInput = screen.getByPlaceholderText("搜索地址...");
    fireEvent.change(searchInput, { target: { value: "北京" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    await waitFor(() => {
      expect(geocodeMock).toHaveBeenCalledWith("北京");
    });
  });

  it("自定义 height 应用到地图容器", () => {
    setupAMapMock();
    const { container } = render(<LocationPicker height={500} />);
    // 地图容器使用 inline style: height: 500px
    const mapContainer = container.querySelector('[style*="height: 500px"]');
    expect(mapContainer).not.toBeNull();
  });

  it("无 window.AMap 时显示加载状态（Loader2 旋转图标）", () => {
    // 强制 AMap 不存在，触发 script 加载逻辑
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "AMap");
    render(<LocationPicker />);
    // mapLoaded=false 时显示 Loader2 旋转图标（emerald-500 色）
    const spinner = document.querySelector(".animate-spin.text-emerald-500");
    expect(spinner).not.toBeNull();
  });

  it("无 window.AMap 时挂载 script 标签到 head（触发 SDK 加载流程）", () => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "AMap");

    // 拦截 createElement：捕获 script 元素，手动触发 onerror 模拟加载失败
    const originalCreate = document.createElement.bind(document);
    let capturedScriptEl: HTMLScriptElement | null = null;
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(
      (tagName: string) => {
        const el = originalCreate(tagName) as HTMLScriptElement;
        if (tagName === "script") {
          capturedScriptEl = el;
        }
        return el;
      }
    );

    render(<LocationPicker />);

    // 验证 script 被创建并附加到 document.head
    expect(capturedScriptEl).not.toBeNull();
    // TS 控制流分析将 capturedScriptEl 收窄为 null，需先转 unknown 再断言
    const scriptEl = capturedScriptEl as unknown as HTMLScriptElement;
    expect(scriptEl.getAttribute("src")).toContain("webapi.amap.com");

    // 触发 onerror 后，error 状态被设置
    act(() => {
      const el = scriptEl as unknown as {
        onerror: ((e: Event) => void) | null;
      };
      if (el.onerror) el.onerror(new Event("error"));
    });

    // error 文本在地图容器内和位置信息区域都渲染，使用 getAllByText
    const errorElements = screen.getAllByText("地图加载失败，请检查网络连接");
    expect(errorElements.length).toBeGreaterThan(0);

    createElementSpy.mockRestore();
  });

  it("调用 regeo 接口（dragend 事件触发后）", async () => {
    const { markerInstance } = setupAMapMock();
    regeoMock.mockResolvedValue({ data: "北京市朝阳区" });

    render(<LocationPicker initialLocation={{ lng: 116.404, lat: 39.915 }} />);

    // 等待地图初始化后触发 dragend
    await waitFor(() => {
      expect(markerInstance._dragendCb).toBeDefined();
    });

    // 触发 dragend 回调
    await act(async () => {
      const dragendCb = markerInstance._dragendCb as (...args: unknown[]) => void;
      await dragendCb();
    });

    await waitFor(() => {
      expect(regeoMock).toHaveBeenCalled();
    });
  });

  it("onLocationChange 在拖拽后被调用", async () => {
    const { markerInstance } = setupAMapMock();
    const onLocationChange = vi.fn();
    regeoMock.mockResolvedValue({ data: "新地址" });

    render(
      <LocationPicker
        initialLocation={{ lng: 116.404, lat: 39.915 }}
        onLocationChange={onLocationChange}
      />
    );

    await waitFor(() => {
      expect(markerInstance._dragendCb).toBeDefined();
    });

    await act(async () => {
      const dragendCb = markerInstance._dragendCb as (...args: unknown[]) => void;
      await dragendCb();
    });

    await waitFor(() => {
      expect(onLocationChange).toHaveBeenCalled();
    });
  });

  it("dragend 期间卸载组件不触发 setState 泄漏", async () => {
    const { markerInstance } = setupAMapMock();
    // 用 deferred Promise 控制慢请求 resolve 时机，模拟 regeo 进行中用户卸载组件
    let resolveRegeo: ((val: { data: string }) => void) | null = null;
    const slowRegeo = new Promise<{ data: string }>((resolve) => {
      resolveRegeo = resolve;
    });
    regeoMock.mockReturnValue(slowRegeo);

    const onLocationChange = vi.fn();
    const { unmount } = render(
      <LocationPicker
        initialLocation={{ lng: 116.404, lat: 39.915 }}
        onLocationChange={onLocationChange}
      />
    );

    // 等 dragend 回调注册完成
    await waitFor(() => {
      expect(markerInstance._dragendCb).toBeDefined();
    });

    // 触发 dragend（不 await，让 regeo 处于 pending 状态）
    // 用同步 act 包裹 dragendCb 的同步部分（setLocation + setLoading），避免 act 警告
    // dragendCb 是 async 函数，同步部分在 microtask 之前执行完毕，regeo 仍处于 pending
    const dragendCb = markerInstance._dragendCb as (...args: unknown[]) => void;
    act(() => {
      void dragendCb();
    });

    // 等待 setLoading(true) 与 regeo 进入 pending
    await waitFor(() => {
      expect(regeoMock).toHaveBeenCalled();
    });

    // 卸载组件：触发 cleanup，cancelled 置 true
    unmount();

    // resolve 慢请求：此时 cancelled 已为 true，setAddress/onLocationChange 应被守卫拦截
    await act(async () => {
      resolveRegeo?.({ data: "新地址" });
      await Promise.resolve();
    });

    // 验证卸载后 onLocationChange 未被调用（卸载前也未调用，因 regeo 未 resolve）
    expect(onLocationChange).not.toHaveBeenCalled();
  });
});
