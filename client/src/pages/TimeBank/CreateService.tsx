import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Clock, AlertCircle, Loader2 } from "lucide-react";
import { createService } from "@/api/timeBank";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { useFormValidation } from "@/hooks/useFormValidation";
import { validateRequired, validateMinLength, validateMaxLength, validateRange } from "@/utils/formValidation";
import ImageUpload from "@/components/Upload/ImageUpload";

export default function CreateService() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  // 表单级错误：替代原生 alert，与项目其他页面风格一致（红色背景 + AlertCircle）
  const [formError, setFormError] = useState<string | null>(null);
  // 图片列表：由 ImageUpload 组件管理上传，提交时一并传给后端
  const [images, setImages] = useState<string[]>([]);
  const [form, setForm] = useState({
    type: "provide" as "provide" | "request",
    category: "",
    title: "",
    description: "",
    durationMinutes: "",
    location: "",
  });

  // 登录校验放在 useEffect 中，避免渲染期间触发副作用
  useEffect(() => {
    if (!isAuthenticated) navigate("/login");
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const fieldConfigs = useMemo(() => ({
    title: {
      value: form.title,
      rules: [
        (v: string) => validateRequired(v, "标题"),
        (v: string) => validateMinLength(v, 2, "标题"),
        (v: string) => validateMaxLength(v, 50, "标题"),
      ],
    },
    category: {
      value: form.category,
      rules: [(v: string) => validateRequired(v, "分类")],
    },
    description: {
      value: form.description,
      rules: [
        (v: string) => validateMinLength(v, 10, "描述"),
        (v: string) => validateMaxLength(v, 500, "描述"),
      ],
    },
    durationMinutes: {
      value: form.durationMinutes,
      rules: [
        (v: string) => validateRequired(v, "服务时长"),
        (v: string) => validateRange(Number(v), 1, 480, "服务时长"),
      ],
    },
  }), [form.title, form.category, form.description, form.durationMinutes]);

  const { setTouched, getFieldError, validateAll } = useFormValidation(fieldConfigs);

  const handleSubmit = async () => {
    if (!validateAll() || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createService({
        type: form.type,
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category.trim(),
        durationMinutes: Number(form.durationMinutes),
        location: form.location.trim() || undefined,
        // 仅在有图片时传 images，避免发送空数组
        images: images.length > 0 ? images : undefined,
      });
      toast.success("服务发布成功");
      navigate("/time-bank");
    } catch (err) {
      // ApiError 精准提取后端错误消息，兜底通用提示
      setFormError(err instanceof ApiError ? err.message : "发布失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // max-w-2xl mx-auto：表单页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">发布服务</h1>
      </div>

      {formError && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {formError}
        </div>
      )}

      <div className="bg-white rounded-lg p-4 shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">服务类型</label>
          <div className="flex gap-3">
            {([["provide", "提供服务"], ["request", "需求服务"]] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => updateField("type", val)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  form.type === val
                    ? "bg-emerald-600 text-white"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">分类 *</label>
          <input
            type="text"
            value={form.category}
            onChange={e => updateField("category", e.target.value)}
            onBlur={() => setTouched("category")}
            placeholder="如：家政服务、教育培训"
            className={`w-full px-3 py-2.5 bg-gray-50 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("category") ? "border-red-500" : "border-gray-200"}`}
          />
          {getFieldError("category") && <p className="text-red-500 text-xs mt-1">{getFieldError("category")}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">标题 *</label>
          <input
            type="text"
            value={form.title}
            onChange={e => updateField("title", e.target.value)}
            onBlur={() => setTouched("title")}
            placeholder="请输入服务标题"
            className={`w-full px-3 py-2.5 bg-gray-50 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("title") ? "border-red-500" : "border-gray-200"}`}
          />
          {getFieldError("title") && <p className="text-red-500 text-xs mt-1">{getFieldError("title")}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
          <textarea
            value={form.description}
            onChange={e => updateField("description", e.target.value)}
            onBlur={() => setTouched("description")}
            placeholder="详细描述您提供的服务内容"
            rows={4}
            className={`w-full px-3 py-2.5 bg-gray-50 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none ${getFieldError("description") ? "border-red-500" : "border-gray-200"}`}
          />
          {getFieldError("description") && <p className="text-red-500 text-xs mt-1">{getFieldError("description")}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            预计时长（分钟）*
          </label>
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="number"
              value={form.durationMinutes}
              onChange={e => updateField("durationMinutes", e.target.value)}
              onBlur={() => setTouched("durationMinutes")}
              placeholder="60"
              min="1"
              className={`w-full pl-9 pr-3 py-2.5 bg-gray-50 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("durationMinutes") ? "border-red-500" : "border-gray-200"}`}
            />
          </div>
          {getFieldError("durationMinutes") && <p className="text-red-500 text-xs mt-1">{getFieldError("durationMinutes")}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">服务地址</label>
          <input
            type="text"
            value={form.location}
            onChange={e => updateField("location", e.target.value)}
            placeholder="请输入服务地址（选填）"
            className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">服务配图</label>
          <ImageUpload
            value={images}
            onChange={setImages}
            maxCount={5}
            onError={(msg) => toast.error(msg)}
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full mt-6 py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {submitting ? "提交中..." : "发布服务"}
      </button>
    </div>
  );
}
