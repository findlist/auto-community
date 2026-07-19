/**
 * AI 智能推荐组件
 * 展示匹配度、信誉分、距离等关键信息
 */
import { useEffect, useState } from "react";
import { Sparkles, Star, MapPin, Loader2, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { matchSkill, matchTimeService, type MatchCandidate } from "@/api/ai";
import { ApiError } from "@/api/client";
import { trackEvent } from "@/utils/ab-test";

interface AIRecommendProps {
  /** 技能帖子 ID 或时间银行服务 ID */
  postId: string;
  /** 推荐类型 */
  type: "skill" | "time-bank";
  /** 推荐标题 */
  title?: string;
}

function MatchScoreBar({ score }: { score: number }) {
  const percent = Math.round(score * 100);
  const color =
    percent >= 80
      ? "bg-[var(--color-success)]"
      : percent >= 60
      ? "bg-[var(--color-primary-500)]"
      : "bg-[var(--color-warning)]";
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <div className="flex-1 h-1.5 bg-[var(--color-neutral-200)] rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-[var(--color-text-primary)] w-9 text-right tabular-nums">
        {percent}%
      </span>
    </div>
  );
}

function ReputationStars({ score }: { score: number }) {
  const stars = Math.round(score / 2); // 0-5 星
  return (
    <div className="flex items-center gap-0.5" aria-label={`信誉分 ${score.toFixed(1)}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${
            i <= stars ? "fill-[var(--color-warning)] text-[var(--color-warning)]" : "text-[var(--color-neutral-300)]"
          }`}
        />
      ))}
      <span className="ml-1 text-xs text-[var(--color-text-tertiary)] tabular-nums">
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function CandidateCard({ candidate, type }: { candidate: MatchCandidate; type: "skill" | "time-bank" }) {
  const path = type === "skill" ? "/skills" : "/time-bank";
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-primary-300)] hover:shadow-sm transition-all duration-200 stagger-item">
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-[var(--color-primary-400)] to-[var(--color-primary-600)] text-white flex items-center justify-center text-sm font-semibold">
        {candidate.nickname?.charAt(0)?.toUpperCase() || "?"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
            {candidate.nickname || "匿名用户"}
          </span>
          <ReputationStars score={candidate.reputationScore} />
        </div>
        <MatchScoreBar score={candidate.matchScore} />
        {candidate.post && (
          <p className="mt-1 text-xs text-[var(--color-text-secondary)] truncate">
            {candidate.post.title}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-text-tertiary)]">
          {candidate.distance !== null && (
            <span className="flex items-center gap-0.5">
              <MapPin className="w-3 h-3" />
              {candidate.distance < 1000
                ? `${candidate.distance}m`
                : `${(candidate.distance / 1000).toFixed(1)}km`}
            </span>
          )}
        </div>
      </div>
      {candidate.post && (
        // 触控目标升级：py-1→py-1.5 使按钮高度达 32px（原 24px 不达移动端触控标准）
        <Link
          to={`${path}/${candidate.post.id}`}
          onClick={() => {
            trackEvent('ai_recommendation_vs_keyword', 'click', { postId: candidate.post?.id }).catch(() => {});
          }}
          className="flex-shrink-0 text-xs text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)] font-medium px-3 py-1.5"
          aria-label={`查看 ${candidate.post.title}`}
        >
          查看
        </Link>
      )}
    </div>
  );
}

export default function AIRecommend({ postId, type, title }: AIRecommendProps) {
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetcher = type === "skill" ? matchSkill : matchTimeService;
    fetcher(postId)
      .then((data) => {
        if (!cancelled) {
          setCandidates(data);
          setLoading(false);
          if (data.length > 0) {
            trackEvent('ai_recommendation_vs_keyword', 'impression', { postId, count: data.length }).catch(() => {});
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          // 错误已被 axios 拦截器统一封装为 ApiError，直接读取 message 即可
          setError(err instanceof ApiError ? err.message : "推荐加载失败");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [postId, type]);

  return (
    <section
      aria-labelledby="ai-recommend-title"
      className="bg-gradient-to-br from-[var(--color-primary-50)] to-[var(--color-secondary-50)] rounded-2xl p-4 border border-[var(--color-primary-100)]"
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-[var(--color-primary-600)]" aria-hidden />
        <h3 id="ai-recommend-title" className="text-base font-semibold text-[var(--color-text-primary)]">
          {title || "AI 智能推荐"}
        </h3>
        <span className="text-xs text-[var(--color-text-tertiary)]">基于语义匹配 · 距离 · 信誉</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          正在匹配中...
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-[var(--color-text-tertiary)]" role="status">
          <AlertCircle className="w-4 h-4" aria-hidden />
          暂无推荐
        </div>
      )}

      {!loading && !error && candidates.length === 0 && (
        <div className="py-6 text-sm text-center text-[var(--color-text-tertiary)]">
          暂无符合条件的推荐
        </div>
      )}

      {!loading && !error && candidates.length > 0 && (
        <div className="space-y-2">
          {candidates.slice(0, 5).map((c, idx) => (
            <CandidateCard key={`${c.userId}-${idx}`} candidate={c} type={type} />
          ))}
        </div>
      )}
    </section>
  );
}
