import { MapPin, Star } from "lucide-react";
import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";

// 徽章颜色映射
const badgeColorMap: Record<string, string> = {
  primary: "text-emerald-600", warning: "text-amber-600", error: "text-red-600",
  info: "text-blue-600", neutral: "text-gray-600",
};
// 左侧边框颜色映射（用于紧急程度等场景）
const leftBorderMap: Record<string, string> = {
  red: "border-l-4 border-red-500", orange: "border-l-4 border-orange-400",
  yellow: "border-l-4 border-yellow-400", blue: "border-l-4 border-blue-400",
  emerald: "border-l-4 border-emerald-500", none: "",
};

interface ResponsiveCardProps {
  to?: string;
  onClick?: () => void;
  title: string;
  description?: string;
  image?: string;
  imagePlaceholder?: string;
  tags?: string[];
  badge?: { text: string; color?: "primary" | "warning" | "error" | "info" | "neutral" };
  leftBorder?: "red" | "orange" | "yellow" | "blue" | "emerald" | "none";
  user?: { nickname: string; avatar?: string; reputationScore?: number };
  meta?: string;
  children?: ReactNode;
}

/** 通用响应式卡片 - 用于技能交换、共享厨房、时间银行等模块 */
export function ResponsiveCard({
  to, onClick, title, description, image, imagePlaceholder = "📋",
  tags = [], badge, leftBorder = "none", user, meta, children,
}: ResponsiveCardProps) {
  // 有 to 时用 Link 跳转，否则用 div + onClick
  const Wrapper: ElementType = to ? Link : "div";
  const wrapperProps = to ? { to } : { onClick };

  return (
    <Wrapper {...wrapperProps} className={`bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer p-4 ${leftBorderMap[leftBorder]}`}>
      {/* 图片区域：有图显示图片，无图显示 emoji 占位符 */}
      {image ? (
        <img src={image} alt={title} className="h-40 w-full rounded-lg object-cover mb-3" />
      ) : (
        <div className="h-40 w-full rounded-lg bg-gray-50 flex items-center justify-center text-4xl mb-3">{imagePlaceholder}</div>
      )}
      {/* 标题与徽章 */}
      <div className="flex items-start justify-between mb-1">
        <h3 className="font-medium text-gray-900 flex-1 truncate pr-2">{title}</h3>
        {badge && <span className={`text-sm font-medium whitespace-nowrap ${badgeColorMap[badge.color ?? "primary"]}`}>{badge.text}</span>}
      </div>
      {description && <p className="text-sm text-gray-500 line-clamp-2 mb-2">{description}</p>}
      {/* 标签列表 */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {tags.map((tag) => <span key={tag} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded">{tag}</span>)}
        </div>
      )}
      {children}
      {/* 底部：用户信息 + 元数据 */}
      {(user || meta) && (
        <div className="flex items-center justify-between pt-2 border-t border-gray-50">
          {user && (
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-gray-200 overflow-hidden">
                {user.avatar && <img src={user.avatar} alt="" className="w-full h-full object-cover" />}
              </div>
              <span className="text-sm text-gray-600">{user.nickname}</span>
              {user.reputationScore != null && (
                <span className="flex items-center gap-0.5 text-sm text-amber-500">
                  <Star className="w-3.5 h-3.5 fill-current" />{user.reputationScore}
                </span>
              )}
            </div>
          )}
          {meta && <span className="flex items-center gap-0.5 text-xs text-gray-400"><MapPin className="w-3 h-3" />{meta}</span>}
        </div>
      )}
    </Wrapper>
  );
}

export default ResponsiveCard;
