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
  // 删除进行中标志：独立于 submitting（submitting 用于 createOrder），用于防止 confirmDelete 重复触发
  // 设计原因：弱网下用户在弹窗内多次点击"删除"会触发多次 deletePost 请求，
  // 后端虽幂等但前端会显示多个 toast 与多次 navigate，体验混乱；同时配合按钮 disabled + 文案变化形成三重防御
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    // 清空历史错误，避免上一次失败的状态污染本次加载
    setError("");
    getPost(id)
      .then(res => { if (!cancelled) setPost(res.data); })
      .catch((err: unknown) => {
        // 记录错误信息优先展示，避免被"帖子不存在"分支掩盖真实原因（404/500/403）
        if (!cancelled) setError(err instanceof ApiError ? err.message : "加载失败");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const isOwner = user?.id === post?.userId;

  const handleCreateOrder = async () => {
    if (!id) return;
    // 入口 if 守卫：与 disabled + 文案变化形成三重防御
    // 设计原因：React 状态更新是异步批处理的，submitting 在批处理结束前仍为 false，
    // 弱网下用户连点"发起交易"会在 submitting 生效前触发多次 createOrder，产生多个订单
    if (submitting) return;
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
  // 三重防御：deleting 状态守卫 + 按钮 disabled + 文案变化，防止弱网下重复提交
  // 不在入口关闭弹窗：deleting 期间保留弹窗显示"删除中..."文案，让用户感知请求进行中；
  // 成功后 navigate 自动卸载组件弹窗消失；失败后关闭弹窗让用户看到 toast 并能重试
  const confirmDelete = async () => {
    if (!id) return;
    if (deleting) return;
    setDeleting(true);
    try {
      await deletePost(id);
      toast.success("删除成功");
      navigate("/skills");
    } catch (error) {
      toast.error(getErrorMessage(error, "删除失败"));
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-neutral-200 rounded w-3/4" />
          <div className="h-4 bg-neutral-200 rounded w-1/2" />
          <div className="h-32 bg-neutral-200 rounded" />
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
              className="px-4 py-2 bg-blue-600 text-white rounded-full text-sm hover:bg-blue-700 transition-colors"
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
              className="px-4 py-2 bg-blue-600 text-white rounded-full text-sm hover:bg-blue-700 transition-colors"
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
    <div className="pb-24 lg:pb-20 max-w-2xl mx-auto">
      {/* 顶部返回 + 模块小标签，与列表页编辑式风格一致 */}
      <div className="px-4 lg:px-0 pt-4 lg:pt-6 mb-4">
        <button
          onClick={() => navigate(-1)}
          // 仅补 py-1.5 扩大垂直触控目标至约 32px，不加 hover:bg 以保留编辑式小标签视觉风格
          // 设计原因：同行有"—— 技能详情"模块小标签，添加 hover:bg 会让返回按钮看起来像可点击按钮破坏编辑式语言
          className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors mb-3 py-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回
        </button>
        <p className="text-xs tracking-widest mb-2 font-mono" style={{ color: "var(--color-module-skill)" }}>
          —— 技能详情
        </p>
      </div>

      <div className="px-4 lg:px-0">
        <div className="flex items-start justify-between mb-6">
          <div className="flex-1 min-w-0">
            <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full font-medium mb-2">
              {post.category}
            </span>
            <h2 className="text-2xl lg:text-3xl font-semibold text-neutral-900 mb-1 tracking-tight text-balance">
              {post.title}
            </h2>
            <p className="text-sm text-neutral-500">
              {post.type === "offer" ? "提供技能" : "需求技能"}
            </p>
          </div>
          <div className="text-2xl lg:text-3xl font-bold text-blue-700 whitespace-nowrap ml-4 tabular-nums">
            {post.creditPrice}
            <span className="text-xs text-neutral-400 ml-0.5 font-normal">积分</span>
          </div>
        </div>

        {/* 详细描述：编辑式区块，弱化卡片背景 */}
        <div className="mb-6">
          <h3 className="text-xs font-mono tracking-widest uppercase text-neutral-400 mb-2">—— 详细描述</h3>
          <p className="text-neutral-700 text-sm lg:text-base leading-relaxed">{post.description}</p>
        </div>

        <div className="space-y-2.5 mb-6">
          {post.location && (
            <div className="flex items-center gap-2 text-neutral-600 text-sm">
              <MapPin className="w-4 h-4 text-neutral-400" />
              <span>{post.location}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-neutral-600 text-sm">
            <Clock className="w-4 h-4 text-neutral-400" />
            <span>{new Date(post.createdAt).toLocaleString()}</span>
          </div>
        </div>

        {/* 发布者信息：编辑式区块 */}
        <div className="mb-6">
          <h3 className="text-xs font-mono tracking-widest uppercase text-neutral-400 mb-3">—— 发布者</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-neutral-100 overflow-hidden flex items-center justify-center">
              {/* 头像 alt 使用用户昵称，屏幕阅读器可识别发帖人身份 */}
              {post.user?.avatar ? (
                <img src={post.user.avatar} alt={post.user.nickname ? `${post.user.nickname}的头像` : "用户头像"} className="w-full h-full object-cover" />
              ) : (
                <span className="text-neutral-400 text-sm">{post.user?.nickname?.[0] ?? "?"}</span>
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium text-neutral-900">{post.user?.nickname}</div>
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
        <div className="mt-6">
          <AIRecommend postId={id!} type="skill" title="可能感兴趣的人" />
        </div>
      </div>

      {/* 底部操作栏：吸底，避免长内容滚动时按钮不可见；考虑移动端安全区 */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-neutral-200 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {isOwner ? (
          <div className="flex gap-3 max-w-2xl mx-auto">
            <button
              onClick={handleDelete}
              className="flex-1 py-3 border border-red-200 text-red-600 rounded-full font-medium flex items-center justify-center gap-2 hover:bg-red-50 active:scale-[0.98] transition-all"
            >
              <Trash2 className="w-4 h-4" />
              删除
            </button>
            <button
              onClick={() => navigate(`/skills/create?edit=${post.id}`)}
              className="flex-1 py-3 bg-blue-600 text-white rounded-full font-medium flex items-center justify-center gap-2 hover:bg-blue-700 active:scale-[0.98] transition-all"
            >
              <Edit2 className="w-4 h-4" />
              编辑
            </button>
          </div>
        ) : (
          <button
            onClick={handleCreateOrder}
            disabled={submitting || post.status !== "active"}
            className="w-full max-w-2xl mx-auto py-3 bg-blue-600 text-white rounded-full font-medium hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed block"
          >
            {submitting ? "提交中..." : "发起交易"}
          </button>
        )}
      </div>

      {/* 删除确认弹窗：替代原生 confirm()，与 SystemStatus/SkillExchange/Orders 弹窗风格统一 */}
      {/* role="dialog" 提升无障碍语义，便于测试用 within 精确定位弹窗内按钮；加入进入动画 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 animate-backdrop"
          // deleting 期间禁止点击背景关闭弹窗，避免请求进行中状态错乱
          onClick={() => { if (!deleting) setShowDeleteConfirm(false); }}
        >
          <div
            role="dialog"
            aria-label="删除确认"
            className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl animate-modal-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-neutral-800 mb-2">删除确认</h3>
            <p className="text-sm text-neutral-600 mb-6">确定要删除这条技能帖子吗？</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
