import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Loader2 } from "lucide-react";
import Empty from "@/components/Empty";
import { getFoodShares, getGroupOrders } from "@/api/kitchen";
import type { KitchenPost, GroupOrder } from "@/types";
import { SkeletonCard, SkeletonListCard } from "@/components/Skeleton";
import { LoadingButton } from "@/components/Button";
import { toast } from "@/components/Toast";

// Tab 配置
const tabs = [
  { key: "offer", label: "美食分享" },
  { key: "need", label: "美食需求" },
  { key: "group", label: "拼单买菜" },
];

// 类别选项
const categories = [
  "全部", "家常菜", "烘焙", "饮品", "小吃", "素食", "海鲜", "火锅", "其他",
];

export default function SharedKitchen() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("offer");
  const [selectedCategory, setSelectedCategory] = useState("全部");
  const [posts, setPosts] = useState<KitchenPost[]>([]);
  const [groupOrders, setGroupOrders] = useState<GroupOrder[]>([]);
  const [loading, setLoading] = useState(false);
  // 持久错误状态：首次加载失败时展示 Empty error + 重新加载按钮，避免用户只能刷新整个页面
  // 设计原因：原实现仅 toast.error 即时提示，弱网下用户错过 toast 后无重试入口；与 Admin 列表页统一交互模式
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // 竞态守卫：跟踪当前活跃的请求标识（Tab+分类），快速切换时旧请求返回不再覆盖新数据
  // 设计原因：loadFoodShares/loadGroupOrders 依赖 activeTab/selectedCategory，切换时会重新创建并触发新请求，
  // 但旧请求的 await 仍在进行中，完成后会覆盖新列表或错误地更新 loading 状态（美食分享与拼单共享同一 loading）
  const activeRequestKeyRef = useRef(`${activeTab}|${selectedCategory}`);

  const loadFoodShares = useCallback(async (reset = false) => {
    // reset 时跳过 loading 守卫，确保切换 Tab/分类时即使上一次请求未完成也能重新加载
    if (!reset && loading) return;
    setLoading(true);
    // reset 时清空历史错误状态，避免上一次失败的 Empty error 残留干扰新一轮加载
    if (reset) setError(null);
    // 当前闭包捕获的请求标识，用于 await 后比对是否仍为最新请求
    const requestKey = `${activeTab}|${selectedCategory}`;
    try {
      const newPage = reset ? 1 : page;
      const res = await getFoodShares({
        type: activeTab as "offer" | "need",
        category: selectedCategory === "全部" ? undefined : selectedCategory,
        page: newPage,
        pageSize: 10,
      });
      // 竞态守卫：await 期间若 Tab/分类已变化，跳过 setState 避免旧数据覆盖新数据
      if (activeRequestKeyRef.current !== requestKey) return;
      if (reset) {
        setPosts(res.data.list);
      } else {
        setPosts(prev => [...prev, ...res.data.list]);
      }
      setHasMore(res.data.hasNext);
      setPage(newPage + 1);
    } catch (error) {
      if (activeRequestKeyRef.current !== requestKey) return;
      console.error("加载失败:", error);
      // 持久错误：首次加载失败时 Empty error 占位 + 重新加载按钮
      setError("加载美食分享失败，请稍后重试");
      // loadMore 失败时列表已有数据，Empty error 不展示，需 toast 提供即时反馈
      if (!reset) toast.error("加载更多失败，请稍后重试");
    } finally {
      // 仅当当前请求标识仍为活跃时才更新 loading，避免旧请求的 finally 覆盖新请求的 loading 状态
      if (activeRequestKeyRef.current === requestKey) {
        setLoading(false);
      }
    }
  }, [activeTab, selectedCategory, page, loading]);

  const loadGroupOrders = useCallback(async (reset = false) => {
    if (!reset && loading) return;
    setLoading(true);
    // reset 时清空历史错误状态，避免上一次失败的 Empty error 残留干扰新一轮加载
    if (reset) setError(null);
    // 当前闭包捕获的请求标识，用于 await 后比对是否仍为最新请求
    const requestKey = `${activeTab}|${selectedCategory}`;
    try {
      const newPage = reset ? 1 : page;
      const res = await getGroupOrders({ page: newPage, pageSize: 10 });
      // 竞态守卫：await 期间若 Tab 已切换走（不再为 group），跳过 setState 避免拼单数据覆盖美食分享数据
      if (activeRequestKeyRef.current !== requestKey) return;
      if (reset) {
        setGroupOrders(res.data.list);
      } else {
        setGroupOrders(prev => [...prev, ...res.data.list]);
      }
      setHasMore(res.data.hasNext);
      setPage(newPage + 1);
    } catch (error) {
      if (activeRequestKeyRef.current !== requestKey) return;
      console.error("加载失败:", error);
      // 持久错误：首次加载失败时 Empty error 占位 + 重新加载按钮
      setError("加载拼单列表失败，请稍后重试");
      // loadMore 失败时列表已有数据，Empty error 不展示，需 toast 提供即时反馈
      if (!reset) toast.error("加载更多失败，请稍后重试");
    } finally {
      if (activeRequestKeyRef.current === requestKey) {
        setLoading(false);
      }
    }
  }, [activeTab, selectedCategory, page, loading]);

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    // 同步活跃请求标识：Tab/分类变化时，旧请求的结果将被丢弃
    activeRequestKeyRef.current = `${activeTab}|${selectedCategory}`;
    if (activeTab === "group") {
      setGroupOrders([]);
      loadGroupOrders(true);
    } else {
      setPosts([]);
      loadFoodShares(true);
    }
    // 仅在 activeTab/selectedCategory 变化时重新加载；load 函数依赖 page/loading，纳入会导致分页后无限重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCategory]);

  const handleLoadMore = () => {
    if (activeTab === "group") {
      loadGroupOrders();
    } else {
      loadFoodShares();
    }
  };

  // 美食列表项：左图右文，分隔线组织，悬停轻底色
  // 悬停态与价格色采用厨房模块橙，强化模块身份
  const renderFoodItem = (post: KitchenPost) => (
    <div
      key={post.id}
      onClick={() => navigate(`/kitchen/${post.id}`)}
      className="group flex gap-4 lg:gap-6 border-b border-neutral-200 py-5 lg:py-6 cursor-pointer transition-colors duration-200 hover:bg-neutral-50/60 -mx-4 px-4 lg:-mx-6 lg:px-6"
    >
      {/* 图片：固定方寸，缺省时用 emoji 占位 */}
      <div className="flex-shrink-0 w-20 h-20 lg:w-28 lg:h-28 rounded-lg overflow-hidden bg-neutral-100">
        {post.images?.[0] ? (
          <img src={post.images[0]} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl">
            {post.type === "offer" ? "🍲" : "🍜"}
          </div>
        )}
      </div>
      {/* 文本：标题 + 描述 + 元信息 */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          <div className="flex items-baseline gap-2.5 mb-1">
            <h3 className="text-base lg:text-lg font-semibold text-neutral-900 truncate group-hover:text-orange-700 group-hover:translate-x-1 transition-all duration-200">
              {post.title}
            </h3>
            <span className="text-orange-700 font-semibold whitespace-nowrap text-sm tabular-nums">
              {post.price === 0 ? "免费" : `${post.price}积分`}
            </span>
          </div>
          <p className="text-sm text-neutral-500 line-clamp-1 mb-1.5">{post.description}</p>
          {/* 过敏原标签 */}
          {post.allergens && post.allergens.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-1">
              {post.allergens.map(allergen => (
                <span key={allergen} className="text-[11px] px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded">
                  ⚠ {allergen}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span className="text-neutral-600">{post.user?.nickname}</span>
          <span>剩余 {post.remaining}/{post.quantity} 份</span>
        </div>
      </div>
    </div>
  );

  // 拼单列表项：标题 + 进度条内联
  // 进度条与百分比色采用厨房模块橙，与美食列表项保持模块身份一致
  const renderGroupItem = (order: GroupOrder) => {
    const percent = Math.min(100, Math.round((order.currentAmount / order.targetAmount) * 100));
    return (
      <div
        key={order.id}
        onClick={() => navigate(`/kitchen/group-orders/${order.id}`)}
        className="group border-b border-neutral-200 py-5 lg:py-6 cursor-pointer transition-colors duration-200 hover:bg-neutral-50/60 -mx-4 px-4 lg:-mx-6 lg:px-6"
      >
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <h3 className="text-base lg:text-lg font-semibold text-neutral-900 truncate group-hover:text-orange-700 group-hover:translate-x-1 transition-all duration-200">
            {order.title}
          </h3>
          <span className="text-sm font-semibold text-orange-700 tabular-nums whitespace-nowrap">
            {percent}%
          </span>
        </div>
        <p className="text-sm text-neutral-500 line-clamp-1 mb-3">{order.description}</p>
        {/* 进度条：细线 + 渐变填充 + 微光，强化进度感与厨房模块橙身份 */}
        <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden mb-2.5">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-orange-600 transition-all duration-500 shadow-[0_0_8px_rgba(249,115,22,0.35)]"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span className="tabular-nums">¥{order.currentAmount} / {order.targetAmount}</span>
          <span className="tabular-nums">{order.currentParticipants}/{order.maxParticipants} 人</span>
          <span>截止 {new Date(order.deadline).toLocaleDateString()}</span>
        </div>
      </div>
    );
  };

  const isEmpty = activeTab === "group" ? groupOrders.length === 0 : posts.length === 0;

  return (
    <div className="px-4 lg:px-10 py-6 pb-24 lg:pb-12 max-w-6xl mx-auto">
      {/* 页面标题 + 发布 */}
      <div className="flex items-end justify-between mb-6 lg:mb-8">
        <div>
          <p className="text-xs tracking-widest mb-2 font-mono" style={{ color: "var(--color-module-kitchen)" }}>—— 共享厨房</p>
          <h1 className="text-3xl lg:text-4xl font-semibold text-neutral-900 tracking-tight text-balance">
            {activeTab === "group" ? "一起买，更便宜" : activeTab === "offer" ? "今天，谁在开火" : "邻居们想吃点啥"}
          </h1>
        </div>
        <button
          onClick={() => navigate("/kitchen/create")}
          className="flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white rounded-full text-sm font-medium hover:bg-neutral-800 hover:shadow-[0_8px_24px_-8px_rgba(249,115,22,0.5)] active:scale-[0.97] transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          发布
        </button>
      </div>

      {/* Tab 切换：下划线式，激活态下划线使用厨房模块橙 */}
      {/* overflow-x-auto + whitespace-nowrap：移动端窄屏 Tab 文字不换行、可横向滚动，避免下划线动效错位 */}
      <div className="flex items-center gap-6 border-b border-neutral-200 mb-5 overflow-x-auto pb-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`relative pb-3 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === key ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"
            }`}
          >
            {label}
            <span
              className={`absolute bottom-0 left-0 right-0 h-0.5 bg-orange-600 transition-transform duration-200 ${
                activeTab === key ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        ))}
      </div>

      {/* 类别筛选：仅美食 tab 显示 */}
      {activeTab !== "group" && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-x-visible">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 text-sm rounded-full whitespace-nowrap transition-all active:scale-95 ${
                selectedCategory === cat
                  ? "bg-neutral-900 text-white shadow-sm"
                  : "bg-neutral-100 text-neutral-600 hover:bg-orange-50 hover:text-orange-700"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* 列表区 */}
      <div>
        {loading && isEmpty ? (
          activeTab === "group" ? (
            <SkeletonListCard count={3} />
          ) : (
            <SkeletonCard count={3} showImage />
          )
        ) : !loading && error && isEmpty ? (
          // 加载失败占位：首次加载失败时展示 Empty error 与重新加载按钮，避免用户被卡在错误页只能刷新整个页面
          // 设计原因：与 Admin 列表页 Empty variant="error" + 重试按钮模式统一；
          // 按钮色板使用厨房模块橙（orange-500/600），与模块主色一致
          <Empty
            variant="error"
            action={
              <button
                onClick={() => activeTab === "group" ? loadGroupOrders(true) : loadFoodShares(true)}
                className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm hover:bg-orange-600 transition-colors"
              >
                重新加载
              </button>
            }
          />
        ) : (
          <>
            {activeTab === "group"
              ? groupOrders.map(renderGroupItem)
              : posts.map(renderFoodItem)}

            {loading && !isEmpty && (
              <div className="text-center py-6 text-neutral-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-neutral-400 inline-block mr-2 align-middle" />
                加载中...
              </div>
            )}
          </>
        )}

        {hasMore && !loading && !isEmpty && (
          <LoadingButton onClick={handleLoadMore} variant="outline" fullWidth className="mt-6">
            加载更多
          </LoadingButton>
        )}

        {!loading && !error && isEmpty && (
          <Empty title={`暂无${activeTab === "group" ? "拼单" : "美食"}`} description="发布后会在这里显示" />
        )}
      </div>
    </div>
  );
}
