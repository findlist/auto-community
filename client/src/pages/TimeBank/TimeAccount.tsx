import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Gift, Heart, TrendingUp, TrendingDown, Clock, AlertCircle, Loader2 } from "lucide-react";
import Empty from "@/components/Empty";
import { getAccount, getTransactions } from "@/api/timeBank";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/utils/format";
import type { TimeAccount as TimeAccountType, TimeTransaction } from "@/types";
import TransferModal from "./TransferModal";
import DonateModal from "./DonateModal";

const typeConfig: Record<string, { label: string; color: string }> = {
  earn: { label: "赚取", color: "bg-green-100 text-green-700" },
  spend: { label: "消费", color: "bg-red-100 text-red-700" },
  transfer: { label: "转赠", color: "bg-blue-100 text-blue-700" },
  donate: { label: "捐赠", color: "bg-purple-100 text-purple-700" },
  bonus: { label: "奖励", color: "bg-amber-100 text-amber-700" },
};

export default function TimeAccountPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [account, setAccount] = useState<TimeAccountType | null>(null);
  const [transactions, setTransactions] = useState<TimeTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [transferOpen, setTransferOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  // 分离账户与交易记录的错误状态，避免并行加载时互相覆盖
  // 设计原因：loadAccount 与 loadTransactions 在 useEffect 中并行执行，
  // 共用单一 error state 会导致一方失败、另一方成功时错误被 setError(null) 清空
  const [accountError, setAccountError] = useState<string | null>(null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  // 合并错误：账户错误优先于交易记录错误展示（账户信息更关键）
  const error = accountError ?? transactionsError;
  // 挂载标志：useEffect cleanup 时置为 false，loadAccount/loadTransactions await 后检查避免卸载后 setState 泄漏
  // 设计原因：loadAccount/loadTransactions 由 useEffect 通过 Promise.all 触发，两路异步在卸载后 resolve 都会触发 setState 泄漏
  const mountedRef = useRef(true);

  const loadAccount = useCallback(async () => {
    try {
      const res = await getAccount();
      // 卸载后不再 setState，避免 React 警告与内存泄漏
      if (!mountedRef.current) return;
      setAccount(res.data);
      setAccountError(null);
    } catch {
      if (!mountedRef.current) return;
      setAccountError("加载账户信息失败");
    }
  }, []);

  const loadTransactions = useCallback(async (reset = false) => {
    try {
      // 游标分页：reset 时从第一页开始（cursor 为空）
      const currentCursor = reset ? undefined : cursor;
      const res = await getTransactions(currentCursor, 20);
      if (!mountedRef.current) return;
      const { list, nextCursor, hasMore } = res.data;
      setTransactions(prev => reset ? list : [...prev, ...list]);
      setCursor(nextCursor ?? undefined);
      setHasMore(hasMore);
      setTransactionsError(null);
    } catch {
      if (!mountedRef.current) return;
      setTransactionsError("加载交易记录失败");
    }
  }, [cursor]);

  useEffect(() => {
    // 重置挂载标志：组件重新挂载时恢复为 true
    mountedRef.current = true;
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    Promise.all([loadAccount(), loadTransactions(true)]).finally(() => {
      // 仅挂载中才更新 loading，避免卸载后 finally 触发 setState
      if (mountedRef.current) setLoading(false);
    });
    // cleanup：组件卸载时置为 false，使进行中的 loadAccount/loadTransactions 失效
    // navigate 稳定、loadAccount 无依赖（均引用稳定）安全纳入
    // loadTransactions 依赖 cursor，纳入会导致游标分页后无限重载，故显式排除
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, navigate, loadAccount]);

  const handleTransferSuccess = () => {
    loadAccount();
    loadTransactions(true);
  };

  const handleDonateSuccess = () => {
    loadAccount();
    loadTransactions(true);
  };

  if (loading) {
    return (
      <div className="px-4 py-4 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    // max-w-2xl mx-auto：账户页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="px-4 lg:px-10 py-6 pb-24 lg:pb-12 max-w-2xl mx-auto">
      {/* 顶部返回 + 模块小标签，与其他时间银行页保持编辑式风格 */}
      <div className="mb-6 lg:mb-8">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回
        </button>
        <p className="text-xs tracking-widest mb-2 font-mono" style={{ color: "var(--color-module-timebank)" }}>
          —— 时间账户
        </p>
        <h1 className="text-2xl lg:text-3xl font-semibold text-neutral-900 tracking-tight text-balance">
          你的时间，存在这里
        </h1>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button
            onClick={() => {
              // 重试前清空两路错误状态，让用户在加载期间看到干净界面
              // 设计原因：error 为派生值，必须同时清空 accountError/transactionsError 才能隐藏错误条
              setAccountError(null);
              setTransactionsError(null);
              Promise.all([loadAccount(), loadTransactions(true)]);
            }}
            // 触摸目标提升：原纯 text-xs underline 无 padding，移动端难以精准点击
            className="ml-auto text-xs underline py-1 px-2 rounded hover:bg-red-50 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* 余额卡片：采用时间银行模块紫渐变，与列表页 Tab 下划线、竖条等模块色一致 */}
      <div className="bg-gradient-to-br from-violet-500 to-violet-700 rounded-2xl p-6 lg:p-7 text-white mb-6 shadow-md relative overflow-hidden">
        {/* 右上角微光晕装饰，避免大面积纯色单调 */}
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2 text-violet-100 text-xs tracking-widest font-mono uppercase">
            <Clock className="w-3.5 h-3.5" />
            当前余额
          </div>
          <div className="text-4xl lg:text-5xl font-bold mb-5 tracking-tight tabular-nums">
            {account ? formatTime(account.balance) : "--"}
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-violet-200" />
              <span className="text-violet-100">累计赚取</span>
              <span className="font-medium tabular-nums">{account ? formatTime(account.totalEarned) : "--"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-violet-200" />
              <span className="text-violet-100">累计消费</span>
              <span className="font-medium tabular-nums">{account ? formatTime(account.totalSpent) : "--"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮：转赠/捐赠使用时间银行模块紫，与卡片色系一致 */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <button
          onClick={() => setTransferOpen(true)}
          className="py-3 bg-violet-600 text-white rounded-full font-medium flex items-center justify-center gap-2 hover:bg-violet-700 active:scale-[0.98] transition-all duration-200 shadow-sm"
        >
          <Gift className="w-4 h-4" />
          转赠时间
        </button>
        <button
          onClick={() => setDonateOpen(true)}
          className="py-3 bg-white text-violet-700 border border-violet-200 rounded-full font-medium flex items-center justify-center gap-2 hover:border-violet-400 hover:bg-violet-50 active:scale-[0.98] transition-all duration-200"
        >
          <Heart className="w-4 h-4" />
          捐赠时间
        </button>
      </div>

      {/* 交易记录标题：编辑式小标签 */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold text-neutral-900 tracking-tight">交易记录</h2>
        <span className="text-xs text-neutral-400 font-mono tracking-widest">—— 流水</span>
      </div>

      {/* 交易列表：编辑式分隔线风格，与 ServiceCard 视觉语言保持一致 */}
      <div className="flex flex-col">
        {transactions.map(tx => {
          const cfg = typeConfig[tx.type] || { label: tx.type, color: "bg-neutral-100 text-neutral-600" };
          const isSpend = tx.type === "spend";
          return (
            <div
              key={tx.id}
              className="group border-b border-neutral-200 py-4 lg:py-5 -mx-4 px-4 lg:-mx-6 lg:px-6 transition-colors duration-200 hover:bg-neutral-50/60"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${cfg.color}`}>{cfg.label}</span>
                <span className={`font-semibold tabular-nums text-sm ${isSpend ? "text-red-600" : "text-emerald-600"}`}>
                  {isSpend ? "-" : "+"}{formatTime(tx.amount)}
                </span>
              </div>
              {tx.remark && <p className="text-sm text-neutral-700 line-clamp-1 mb-1">{tx.remark}</p>}
              <p className="text-xs text-neutral-400 font-mono">
                {new Date(tx.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
          );
        })}
      </div>

      {hasMore && transactions.length > 0 && (
        <button
          onClick={() => loadTransactions()}
          className="w-full py-3 mt-5 text-center text-violet-700 hover:bg-violet-50 rounded-full text-sm font-medium transition-colors"
        >
          加载更多
        </button>
      )}

      {!loading && transactions.length === 0 && (
        <Empty title="暂无交易记录" description="时间币收支记录会在这里显示" />
      )}

      <TransferModal
        open={transferOpen}
        onClose={() => setTransferOpen(false)}
        onSuccess={handleTransferSuccess}
        currentBalance={account?.balance}
      />
      <DonateModal
        open={donateOpen}
        onClose={() => setDonateOpen(false)}
        onSuccess={handleDonateSuccess}
        currentBalance={account?.balance}
      />
    </div>
  );
}
