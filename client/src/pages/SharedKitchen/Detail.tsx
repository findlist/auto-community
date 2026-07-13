import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getFoodShareById, createFoodOrder } from "@/api/kitchen";
import { ApiError } from "@/api/client";
import type { KitchenPost } from "@/types";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<KitchenPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [pickupType, setPickupType] = useState<"self_pickup" | "delivery">("self_pickup");
  const [remark, setRemark] = useState("");
  const [ordering, setOrdering] = useState(false);
  // 加载错误信息：getFoodShareById 失败时记录，用于优先于"不存在"分支展示真实错误
  const [error, setError] = useState("");

  // 加载详情
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    // 清空历史错误，避免上一次失败的状态污染本次加载
    setError("");
    getFoodShareById(id)
      .then(res => setPost(res.data))
      .catch((err: unknown) => {
        // 记录错误信息优先展示，避免被"美食不存在"分支掩盖真实原因（404/500/403）
        setError(err instanceof ApiError ? err.message : "加载失败");
      })
      .finally(() => setLoading(false));
  }, [id]);

  // 预约领取
  const handleOrder = async () => {
    if (!id || !post) return;
    setOrdering(true);
    try {
      await createFoodOrder({
        postId: id,
        quantity,
        pickupType,
        remark: remark || undefined,
      });
      toast.success("预约成功");
      setShowOrderModal(false);
      navigate("/kitchen/orders");
    } catch (error) {
      toast.error(getErrorMessage(error, "预约失败"));
    } finally {
      setOrdering(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-64 bg-gray-200 rounded-lg" />
          <div className="h-6 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
    );
  }

  // 渲染优先级：!post && error 优先展示加载错误，避免被"不存在"分支掩盖真实原因
  // 设计原因：getFoodShareById 失败时 post 仍为 null，若直接走 !post 分支会显示"美食不存在"，
  // 掩盖 404/500/403 等真实错误，影响用户排查问题
  if (!post && error) {
    return (
      <div className="p-4">
        <div className="text-center text-red-600 mb-2">{error}</div>
        <div className="text-center">
          <button
            onClick={() => navigate("/kitchen")}
            className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-md text-sm hover:bg-[var(--color-primary-600)] transition-colors"
          >
            返回列表
          </button>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="p-4 text-center text-gray-500">
        美食不存在或已下架
      </div>
    );
  }

  return (
    // max-w-2xl mx-auto：详情页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="pb-20 max-w-2xl mx-auto">
      {/* 二级页面返回按钮：触控区域 ≥40px（py-1.5 px-2），与项目其他页面统一 */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-gray-600 mb-4 py-1.5 px-2 rounded hover:bg-gray-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>
      {/* 图片 */}
      <div className="h-64 bg-gray-100">
        {post.images?.[0] ? (
          <img src={post.images[0]} alt={post.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-6xl">
            {post.type === "offer" ? "🍲" : "🍜"}
          </div>
        )}
      </div>

      <div className="p-4">
        {/* 标题和价格 */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-xl font-medium text-gray-900">{post.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{post.category}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-emerald-600">
              {post.price === 0 ? "免费" : `${post.price}积分`}
            </div>
            <div className="text-sm text-gray-500">
              剩余 {post.remaining}/{post.quantity} 份
            </div>
          </div>
        </div>

        {/* 描述 */}
        <p className="text-gray-600 mb-4">{post.description}</p>

        {/* 分享者信息 */}
        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-200 overflow-hidden">
              {post.user?.avatar && <img src={post.user.avatar} alt="" className="w-full h-full" />}
            </div>
            <div className="flex-1">
              <div className="font-medium">{post.user?.nickname}</div>
              <div className="text-sm text-gray-500">
                {post.user?.reputationScore && <span>⭐ {post.user.reputationScore}</span>}
              </div>
            </div>
            {post.healthCert && (
              <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">
                ✓ 已认证
              </span>
            )}
          </div>
        </div>

        {/* 领取信息 */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-gray-600">
            <span>📍</span>
            <span>{post.pickupLocation}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <span>🕐</span>
            <span>{post.pickupTime || "随时可取"}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <span>🚚</span>
            <span>{post.pickupType === "delivery" ? "可配送" : "仅自取"}</span>
          </div>
        </div>

        {/* 过敏原提醒 */}
        {post.allergens && post.allergens.length > 0 && (
          <div className="bg-orange-50 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 text-orange-700 font-medium mb-2">
              <span>⚠️</span>
              <span>过敏原信息</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {post.allergens.map(allergen => (
                <span key={allergen} className="px-2 py-1 bg-orange-100 text-orange-800 text-sm rounded">
                  {allergen}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部操作栏 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-4 py-3 flex gap-2">
        <button
          onClick={() => navigate(`/kitchen/${post.id}/reviews`)}
          className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
        >
          查看评价
        </button>
        {post.type === "offer" && post.remaining > 0 && (
          <button
            onClick={() => setShowOrderModal(true)}
            className="flex-1 py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
          >
            立即预约
          </button>
        )}
      </div>

      {/* 预约弹窗 */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white w-full rounded-t-2xl p-6 animate-slide-up">
            <h3 className="text-lg font-medium mb-4">预约领取</h3>
            
            {/* 份数 */}
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-2">领取份数</label>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  -
                </button>
                <span className="text-xl font-medium w-8 text-center">{quantity}</span>
                <button
                  onClick={() => setQuantity(Math.min(post.remaining, quantity + 1))}
                  className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  +
                </button>
                <span className="text-gray-500 text-sm ml-2">
                  共 {post.price * quantity} 积分
                </span>
              </div>
            </div>

            {/* 领取方式 */}
            {post.pickupType === "delivery" && (
              <div className="mb-4">
                <label className="block text-sm text-gray-600 mb-2">领取方式</label>
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
                    配送
                  </button>
                </div>
              </div>
            )}

            {/* 备注 */}
            <div className="mb-6">
              <label className="block text-sm text-gray-600 mb-2">备注（选填）</label>
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="有什么需要特别说明的吗？"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg resize-none"
                rows={2}
              />
            </div>

            {/* 按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowOrderModal(false)}
                className="flex-1 py-3 border border-gray-200 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleOrder}
                disabled={ordering}
                className="flex-1 py-3 bg-emerald-600 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {ordering ? "提交中..." : "确认预约"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
