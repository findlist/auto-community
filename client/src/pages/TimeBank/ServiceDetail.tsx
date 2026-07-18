import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Star, MapPin, Clock, ArrowLeft, Pencil, X, Save, Loader2, AlertCircle } from "lucide-react";
import { getService, createOrder, updateService } from "@/api/timeBank";
import { ApiError } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/utils/format";
import { toast } from "@/components/Toast";
import AIRecommend from "@/components/AIRecommend";
import Empty from "@/components/Empty";
import ImageUpload from "@/components/Upload/ImageUpload";
import type { TimeService } from "@/types";

function DetailSkeleton() {
  return (
    <div className="p-4">
      <div className="animate-pulse space-y-4">
        {/* 骨架灰阶对齐设计令牌 neutral-200，与 SharedKitchen/Detail 加载骨架一致 */}
        <div className="h-6 bg-neutral-200 rounded w-3/4" />
        <div className="h-4 bg-neutral-200 rounded w-1/2" />
        <div className="h-32 bg-neutral-200 rounded" />
      </div>
    </div>
  );
}

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const [service, setService] = useState<TimeService | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [error, setError] = useState("");
  // 编辑弹窗状态：editing 控制弹窗显隐，saving 标记提交中避免重复请求
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    getService(id)
      .then(res => { if (!cancelled) setService(res.data); })
      .catch((err) => {
        console.error("加载时间银行服务详情失败:", err);
        if (!cancelled) setError("加载失败");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const handleCreateOrder = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      await createOrder({ serviceId: id });
      setOrderSuccess(true);
      toast.success("需求已发布，等待响应");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "发起请求失败";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // 提交编辑：调用 updateService，成功后同步 service state 并关闭弹窗
  // 设计原因：仅在发布者本人且服务 active 时可编辑，与后端权限校验一致
  const handleEditSubmit = async (form: {
    type: "provide" | "request";
    category: string;
    title: string;
    description: string;
    durationMinutes: number;
    address?: string;
    images: string[];
  }) => {
    if (!id || saving) return;
    setSaving(true);
    try {
      const res = await updateService({
        id,
        type: form.type,
        category: form.category,
        title: form.title,
        description: form.description,
        durationMinutes: form.durationMinutes,
        address: form.address,
        images: form.images,
      });
      setService(res.data);
      toast.success("服务已更新");
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "更新失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <DetailSkeleton />;

  if (error || !service) {
    return (
      <div className="p-4">
        <Empty
          variant="default"
          title="服务不存在"
          description="该服务可能已下架或被删除"
          action={
            <button
              onClick={() => navigate("/time-bank")}
              className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-md text-sm hover:bg-[var(--color-primary-600)] transition-colors"
            >
              返回列表
            </button>
          }
        />
      </div>
    );
  }

  const isProvide = service.type === "provide";

  return (
    // max-w-2xl mx-auto：详情页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="pb-20 max-w-2xl mx-auto">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-neutral-100">
        <button onClick={() => navigate(-1)} aria-label="返回" className="p-2.5 hover:bg-neutral-100 rounded transition-colors">
          <ArrowLeft className="w-5 h-5 text-neutral-600" />
        </button>
        <h1 className="text-lg font-medium text-neutral-900 flex-1 truncate">{service.title}</h1>
        {/* 仅发布者本人且服务处于 active 时可编辑，与后端 updateService 权限校验一致 */}
        {user && service.userId === user.id && service.status === "active" && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-violet-600 border border-violet-200 rounded-lg hover:bg-violet-50 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            编辑
          </button>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              {/* 类型徽章：提供=翡翠绿（积极给出），需求=时间银行模块紫，与 ServiceCard 竖条配色一致 */}
              <span
                className={`inline-block px-2 py-0.5 text-xs rounded ${
                  isProvide ? "bg-emerald-50 text-emerald-600" : "bg-violet-50 text-violet-600"
                }`}
              >
                {isProvide ? "提供服务" : "需要服务"}
              </span>
              <span className="inline-block px-2 py-0.5 bg-neutral-100 text-neutral-600 text-xs rounded">
                {service.category}
              </span>
            </div>
            <h2 className="text-xl font-bold text-neutral-900 mb-1">{service.title}</h2>
          </div>
          <div className="text-lg font-bold text-violet-600 whitespace-nowrap ml-4">
            {formatTime(service.durationMinutes)}
          </div>
        </div>

        <div className="bg-neutral-50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-neutral-700 mb-2">详细描述</h3>
          <p className="text-neutral-600 text-sm leading-relaxed">{service.description}</p>
        </div>

        {/* 服务配图：仅在有图片时渲染，使用网格布局适配多图 */}
        {service.images && service.images.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-neutral-700 mb-2">服务配图</h3>
            <div className="grid grid-cols-3 gap-2">
              {service.images.map((img, idx) => (
                <img
                  key={idx}
                  src={img}
                  alt={`服务配图${idx + 1}`}
                  className="w-full aspect-square object-cover rounded-lg bg-neutral-100"
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 mb-4">
          {(service.location || service.address) && (
            <div className="flex items-center gap-2 text-neutral-600 text-sm">
              <MapPin className="w-4 h-4 text-neutral-400" />
              <span>{service.location || service.address}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-neutral-600 text-sm">
            <Clock className="w-4 h-4 text-neutral-400" />
            <span>{new Date(service.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-neutral-50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-neutral-700 mb-3">发布者信息</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-200 overflow-hidden">
              {/* 头像 alt 使用用户昵称，屏幕阅读器可识别服务发布者身份 */}
              {service.user?.avatar && (
                <img src={service.user.avatar} alt={service.user.nickname ? `${service.user.nickname}的头像` : "用户头像"} className="w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium text-neutral-900">{service.user?.nickname}</div>
              {service.user?.reputationScore != null && (
                <div className="flex items-center gap-1 text-sm text-amber-500 mt-0.5">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  <span>信誉分 {service.user.reputationScore}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI 智能推荐 */}
        <div className="mt-4">
          <AIRecommend postId={id!} type="time-bank" title="可能感兴趣的人" />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-4 py-3">
        {orderSuccess ? (
          <div className="text-center text-emerald-600 font-medium py-2">
            请求已发起成功！
          </div>
        ) : !isAuthenticated ? (
          <div className="text-center text-neutral-500 py-2">请先登录后再发起请求</div>
        ) : (
          <button
            onClick={handleCreateOrder}
            disabled={submitting || service.status !== "active"}
            // 发起请求按钮使用时间银行模块紫，与 CreateService 提交按钮配色一致
            className="w-full py-3 bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "提交中..." : "发起请求"}
          </button>
        )}
      </div>

      {/* 编辑服务弹窗：仅发布者可见入口，复用 ImageUpload 管理配图 */}
      {editing && service && (
        <EditServiceModal
          service={service}
          saving={saving}
          onClose={() => setEditing(false)}
          onSave={handleEditSubmit}
        />
      )}
    </div>
  );
}

// ===================== 编辑服务弹窗子组件 =====================

interface EditServiceModalProps {
  service: TimeService;
  saving: boolean;
  onClose: () => void;
  onSave: (form: {
    type: "provide" | "request";
    category: string;
    title: string;
    description: string;
    durationMinutes: number;
    address?: string;
    images: string[];
  }) => void;
}

function EditServiceModal({ service, saving, onClose, onSave }: EditServiceModalProps) {
  // 预填当前服务数据：address 兜底取 location，兼容历史数据两字段并存
  const [type, setType] = useState<"provide" | "request">(service.type);
  const [category, setCategory] = useState(service.category);
  const [title, setTitle] = useState(service.title);
  const [description, setDescription] = useState(service.description);
  const [durationMinutes, setDurationMinutes] = useState(String(service.durationMinutes));
  const [address, setAddress] = useState(service.address || service.location || "");
  const [images, setImages] = useState<string[]>(service.images || []);
  const [formError, setFormError] = useState<string | null>(null);

  // 字段级校验：与 CreateService 保持一致规则，确保编辑前后数据约束统一
  const validate = (): string | null => {
    if (!title.trim()) return "标题不能为空";
    if (title.trim().length < 2) return "标题至少 2 个字符";
    if (title.trim().length > 50) return "标题不能超过 50 个字符";
    if (!category.trim()) return "分类不能为空";
    // 描述为选填，非空时才校验长度
    if (description.trim().length > 0 && description.trim().length < 10) return "描述至少 10 个字符";
    if (description.trim().length > 500) return "描述不能超过 500 个字符";
    const duration = Number(durationMinutes);
    if (!durationMinutes || isNaN(duration)) return "请输入服务时长";
    if (duration < 1 || duration > 480) return "服务时长需在 1-480 分钟之间";
    return null;
  };

  const error = validate();

  const handleSubmit = () => {
    if (error || saving) return;
    setFormError(null);
    onSave({
      type,
      category: category.trim(),
      title: title.trim(),
      description: description.trim(),
      durationMinutes: Number(durationMinutes),
      address: address.trim() || undefined,
      images,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-md p-5 shadow-lg my-8">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold text-neutral-800">编辑服务</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600" disabled={saving}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">服务类型</label>
            <div className="flex gap-3">
              {([["provide", "提供服务"], ["request", "需求服务"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setType(val)}
                  // 编辑弹窗内类型切换同样使用时间银行模块紫，与 CreateService 保持一致
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    type === val ? "bg-violet-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">分类 *</label>
            <input
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="如：家政服务、教育培训"
              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/15 focus:border-violet-400 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">标题 *</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="请输入服务标题"
              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/15 focus:border-violet-400 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="详细描述服务内容"
              rows={4}
              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/15 focus:border-violet-400 transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">预计时长（分钟）*</label>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="number"
                value={durationMinutes}
                onChange={e => setDurationMinutes(e.target.value)}
                min="1"
                className="w-full pl-9 pr-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/15 focus:border-violet-400 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">服务地址</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="请输入服务地址（选填）"
              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/15 focus:border-violet-400 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">服务配图</label>
            <ImageUpload
              value={images}
              onChange={setImages}
              maxCount={5}
              onError={(msg) => toast.error(msg)}
            />
          </div>
        </div>

        {/* 字段级错误提示：AlertCircle 红色背景，符合项目错误提示规范 */}
        {(formError || error) && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{formError || error}</p>
          </div>
        )}

        <div className="flex gap-2 justify-end mt-5">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!!error || saving}
            // 保存按钮使用时间银行模块紫，与 CreateService 提交按钮一致
            className="px-4 py-2 text-sm text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
