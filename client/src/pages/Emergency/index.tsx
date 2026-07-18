import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Siren, ArrowLeft, MapPin, Clock, Star, AlertTriangle,
  Shield, Heart, Phone, Package, X, Loader2, Navigation, Map as MapIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/api/client";
import { useSafeTimeout } from "@/hooks/useSafeTimeout";
import {
  getRequests, getRequest, createRequest, respondToRequest,
  updateResponseStatus, submitFalseReport, getResources,
} from "@/api/emergency";
import type {
  EmergencyRequest, EmergencyResponse, EmergencyResource,
} from "@/types";
import { SkeletonListCard, SkeletonDetail } from "@/components/Skeleton";
import { LoadingButton } from "@/components/Button";
// Empty 组件统一空状态视觉规范，替代零散 emoji + 文案组合
import Empty from "@/components/Empty";
import LocationPicker from "@/components/Map/LocationPicker";
import { useFormValidation } from "@/hooks/useFormValidation";
import { validateRequired, validateMinLength, validateMaxLength, validatePhone } from "@/utils/formValidation";
import { escapeHtml } from "@/utils/format";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

// 紧急程度色点（列表项左侧小圆点，替代粗边框卡片）
const URGENCY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-400",
  medium: "bg-yellow-400",
  low: "bg-blue-400",
};

const URGENCY_LABEL: Record<string, string> = {
  critical: "紧急", high: "较高", medium: "一般", low: "较低",
};

const URGENCY_BADGE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-700",
  low: "bg-blue-100 text-blue-700",
};

const STATUS_LABEL: Record<string, string> = {
  open: "待响应", responding: "处理中", resolved: "已解决",
  closed: "已关闭", false_report: "虚假举报",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-green-100 text-green-700",
  responding: "bg-blue-100 text-blue-700",
  resolved: "bg-gray-100 text-gray-600",
  closed: "bg-gray-100 text-gray-500",
  false_report: "bg-red-100 text-red-600",
};

const RESPONSE_STATUS_LABEL: Record<string, string> = {
  pending: "待处理", accepted: "已响应", arrived: "已到达",
  completed: "已完成", timeout: "已超时",
};

const RESOURCE_STATUS_LABEL: Record<string, string> = {
  available: "可用", maintenance: "维护中", unavailable: "不可用",
};

const RESOURCE_STATUS_BADGE: Record<string, string> = {
  available: "bg-green-100 text-green-700",
  maintenance: "bg-yellow-100 text-yellow-700",
  unavailable: "bg-gray-100 text-gray-500",
};

const CATEGORIES = [
  { value: "medical", label: "医疗" },
  { value: "repair", label: "维修" },
  { value: "safety", label: "安全" },
  { value: "other", label: "其他" },
];

const RESOURCE_TYPES = [
  { value: "", label: "全部" },
  { value: "aed", label: "AED" },
  { value: "fire_extinguisher", label: "灭火器" },
  { value: "tool_kit", label: "工具箱" },
];

const TABS = [
  { key: "emergency", label: "紧急" },
  { key: "daily", label: "日常" },
  { key: "", label: "全部" },
];

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString();
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)}>
          <Star className={`w-6 h-6 ${n <= value ? "fill-yellow-400 text-yellow-400" : "text-[var(--color-neutral-300)]"}`} />
        </button>
      ))}
    </div>
  );
}

function useModalTransition() {
  const [isVisible, setIsVisible] = useState(false);
  // 安全定时器：组件卸载时自动清理，调用前自动清理上一个，避免 onClose 作用于已卸载组件与快速点击累积
  const safeSetTimeout = useSafeTimeout();

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  return {
    isVisible,
    handleClose: (onClose: () => void) => {
      setIsVisible(false);
      safeSetTimeout(onClose, 300);
    },
  };
}

