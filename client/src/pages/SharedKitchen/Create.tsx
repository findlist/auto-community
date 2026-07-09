import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
      {/* 类型切换 */}
      <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
        <button
          onClick={() => setType("offer")}
          className={`flex-1 py-2 rounded-md transition-colors ${
            type === "offer" ? "bg-emerald-600 text-white" : "text-gray-600"
          }`}
        >
          🍲 我要分享
        </button>
        <button
          onClick={() => setType("need")}
          className={`flex-1 py-2 rounded-md transition-colors ${
            type === "need" ? "bg-emerald-600 text-white" : "text-gray-600"
          }`}
        >
          🍜 我有需求
        </button>
      </div>

      {/* 表单 */}
      <div className="space-y-4">
        {/* 标题 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            标题 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => setTouched("title")}
            placeholder={type === "offer" ? "今天做了什么好吃的？" : "想吃什么美食？"}
            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("title") ? "border-red-500" : "border-gray-200"}`}
          />
          {getFieldError("title") && <p className="text-red-500 text-xs mt-1">{getFieldError("title")}</p>}
        </div>

        {/* 描述 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">详细描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => setTouched("description")}
            placeholder="描述一下这道美食..."
            className={`w-full px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("description") ? "border-red-500" : "border-gray-200"}`}
            rows={3}
          />
          {getFieldError("description") && <p className="text-red-500 text-xs mt-1">{getFieldError("description")}</p>}
        </div>

        {/* 类别 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            类别 <span className="text-red-500">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 rounded-full text-sm ${
                  category === cat
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-600"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">价格（积分）</label>
            <input
              type="number"
              value={price}
              onChange={e => setPrice(Number(e.target.value))}
              onBlur={() => setTouched("price")}
              min={0}
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("price") ? "border-red-500" : "border-gray-200"}`}
            />
            {getFieldError("price") && <p className="text-red-500 text-xs mt-1">{getFieldError("price")}</p>}
          </div>
          {type === "offer" && (
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">分享份数</label>
              <input
                type="number"
                value={quantity}
                onChange={e => setQuantity(Number(e.target.value))}
                min={1}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}
        </div>

        {/* 领取信息 */}
        {type === "offer" && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">领取地点</label>
              <input
                type="text"
                value={pickupLocation}
                onChange={e => setPickupLocation(e.target.value)}
                onBlur={() => setTouched("pickupLocation")}
                placeholder="如：3号楼1单元102"
                className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 ${getFieldError("pickupLocation") ? "border-red-500" : "border-gray-200"}`}
              />
              {getFieldError("pickupLocation") && <p className="text-red-500 text-xs mt-1">{getFieldError("pickupLocation")}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">领取时间</label>
              <input
                type="text"
                value={pickupTime}
                onChange={e => setPickupTime(e.target.value)}
                placeholder="如：今天17:00-19:00"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">领取方式</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPickupType("self_pickup")}
                  className={`flex-1 py-2 rounded-lg border ${
                    pickupType === "self_pickup" ? "border-emerald-500 bg-emerald-50" : "border-gray-200"
                  }`}
                >
                  自取
                </button>
                <button
                  onClick={() => setPickupType("delivery")}
                  className={`flex-1 py-2 rounded-lg border ${
                    pickupType === "delivery" ? "border-emerald-500 bg-emerald-50" : "border-gray-200"
                  }`}
                >
                  可配送
                </button>
              </div>
            </div>

            {/* 过敏原 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">过敏原标注（可选）</label>
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
                    className={`px-3 py-1 rounded-full text-sm ${
                      selectedAllergens.includes(allergen)
                        ? "bg-orange-100 text-orange-700"
                        : "bg-gray-100 text-gray-600"
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
          <label className="block text-sm font-medium text-gray-700 mb-1">图片（选填）</label>
          <ImageUpload value={images} onChange={setImages} maxCount={5} />
        </div>
      </div>

      {/* 提交按钮 */}
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
