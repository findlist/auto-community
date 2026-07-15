import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Users,
  Check,
  X,
  Loader2,
  AlertCircle,
  UserPlus,
  UserMinus,
  ArrowRightLeft,
} from "lucide-react";
import {
  getFamilyBindings,
  createFamilyBinding,
  confirmFamilyBinding,
  rejectFamilyBinding,
  unbindFamilyBinding,
} from "@/api/timeBank";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/Toast";
import Empty from "@/components/Empty";
import type { FamilyBinding as FamilyBindingType } from "@/types";

// 状态展示配置：统一管理颜色与文案，避免散落在 JSX 中难维护
const statusConfig: Record<FamilyBindingType["status"], { label: string; color: string }> = {
  pending: { label: "待确认", color: "bg-amber-100 text-amber-700" },
  confirmed: { label: "已绑定", color: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "已拒绝", color: "bg-neutral-100 text-neutral-500" },
  unbound: { label: "已解绑", color: "bg-neutral-100 text-neutral-500" },
};

// 关系选项：覆盖常见家庭角色，避免硬编码只有父母
const relationshipOptions = [
  { value: "father", label: "父亲" },
  { value: "mother", label: "母亲" },
  { value: "spouse", label: "配偶" },
  { value: "child", label: "子女" },
  { value: "sibling", label: "兄弟姐妹" },
  { value: "other", label: "其他" },
];

const relationshipLabel = (value: string) =>
  relationshipOptions.find(o => o.value === value)?.label ?? value;

// 顶部筛选 Tab：全部 / 待我确认 / 我发起的 / 已绑定
const filterTabs = [
  { key: "all", label: "全部" },
  { key: "incoming", label: "待我确认" },
  { key: "outgoing", label: "我发起的" },
  { key: "confirmed", label: "已绑定" },
] as const;

type FilterKey = typeof filterTabs[number]["key"];

// 手机号校验：11 位数字，避免提交非法格式
const isPhoneValid = (phone: string) => /^1\d{10}$/.test(phone);

