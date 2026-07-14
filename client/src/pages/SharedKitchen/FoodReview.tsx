import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Star, Loader2, AlertCircle } from "lucide-react";
import Empty from "@/components/Empty";
import { getFoodReviews } from "@/api/kitchen";
import { getFoodShareById } from "@/api/kitchen";
import { ApiError } from "@/api/client";
import type { FoodReview, KitchenPost } from "@/types";

const PAGE_SIZE = 10;

// 渲染星级评分
function StarRating({ rating, size = "w-4 h-4" }: { rating: number; size?: string }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${size} ${n <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`}
        />
      ))}
    </div>
  );
}

export default function FoodReviewPage() {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<KitchenPost | null>(null);
  const [reviews, setReviews] = useState<FoodReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  // 评分统计
  const [avgRating, setAvgRating] = useState(0);

  // 加载评价列表：通过帖子获取提供者 userId，再查该用户的评价
  const loadReviews = useCallback(async (p: number) => {
    if (!postId) return;
    setLoading(true);
    setError("");
    try {
      // 首次加载时获取帖子信息，确定被评价者
      if (!post) {
        const postRes = await getFoodShareById(postId);
        setPost(postRes.data);
      }
      const userId = post?.userId;
      const res = await getFoodReviews({ userId, page: p, pageSize: PAGE_SIZE });
      setReviews(res.data.list);
      setTotalPages(res.data.totalPages);
      setTotal(res.data.total);
      setPage(res.data.page);

      // 计算平均分
      if (res.data.list.length > 0) {
        const sum = res.data.list.reduce((acc, r) => acc + r.rating, 0);
        setAvgRating(sum / res.data.list.length);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载评价失败");
    } finally {
      setLoading(false);
    }
  }, [postId, post]);

  useEffect(() => {
    loadReviews(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  return (
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate(`/kitchen/${postId}`)}
          aria-label="返回"
          className="p-1.5 hover:bg-gray-100 rounded transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-lg font-bold text-gray-900">食物评价</h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* 食物信息卡片 */}
      {post && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <h3 className="font-medium text-gray-900 mb-1">{post.title}</h3>
          <p className="text-sm text-gray-500">提供者: {post.user?.nickname || "未知"}</p>
        </div>
      )}

      {/* 评分统计卡片 */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4 flex items-center gap-4">
        <div className="text-center">
          <div className="text-3xl font-bold text-gray-900">{avgRating.toFixed(1)}</div>
          <StarRating rating={Math.round(avgRating)} />
        </div>
        <div className="text-sm text-gray-500">
          共 {total} 条评价
        </div>
      </div>

      {/* 评价列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : reviews.length === 0 ? (
        <Empty title="暂无评价" description="评价提交后会在这里显示" />
      ) : (
        <>
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {review.reviewer?.avatar ? (
                      <img
                        src={review.reviewer.avatar}
                        alt=""
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500">
                        {(review.reviewer?.nickname || "匿")[0]}
                      </div>
                    )}
                    <span className="text-sm font-medium text-gray-700">
                      {review.reviewer?.nickname || "匿名用户"}
                    </span>
                  </div>
                  <StarRating rating={review.rating} />
                </div>
                {review.content && (
                  <p className="text-sm text-gray-600 mt-2">{review.content}</p>
                )}
                <div className="text-xs text-gray-400 mt-2">
                  {new Date(review.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 text-sm">
              <button
                onClick={() => loadReviews(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-gray-600">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => loadReviews(page + 1)}
                disabled={page >= totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded-lg disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============ 评价提交弹窗组件 ============
// 供 Orders.tsx 订单完成时使用，替代原有的 prompt() 弹窗

export interface ReviewSubmitModalProps {
  orderId: string;
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReviewSubmitModal({ orderId, visible, onClose, onSuccess }: ReviewSubmitModalProps) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (rating < 1 || rating > 5) {
      setError("请选择评分");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const { completeFoodOrder } = await import("@/api/kitchen");
      await completeFoodOrder(orderId, {
        rating,
        content: content.trim() || undefined,
      });
      onSuccess();
      onClose();
      // 重置表单
      setRating(5);
      setContent("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "评价失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">评价订单</h3>
        </div>
        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* 星级选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">评分</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className="p-1"
                >
                  <Star
                    className={`w-7 h-7 ${
                      n <= rating
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-gray-300 hover:text-gray-400"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* 评价内容 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              评价内容（选填）
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              placeholder="分享您的用餐体验..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50"
          >
            {submitting ? "提交中..." : "提交评价"}
          </button>
        </div>
      </div>
    </div>
  );
}
