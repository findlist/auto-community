/**
 * 轻量级数据可视化组件（无外部依赖）
 * - BarChart：水平条形图
 * - LineChart：折线图（SVG 实现）
 * - PieChart：饼图（SVG 实现）
 * - ProgressBar：进度条
 *
 * 设计原则：零依赖、性能优、Design Token 适配
 */
import { ReactNode, useState, useEffect, useMemo, useCallback } from "react";

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
};

const darkenColor = (hex: string, amount: number) => {
  const num = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
};

function ChartTooltip({
  x,
  y,
  label,
  value,
  color,
}: {
  x: number;
  y: number;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="pointer-events-none z-50"
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -100%)",
        marginTop: -10,
      }}
    >
      <div
        className="rounded-lg px-3 py-2 text-xs shadow-lg whitespace-nowrap"
        style={{
          background: "white",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-center gap-1.5 mb-0.5">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-[var(--color-text-secondary)]">{label}</span>
        </div>
        <div className="font-semibold text-[var(--color-text-primary)]">
          {value}
        </div>
      </div>
    </div>
  );
}

/* ============= 折线图 ============= */
export interface LineSeries {
  name: string;
  data: number[];
  color: string;
}

export interface LineChartProps {
  labels: string[];
  series: LineSeries[];
  height?: number;
  showLegend?: boolean;
  yAxisLabel?: string;
}

