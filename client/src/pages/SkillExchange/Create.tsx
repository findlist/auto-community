import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { createPost } from "@/api/skills";
import { useFormValidation } from "@/hooks/useFormValidation";
import { validateRequired, validateMinLength, validateMaxLength, validatePrice, validateRange } from "@/utils/formValidation";
import ImageUpload from "@/components/Upload/ImageUpload";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

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
    // 入口守卫：与按钮 disabled 形成双重防御，避免弱网下连点产生多条技能帖子
    // 设计原因：createPost 是创建非幂等资源，重复触发会污染列表并浪费审核资源
    if (submitting) return;
    if (!validateAll()) return;

    setSubmitting(true);
    try {
      await createPost({
        type,
        title: title.trim(),
        description: description.trim(),
        category,
        creditPrice: Number(creditPrice) || 0,
        location: location.trim() || undefined,
        // 仅在有图片时传 images，避免发送空数组
        images: images.length > 0 ? images : undefined,
      });
      toast.success("发布成功");
      navigate("/skills");
    } catch (error) {
      toast.error(getErrorMessage(error, "发布失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // max-w-2xl mx-auto：表单页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="pb-24 max-w-2xl mx-auto">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-neutral-100">
        {/* 触控区域标准：py-1.5 px-2 ≥40px，-ml-2 抵消父容器 px-4 保持视觉对齐 */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 py-1.5 px-2 -ml-2 rounded text-neutral-600 hover:bg-neutral-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          返回
        </button>
        <h1 className="text-lg font-medium text-neutral-900">发布技能</h1>
      </div>

      <div className="p-4">
        <div className="flex bg-neutral-100 rounded-lg p-1 mb-6">
          <button
            onClick={() => setType("offer")}
            // 类型切换激活态使用技能模块蓝，与列表页 Tab 下划线 bg-blue-600 一致
            className={`flex-1 py-2 rounded-md transition-colors text-sm ${
              type === "offer" ? "bg-blue-600 text-white" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            提供技能
          </button>
          <button
            onClick={() => setType("request")}
            className={`flex-1 py-2 rounded-md transition-colors text-sm ${
              type === "request" ? "bg-blue-600 text-white" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            需求技能
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={() => setTouched("title")}
              placeholder={type === "offer" ? "例如：擅长电脑维修、系统安装" : "例如：想学英语、需要家教"}
              // 焦点环改用技能模块蓝 15% 透明度光晕 + 400 阶边框，与列表页搜索框 focus:ring-blue-500/15 一致
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 transition-all text-sm ${getFieldError("title") ? "border-red-500" : "border-neutral-200"}`}
            />
            {getFieldError("title") && <p className="text-red-500 text-xs mt-1">{getFieldError("title")}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">详细描述</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => setTouched("description")}
              placeholder="详细描述你的技能或需求..."
              className={`w-full px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 transition-all text-sm ${getFieldError("description") ? "border-red-500" : "border-neutral-200"}`}
              rows={4}
            />
            {getFieldError("description") && <p className="text-red-500 text-xs mt-1">{getFieldError("description")}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              分类 <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => { setCategory(cat); setTouched("category"); }}
                  // 分类按钮激活态使用技能模块蓝浅色变体，与列表项悬停 group-hover:text-blue-700 同色系
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    category === cat
                      ? "bg-blue-100 text-blue-700"
                      : "bg-neutral-100 text-neutral-600 hover:bg-blue-50 hover:text-blue-700"
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
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                积分价格 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                value={creditPrice}
                onChange={e => setCreditPrice(e.target.value)}
                onBlur={() => setTouched("creditPrice")}
                placeholder="设置每次服务的积分价格"
                min={1}
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 transition-all text-sm ${getFieldError("creditPrice") ? "border-red-500" : "border-neutral-200"}`}
              />
              {getFieldError("creditPrice") && <p className="text-red-500 text-xs mt-1">{getFieldError("creditPrice")}</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">服务地址</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="如：3号楼1单元（选填）"
              className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/15 focus:border-blue-400 transition-all text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">图片（选填）</label>
            <ImageUpload value={images} onChange={setImages} maxCount={5} />
          </div>
        </div>
      </div>

      {/* 提交按钮：fixed 固定在视口底部（避开移动端 h-16 底部 Tab），left-1/2 + max-w-2xl 约束宽度跟随表单容器，避免桌面端全屏拉伸 */}
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-white border-t px-4 py-3">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          // 提交按钮使用技能模块蓝，与列表页发布按钮 hover 光晕 rgba(59,130,246,0.5) 同色系
          className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 active:scale-[0.99]"
        >
          {submitting ? "发布中..." : "立即发布"}
        </button>
      </div>
    </div>
  );
}
