import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Star, MapPin, Clock, ArrowLeft, Edit2, Trash2 } from "lucide-react";
import { getPost, createOrder, deletePost } from "@/api/skills";
import { ApiError } from "@/api/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";
import AIRecommend from "@/components/AIRecommend";
import Empty from "@/components/Empty";
import type { SkillPost } from "@/types";

interface SkillPostRaw extends Omit<SkillPost, "creditsRequired"> {
  creditPrice: number;
}

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [post, setPost] = useState<SkillPostRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // 加载错误信息：getPost 失败时记录，用于优先于"不存在"分支展示真实错误
  const [error, setError] = useState("");
  // 删除确认弹窗状态：true 表示弹窗打开
  // 设计原因：原生 confirm() 阻塞主线程且移动端样式不可控，改用状态驱动的自定义 Modal，
  // 用户点击"删除"后才真正调用 deletePost，与 SystemStatus/SkillExchange/Orders 弹窗风格统一
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    // 清空历史错误，避免上一次失败的状态污染本次加载
    setError("");
    getPost(id)
      .then(res => setPost(res.data))
      .catch((err: unknown) => {
        // 记录错误信息优先展示，避免被"帖子不存在"分支掩盖真实原因（404/500/403）
        setError(err instanceof ApiError ? err.message : "加载失败");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const isOwner = user?.id === post?.userId;

  const handleCreateOrder = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      await createOrder({ postId: id });
      toast.success("交易发起成功！");
      navigate("/skills");
    } catch (error) {
      toast.error(getErrorMessage(error, "发起交易失败"));
    } finally {
      setSubmitting(false);
    }
  };

  // 打开删除确认弹窗：仅切换弹窗状态，实际调用由弹窗内"删除"按钮触发
  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  // 用户在弹窗中点击"删除"后执行实际删除
  // 先关闭弹窗避免重复点击；try/catch 内已有 toast 兜底
  const confirmDelete = async () => {
    if (!id) return;
    setShowDeleteConfirm(false);
    try {
      await deletePost(id);
      toast.success("删除成功");
      navigate("/skills");
    } catch (error) {
      toast.error(getErrorMessage(error, "删除失败"));
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-3/4" />
          <div className="h-4 bg-gray-200 rounded w-1/2" />
          <div className="h-32 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  // 渲染优先级：!post && error 优先展示加载错误，避免被"不存在"分支掩盖真实原因
  // 设计原因：getPost 失败时 post 仍为 null，若直接走 !post 分支会显示"帖子不存在"，
  // 掩盖 404/500/403 等真实错误，影响用户排查问题
  if (!post && error) {
    return (
      <div className="p-4">
        <Empty
          variant="default"
          title="帖子加载失败"
          description={error}
          action={
            <button
              onClick={() => navigate("/skills")}
              className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-md text-sm hover:bg-[var(--color-primary-600)] transition-colors"
            >
              返回列表
            </button>
          }
        />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="p-4">
        <Empty
          variant="default"
          title="技能帖子不存在"
          description="该帖子可能已下架或被删除"
          action={
            <button
              onClick={() => navigate("/skills")}
              className="px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-md text-sm hover:bg-[var(--color-primary-600)] transition-colors"
            >
              返回列表
            </button>
          }
        />
      </div>
    );
  }

  return (
    // max-w-2xl mx-auto：详情页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="pb-20 max-w-2xl mx-auto">
      <div className="px-4 py-3 flex items-center gap-3 border-b border-gray-100">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h1 className="text-lg font-medium text-gray-900 flex-1 truncate">{post.title}</h1>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <span className="inline-block px-2 py-0.5 bg-emerald-50 text-emerald-600 text-xs rounded mb-2">
              {post.category}
            </span>
            <h2 className="text-xl font-bold text-gray-900 mb-1">{post.title}</h2>
            <p className="text-sm text-gray-500">
              {post.type === "offer" ? "提供技能" : "需求技能"}
            </p>
          </div>
          <div className="text-2xl font-bold text-emerald-600 whitespace-nowrap ml-4">
            {post.creditPrice}积分
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">详细描述</h3>
          <p className="text-gray-600 text-sm leading-relaxed">{post.description}</p>
        </div>

        <div className="space-y-3 mb-4">
          {post.location && (
            <div className="flex items-center gap-2 text-gray-600 text-sm">
              <MapPin className="w-4 h-4 text-gray-400" />
              <span>{post.location}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-gray-600 text-sm">
            <Clock className="w-4 h-4 text-gray-400" />
            <span>{new Date(post.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">发布者信息</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-200 overflow-hidden">
              {post.user?.avatar && (
                <img src={post.user.avatar} alt="" className="w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-900">{post.user?.nickname}</div>
              {post.user?.reputationScore != null && (
                <div className="flex items-center gap-1 text-sm text-amber-500 mt-0.5">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  <span>信誉分 {post.user.reputationScore}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI 智能推荐 */}
        <div className="mt-4">
          <AIRecommend postId={id!} type="skill" title="可能感兴趣的人" />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t px-4 py-3">
        {isOwner ? (
          <div className="flex gap-3">
            <button
              onClick={handleDelete}
              className="flex-1 py-3 border border-red-200 text-red-500 rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
            <button
              onClick={() => navigate(`/skills/create?edit=${post.id}`)}
              className="flex-1 py-3 bg-emerald-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              编辑
            </button>
          </div>
        ) : (
          <button
            onClick={handleCreateOrder}
            disabled={submitting || post.status !== "active"}
            className="w-full py-3 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {submitting ? "提交中..." : "发起交易"}
          </button>
        )}
      </div>

      {/* 删除确认弹窗：替代原生 confirm()，与 SystemStatus/SkillExchange/Orders 弹窗风格统一 */}
      {/* role="dialog" 提升无障碍语义，便于测试用 within 精确定位弹窗内按钮 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            role="dialog"
            aria-label="删除确认"
            className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-neutral-800 mb-2">删除确认</h3>
            <p className="text-sm text-neutral-600 mb-6">确定要删除这条技能帖子吗？</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