function RequestCard({ request }: { request: EmergencyRequest }) {
  const navigate = useNavigate();
  const displayName = request.isAnonymous ? "匿名用户" : (request.user?.nickname ?? "未知用户");

  return (
    <div
      onClick={() => navigate(`/emergency/${request.id}`)}
      className="group flex items-start gap-3.5 lg:gap-5 border-b border-neutral-200 py-5 lg:py-6 cursor-pointer transition-colors duration-200 hover:bg-neutral-50/60 -mx-4 px-4 lg:-mx-6 lg:px-6"
    >
      {/* 左侧：紧急程度色点 */}
      <span className={`flex-shrink-0 mt-2 w-2 h-2 rounded-full ${URGENCY_DOT[request.urgency]}`} />

      <div className="flex-1 min-w-0">
        {/* 标题行：标题 + 紧急标签 */}
        <div className="flex items-baseline gap-2.5 mb-1.5">
          <h3 className="text-base lg:text-lg font-semibold text-neutral-900 truncate group-hover:text-emerald-700 transition-colors">
            {request.title}
          </h3>
          <span className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${URGENCY_BADGE[request.urgency]}`}>
            {URGENCY_LABEL[request.urgency]}
          </span>
        </div>
        {/* 描述 */}
        <p className="text-sm text-neutral-500 line-clamp-1 mb-2">{request.description}</p>
        {/* 元信息 */}
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span className="text-neutral-600">{displayName}</span>
          <span>·</span>
          <span>{request.category}</span>
          <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[request.status]}`}>
            {STATUS_LABEL[request.status]}
          </span>
          <span className="flex items-center gap-0.5 ml-auto">
            <Clock className="w-3 h-3" />
            {formatRelativeTime(request.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { isVisible, handleClose } = useModalTransition();
  const [type, setType] = useState<"emergency" | "daily">("emergency");
  const [category, setCategory] = useState("medical");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<{ lng: number; lat: number } | undefined>(undefined);

  const fieldConfigs = useMemo(() => ({
    title: {
      value: title,
      rules: [(v: string) => validateRequired(v, "标题")],
    },
    description: {
      value: description,
      rules: [
        (v: string) => validateRequired(v, "详细描述"),
        (v: string) => validateMinLength(v, 10, "详细描述"),
        (v: string) => validateMaxLength(v, 500, "详细描述"),
      ],
    },
    contactPhone: {
      value: contactPhone,
      rules: [
        (v: string) => validateRequired(v, "联系电话"),
        (v: string) => validatePhone(v),
      ],
    },
  }), [title, description, contactPhone]);

  const { setTouched, getFieldError, validateAll } = useFormValidation(fieldConfigs);

  const handleLocationChange = (location: { lng: number; lat: number }, addr: string) => {
    setSelectedLocation(location);
    setAddress(addr);
  };

  const handleSubmit = async () => {
    // 入口守卫：弱网下用户连点"提交"会触发多次 createRequest，产生多个求助记录
    // 设计原因：紧急场景下用户更易焦虑连点，disabled 单一防御不足以阻断异步批处理窗口内的连点
    if (submitting) return;
    if (!validateAll()) return;
    setSubmitting(true);
    try {
      await createRequest({
        type, category, title: title.trim(), description: description.trim(),
        address: address.trim() || undefined, contactPhone: contactPhone.trim() || undefined,
        isAnonymous, urgency: type === "emergency" ? "critical" : "medium",
        location: selectedLocation,
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "发布求助失败，请稍后重试"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/40 transition-opacity duration-300 ${isVisible ? "opacity-100" : "opacity-0"}`} onClick={() => handleClose(onClose)}>
      <div
        className={`w-full max-w-lg bg-white rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto transition-transform duration-300 ease-out ${isVisible ? "translate-y-0" : "translate-y-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">发布求助</h2>
          <button onClick={() => handleClose(onClose)}><X className="w-5 h-5 text-[var(--color-text-tertiary)]" /></button>
        </div>

        <div className="flex bg-[var(--color-neutral-100)] rounded-lg p-1 mb-4">
          {([["emergency", "紧急求助", "bg-red-500"] as const, ["daily", "日常互助", "bg-emerald-500"] as const]).map(([val, label, color]) => (
            <button
              key={val}
              onClick={() => setType(val)}
              className={`flex-1 py-2 text-sm rounded-md transition-colors ${type === val ? `${color} text-white` : "text-[var(--color-text-secondary)]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-[var(--color-text-secondary)] mb-1 block">类别</label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORIES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setCategory(value)}
                  className={`px-3 py-2 text-sm rounded-full border transition-colors ${category === value ? "bg-emerald-500 text-white border-emerald-500" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm text-[var(--color-text-secondary)] mb-1 block">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched("title")}
              placeholder="简要描述您的求助"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("title") ? "border-red-500" : "border-[var(--color-border)]"}`}
            />
            {getFieldError("title") && <p className="text-red-500 text-xs mt-1">{getFieldError("title")}</p>}
          </div>

          <div>
            <label className="text-sm text-[var(--color-text-secondary)] mb-1 block">详细描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => setTouched("description")}
              placeholder="详细描述情况..."
              rows={3}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none ${getFieldError("description") ? "border-red-500" : "border-[var(--color-border)]"}`}
            />
            {getFieldError("description") && <p className="text-red-500 text-xs mt-1">{getFieldError("description")}</p>}
          </div>

          <div>
            <label className="text-sm text-[var(--color-text-secondary)] mb-1 block">地址</label>
            <div className="flex gap-2">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="事发地址（选填）"
                className="flex-1 px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                onClick={() => setShowMap(!showMap)}
                className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1 transition-colors ${showMap ? "bg-emerald-500 text-white" : "bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]"}`}
              >
                <Navigation className="w-4 h-4" />
                地图
              </button>
            </div>
            {showMap && (
              <div className="mt-3">
                <LocationPicker
                  initialLocation={selectedLocation}
                  initialAddress={address}
                  onLocationChange={handleLocationChange}
                  height={200}
                />
              </div>
            )}
          </div>

          <div>
            <label className="text-sm text-[var(--color-text-secondary)] mb-1 block">联系电话</label>
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              onBlur={() => setTouched("contactPhone")}
              placeholder="联系电话"
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("contactPhone") ? "border-red-500" : "border-[var(--color-border)]"}`}
            />
            {getFieldError("contactPhone") && <p className="text-red-500 text-xs mt-1">{getFieldError("contactPhone")}</p>}
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm text-[var(--color-text-secondary)]">匿名发布</span>
            <button
              onClick={() => setIsAnonymous(!isAnonymous)}
              className={`w-11 h-6 rounded-full transition-colors relative ${isAnonymous ? "bg-emerald-500" : "bg-gray-300"}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isAnonymous ? "translate-x-5.5" : "translate-x-0.5"}`} />
            </button>
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 bg-emerald-500 text-white rounded-xl font-medium disabled:opacity-50 transition-opacity"
          >
            {submitting ? "提交中..." : "提交"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResourceModal({ onClose }: { onClose: () => void }) {
  const { isVisible, handleClose } = useModalTransition();
  const [resources, setResources] = useState<EmergencyResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [showMap, setShowMap] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getResources(typeFilter ? { type: typeFilter } : undefined);
      setResources(res.data.list);
    } catch (err) {
      toast.error(getErrorMessage(err, "加载应急资源失败"));
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => { fetchResources(); }, [fetchResources]);

  // 加载高德地图 SDK
  // 设计原因：与 ResourceMap.tsx useAMapScript / LocationPicker 保持一致的 scriptId 与 cancelled 模式，
  // 避免同一应用内多套加载逻辑产生重复 script 标签与卸载后 setState 泄漏
  useEffect(() => {
    if (!showMap) return;

    if (window.AMap) {
      setMapLoaded(true);
      return;
    }

    let cancelled = false;
    // 统一 script id：与 ResourceMap/LocationPicker 一致，便于跨页面复用与精确移除
    const scriptId = 'amap-sdk-script';
    const script = document.createElement('script');
    script.id = scriptId;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${window._AMAP_KEY || ''}`;
    script.onload = () => {
      // 卸载后不再触发 setMapLoaded，避免对已卸载组件 setState 造成泄漏
      if (!cancelled) setMapLoaded(true);
    };
    // 地图 SDK 加载失败时提示用户，降级模式下仍可查看资源列表
    script.onerror = () => {
      if (cancelled) return;
      console.error('地图加载失败');
      toast.error('地图加载失败，已切换为列表模式查看');
    };
    document.head.appendChild(script);

    // cleanup：组件卸载或 showMap 关闭时移除未加载完成的 script，避免 DOM 堆积
    return () => {
      cancelled = true;
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [showMap]);

  // 初始化地图并显示资源标记
  useEffect(() => {
    if (!showMap || !mapLoaded || !mapContainerRef.current || !window.AMap) return;

    // 创建地图实例
    const map = new window.AMap.Map(mapContainerRef.current, {
      zoom: 14,
      center: userLocation ? [userLocation.lng, userLocation.lat] : [116.397428, 39.90923],
    });

    mapRef.current = map;

    // 如果有用户位置，添加用户位置标记
    if (userLocation) {
      const userMarker = new window.AMap.Marker({
        position: [userLocation.lng, userLocation.lat],
        title: '您的位置',
        content: '<div class="w-6 h-6 bg-emerald-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center"><svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4"/></svg></div>',
      });
      userMarker.setMap(map);
    }

    // 添加资源标记
    resources.forEach((r) => {
      if (r.location) {
        // 解析 location 字符串（格式可能是 "(lng,lat)" 或 "lng,lat"）
        const locationStr = r.location.replace(/[()]/g, '');
        const parts = locationStr.split(',').map(Number);
        const lng = parts[0];
        const lat = parts[1];
        // 经纬度为 0 是合法值（赤道/本初子午线交点位于几内亚湾），不能用 if (lng && lat) 判空
        // 必须用 lng != null 收窄类型 + Number.isFinite 严格校验数值有效，避免 0/NaN/Infinity 误判
        if (lng != null && lat != null && Number.isFinite(lng) && Number.isFinite(lat)) {
          const marker = new window.AMap.Marker({
            position: [lng, lat],
            title: r.name,
            content: `<div class="px-2 py-1 bg-red-500 text-white text-xs rounded shadow-lg whitespace-nowrap">${escapeHtml(r.name)}</div>`,
          });
          marker.setMap(map);
        }
      }
    });

    return () => {
      map.destroy();
    };
  }, [showMap, mapLoaded, resources, userLocation]);

  // 尝试获取用户位置
  // 设计原因：getCurrentPosition 的回调是异步执行的，组件可能在回调触发前已卸载（用户关闭地图），
  // 直接 setUserLocation 会触发 React 警告或无意义的状态更新；用 cancelled 标志在 cleanup 时标记放弃回调结果
  useEffect(() => {
    if (!showMap) return;
    if (!navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setUserLocation({ lng: pos.coords.longitude, lat: pos.coords.latitude });
      },
      () => {
        // 获取失败，使用默认位置；无需额外处理 cancelled（不更新状态）
      }
    );

    return () => {
      cancelled = true;
    };
  }, [showMap]);

  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/40 transition-opacity duration-300 ${isVisible ? "opacity-100" : "opacity-0"}`} onClick={() => handleClose(onClose)}>
      <div
        className={`w-full max-w-lg bg-white rounded-t-2xl p-5 max-h-[90vh] overflow-y-auto transition-transform duration-300 ease-out ${isVisible ? "translate-y-0" : "translate-y-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">应急资源</h2>
          <button onClick={() => handleClose(onClose)}><X className="w-5 h-5 text-[var(--color-text-tertiary)]" /></button>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {RESOURCE_TYPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={`px-3 py-2 text-sm rounded-full whitespace-nowrap border transition-colors ${typeFilter === value ? "bg-emerald-500 text-white border-emerald-500" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setShowMap(!showMap)}
            className={`px-3 py-2 text-sm rounded-full whitespace-nowrap border transition-colors ${showMap ? "bg-blue-500 text-white border-blue-500" : "border-[var(--color-border)] text-[var(--color-text-secondary)]"}`}
          >
            <Navigation className="w-3 h-3 inline mr-1" />
            地图
          </button>
        </div>

        {/* 地图显示 */}
        {showMap && (
          <div
            ref={mapContainerRef}
            className="w-full h-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-neutral-100)] mb-4"
          >
            {!mapLoaded && (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 bg-white rounded-lg animate-pulse border border-gray-100">
                <div className="h-4 bg-[var(--color-neutral-200)] rounded w-2/3 mb-2" />
                <div className="h-3 bg-[var(--color-neutral-200)] rounded w-full mb-2" />
                <div className="h-3 bg-[var(--color-neutral-200)] rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : resources.length === 0 ? (
          <Empty
            icon={<Package className="w-12 h-12" />}
            title="暂无相关资源"
            description="暂时没有可用的应急资源"
          />
        ) : (
          <div className="space-y-3">
            {resources.map((r) => (
              <div key={r.id} className="p-4 bg-white rounded-lg border border-gray-100">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-medium text-[var(--color-text-primary)] text-sm">{r.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${RESOURCE_STATUS_BADGE[r.status]}`}>
                    {RESOURCE_STATUS_LABEL[r.status]}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-secondary)] mb-1">{r.type}</p>
                {r.description && <p className="text-xs text-[var(--color-text-secondary)] mb-2 line-clamp-2">{r.description}</p>}
                {r.address && (
                  <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
                    <MapPin className="w-3 h-3" />
                    <span>{r.address}</span>
                  </div>
                )}
                {r.contactPhone && (
                  <div className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] mt-1">
                    <Phone className="w-3 h-3" />
                    <span>{r.contactPhone}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ResponseItem({
  response, currentUserId, onStatusChange,
}: {
  response: EmergencyResponse;
  currentUserId?: string;
  onStatusChange: () => void;
}) {
  const [updating, setUpdating] = useState(false);
  const isResponder = currentUserId === response.userId;

  const handleConfirmArrival = async () => {
    // 入口守卫：弱网下用户连点"确认到达"会触发多次 updateResponseStatus，状态机可能跳过中间状态
    // 设计原因：disabled 单一防御不足以阻断异步批处理窗口内的连点
    if (updating) return;
    setUpdating(true);
    try {
      await updateResponseStatus(response.id, { status: "arrived" });
      onStatusChange();
    } catch (err) {
      toast.error(getErrorMessage(err, "确认到达失败，请稍后重试"));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="p-3 bg-[var(--color-neutral-50)] rounded-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          {response.user?.nickname ?? "用户"}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${response.status === "accepted" ? "bg-blue-100 text-blue-700" : response.status === "arrived" ? "bg-green-100 text-green-700" : response.status === "completed" ? "bg-gray-100 text-gray-600" : "bg-yellow-100 text-yellow-700"}`}>
          {RESPONSE_STATUS_LABEL[response.status]}
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] mb-1">{response.message}</p>
      {response.eta != null && (
        <p className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1">
          <Clock className="w-3 h-3" />
          预计 {response.eta} 分钟到达
        </p>
      )}
      {isResponder && response.status === "accepted" && (
        <button
          onClick={handleConfirmArrival}
          disabled={updating}
          // 触摸目标提升：原 py-1.5 text-xs 偏小，改 py-2 text-sm 符合移动端最小可点击区域
          className="mt-2 px-4 py-2 bg-emerald-500 text-white text-sm rounded-full disabled:opacity-50"
        >
          {updating ? "处理中..." : "确认到达"}
        </button>
      )}
    </div>
  );
}

function DetailView({ requestId }: { requestId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState<EmergencyRequest | null>(null);
  const [loading, setLoading] = useState(true);
  // 加载错误信息：getRequest 失败时记录，用于优先于"不存在"分支展示真实错误
  const [error, setError] = useState("");
  const [responding, setResponding] = useState(false);
  const [responseMsg, setResponseMsg] = useState("");
  const [showRespondInput, setShowRespondInput] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewContent, setReviewContent] = useState("");
  const [showReportInput, setShowReportInput] = useState(false);
  const [reportReason, setReportReason] = useState("");
  // 举报提交中状态守卫：避免弱网下用户重复点击触发多次 submitFalseReport 请求
  // 设计原因：举报接口无幂等性保证，重复提交会产生多条举报记录污染审核队列
  const [reporting, setReporting] = useState(false);

  // 竞态守卫：跟踪当前活跃的 requestId，快速切换路由时旧请求返回不再覆盖新数据
  // 设计原因：fetchRequest 是 useCallback 依赖 requestId，切换路由会重新创建并触发新请求，
  // 但旧请求的 await 仍在进行中，完成后会 setRequest 旧数据覆盖新数据，导致显示内容与路由 id 不一致
  const activeRequestIdRef = useRef(requestId);

  const fetchRequest = useCallback(async () => {
    setLoading(true);
    // 清空历史错误，避免上一次失败的状态污染本次加载
    setError("");
    try {
      const res = await getRequest(requestId);
      // 竞态守卫：await 期间若 requestId 已变化，跳过 setState 避免旧数据覆盖新数据
      if (activeRequestIdRef.current !== requestId) return;
      setRequest(res.data);
    } catch (err: unknown) {
      if (activeRequestIdRef.current !== requestId) return;
      // 记录错误信息优先展示，避免被"求助信息不存在"分支掩盖真实原因（404/500/403）
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      // 仅当当前 requestId 仍为活跃时才更新 loading，避免旧请求的 finally 覆盖新请求的 loading 状态
      if (activeRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [requestId]);

  // 同步活跃 requestId 并触发请求：依赖 requestId 变化时重新拉取
  useEffect(() => {
    activeRequestIdRef.current = requestId;
    fetchRequest();
  }, [fetchRequest, requestId]);

  const handleRespond = async () => {
    // 入口守卫：弱网下用户连点"响应"会触发多次 respondToRequest，产生多个响应记录
    if (responding) return;
    if (!responseMsg.trim()) return;
    setResponding(true);
    try {
      await respondToRequest(requestId, { message: responseMsg.trim() });
      setShowRespondInput(false);
      setResponseMsg("");
      fetchRequest();
    } catch (err) {
      toast.error(getErrorMessage(err, "响应求助失败，请稍后重试"));
    } finally {
      setResponding(false);
    }
  };

  const handleComplete = async () => {
    // 入口守卫：弱网下用户连点"完成"会触发多次 updateResponseStatus，状态机可能跳过中间状态
    if (completing) return;
    const acceptedResponse = request?.responses.find((r) => r.status === "arrived");
    if (!acceptedResponse) return;
    setCompleting(true);
    try {
      await updateResponseStatus(acceptedResponse.id, {
        status: "completed",
        rating: reviewRating,
        review: reviewContent.trim() || undefined,
      });
      setCompleting(false);
      setReviewContent("");
      fetchRequest();
    } catch (err) {
      setCompleting(false);
      setError(err instanceof ApiError ? err.message : "完成操作失败");
    }
  };

  const handleReport = async () => {
    if (!reportReason.trim()) return;
    // 提交中守卫：避免重复点击触发多次请求
    if (reporting) return;
    setReporting(true);
    try {
      await submitFalseReport(requestId, reportReason.trim());
      setShowReportInput(false);
      setReportReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "举报提交失败");
    } finally {
      setReporting(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-4">
        <SkeletonDetail showImage showActions />
      </div>
    );
  }

  // 渲染优先级：!request && error 优先展示加载错误，避免被"不存在"分支掩盖真实原因
  // 设计原因：getRequest 失败时 request 仍为 null，若直接走 !request 分支会显示"求助信息不存在"，
  // 掩盖 404/500/403 等真实错误，影响用户排查问题
  if (!request && error) {
    return (
      <div className="px-4 py-12 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-red-500" />
        <p className="text-red-600 mb-3">{error}</p>
        <button
          onClick={() => navigate("/emergency")}
          className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-md text-sm hover:bg-[var(--color-primary-600)] transition-colors"
        >
          返回列表
        </button>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="px-4 py-12 text-center text-[var(--color-text-tertiary)]">
        <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-[var(--color-neutral-300)]" />
        <p>求助信息不存在</p>
      </div>
    );
  }

  const displayName = request.isAnonymous ? "匿名用户" : (request.user?.nickname ?? "未知用户");
  const myResponse = request.responses.find((r) => r.userId === user?.id);
  const isRequester = user?.id === request.userId;
  const hasArrivedResponse = request.responses.some((r) => r.status === "arrived");
  const canRespond = !myResponse && (request.status === "open" || request.status === "responding") && user;
  const canComplete = isRequester && hasArrivedResponse;

  return (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => navigate("/emergency")} className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] py-1 px-2 -ml-2 rounded hover:bg-[var(--color-neutral-100)] transition-colors">
        <ArrowLeft className="w-4 h-4" />
        返回列表
      </button>

      <div className="p-4 bg-white rounded-xl shadow-sm space-y-3">
        <div className="flex items-start justify-between">
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)] flex-1 mr-2">{request.title}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${URGENCY_BADGE[request.urgency]}`}>
            {URGENCY_LABEL[request.urgency]}
          </span>
        </div>

        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">{request.description}</p>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full ${STATUS_BADGE[request.status]}`}>
            {STATUS_LABEL[request.status]}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{request.category}</span>
          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
            {request.type === "emergency" ? "紧急求助" : "日常互助"}
          </span>
        </div>

        <div className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            <span>{displayName}</span>
          </div>
          {request.address && (
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              <span>{request.address}</span>
            </div>
          )}
          {request.contactPhone && (
            <div className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              <span>{request.contactPhone}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatRelativeTime(request.createdAt)}</span>
          </div>
        </div>

        {request.images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {/* 配图 alt 使用序号，屏幕阅读器可识别多张求助配图 */}
            {request.images.map((img, i) => (
              <img key={i} src={img} alt={`求助配图${i + 1}`} className="w-24 h-24 rounded-lg object-cover flex-shrink-0" />
            ))}
          </div>
        )}
      </div>

      {request.responses.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">响应列表</h2>
          <div className="space-y-2">
            {request.responses.map((resp) => (
              <ResponseItem
                key={resp.id}
                response={resp}
                currentUserId={user?.id}
                onStatusChange={fetchRequest}
              />
            ))}
          </div>
        </div>
      )}

      {canRespond && !showRespondInput && (
        <button
          onClick={() => setShowRespondInput(true)}
          className="w-full py-3 bg-emerald-500 text-white rounded-xl font-medium"
        >
          立即响应
        </button>
      )}

      {showRespondInput && (
        <div className="p-4 bg-white rounded-xl shadow-sm space-y-3">
          <textarea
            value={responseMsg}
            onChange={(e) => setResponseMsg(e.target.value)}
            placeholder="留言说明您能提供什么帮助..."
            rows={3}
            className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
          <div className="flex gap-2">
            {/* 触摸目标统一：与举报区"取消"按钮 py-2.5 保持一致，符合移动端最小可点击区域 */}
            <button onClick={() => setShowRespondInput(false)} className="flex-1 py-2.5 border border-[var(--color-border)] rounded-xl text-sm text-[var(--color-text-secondary)]">
              取消
            </button>
            <LoadingButton
              onClick={handleRespond}
              loading={responding}
              loadingText="提交中..."
              disabled={!responseMsg.trim()}
              fullWidth
            >
              确认响应
            </LoadingButton>
          </div>
        </div>
      )}

      {canComplete && (
        <div className="p-4 bg-white rounded-xl shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">完成互助并评价</h3>
          <StarRating value={reviewRating} onChange={setReviewRating} />
          <textarea
            value={reviewContent}
            onChange={(e) => setReviewContent(e.target.value)}
            placeholder="写下您的评价（选填）"
            rows={2}
            className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
          <LoadingButton
            onClick={handleComplete}
            loading={completing}
            loadingText="处理中..."
            fullWidth
          >
            完成互助
          </LoadingButton>
        </div>
      )}

      {request.reviews.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">评价</h2>
          {request.reviews.map((review) => (
            <div key={review.id} className="p-3 bg-white rounded-lg border border-gray-100">
              <div className="flex items-center gap-1 mb-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={`w-3.5 h-3.5 ${n <= review.rating ? "fill-yellow-400 text-yellow-400" : "text-[var(--color-neutral-300)]"}`} />
                ))}
              </div>
              {review.content && <p className="text-sm text-[var(--color-text-secondary)]">{review.content}</p>}
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">{formatRelativeTime(review.createdAt)}</p>
            </div>
          ))}
        </div>
      )}

      {!showReportInput ? (
        <button
          onClick={() => setShowReportInput(true)}
          // 触摸目标提升：原 text-xs underline 纯文字链接触摸区域过小，改 py-2 px-3 增大可点击范围
          className="text-xs text-[var(--color-text-tertiary)] underline py-2 px-1 mt-2 inline-block"
        >
          举报虚假信息
        </button>
      ) : (
        <div className="p-3 bg-red-50 rounded-lg space-y-2">
          <textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="请说明举报原因..."
            rows={2}
            className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none bg-white"
          />
          <div className="flex gap-2">
            <button onClick={() => { setShowReportInput(false); setReportReason(""); }} className="flex-1 py-2.5 border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-secondary)] bg-white">
              取消
            </button>
            <button
              onClick={handleReport}
              disabled={!reportReason.trim() || reporting}
              className="flex-1 py-2.5 bg-red-500 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {reporting ? "提交中..." : "提交举报"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ListView() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showResources, setShowResources] = useState(false);

  // 竞态守卫：跟踪当前活跃的 activeTab，快速切换 Tab 时旧请求返回不再覆盖新数据
  // 设计原因：fetchRequests 依赖 activeTab，切换 Tab 会重新创建并触发新请求，
  // 但旧请求的 await 仍在进行中，完成后会 setRequests 旧列表覆盖新列表
  const activeTabRef = useRef(activeTab);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = activeTab ? { type: activeTab } : undefined;
      const res = await getRequests(params);
      // 竞态守卫：await 期间若 activeTab 已变化，跳过 setState 避免旧列表覆盖新列表
      if (activeTabRef.current !== activeTab) return;
      setRequests(res.data.list);
    } catch (err) {
      if (activeTabRef.current !== activeTab) return;
      console.error("加载求助列表失败:", err);
      // 应急场景时效性高，加载失败需提示用户，避免误以为当前无求助
      toast.error(getErrorMessage(err, "加载求助列表失败，请稍后重试"));
    } finally {
      // 仅当当前 activeTab 仍为活跃时才更新 loading，避免旧请求的 finally 覆盖新请求的 loading 状态
      if (activeTabRef.current === activeTab) {
        setLoading(false);
      }
    }
  }, [activeTab]);

  // 同步活跃 activeTab 并触发请求：依赖 activeTab 变化时重新拉取
  useEffect(() => {
    activeTabRef.current = activeTab;
    fetchRequests();
  }, [fetchRequests, activeTab]);

  const tabLabel = activeTab === "emergency" ? "紧急求助" : activeTab === "daily" ? "日常互助" : "全部求助";

  return (
    <div className="px-4 lg:px-10 py-6 pb-24 lg:pb-12 max-w-6xl mx-auto">
      {/* 页面标题 + 操作
          flex-wrap：移动端窄屏按钮组自动换行，避免挤压标题
          gap-y-2：换行后行间距与列间距区分 */}
      <div className="flex items-end justify-between mb-6 lg:mb-8 flex-wrap gap-y-3">
        <div>
          <p className="text-xs tracking-widest text-neutral-400 mb-2 font-mono">—— 应急邻里</p>
          <h1 className="text-3xl lg:text-4xl font-semibold text-neutral-900 tracking-tight">
            {tabLabel}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => navigate("/emergency/resources/map")}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium hover:bg-emerald-100 transition-colors"
          >
            <MapIcon className="w-4 h-4" />
            资源地图
          </button>
          <button
            onClick={() => setShowResources(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-neutral-100 text-neutral-700 rounded-full text-sm font-medium hover:bg-neutral-200 transition-colors"
          >
            <Package className="w-4 h-4" />
            资源
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-full text-sm font-medium hover:bg-red-600 transition-colors"
          >
            <Siren className="w-4 h-4" />
            求助
          </button>
        </div>
      </div>

      {/* Tab 切换：下划线式 */}
      {/* overflow-x-auto + whitespace-nowrap：移动端窄屏 Tab 文字不换行、可横向滚动，避免下划线动效错位 */}
      <div className="flex items-center gap-6 border-b border-neutral-200 mb-6 overflow-x-auto pb-1">
        {TABS.map(({ key, label }) => (
          <button
            key={label}
            onClick={() => setActiveTab(key)}
            className={`relative pb-3 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === key ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"
            }`}
          >
            {label}
            <span
              className={`absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-900 transition-transform duration-200 ${
                activeTab === key ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        ))}
      </div>

      {/* 列表区 */}
      {loading ? (
        <SkeletonListCard count={3} />
      ) : requests.length === 0 ? (
        <Empty
          icon={<Heart className="w-10 h-10" />}
          title="暂无求助信息"
          description="成为第一个伸出援手的人吧"
        />
      ) : (
        // 列表项自带分隔线，外层仅纵向排列
        <div className="flex flex-col">
          {requests.map((req) => <RequestCard key={req.id} request={req} />)}
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onSuccess={fetchRequests} />}
      {showResources && <ResourceModal onClose={() => setShowResources(false)} />}
    </div>
  );
}

export default function Emergency() {
  const { id } = useParams<{ id: string }>();

  if (id) return <DetailView requestId={id} />;
  return <ListView />;
}
