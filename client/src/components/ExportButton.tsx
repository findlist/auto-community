/**
 * 数据导出按钮组件（下拉菜单版）
 * 封装 CSV / Excel 双格式导出的加载状态、错误提示、下载触发逻辑，供管理后台列表页复用
 * 设计原因：不同办公场景对表格格式需求不同，CSV 适合程序处理、Excel 适合人工查阅，
 *           合并为单个下拉按钮避免页面出现多个导出按钮造成视觉冗余
 */
import { useState, useRef, useEffect } from "react";
import { Download, Loader2, ChevronDown, FileText, FileSpreadsheet } from "lucide-react";
import { exportData, type ExportType, type ExportParams, type ExportFormat } from "@/api/admin";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";

interface ExportButtonProps {
  /** 导出数据类型 */
  type: ExportType;
  /** 导出筛选参数（status/orderType/时间范围等） */
  params?: ExportParams;
  /** 触发按钮文案，默认"导出数据" */
  label?: string;
  /** 自定义样式类名 */
  className?: string;
}

// 可选导出格式清单：集中维护便于后续扩展（如 PDF）
const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string; icon: typeof FileText }> = [
  { value: "csv", label: "导出 CSV", icon: FileText },
  { value: "xlsx", label: "导出 Excel", icon: FileSpreadsheet },
];

export default function ExportButton({
  type,
  params,
  label = "导出数据",
  className = "",
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeFormat, setActiveFormat] = useState<ExportFormat | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击组件外部时关闭菜单：监听 mousedown，避免点击菜单项时先关闭导致事件丢失
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleExport = async (format: ExportFormat) => {
    if (exporting) return;
    setOpen(false);
    setExporting(true);
    setActiveFormat(format);
    try {
      await exportData(type, params, format);
      toast.success("导出成功，请查看下载文件");
    } catch (err) {
      // 区分 API 业务错误与未知异常，给出精准提示
      const message = err instanceof ApiError ? err.message : "导出失败，请稍后重试";
      toast.error(message);
    } finally {
      setExporting(false);
      setActiveFormat(null);
    }
  };

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={exporting}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
      >
        {exporting ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        ) : (
          <Download className="w-4 h-4" aria-hidden />
        )}
        {exporting
          ? `导出${activeFormat === "xlsx" ? "Excel" : "CSV"}中...`
          : label}
        {!exporting && <ChevronDown className="w-3.5 h-3.5 opacity-60" aria-hidden />}
      </button>

      {open && !exporting && (
        <ul
          role="menu"
          className="absolute right-0 mt-1 w-36 rounded-lg border border-gray-200 bg-white shadow-lg z-20 overflow-hidden"
        >
          {FORMAT_OPTIONS.map(({ value, label: fmtLabel, icon: Icon }) => (
            <li key={value}>
              <button
                role="menuitem"
                onClick={() => handleExport(value)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
              >
                <Icon className="w-4 h-4 opacity-70" aria-hidden />
                {fmtLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
