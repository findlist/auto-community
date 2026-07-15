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
          <div className="h-64 bg-neutral-200 rounded-lg" />
          <div className="h-6 bg-neutral-200 rounded w-3/4" />
          <div className="h-4 bg-neutral-200 rounded w-1/2" />
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
        <div className="text-center text-red-600 mb-3 text-sm">{error}</div>
        <div className="text-center">
          <button
            onClick={() => navigate("/kitchen")}
            className="px-5 py-2 bg-orange-600 text-white rounded-full text-sm hover:bg-orange-700 transition-colors"
          >
            返回列表
          </button>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="p-4 text-center text-neutral-500 text-sm">
        美食不存在或已下架
      </div>
    );
  }

  return (
    // max-w-2xl mx-auto：详情页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="pb-24 lg:pb-20 max-w-2xl mx-auto">
      {/* 顶部返回 + 模块小标签，与列表页编辑式风格一致 */}
      <div className="px-4 lg:px-0 pt-4 lg:pt-6 mb-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回
        </button>
        <p className="text-xs tracking-widest mb-2 font-mono" style={{ color: "var(--color-module-kitchen)" }}>
          —— 美食详情
        </p>
      </div>

      {/* 图片：圆角处理，缺省用 emoji 占位 */}
      <div className="px-4 lg:px-0">
        <div className="h-64 lg:h-72 bg-neutral-100 rounded-2xl overflow-hidden">
          {post.images?.[0] ? (
            <img src={post.images[0]} alt={post.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl">
              {post.type === "offer" ? "🍲" : "🍜"}
            </div>
          )}
        </div>
      </div>

      <div className="p-4 lg:p-0 lg:pt-6">
        {/* 标题和价格 */}
        <div className="flex justify-between items-start mb-5">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl lg:text-3xl font-semibold text-neutral-900 tracking-tight text-balance">
              {post.title}
            </h1>
            <p className="text-sm text-neutral-500 mt-1">{post.category}</p>
          </div>
          <div className="text-right ml-4">
            <div className="text-2xl lg:text-3xl font-bold text-orange-700 tabular-nums">
              {post.price === 0 ? "免费" : `${post.price}`}
              {post.price !== 0 && <span className="text-xs text-neutral-400 ml-0.5 font-normal">积分</span>}
            </div>
            <div className="text-sm text-neutral-500 mt-1 tabular-nums">
              剩余 {post.remaining}/{post.quantity} 份
            </div>
          </div>
        </div>

        {/* 描述：编辑式区块 */}
        <div className="mb-6">
          <h3 className="text-xs font-mono tracking-widest uppercase text-neutral-400 mb-2">—— 描述</h3>
          <p className="text-neutral-700 text-sm lg:text-base leading-relaxed">{post.description}</p>
        </div>

        {/* 分享者信息：编辑式区块 */}
        <div className="mb-6">
          <h3 className="text-xs font-mono tracking-widest uppercase text-neutral-400 mb-3">—— 分享者</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-100 overflow-hidden flex items-center justify-center">
              {post.user?.avatar ? (
                <img src={post.user.avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-neutral-400 text-sm">{post.user?.nickname?.[0] ?? "?"}</span>
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium text-neutral-900">{post.user?.nickname}</div>
              <div className="text-sm text-neutral-500">
                {post.user?.reputationScore != null && (
                  <span className="text-amber-500">⭐ {post.user.reputationScore}</span>
                )}
              </div>
            </div>
            {post.healthCert && (
              <span className="px-2 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-medium">
                ✓ 已认证
              </span>
            )}
          </div>
        </div>

        {/* 领取信息：编辑式区块 */}
        <div className="mb-6">
          <h3 className="text-xs font-mono tracking-widest uppercase text-neutral-400 mb-3">—— 领取信息</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-neutral-700 text-sm">
              <span className="text-base">📍</span>
              <span>{post.pickupLocation}</span>
            </div>
            <div className="flex items-center gap-2 text-neutral-700 text-sm">
              <span className="text-base">🕐</span>
              <span>{post.pickupTime || "随时可取"}</span>
            </div>
            <div className="flex items-center gap-2 text-neutral-700 text-sm">
              <span className="text-base">🚚</span>
              <span>{post.pickupType === "delivery" ? "可配送" : "仅自取"}</span>
            </div>
          </div>
        </div>

        {/* 过敏原提醒 */}
        {post.allergens && post.allergens.length > 0 && (
          <div className="bg-orange-50 rounded-xl p-4 mb-4 border border-orange-100">
            <div className="flex items-center gap-2 text-orange-700 font-medium mb-2 text-sm">
              <span>⚠️</span>
              <span>过敏原信息</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {post.allergens.map(allergen => (
                <span key={allergen} className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded-full">
                  {allergen}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部操作栏：吸底 + 安全区 + 毛玻璃 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-neutral-200 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <div className="flex gap-3 max-w-2xl mx-auto">
          <button
            onClick={() => navigate(`/kitchen/${post.id}/reviews`)}
            className="flex-1 py-3 border border-neutral-200 text-neutral-700 rounded-full font-medium hover:bg-neutral-50 active:scale-[0.98] transition-all"
          >
            查看评价
          </button>
          {post.type === "offer" && post.remaining > 0 && (
            <button
              onClick={() => setShowOrderModal(true)}
              className="flex-1 py-3 bg-orange-600 text-white rounded-full font-medium hover:bg-orange-700 active:scale-[0.98] transition-all"
            >
              立即预约
            </button>
          )}
        </div>
      </div>

      {/* 预约弹窗：底部抽屉 + 遮罩淡入 */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50 animate-backdrop">
          <div className="bg-white w-full rounded-t-2xl p-6 animate-modal-enter pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <h3 className="text-lg font-semibold text-neutral-900 mb-4">预约领取</h3>

            {/* 份数 */}
            <div className="mb-4">
              <label className="block text-sm text-neutral-600 mb-2">领取份数</label>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center text-lg hover:bg-neutral-200 active:scale-95 transition-all"
                >
                  -
                </button>
                <span className="text-xl font-medium w-8 text-center tabular-nums">{quantity}</span>
                <button
                  onClick={() => setQuantity(Math.min(post.remaining, quantity + 1))}
                  className="w-10 h-10 rounded-full bg-neutral-100 flex items-center justify-center text-lg hover:bg-neutral-200 active:scale-95 transition-all"
                >
                  +
                </button>
                <span className="text-neutral-500 text-sm ml-2 tabular-nums">
                  共 {post.price * quantity} 积分
                </span>
              </div>
            </div>

            {/* 领取方式 */}
            {post.pickupType === "delivery" && (
              <div className="mb-4">
                <label className="block text-sm text-neutral-600 mb-2">领取方式</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPickupType("self_pickup")}
                    className={`flex-1 py-2 rounded-lg border text-sm transition-all ${
                      pickupType === "self_pickup" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-neutral-200 text-neutral-600"
                    }`}
                  >
                    自取
                  </button>
                  <button
                    onClick={() => setPickupType("delivery")}
                    className={`flex-1 py-2 rounded-lg border text-sm transition-all ${
                      pickupType === "delivery" ? "border-orange-500 bg-orange-50 text-orange-700" : "border-neutral-200 text-neutral-600"
                    }`}
                  >
                    配送
                  </button>
                </div>
              </div>
            )}

            {/* 备注 */}
            <div className="mb-6">
              <label className="block text-sm text-neutral-600 mb-2">备注（选填）</label>
              <textarea
                value={remark}
                onChange={e => setRemark(e.target.value)}
                placeholder="有什么需要特别说明的吗？"
                className="w-full px-3 py-2 border border-neutral-200 rounded-lg resize-none text-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all"
                rows={2}
              />
            </div>

            {/* 按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowOrderModal(false)}
                className="flex-1 py-3 border border-neutral-200 text-neutral-700 rounded-full"
              >
                取消
              </button>
              <button
                onClick={handleOrder}
                disabled={ordering}
                className="flex-1 py-3 bg-orange-600 text-white rounded-full font-medium disabled:opacity-50 hover:bg-orange-700 active:scale-[0.98] transition-all"
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
