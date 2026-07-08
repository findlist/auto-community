import { Clock, MapPin, Star, ArrowUpRight } from "lucide-react";
import { formatTime } from "@/utils/format";
import type { TimeService } from "@/types";

interface ServiceCardProps {
  service: TimeService;
  onClick?: () => void;
}

/**
 * 时间银行服务列表项
 * 编辑式分隔线列表风格，无卡片；悬停时整体右移、显现箭头
 */
export default function ServiceCard({ service, onClick }: ServiceCardProps) {
  const isProvide = service.type === "provide";

  return (
    <div
      onClick={onClick}
      className="group flex items-start gap-4 lg:gap-6 border-b border-neutral-200 py-5 lg:py-6 cursor-pointer transition-colors duration-200 hover:bg-neutral-50/60 -mx-4 px-4 lg:-mx-6 lg:px-6"
    >
      {/* 左侧：类型竖条标记，颜色区分提供/需求 */}
      <div className="flex-shrink-0 pt-1">
        <span
          className={`block w-1 h-12 rounded-full ${isProvide ? "bg-emerald-500" : "bg-violet-500"}`}
        />
      </div>

      {/* 中间：标题 + 描述 + 元信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2.5 mb-1.5">
          <span
            className={`text-xs font-mono tracking-wider uppercase ${
              isProvide ? "text-emerald-600" : "text-violet-600"
            }`}
          >
            {isProvide ? "提供" : "需求"}
          </span>
          <h3 className="text-base lg:text-lg font-semibold text-neutral-900 truncate group-hover:text-emerald-700 transition-colors">
            {service.title}
          </h3>
          <span className="text-xs text-neutral-400 tabular-nums whitespace-nowrap">
            {formatTime(service.durationMinutes)}
          </span>
        </div>
        <p className="text-sm text-neutral-500 line-clamp-1 mb-2">{service.description}</p>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span className="text-emerald-700/80">{service.category}</span>
          {(service.location || service.address) && (
            <span className="flex items-center gap-0.5">
              <MapPin className="w-3 h-3" />
              {service.location || service.address}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span className="text-neutral-600">{service.user?.nickname}</span>
            {service.user?.reputationScore != null && (
              <span className="flex items-center gap-0.5 text-amber-500">
                <Star className="w-3 h-3 fill-current" />
                {service.user.reputationScore}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* 右侧：悬停显现的箭头 */}
      <ArrowUpRight
        className="flex-shrink-0 w-5 h-5 text-neutral-900 -translate-x-2 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300 mt-1"
        aria-hidden
      />
    </div>
  );
}