export function LineChart({
  labels,
  series,
  height = 220,
  showLegend = true,
}: LineChartProps) {
  const reducedMotion = useReducedMotion();
  const [hoveredPoint, setHoveredPoint] = useState<{
    seriesIdx: number;
    pointIdx: number;
  } | null>(null);

  const handlePointEnter = useCallback(
    (seriesIdx: number, pointIdx: number) => {
      setHoveredPoint({ seriesIdx, pointIdx });
    },
    []
  );

  const handlePointLeave = useCallback(() => {
    setHoveredPoint(null);
  }, []);

  const layout = useMemo(() => {
    const width = 600;
    const padding = { top: 20, right: 16, bottom: 32, left: 40 };
    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;
    const allValues = series.flatMap((s) => s.data);
    const maxVal = Math.max(1, ...allValues);
    const stepX = innerW / Math.max(1, labels.length - 1);
    const yTicks = 4;
    const ySteps = Array.from({ length: yTicks + 1 }, (_, i) =>
      Math.round((maxVal * i) / yTicks)
    );
    return { width, padding, innerW, innerH, maxVal, stepX, ySteps };
  }, [labels.length, series, height]);

  const getPointPos = useCallback(
    (pointIdx: number, value: number) => {
      const x = layout.padding.left + pointIdx * layout.stepX;
      const y =
        layout.padding.top +
        layout.innerH -
        (value / layout.maxVal) * layout.innerH;
      return { x, y };
    },
    [layout]
  );

  if (!labels.length || !series.length) {
    return (
      <div className="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
        暂无数据
      </div>
    );
  }

  const transition = reducedMotion ? "none" : "all 0.2s ease";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${layout.width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        role="img"
        aria-label="折线图"
      >
        {layout.ySteps.map((val, i) => {
          const y =
            layout.padding.top +
            layout.innerH -
            (val / layout.maxVal) * layout.innerH;
          return (
            <g key={i}>
              <line
                x1={layout.padding.left}
                y1={y}
                x2={layout.padding.left + layout.innerW}
                y2={y}
                stroke="var(--color-border)"
                strokeDasharray="2 4"
                strokeWidth={1}
              />
              <text
                x={layout.padding.left - 6}
                y={y + 3}
                fontSize="10"
                fill="var(--color-text-tertiary)"
                textAnchor="end"
              >
                {val}
              </text>
            </g>
          );
        })}

        {labels.map((lbl, i) => (
          <text
            key={i}
            x={layout.padding.left + i * layout.stepX}
            y={height - 8}
            fontSize="10"
            fill="var(--color-text-tertiary)"
            textAnchor="middle"
          >
            {lbl}
          </text>
        ))}

        {hoveredPoint && (
          <line
            x1={layout.padding.left + hoveredPoint.pointIdx * layout.stepX}
            y1={layout.padding.top}
            x2={layout.padding.left + hoveredPoint.pointIdx * layout.stepX}
            y2={layout.padding.top + layout.innerH}
            stroke="var(--color-text-tertiary)"
            strokeDasharray="4 3"
            strokeWidth={1}
            opacity={0.5}
            style={{ transition }}
          />
        )}

        {series.map((s, si) => {
          const points = s.data
            .map((v, i) => {
              const pos = getPointPos(i, v);
              return `${pos.x},${pos.y}`;
            })
            .join(" ");
          return (
            <g key={s.name}>
              <polyline
                points={points}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.data.map((v, pi) => {
                const pos = getPointPos(pi, v);
                const isHovered =
                  hoveredPoint?.seriesIdx === si &&
                  hoveredPoint?.pointIdx === pi;
                return (
                  <g key={pi}>
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={12}
                      fill="transparent"
                      onMouseEnter={() => handlePointEnter(si, pi)}
                      onMouseLeave={handlePointLeave}
                      style={{ cursor: "pointer" }}
                    />
                    {isHovered && (
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={5}
                        fill={s.color}
                        stroke="white"
                        strokeWidth={2.5}
                        style={{ transition }}
                      />
                    )}
                    {!isHovered && (
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={3}
                        fill="white"
                        stroke={s.color}
                        strokeWidth={2}
                        style={{ transition }}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {hoveredPoint && (() => {
        const s = series[hoveredPoint.seriesIdx];
        if (!s) return null;
        const v = s.data[hoveredPoint.pointIdx];
        if (v === undefined) return null;
        const label = labels[hoveredPoint.pointIdx];
        if (label === undefined) return null;
        const pos = getPointPos(hoveredPoint.pointIdx, v);
        return (
          <ChartTooltip
            x={(pos.x / layout.width) * 100}
            y={pos.y}
            label={label}
            value={`${s.name}: ${v}`}
            color={s.color}
          />
        );
      })()}

      {showLegend && (
        <div className="flex flex-wrap gap-3 mt-2 text-xs">
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[var(--color-text-secondary)]">
                {s.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============= 饼图 ============= */
export interface PieData {
  name: string;
  value: number;
  color: string;
}

export interface PieChartProps {
  data: PieData[];
  size?: number;
}

export function PieChart({ data, size = 180 }: PieChartProps) {
  const reducedMotion = useReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleSliceEnter = useCallback((idx: number) => {
    setHoveredIndex(idx);
  }, []);

  const handleSliceLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  const total = useMemo(
    () => data.reduce((s, d) => s + d.value, 0) || 1,
    [data]
  );
  const radius = size / 2;
  const cx = radius;
  const cy = radius;

  const slices = useMemo(() => {
    let cumulative = 0;
    return data.map((d) => {
      const startAngle = (cumulative / total) * 2 * Math.PI;
      cumulative += d.value;
      const endAngle = (cumulative / total) * 2 * Math.PI;
      const midAngle = (startAngle + endAngle) / 2;
      const x1 = cx + radius * Math.sin(startAngle);
      const y1 = cy - radius * Math.cos(startAngle);
      const x2 = cx + radius * Math.sin(endAngle);
      const y2 = cy - radius * Math.cos(endAngle);
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
      const labelR = radius * 0.7;
      return {
        ...d,
        d: `M ${cx},${cy} L ${x1},${y1} A ${radius},${radius} 0 ${largeArc} 1 ${x2},${y2} Z`,
        percent: (d.value / total) * 100,
        midX: cx + labelR * Math.sin(midAngle),
        midY: cy - labelR * Math.cos(midAngle),
      };
    });
  }, [data, total, cx, cy, radius]);

  if (!data.length) {
    return (
      <div className="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
        暂无数据
      </div>
    );
  }

  const transition = reducedMotion ? "none" : "all 0.2s ease";

  return (
    <div className="flex items-center gap-4 relative">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="饼图"
      >
        {slices.map((s, i) => {
          const isHovered = hoveredIndex === i;
          return (
            <path
              key={s.name}
              d={s.d}
              fill={isHovered ? darkenColor(s.color, 30) : s.color}
              stroke="white"
              strokeWidth={2}
              style={{
                transform: isHovered
                  ? `scale(1.05)`
                  : "scale(1)",
                transformOrigin: `${cx}px ${cy}px`,
                transition,
                cursor: "pointer",
              }}
              onMouseEnter={() => handleSliceEnter(i)}
              onMouseLeave={handleSliceLeave}
            >
              <title>{`${s.name}: ${s.value} (${s.percent.toFixed(1)}%)`}</title>
            </path>
          );
        })}
        <circle cx={cx} cy={cy} r={radius * 0.5} fill="white" />
        <text
          x={cx}
          y={cy}
          fontSize="14"
          fontWeight="600"
          fill="var(--color-text-primary)"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 14}
          fontSize="9"
          fill="var(--color-text-tertiary)"
          textAnchor="middle"
        >
          总计
        </text>
      </svg>

      {hoveredIndex !== null && (() => {
        const s = slices[hoveredIndex];
        if (!s) return null;
        return (
          <ChartTooltip
            x={size + s.midX}
            y={s.midY}
            label={s.name}
            value={`${s.value} (${s.percent.toFixed(1)}%)`}
            color={s.color}
          />
        );
      })()}

      <ul className="flex-1 space-y-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ backgroundColor: s.color }}
            />
            <span className="flex-1 truncate text-[var(--color-text-primary)]">
              {s.name}
            </span>
            <span className="tabular-nums text-[var(--color-text-tertiary)]">
              {s.value} ({s.percent.toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============= 水平条形图 ============= */
export interface BarChartProps {
  data: Array<{ name: string; value: number; color?: string }>;
  maxValue?: number;
}

export function BarChart({ data, maxValue }: BarChartProps) {
  const reducedMotion = useReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const handleBarEnter = useCallback((idx: number) => {
    setHoveredIndex(idx);
  }, []);

  const handleBarLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  if (!data.length) {
    return (
      <div className="text-sm text-[var(--color-text-tertiary)] py-8 text-center">
        暂无数据
      </div>
    );
  }

  const max = maxValue ?? Math.max(1, ...data.map((d) => d.value));
  const transition = reducedMotion ? "none" : "all 0.2s ease";

  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => {
        const percent = (d.value / max) * 100;
        const isHovered = hoveredIndex === i;
        const baseColor = d.color || "var(--color-primary-500)";
        return (
          <li
            key={d.name}
            className="text-xs relative"
            onMouseEnter={() => handleBarEnter(i)}
            onMouseLeave={handleBarLeave}
            style={{ cursor: "default" }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[var(--color-text-primary)] truncate">
                {d.name}
              </span>
              <span
                className="tabular-nums font-medium ml-2"
                style={{
                  color: isHovered ? baseColor : undefined,
                  transition,
                }}
              >
                {d.value}
              </span>
            </div>
            <div className="h-2 bg-[var(--color-neutral-100)] rounded-full overflow-hidden">
              <div className="relative h-full rounded-full" style={{ width: `${percent}%`, transition }}>
                <div
                  className="absolute inset-0 rounded-full"
                  style={{ backgroundColor: baseColor }}
                />
                {isHovered && (
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      backgroundColor: "rgba(0,0,0,0.15)",
                      transition,
                    }}
                  />
                )}
              </div>
            </div>
            {isHovered && (
              <ChartTooltip
                x={percent}
                y={-4}
                label={d.name}
                value={String(d.value)}
                color={baseColor}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ============= 进度条（单值） ============= */
export interface ProgressBarProps {
  value: number;
  max?: number;
  color?: string;
  label?: string;
  showValue?: boolean;
}

export function ProgressBar({
  value,
  max = 100,
  color,
  label,
  showValue = true,
}: ProgressBarProps) {
  const percent = Math.min(100, (value / max) * 100);
  return (
    <div>
      {label && (
        <div className="flex justify-between text-xs mb-1">
          <span className="text-[var(--color-text-secondary)]">{label}</span>
          {showValue && (
            <span className="tabular-nums text-[var(--color-text-primary)] font-medium">
              {value}/{max}
            </span>
          )}
        </div>
      )}
      <div className="h-2 bg-[var(--color-neutral-100)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${percent}%`,
            backgroundColor: color || "var(--color-primary-500)",
          }}
        />
      </div>
    </div>
  );
}

/* ============= 图表卡片容器 ============= */
export interface ChartCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
}

export function ChartCard({ title, subtitle, children, action }: ChartCardProps) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-[var(--color-border)] shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
          {subtitle && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
