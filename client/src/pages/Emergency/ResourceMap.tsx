import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, MapPin, Phone, Loader2, Package,
  AlertCircle, Locate, Navigation2, Shield,
} from "lucide-react";
import { getResources } from "@/api/emergency";
import { escapeHtml } from "@/utils/format";
import type { EmergencyResource } from "@/types";

// 资源类型元数据：用于列表图标与标记颜色区分，未命中时回退为通用样式
const RESOURCE_TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  aed: { label: "AED", color: "#ef4444", bg: "bg-red-100 text-red-700" },
  fire_extinguisher: { label: "灭火器", color: "#f97316", bg: "bg-orange-100 text-orange-700" },
  tool_kit: { label: "工具箱", color: "#3b82f6", bg: "bg-blue-100 text-blue-700" },
  first_aid: { label: "急救箱", color: "#10b981", bg: "bg-emerald-100 text-emerald-700" },
  shelter: { label: "避难所", color: "#8b5cf6", bg: "bg-purple-100 text-purple-700" },
};

const RESOURCE_STATUS_BADGE: Record<string, string> = {
  available: "bg-green-100 text-green-700",
  maintenance: "bg-yellow-100 text-yellow-700",
  unavailable: "bg-gray-100 text-gray-500",
};

const RESOURCE_STATUS_LABEL: Record<string, string> = {
  available: "可用", maintenance: "维护中", unavailable: "不可用",
};

const TYPE_FILTERS = [
  { value: "", label: "全部" },
  { value: "aed", label: "AED" },
  { value: "fire_extinguisher", label: "灭火器" },
  { value: "tool_kit", label: "工具箱" },
  { value: "first_aid", label: "急救箱" },
  { value: "shelter", label: "避难所" },
];

// 默认中心点（北京天安门），用户定位失败或未授权时回退使用
const DEFAULT_CENTER: [number, number] = [116.397428, 39.90923];

// 解析后端 point 字符串 "(lng,lat)" 为坐标对象；格式异常或缺失时返回 null
function parseLocation(loc?: string): { lng: number; lat: number } | null {
  if (!loc) return null;
  const cleaned = loc.replace(/[()]/g, "");
  const parts = cleaned.split(",").map(Number);
  const lng = parts[0];
  const lat = parts[1];
  // 双重校验：长度与数值有效性，避免 undefined/NaN 污染地图标记
  if (parts.length === 2 && lng != null && lat != null && Number.isFinite(lng) && Number.isFinite(lat)) {
    return { lng, lat };
  }
  return null;
}

// 使用 Haversine 公式计算两点间球面距离（米），避免依赖高德几何工具插件
function haversineDistance(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371000; // 地球半径（米）
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 将米转换为可读距离文案
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} 米`;
  return `${(meters / 1000).toFixed(1)} 公里`;
}

// 拼接高德地图导航 URI，唤起 App 或网页版导航
function openNavigation(lng: number, lat: number, name: string) {
  const url = `https://uri.amap.com/navigation?to=${lng},${lat},${encodeURIComponent(name)}&mode=walk&src=linli-circle&callnative=1`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * 动态加载高德地图 JS SDK，仅在首次调用时注入 script 标签。
 * 抽成 hook 以便后续其他地图页面复用，避免重复加载。
 *
 * 降级策略（对齐规范第六章）：检测到 _AMAP_KEY 缺失时直接进入降级模式，
 * 不发起注定失败的脚本请求，由调用方根据 hasKey 切换为列表展示布局，
 * 完整保留距离计算、导航跳转等业务逻辑，仅禁用地图渲染。
 */
