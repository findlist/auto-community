import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { createFoodShare } from "@/api/kitchen";
import { useFormValidation } from "@/hooks/useFormValidation";
import { validateRequired, validateMinLength, validateMaxLength, validatePrice } from "@/utils/formValidation";
import ImageUpload from "@/components/Upload/ImageUpload";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

const categories = ["家常菜", "烘焙", "饮品", "小吃", "素食", "海鲜", "火锅", "其他"];
const allergenOptions = ["鸡蛋", "牛奶", "面粉", "花生", "大豆", "海鲜", "肉类"];

export default function Create() {
  const navigate = useNavigate();
  const [type, setType] = useState<"offer" | "need">("offer");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [pickupLocation, setPickupLocation] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [pickupType, setPickupType] = useState<"self_pickup" | "delivery">("self_pickup");
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  // 图片列表：由 ImageUpload 组件管理上传，提交时一并传给后端
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fieldConfigs = useMemo(() => ({
    title: {
      value: title,
      rules: [
        (v: string) => validateRequired(v, "标题"),
        (v: string) => validateMinLength(v, 2, "标题"),
        (v: string) => validateMaxLength(v, 30, "标题"),
      ],
    },
    description: {
      value: description,
      rules: [
        (v: string) => validateMaxLength(v, 200, "详细描述"),
      ],
    },
    price: {
      value: String(price),
      rules: type === "offer" ? [
        (v: string) => validatePrice(v),
      ] : [],
    },
    pickupLocation: {
      value: pickupLocation,
      rules: type === "offer" ? [
        (v: string) => validateRequired(v, "领取地点"),
      ] : [],
    },
  }), [title, description, price, pickupLocation, type]);

  const { setTouched, getFieldError, validateAll } = useFormValidation(fieldConfigs);

  const handleSubmit = async () => {
    if (!validateAll()) return;

    setSubmitting(true);
    try {
      await createFoodShare({
        type,
        title,
        description,
        category,
        price,
        quantity,
        pickupTime: pickupTime || undefined,
        pickupLocation: pickupLocation || undefined,
        pickupType,
        allergens: selectedAllergens.length > 0 ? selectedAllergens : undefined,
        // 仅在有图片时传 images，避免发送空数组
        images: images.length > 0 ? images : undefined,
      });
      toast.success("发布成功");
      navigate("/kitchen");
    } catch (error) {
      toast.error(getErrorMessage(error, "发布失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // max-w-2xl mx-auto：表单页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      {/* 返回按钮：与 SkillExchange/Create 风格统一，触控区域 ≥40px */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-neutral-600 mb-4 py-1.5 px-2 -ml-2 rounded hover:bg-neutral-100 transition-colors">
        <ArrowLeft className="w-4 h-4" />返回
      </button>
      {/* 类型切换 */}
      <div className="flex bg-neutral-100 rounded-lg p-1 mb-6">
        <button
          onClick={() => setType("offer")}
          // 类型切换激活态使用厨房模块橙，与列表页 Tab 下划线 bg-orange-600 一致
          className={`flex-1 py-2 rounded-md transition-colors ${
            type === "offer" ? "bg-orange-600 text-white" : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          🍲 我要分享
        </button>
        <button
          onClick={() => setType("need")}
          className={`flex-1 py-2 rounded-md transition-colors ${
            type === "need" ? "bg-orange-600 text-white" : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          🍜 我有需求
        </button>
      </div>

      {/* 表单 */}
      <div className="space-y-4">
        {/* 标题 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            标题 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => setTouched("title")}
            placeholder={type === "offer" ? "今天做了什么好吃的？" : "想吃什么美食？"}
            // 焦点环改用厨房模块橙 15% 透明度光晕 + 400 阶边框，与列表页 Tab/发布按钮的橙色语言一致
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/15 focus:border-orange-400 transition-all ${getFieldError("title") ? "border-red-500" : "border-neutral-200"}`}
          />
          {getFieldError("title") && <p className="text-red-500 text-xs mt-1">{getFieldError("title")}</p>}
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">详细描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => setTouched("description")}
            placeholder="描述一下这道美食..."
            className={`w-full px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/15 focus:border-orange-400 transition-all ${getFieldError("description") ? "border-red-500" : "border-neutral-200"}`}
            rows={3}
          />
          {getFieldError("description") && <p className="text-red-500 text-xs mt-1">{getFieldError("description")}</p>}
        </div>

        {/* 类别 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            类别 <span className="text-red-500">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                // 分类按钮激活态使用厨房模块橙浅色变体，与列表项悬停 group-hover:text-orange-700 同色系
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  category === cat
                    ? "bg-orange-100 text-orange-700"
                    : "bg-neutral-100 text-neutral-600 hover:bg-orange-50 hover:text-orange-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 价格和份数 */}
        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-neutral-700 mb-1">价格（积分）</label>
            <input
              type="number"
              value={price}
              onChange={e => setPrice(Number(e.target.value))}
              onBlur={() => setTouched("price")}
              min={0}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/15 focus:border-orange-400 transition-all ${getFieldError("price") ? "border-red-500" : "border-neutral-200"}`}
            />
            {getFieldError("price") && <p className="text-red-500 text-xs mt-1">{getFieldError("price")}</p>}
          </div>
          {type === "offer" && (
            <div className="flex-1">
              <label className="block text-sm font-medium text-neutral-700 mb-1">分享份数</label>
              <input
                type="number"
                value={quantity}
                onChange={e => setQuantity(Number(e.target.value))}
                min={1}
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/15 focus:border-orange-400 transition-all"
              />
            </div>
          )}
        </div>

        {/* 领取信息 */}
        {type === "offer" && (
          <>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">领取地点</label>
              <input
                type="text"
                value={pickupLocation}
                onChange={e => setPickupLocation(e.target.value)}
                onBlur={() => setTouched("pickupLocation")}
                placeholder="如：3号楼1单元102"
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/15 focus:border-orange-400 transition-all ${getFieldError("pickupLocation") ? "border-red-500" : "border-neutral-200"}`}
              />
              {getFieldError("pickupLocation") && <p className="text-red-500 text-xs mt-1">{getFieldError("pickupLocation")}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">领取时间</label>
              <input
                type="text"
                value={pickupTime}
                onChange={e => setPickupTime(e.target.value)}
                placeholder="如：今天17:00-19:00"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/15 focus:border-orange-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">领取方式</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPickupType("self_pickup")}
                  // 领取方式选中态使用厨房模块橙边框 + 浅橙背景，与列表项 hover 橙色语言一致
                  className={`flex-1 py-2 rounded-lg border transition-colors ${
                    pickupType === "self_pickup" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  自取
                </button>
                <button
                  onClick={() => setPickupType("delivery")}
                  className={`flex-1 py-2 rounded-lg border transition-colors ${
                    pickupType === "delivery" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  可配送
                </button>
              </div>
            </div>

            {/* 过敏原 */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2">过敏原标注（可选）</label>
              <div className="flex flex-wrap gap-2">
                {allergenOptions.map(allergen => (
                  <button
                    key={allergen}
                    onClick={() => {
                      setSelectedAllergens(prev =>
                        prev.includes(allergen)
                          ? prev.filter(a => a !== allergen)
                          : [...prev, allergen]
                      );
                    }}
                    className={`px-3 py-1 rounded-full text-sm transition-colors ${
                      selectedAllergens.includes(allergen)
                        ? "bg-orange-100 text-orange-700"
                        : "bg-neutral-100 text-neutral-600 hover:bg-orange-50 hover:text-orange-700"
                    }`}
                  >
                    {allergen}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 图片上传：offer 和 need 类型均可上传 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">图片（选填）</label>
          <ImageUpload value={images} onChange={setImages} maxCount={5} />
        </div>
      </div>

      {/* 提交按钮：fixed 固定在视口底部（避开移动端 h-16 底部 Tab），left-1/2 + max-w-2xl 约束宽度跟随表单容器，避免桌面端全屏拉伸 */}
      <div className="fixed bottom-16 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-white border-t px-4 py-3">
        <button
          onClick={handleSubmit}
          disabled={submitting}
          // 提交按钮使用厨房模块橙，与列表页发布按钮 hover 光晕 rgba(249,115,22,0.5) 同色系
          className="w-full py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors disabled:opacity-50 active:scale-[0.99]"
        >
          {submitting ? "发布中..." : "立即发布"}
        </button>
      </div>
    </div>
  );
}
