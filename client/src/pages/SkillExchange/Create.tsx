import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { createPost } from "@/api/skills";
import { useFormValidation } from "@/hooks/useFormValidation";
import { validateRequired, validateMinLength, validateMaxLength, validatePrice, validateRange } from "@/utils/formValidation";
import ImageUpload from "@/components/Upload/ImageUpload";
import { toast } from "@/components/Toast";

const categories = [
  "电脑维修", "家政服务", "教育培训", "运动健身",
  "音乐艺术", "语言翻译", "法律咨询", "其他",
];

export default function Create() {
  const navigate = useNavigate();
  const [type, setType] = useState<"offer" | "request">("offer");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [creditPrice, setCreditPrice] = useState("");
  const [location, setLocation] = useState("");
  // 图片列表：由 ImageUpload 组件管理上传，提交时一并传给后端
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fieldConfigs = useMemo(() => ({
    title: {
      value: title,
      rules: [
        (v: string) => validateRequired(v, "标题"),
        (v: string) => validateMinLength(v, 2, "标题"),
        (v: string) => validateMaxLength(v, 50, "标题"),
      ],
    },
    description: {
      value: description,
      rules: [
        (v: string) => validateMinLength(v, 10, "详细描述"),
        (v: string) => validateMaxLength(v, 500, "详细描述"),
      ],
    },
    category: {
      value: category,
      rules: [(v: string) => validateRequired(v, "分类")],
    },
    creditPrice: {
      value: creditPrice,
      rules: type === "offer" ? [
        (v: string) => validateRequired(v, "积分价格"),
        (v: string) => validatePrice(v),
        (v: string) => validateRange(Number(v), 1, 10000, "积分价格"),
      ] : [],
    },
  }), [title, description, category, creditPrice, type]);

  const { setTouched, getFieldError, validateAll } = useFormValidation(fieldConfigs);

  const handleSubmit = async () => {
    if (!validateAll()) return;

    setSubmitting(true);
    try {
      await createPost({
        type,
        title: title.trim(),
        description: description.trim(),
        category,
        creditsRequired: Number(creditPrice) || 0,
        location: location.trim() || undefined,
        // 仅在有图片时传 images，避免发送空数组
        images: images.length > 0 ? images : undefined,
      });
      toast.success("发布成功");
      navigate("/skills");
    } catch (error: any) {
      toast.error(error.message || "发布失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // max-w-2xl mx-auto：表单页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="pb-24 max-w-2xl mx-auto">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-100">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-lg font-medium text-gray-900">发布技能</h1>
      </div>

      <div className="p-4">
        <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
          <button
            onClick={() => setType("offer")}
            className={`flex-1 py-2 rounded-md transition-colors text-sm ${
              type === "offer" ? "bg-emerald-600 text-white" : "text-gray-600"
            }`}
          >
            提供技能
          </button>
          <button
            onClick={() => setType("request")}
            className={`flex-1 py-2 rounded-md transition-colors text-sm ${
              type === "request" ? "bg-emerald-600 text-white" : "text-gray-600"
            }`}
          >
            需求技能
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => setTouched("title")}
              placeholder={type === "offer" ? "例如：擅长电脑维修、系统安装" : "例如：想学英语、需要家教"}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm ${getFieldError("title") ? "border-red-500" : "border-gray-200"}`}
            />
            {getFieldError("title") && <p className="text-red-500 text-xs mt-1">{getFieldError("title")}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">详细描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => setTouched("description")}
              placeholder="详细描述你的技能或需求..."
              className={`w-full px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm ${getFieldError("description") ? "border-red-500" : "border-gray-200"}`}
              rows={4}
            />
            {getFieldError("description") && <p className="text-red-500 text-xs mt-1">{getFieldError("description")}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              分类 <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => { setCategory(cat); setTouched("category"); }}
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    category === cat
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            {getFieldError("category") && <p className="text-red-500 text-xs mt-1">{getFieldError("category")}</p>}
          </div>

          {type === "offer" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                积分价格 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={creditPrice}
                onChange={e => setCreditPrice(e.target.value)}
                onBlur={() => setTouched("creditPrice")}
                placeholder="设置每次服务的积分价格"
                min={1}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm ${getFieldError("creditPrice") ? "border-red-500" : "border-gray-200"}`}
              />
              {getFieldError("creditPrice") && <p className="text-red-500 text-xs mt-1">{getFieldError("creditPrice")}</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">服务地址</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="如：3号楼1单元（选填）"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">图片（选填）</label>
            <ImageUpload value={images} onChange={setImages} maxCount={5} />
          </div>
        </div>
      </div>

      <div className="fixed bottom-16 left-0 right-0 bg-white border-t px-4 py-3">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
          {submitting ? "发布中..." : "立即发布"}
        </button>
      </div>
    </div>
  );
}
