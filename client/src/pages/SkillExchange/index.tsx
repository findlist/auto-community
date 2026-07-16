import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Star, MapPin, X, Loader2 } from "lucide-react";
import Empty from "@/components/Empty";
import { getPosts } from "@/api/skills";
import type { SkillPost } from "@/types";
import { SkeletonListCard } from "@/components/Skeleton";
import { LoadingButton } from "@/components/Button";
import { toast } from "@/components/Toast";

const tabs = [
  { key: "offer", label: "提供技能" },
  { key: "request", label: "需求技能" },
];

const categories = [
  "全部", "电脑维修", "家政服务", "教育培训", "运动健身",
  "音乐艺术", "语言翻译", "法律咨询", "其他",
];

export default function SkillExchange() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("offer");
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("全部");
  const [posts, setPosts] = useState<SkillPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadPosts = useCallback(async (reset = false) => {
    // reset 时跳过 loading 守卫，确保切换 Tab/分类/搜索时即使上一次请求未完成也能重新加载
    if (!reset && loading) return;
    setLoading(true);
    try {
      const newPage = reset ? 1 : page;
      const res = await getPosts({
        type: activeTab as "offer" | "request",
        category: selectedCategory === "全部" ? undefined : selectedCategory,
        keyword: keyword || undefined,
        page: newPage,
        pageSize: 20,
      });
      const { list, hasNext } = res.data;
      if (reset) {
        setPosts(list);
      } else {
        setPosts(prev => [...prev, ...list]);
      }
      setHasMore(hasNext);
      setPage(newPage + 1);
    } catch (error) {
      console.error("加载失败:", error);
      toast.error("加载技能列表失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [activeTab, selectedCategory, keyword, page, loading]);

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    setPosts([]);
    loadPosts(true);
    // 仅在 activeTab/selectedCategory/keyword 变化时重新加载；loadPosts 依赖 page/loading，纳入会导致分页后无限重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCategory, keyword]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // 编辑式列表项：无卡片，靠分隔线与留白组织信息
  // 悬停态与价格/分类色采用技能模块蓝，强化模块身份
  const renderItem = (post: SkillPost) => (
    <div
      key={post.id}
      onClick={() => navigate(`/skills/${post.id}`)}
      className="group border-b border-neutral-200 py-5 lg:py-6 cursor-pointer transition-colors duration-200 hover:bg-neutral-50/60 -mx-4 px-4 lg:-mx-6 lg:px-6 rounded-none"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* 标题行：标题 + 价格 */}
          <div className="flex items-baseline gap-3 mb-1.5">
            <h3 className="text-base lg:text-lg font-semibold text-neutral-900 truncate group-hover:text-blue-700 group-hover:translate-x-1 transition-all duration-200">
              {post.title}
            </h3>
            <span className="text-blue-700 font-semibold whitespace-nowrap text-sm tabular-nums">
              {post.creditPrice}<span className="text-xs text-neutral-400 ml-0.5">积分</span>
            </span>
          </div>
          {/* 描述 */}
          <p className="text-sm text-neutral-500 mb-2.5 line-clamp-1">{post.description}</p>
          {/* 元信息：分类 + 位置 */}
          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <span className="text-blue-700/80">{post.category}</span>
            {post.location && (
              <span className="flex items-center gap-0.5">
                <MapPin className="w-3 h-3" />
                {post.location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="text-neutral-600">{post.user?.nickname}</span>
              {post.user?.reputationScore != null && (
                <span className="flex items-center gap-0.5 text-amber-500">
                  <Star className="w-3 h-3 fill-current" />
                  {post.user.reputationScore}
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="px-4 lg:px-10 py-6 pb-24 lg:pb-12 max-w-6xl mx-auto">
      {/* 页面标题 + 操作 */}
      <div className="flex items-end justify-between mb-6 lg:mb-8">
        <div>
          <p className="text-xs tracking-widest mb-2 font-mono" style={{ color: "var(--color-module-skill)" }}>—— 技能交换</p>
          <h1 className="text-3xl lg:text-4xl font-semibold text-neutral-900 tracking-tight text-balance">
            {activeTab === "offer" ? "邻居能提供什么" : "邻居需要什么"}
          </h1>
        </div>
        <button
          onClick={() => navigate("/skills/create")}
          className="flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white rounded-full text-sm font-medium hover:bg-neutral-800 hover:shadow-[0_8px_24px_-8px_rgba(59,130,246,0.5)] active:scale-[0.97] transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          发布
        </button>
      </div>

      {/* Tab 切换：简洁下划线式，激活态下划线使用技能模块蓝 */}
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
              className={`absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 transition-transform duration-200 ${
                activeTab === key ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        ))}
      </div>

      {/* 搜索 + 分类筛选 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜索技能..."
            className="w-full pl-10 pr-10 py-2.5 bg-neutral-100 border border-transparent rounded-lg text-sm focus:outline-none focus:bg-white focus:border-neutral-300 transition-colors"
          />
          {searchInput && (
            <X
              className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 hover:text-neutral-600 cursor-pointer"
              onClick={() => setSearchInput("")}
            />
          )}
        </div>
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className="px-4 py-2.5 bg-neutral-100 border border-transparent rounded-lg text-sm text-neutral-700 focus:outline-none focus:bg-white focus:border-neutral-300 transition-colors cursor-pointer"
        >
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* 列表区 */}
      <div>
        {loading && posts.length === 0 && <SkeletonListCard count={5} />}
        {posts.map(renderItem)}

        {loading && posts.length > 0 && (
          <div className="text-center py-6 text-neutral-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-neutral-400 inline-block mr-2 align-middle" />
            加载中...
          </div>
        )}

        {hasMore && !loading && posts.length > 0 && (
          <LoadingButton onClick={() => loadPosts()} variant="outline" fullWidth className="mt-6">
            加载更多
          </LoadingButton>
        )}

        {!loading && posts.length === 0 && (
          <Empty title="暂无相关技能" description="发布后会在这里显示" />
        )}
      </div>
    </div>
  );
}
