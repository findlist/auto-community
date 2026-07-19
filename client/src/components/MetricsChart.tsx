import { useState } from "react";
import { LineChart } from "@/components/Charts";

interface MetricsChartProps {
  title: string;
  data: { date: string; value: number }[];
  color?: string;
  unit?: string;
  timeRange?: "7d" | "30d" | "90d";
  onTimeRangeChange?: (range: "7d" | "30d" | "90d") => void;
}

const TIME_RANGE_OPTIONS = [
  { value: "7d" as const, label: "7天" },
  { value: "30d" as const, label: "30天" },
  { value: "90d" as const, label: "90天" },
];

export default function MetricsChart({
  title,
  data,
  color = "var(--color-primary-500)",
  unit = "",
  timeRange: controlledTimeRange,
  onTimeRangeChange,
}: MetricsChartProps) {
  const [internalTimeRange, setInternalTimeRange] = useState<"7d" | "30d" | "90d">("7d");

  const timeRange = controlledTimeRange ?? internalTimeRange;

  const handleTimeRangeChange = (range: "7d" | "30d" | "90d") => {
    if (onTimeRangeChange) {
      onTimeRangeChange(range);
    } else {
      setInternalTimeRange(range);
    }
  };

  const labels = data.map((item) => {
    const date = new Date(item.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  const values = data.map((item) => item.value);

  const series = [
    {
      name: title,
      data: values,
      color,
    },
  ];

  return (
    <div className="bg-white rounded-2xl p-5 border border-[var(--color-border)] shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {title}
          </h3>
          {unit && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              单位：{unit}
            </p>
          )}
        </div>
        <div className="flex gap-1 bg-[var(--color-neutral-100)] rounded-lg p-0.5">
          {TIME_RANGE_OPTIONS.map((option) => (
            // 触控目标升级：py-1→py-1.5 使按钮高度达 32px（原 24px 不达移动端触控标准）
            <button
              key={option.value}
              onClick={() => handleTimeRangeChange(option.value)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                timeRange === option.value
                  ? "bg-white text-[var(--color-text-primary)] shadow-sm font-medium"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <LineChart
        labels={labels}
        series={series}
        height={200}
        showLegend={false}
      />
    </div>
  );
}