function useAMapScript() {
  // 在 hook 内部一次性读取 Key 配置，避免运行期被外部清空导致状态错乱
  const hasKey = useMemo(() => Boolean(window._AMAP_KEY), []);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 无 Key 时直接进入降级模式，跳过脚本加载以避免无效网络请求与控制台噪声
    if (!hasKey) {
      setError("未配置高德地图 Key，已切换为列表模式");
      return;
    }
    if (window.AMap) {
      setLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${window._AMAP_KEY}`;
    script.onload = () => setLoaded(true);
    script.onerror = () => setError("地图加载失败，请检查网络连接");
    document.head.appendChild(script);
  }, [hasKey]);

  return { loaded, error, hasKey };
}

export default function ResourceMap() {
  const navigate = useNavigate();
  const { loaded: mapLoaded, error: mapError, hasKey } = useAMapScript();
  // 降级模式：无 Key 时禁用地图渲染，列表占满宽度，地图区域改为提示卡片
  const isDegraded = !hasKey;

  const [resources, setResources] = useState<EmergencyResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const markersRef = useRef<Map<string, AMapMarker>>(new Map());
  const infoWindowRef = useRef<AMapInfoWindow | null>(null);

  // 拉取资源列表
  const fetchResources = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await getResources(typeFilter ? { type: typeFilter, pageSize: 200 } : { pageSize: 200 });
      setResources(res.data.list);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "资源加载失败");
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  // 尝试获取用户位置（用于距离计算与地图中心定位）
  useEffect(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({ lng: pos.coords.longitude, lat: pos.coords.latitude });
        setLocating(false);
      },
      () => {
        // 用户拒绝或定位失败时静默回退到默认中心
        setLocating(false);
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }, []);

  // 初始化地图实例与信息窗体
  useEffect(() => {
    if (!mapLoaded || !containerRef.current || !window.AMap) return;

    const map = new window.AMap.Map(containerRef.current, {
      zoom: 13,
      center: userLocation ? [userLocation.lng, userLocation.lat] : DEFAULT_CENTER,
    });
    mapRef.current = map;

    // 信息窗体：点击标记或列表项时展示资源详情与导航入口
    infoWindowRef.current = new window.AMap.InfoWindow({
      offset: new window.AMap.Pixel(0, -32),
      closeWhenClickMap: true,
    });

    // 捕获当前 markers 实例到局部变量，cleanup 执行时 ref 可能已被其他 effect 修改（满足 exhaustive-deps 规则）
    const markers = markersRef.current;
    return () => {
      map.destroy();
      markers.clear();
    };
  }, [mapLoaded, userLocation]);

  // 渲染资源标记（资源或用户位置变化时重建）
  useEffect(() => {
    if (!mapRef.current || !window.AMap) return;
    const map = mapRef.current;

    // 清除旧标记
    markersRef.current.forEach((m) => map.remove(m));
    markersRef.current.clear();

    // 用户位置标记（绿色圆点）
    if (userLocation) {
      const userMarker = new window.AMap.Marker({
        position: [userLocation.lng, userLocation.lat],
        content: '<div style="width:18px;height:18px;border-radius:50%;background:#10b981;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
        offset: new window.AMap.Pixel(-9, -9),
        zIndex: 200,
      });
      userMarker.setMap(map);
      markersRef.current.set("__user__", userMarker);
    }

    // 资源标记
    resources.forEach((r) => {
      const coord = parseLocation(r.location);
      if (!coord) return;
      const meta = RESOURCE_TYPE_META[r.type] || { label: r.type, color: "#6b7280" };
      const marker = new window.AMap.Marker({
        position: [coord.lng, coord.lat],
        content: `<div style="background:${meta.color};color:#fff;font-size:12px;padding:4px 8px;border-radius:12px;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.2);">${escapeHtml(r.name)}</div>`,
        offset: new window.AMap.Pixel(0, -12),
      });
      marker.on("click", () => {
        setSelectedId(r.id);
        showInfoWindow(r, coord);
      });
      marker.setMap(map);
      markersRef.current.set(r.id, marker);
    });

    // 自动调整视野以包含所有标记
    // 元组断言避免 noUncheckedIndexedAccess 把 p[0]/p[1] 推断为 number | undefined
    const allPositions: [number, number][] = [
      ...(userLocation ? [[userLocation.lng, userLocation.lat] as [number, number]] : []),
      ...resources
        .map((r) => parseLocation(r.location))
        .filter((c): c is { lng: number; lat: number } => c !== null)
        .map((c): [number, number] => [c.lng, c.lat]),
    ];
    if (allPositions.length > 1) {
      map.setFitView(allPositions.map((p) => new window.AMap.LngLat(p[0], p[1])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, userLocation]);

  // 信息窗体内容：包含名称、类型、距离、联系方式与导航按钮
  const showInfoWindow = useCallback((resource: EmergencyResource, coord: { lng: number; lat: number }) => {
    if (!infoWindowRef.current || !mapRef.current) return;
    const meta = RESOURCE_TYPE_META[resource.type] || { label: resource.type };
    const distance = userLocation ? formatDistance(haversineDistance(userLocation, coord)) : null;
    const statusLabel = RESOURCE_STATUS_LABEL[resource.status] || resource.status;

    // 拼接信息窗体 HTML，点击导航按钮触发外部跳转（通过 data 属性传递参数）
    // 后端字段（name/address/contactPhone）经 escapeHtml 转义，防止存储型 XSS
    const content = `
      <div style="min-width:200px;max-width:260px;padding:4px;">
        <div style="font-weight:600;font-size:14px;color:#111827;margin-bottom:4px;">${escapeHtml(resource.name)}</div>
        <div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${meta.label} · ${statusLabel}</div>
        ${distance ? `<div style="font-size:12px;color:#10b981;margin-bottom:6px;">距您约 ${distance}</div>` : ""}
        ${resource.address ? `<div style="font-size:12px;color:#6b7280;margin-bottom:4px;">📍 ${escapeHtml(resource.address)}</div>` : ""}
        ${resource.contactPhone ? `<div style="font-size:12px;color:#6b7280;margin-bottom:8px;">📞 ${escapeHtml(resource.contactPhone)}</div>` : ""}
        <button id="res-nav-btn" style="width:100%;background:#10b981;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;">路线导航</button>
      </div>`;
    infoWindowRef.current.setContent(content);
    infoWindowRef.current.open(mapRef.current, new window.AMap.LngLat(coord.lng, coord.lat));

    // 绑定导航按钮点击事件：延迟绑定以等待 DOM 渲染完成
    setTimeout(() => {
      const btn = document.getElementById("res-nav-btn");
      if (btn) {
        btn.onclick = () => openNavigation(coord.lng, coord.lat, resource.name);
      }
    }, 50);
  }, [userLocation]);

  // 列表项点击：聚焦地图标记并打开信息窗体
  const handleSelectResource = useCallback((r: EmergencyResource) => {
    const coord = parseLocation(r.location);
    if (!coord || !mapRef.current) return;
    setSelectedId(r.id);
    mapRef.current.setZoomAndCenter(15, [coord.lng, coord.lat]);
    showInfoWindow(r, coord);
  }, [showInfoWindow]);

  // 计算每个资源距用户的距离（用于列表排序与展示）
  const resourcesWithDistance = useMemo(() => {
    if (!userLocation) return resources.map((r) => ({ resource: r, distance: null as number | null }));
    return resources
      .map((r) => {
        const coord = parseLocation(r.location);
        return { resource: r, distance: coord ? haversineDistance(userLocation, coord) : null };
      })
      .sort((a, b) => {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
  }, [resources, userLocation]);

  return (
    <div className="px-4 lg:px-10 py-6 pb-24 lg:pb-12 max-w-6xl lg:mx-auto">
      {/* 顶部：返回 + 标题 + 定位状态 */}
      <button
        onClick={() => navigate("/emergency")}
        className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] mb-4 hover:text-emerald-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回应急大厅
      </button>

      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <p className="text-xs tracking-widest text-neutral-400 mb-1 font-mono">—— 应急邻里</p>
          <h1 className="text-2xl lg:text-3xl font-semibold text-neutral-900 tracking-tight">应急资源地图</h1>
          <p className="text-sm text-neutral-500 mt-1">查看附近的 AED、灭火器、急救箱等公共应急资源</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          {locating ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 定位中</>
          ) : userLocation ? (
            <><Locate className="w-3.5 h-3.5 text-emerald-500" /> 已定位</>
          ) : (
            <><Locate className="w-3.5 h-3.5" /> 未定位</>
          )}
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {TYPE_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setTypeFilter(value)}
            className={`px-3 py-2 text-sm rounded-full whitespace-nowrap border transition-colors ${
              typeFilter === value
                ? "bg-emerald-500 text-white border-emerald-500"
                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-emerald-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {fetchError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm mb-4">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{fetchError}</span>
          <button onClick={fetchResources} className="ml-auto text-sm underline py-1 px-2 rounded hover:bg-red-50 transition-colors">重试</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* 地图区域：有 Key 时占 3 列渲染地图；无 Key 降级时占满宽度显示提示卡片 */}
        <div className={isDegraded ? "lg:col-span-5" : "lg:col-span-3"}>
          {isDegraded ? (
            // 降级提示卡片：保留地图接入入口说明，引导配置 Key 后启用地图模式
            <div className="w-full rounded-2xl border border-amber-200 bg-amber-50 p-6 flex flex-col items-center justify-center gap-3 text-center">
              <Shield className="w-10 h-10 text-amber-500" />
              <div>
                <p className="text-sm font-semibold text-amber-800 mb-1">未配置高德地图 Key</p>
                <p className="text-xs text-amber-700 leading-relaxed">
                  已切换为列表模式，您仍可查看全部应急资源、距离与导航信息。
                </p>
                <p className="text-xs text-amber-600 mt-2">
                  配置 <code className="px-1 py-0.5 bg-amber-100 rounded text-[11px]">window._AMAP_KEY</code> 后即可启用地图渲染。
                </p>
              </div>
            </div>
          ) : (
            <div
              ref={containerRef}
              className="w-full h-[50vh] lg:h-[600px] rounded-2xl border border-[var(--color-border)] bg-[var(--color-neutral-100)] overflow-hidden relative"
            >
              {!mapLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white">
                  {mapError ? (
                    <>
                      <AlertCircle className="w-8 h-8 text-red-400" />
                      <p className="text-sm text-red-500">{mapError}</p>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                      <p className="text-sm text-[var(--color-text-tertiary)]">地图加载中...</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 资源列表：降级时占满 5 列，否则占 2 列，按距离排序 */}
        <div className={isDegraded ? "lg:col-span-5" : "lg:col-span-2"}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              资源列表
              <span className="ml-1.5 text-xs font-normal text-[var(--color-text-tertiary)]">
                ({resourcesWithDistance.length})
              </span>
            </h2>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 bg-white rounded-xl border border-gray-100 animate-pulse">
                  <div className="h-4 bg-[var(--color-neutral-200)] rounded w-2/3 mb-2" />
                  <div className="h-3 bg-[var(--color-neutral-200)] rounded w-full mb-2" />
                  <div className="h-3 bg-[var(--color-neutral-200)] rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : resourcesWithDistance.length === 0 ? (
            <div className="py-12 text-center text-[var(--color-text-tertiary)]">
              <Package className="w-12 h-12 mx-auto mb-3 text-[var(--color-neutral-300)]" />
              <p className="text-sm">暂无应急资源</p>
              <p className="text-xs mt-1">可尝试切换筛选条件</p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
              {resourcesWithDistance.map(({ resource: r, distance }) => {
                const meta = RESOURCE_TYPE_META[r.type] || { label: r.type, bg: "bg-gray-100 text-gray-600" };
                const coord = parseLocation(r.location);
                const isSelected = selectedId === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => coord && handleSelectResource(r)}
                    className={`p-3.5 bg-white rounded-xl border transition-all ${
                      isSelected
                        ? "border-emerald-400 ring-1 ring-emerald-100"
                        : "border-gray-100 hover:border-emerald-200"
                    } ${coord ? "cursor-pointer" : "opacity-60 cursor-default"}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <h3 className="font-medium text-[var(--color-text-primary)] text-sm flex-1">{r.name}</h3>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${meta.bg}`}>
                        {meta.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs mb-1.5">
                      <span className={`px-1.5 py-0.5 rounded-full ${RESOURCE_STATUS_BADGE[r.status] || "bg-gray-100 text-gray-500"}`}>
                        {RESOURCE_STATUS_LABEL[r.status] || r.status}
                      </span>
                      {distance != null && (
                        <span className="text-emerald-600 flex items-center gap-0.5">
                          <Navigation2 className="w-3 h-3" />
                          {formatDistance(distance)}
                        </span>
                      )}
                    </div>

                    {r.address && (
                      <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] mb-1">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{r.address}</span>
                      </div>
                    )}
                    {r.contactPhone && (
                      <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                        <Phone className="w-3 h-3 flex-shrink-0" />
                        <span>{r.contactPhone}</span>
                      </div>
                    )}
                    {!coord && (
                      <div className="flex items-center gap-1 text-xs text-amber-500 mt-1">
                        <Shield className="w-3 h-3" />
                        <span>未设置位置，无法在地图展示</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
