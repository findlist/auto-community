import { useAuth } from "@/hooks/useAuth";
import { CreditCard, ArrowUpRight, ArrowDownRight, Snowflake, RotateCcw, Clock, TrendingUp, ArrowLeft, Loader2 } from "lucide-react";
import Empty from "@/components/Empty";
import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { getCreditHistory } from "@/api/user";
import type { CreditTransaction } from "@/types";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

// 交易类型中文映射
const typeLabel: Record<string, string> = {
  earn: "收入",
  spend: "支出",
  freeze: "冻结",
  unfreeze: "解冻",
  refund: "退款",
  time_earn: "时间收入",
  time_spend: "时间支出",
};

// 交易类型图标颜色
const typeStyle: Record<CreditTransaction['type'], { color: string; bg: string; icon: typeof ArrowUpRight }> = {
  earn: { color: "text-green-600", bg: "bg-green-50", icon: ArrowUpRight },
  spend: { color: "text-red-600", bg: "bg-red-50", icon: ArrowDownRight },
  freeze: { color: "text-blue-600", bg: "bg-blue-50", icon: Snowflake },
  unfreeze: { color: "text-emerald-600", bg: "bg-emerald-50", icon: RotateCcw },
  refund: { color: "text-amber-600", bg: "bg-amber-50", icon: RotateCcw },
  time_earn: { color: "text-purple-600", bg: "bg-purple-50", icon: TrendingUp },
  time_spend: { color: "text-orange-600", bg: "bg-orange-50", icon: ArrowDownRight },
};

const PAGE_SIZE = 20;

export default function PointsDetail() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // 竞态守卫：跟踪当前活跃页码，避免快速翻页时旧请求覆盖新页数据
  // 设计原因：fetchTransactions 依赖外部 page 参数，用户快速点击下一页/上一页时
  // 旧请求的 await 仍在进行，完成后 setTransactions 会用旧页数据覆盖新页数据
  const activePageRef = useRef(page);

  const fetchTransactions = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getCreditHistory(p, PAGE_SIZE);
      // 竞态守卫：await 期间若 page 已变化，跳过 setState 避免旧页数据覆盖新页数据
      if (activePageRef.current !== p) return;
      setTransactions(res.data.list);
      setTotal(res.data.total);
    } catch (err) {
      if (activePageRef.current !== p) return;
      // 加载失败需提示用户，避免误以为账户无记录（区分"无数据"与"加载失败"）
      toast.error(getErrorMessage(err, "加载积分明细失败，请稍后重试"));
    } finally {
      // 仅当当前页码仍为活跃时才更新 loading，避免旧请求的 finally 覆盖新请求的 loading 状态
      if (activePageRef.current === p) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      // 同步活跃页码并触发请求
      activePageRef.current = page;
      fetchTransactions(page);
    }
    return () => {
      // 卸载时重置 activePageRef 让进行中请求失效，避免卸载后 setState 泄漏
      // 设计原因：fetchTransactions 内部用 activePageRef.current === p 守卫，
      // 若 cleanup 不重置 ref，进行中请求的 p 仍匹配，await 后会触发 setState
      activePageRef.current = -1;
    };
  }, [page, isAuthenticated, fetchTransactions]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <Clock className="w-16 h-16 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-4">请先登录</p>
        <Link to="/login" className="px-6 py-2 bg-emerald-500 text-white rounded-lg">
          去登录
        </Link>
      </div>
    );
  }

  // 格式化金额正负号
  function formatAmount(type: string, amount: number): string {
    const prefix = ["earn", "unfreeze", "refund", "time_earn"].includes(type) ? "+" : "-";
    return `${prefix}${Math.abs(amount)}`;
  }

  function amountClass(type: string): string {
    return ["earn", "unfreeze", "refund", "time_earn"].includes(type)
      ? "text-green-600"
      : "text-red-600";
  }

  // 格式化时间
  function formatTime(iso: string): string {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hours}:${minutes}`;
  }

  return (
    // max-w-2xl mx-auto：桌面端约束内容宽度，与项目其他列表页一致
    <div className="max-w-2xl mx-auto px-4 py-4">
      {/* 返回按钮 + 标题 */}
      <div className="flex items-center gap-3 mb-4">
        {/* 触控区域标准：py-1.5 px-2 ≥40px，-ml-2 抵消父容器 px-4 保持视觉对齐 */}
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-gray-600 py-1.5 px-2 -ml-2 rounded hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <h2 className="text-lg font-semibold text-gray-900">积分明细</h2>
      </div>

      {/* 积分余额卡片 */}
      <div className="bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-xl p-5 mb-4 text-white">
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="w-5 h-5 opacity-80" />
          <span className="text-sm opacity-80">当前积分余额</span>
        </div>
        <div className="text-3xl font-bold">{user?.creditBalance ?? 0}</div>
      </div>

      {/* 交易记录列表 */}
      <div className="bg-white rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-700">
            交易记录
            {total > 0 && <span className="text-gray-400 ml-1">（共 {total} 条）</span>}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          </div>
        ) : transactions.length === 0 ? (
          <Empty title="暂无交易记录" description="积分收支记录会在这里显示" icon={<CreditCard className="w-16 h-16" />} />
        ) : (
          transactions.map((tx) => {
            const style = typeStyle[tx.type] || typeStyle.spend;
            const Icon = style.icon;
            return (
              <div key={tx.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                <div className={`w-9 h-9 rounded-full ${style.bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${style.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{tx.description || typeLabel[tx.type] || tx.type}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatTime(tx.createdAt)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-medium ${amountClass(tx.type)}`}>
                    {formatAmount(tx.type, tx.amount)}
                  </p>
                  {tx.balanceAfter !== undefined && (
                    <p className="text-xs text-gray-400 mt-0.5">余额 {tx.balanceAfter}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg bg-white text-gray-600 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            上一页
          </button>
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-white text-gray-600 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