export default function FamilyBindingPage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();

  const [bindings, setBindings] = useState<FamilyBindingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  // 解绑确认弹窗状态：unbindingId 非 null 时展示弹窗，unbinding 标记请求中态
  const [unbindingId, setUnbindingId] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState(false);

  // 表单状态
  const [parentPhone, setParentPhone] = useState("");
  const [relationship, setRelationship] = useState("father");
  const [formError, setFormError] = useState<string | null>(null);

  const loadBindings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getFamilyBindings();
      setBindings(res.data);
    } catch (err: unknown) {
      // 加载失败展示错误状态，供用户重试，而不是静默失败
      const message = err instanceof Error ? err.message : "加载绑定列表失败";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    loadBindings();
  }, [isAuthenticated, navigate, loadBindings]);

  // 客户端筛选：减少后端请求，列表数据量小可一次拉全
  const filteredBindings = useMemo(() => {
    if (activeFilter === "all") return bindings;
    if (activeFilter === "confirmed") {
      return bindings.filter(b => b.status === "confirmed");
    }
    if (activeFilter === "incoming") {
      // 对方绑我为家长、且状态为 pending：需要我确认
      return bindings.filter(b => b.parentId === user?.id && b.status === "pending");
    }
    // outgoing：我发起的（我是 user_id）
    return bindings.filter(b => b.userId === user?.id);
  }, [bindings, activeFilter, user?.id]);

  // 各 Tab 数量统计，用于在 Tab 标签上展示计数
  const tabCounts = useMemo(() => {
    const counts = { all: bindings.length, incoming: 0, outgoing: 0, confirmed: 0 };
    for (const b of bindings) {
      if (b.parentId === user?.id && b.status === "pending") counts.incoming++;
      if (b.userId === user?.id) counts.outgoing++;
      if (b.status === "confirmed") counts.confirmed++;
    }
    return counts;
  }, [bindings, user?.id]);

  const handleCreate = async () => {
    // 字段级校验：手机号格式不合法时直接拦截
    const trimmedPhone = parentPhone.trim();
    if (!trimmedPhone) {
      setFormError("请输入家长手机号");
      return;
    }
    if (!isPhoneValid(trimmedPhone)) {
      setFormError("手机号格式不正确（需为 11 位数字）");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await createFamilyBinding(trimmedPhone, relationship);
      toast.success("绑定申请已发起");
      setParentPhone("");
      await loadBindings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "发起绑定失败，请重试";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (id: string) => {
    try {
      await confirmFamilyBinding(id);
      toast.success("已确认绑定");
      await loadBindings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "操作失败，请重试";
      toast.error(message);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectFamilyBinding(id);
      toast.success("已拒绝绑定");
      await loadBindings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "操作失败，请重试";
      toast.error(message);
    }
  };

  // 解绑确认后的实际请求：关闭弹窗 → 调用 API → 刷新列表
  const handleUnbindConfirm = async () => {
    if (!unbindingId) return;
    setUnbinding(true);
    try {
      await unbindFamilyBinding(unbindingId);
      toast.success("已解除绑定");
      setUnbindingId(null);
      await loadBindings();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "解绑失败，请重试";
      toast.error(message);
    } finally {
      setUnbinding(false);
    }
  };

  // 加载中：使用 Loader2 animate-spin，符合项目规范
  if (loading && bindings.length === 0) {
    return (
      <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
        <Header onBack={() => navigate(-1)} />
        <div className="flex flex-col items-center justify-center py-20 gap-2" role="status">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          <span className="text-sm text-neutral-400">正在加载...</span>
        </div>
      </div>
    );
  }

  // 错误状态：使用 AlertCircle + 红色背景
  if (error) {
    return (
      <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
        <Header onBack={() => navigate(-1)} />
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-red-700 font-medium">加载失败</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
            <button
              onClick={loadBindings}
              className="mt-3 px-3 py-1.5 bg-red-600 text-white rounded-md text-xs hover:bg-red-700 transition-colors"
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4 pb-24 max-w-2xl mx-auto">
      <Header onBack={() => navigate(-1)} />

      {/* 发起绑定表单卡片 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-neutral-100 mb-6">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-emerald-600" />
          发起亲情绑定
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-neutral-500 mb-1">家长手机号</label>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={11}
              value={parentPhone}
              onChange={e => {
                // 仅允许数字输入，避免用户输入字母或符号
                setParentPhone(e.target.value.replace(/\D/g, ""));
                if (formError) setFormError(null);
              }}
              placeholder="请输入家长手机号"
              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-500 mb-1">关系</label>
            <select
              value={relationship}
              onChange={e => setRelationship(e.target.value)}
              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent cursor-pointer"
            >
              {relationshipOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {formError && (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{formError}</span>
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={submitting}
            className="w-full py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                提交中...
              </>
            ) : (
              "发起绑定"
            )}
          </button>
        </div>
      </div>

      {/* 筛选 Tab：下划线式，与列表页风格一致 */}
      <div className="flex items-center gap-4 border-b border-neutral-200 mb-4 overflow-x-auto">
        {filterTabs.map(({ key, label }) => {
          const count = tabCounts[key];
          const active = activeFilter === key;
          return (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className={`relative pb-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                active ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"
              }`}
            >
              {label}
              {count > 0 && (
                <span className={`ml-1 text-xs ${active ? "text-emerald-600" : "text-neutral-400"}`}>
                  ({count})
                </span>
              )}
              <span
                className={`absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-900 transition-transform duration-200 ${
                  active ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* 绑定列表 */}
      <div className="space-y-3">
        {filteredBindings.map(binding => {
          const cfg = statusConfig[binding.status] ?? { label: binding.status, color: "bg-neutral-100 text-neutral-500" };
          // 当前用户是家长 → 需要我来确认；否则为自己发起
          const isParent = user?.id === binding.parentId;
          const direction = isParent ? "待我确认" : "我发起的";

          return (
            <div key={binding.id} className="bg-white rounded-xl p-4 shadow-sm border border-neutral-100">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* 对方头像 */}
                  <div className="w-10 h-10 rounded-full bg-neutral-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                    {/* 头像 alt 使用用户昵称，屏幕阅读器可识别家属身份 */}
                    {binding.other?.avatar ? (
                      <img src={binding.other.avatar} alt={binding.other.nickname ? `${binding.other.nickname}的头像` : "用户头像"} className="w-full h-full object-cover" />
                    ) : (
                      <Users className="w-5 h-5 text-neutral-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-neutral-900 truncate">
                        {binding.other?.nickname || "未知用户"}
                      </span>
                      <span className="text-xs text-neutral-400">{relationshipLabel(binding.relationship)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-neutral-400 mt-0.5">
                      <ArrowRightLeft className="w-3 h-3" />
                      {direction}
                    </div>
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${cfg.color} flex-shrink-0`}>{cfg.label}</span>
              </div>

              <p className="text-xs text-neutral-400 mb-3">
                {new Date(binding.createdAt).toLocaleString("zh-CN")}
              </p>

              {/* 仅当对方绑我为家长且状态为 pending 时，才展示确认/拒绝按钮 */}
              {binding.status === "pending" && isParent && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirm(binding.id)}
                    className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1 hover:bg-emerald-700 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    确认
                  </button>
                  <button
                    onClick={() => handleReject(binding.id)}
                    className="flex-1 py-2 bg-neutral-100 text-neutral-600 rounded-lg text-sm font-medium flex items-center justify-center gap-1 hover:bg-neutral-200 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    拒绝
                  </button>
                </div>
              )}

              {/* 已确认绑定的双方均可发起解绑，二次确认避免误操作 */}
              {binding.status === "confirmed" && (
                <button
                  onClick={() => setUnbindingId(binding.id)}
                  className="w-full py-2 bg-red-50 text-red-600 rounded-lg text-sm font-medium flex items-center justify-center gap-1 hover:bg-red-100 transition-colors"
                >
                  <UserMinus className="w-3.5 h-3.5" />
                  解除绑定
                </button>
              )}
            </div>
          );
        })}

        {/* 空状态：使用 Empty 组件，符合项目规范 */}
        {filteredBindings.length === 0 && (
          <Empty
            variant="default"
            title={activeFilter === "all" ? "暂无绑定记录" : "该分类下暂无记录"}
            description="发起亲情绑定后，可与家人共享时间账户"
          />
        )}
      </div>

      {/* 解绑确认弹窗：二次确认避免误操作，点击遮罩或取消按钮关闭 */}
      {unbindingId && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
          onClick={() => !unbinding && setUnbindingId(null)}
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <h3 className="text-base font-semibold text-neutral-900">确认解除绑定</h3>
            </div>
            <p className="text-sm text-neutral-500 mb-5">
              解除后将与对方取消亲情绑定关系，对方将收到通知。此操作不可撤销。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setUnbindingId(null)}
                disabled={unbinding}
                className="flex-1 py-2.5 bg-neutral-100 text-neutral-600 rounded-lg text-sm font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleUnbindConfirm}
                disabled={unbinding}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {unbinding ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    解绑中...
                  </>
                ) : (
                  "确认解绑"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 顶部标题栏：抽取为内部组件，避免主组件 JSX 过长
function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <button onClick={onBack} className="text-neutral-500 hover:text-neutral-700 transition-colors" aria-label="返回">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="text-lg font-semibold text-neutral-900">亲情绑定</h1>
    </div>
  );
}
