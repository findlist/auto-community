import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Gift, Heart, TrendingUp, TrendingDown, Clock, AlertCircle, Loader2 } from "lucide-react";
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

  const loadAccount = useCallback(async () => {
    try {
      const res = await getAccount();
      setAccount(res.data);
      setAccountError(null);
    } catch {
      setAccountError("加载账户信息失败");
    }
  }, []);

  const loadTransactions = useCallback(async (reset = false) => {
    try {
      // 游标分页：reset 时从第一页开始（cursor 为空）
      const currentCursor = reset ? undefined : cursor;
      const res = await getTransactions(currentCursor, 20);
      const { list, nextCursor, hasMore } = res.data;
      setTransactions(prev => reset ? list : [...prev, ...list]);
      setCursor(nextCursor ?? undefined);
      setHasMore(hasMore);
      setTransactionsError(null);
    } catch {
      setTransactionsError("加载交易记录失败");
    }
  }, [cursor]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
      return;
    }
    Promise.all([loadAccount(), loadTransactions(true)]).finally(() => setLoading(false));
    // navigate 稳定、loadAccount 无依赖（均引用稳定）安全纳入
    // loadTransactions 依赖 cursor，纳入会导致游标分页后无限重载，故显式排除
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
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">时间账户</h1>
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

      <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl p-5 text-white mb-4 shadow-sm">
        <div className="flex items-center gap-2 mb-1 text-emerald-100 text-sm">
          <Clock className="w-4 h-4" />
          当前余额
        </div>
        <div className="text-3xl font-bold mb-4">
          {account ? formatTime(account.balance) : "--"}
        </div>
        <div className="flex gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-200" />
            <span className="text-emerald-100">累计赚取</span>
            <span className="font-medium">{account ? formatTime(account.totalEarned) : "--"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <TrendingDown className="w-4 h-4 text-emerald-200" />
            <span className="text-emerald-100">累计消费</span>
            <span className="font-medium">{account ? formatTime(account.totalSpent) : "--"}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setTransferOpen(true)}
          className="py-3 bg-emerald-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-emerald-700 transition-colors"
        >
          <Gift className="w-4 h-4" />
          转赠时间
        </button>
        <button
          onClick={() => setDonateOpen(true)}
          className="py-3 bg-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-purple-700 transition-colors"
        >
          <Heart className="w-4 h-4" />
          捐赠时间
        </button>
      </div>

      <h2 className="text-base font-semibold text-gray-900 mb-3">交易记录</h2>

      <div className="space-y-3">
        {transactions.map(tx => {
          const cfg = typeConfig[tx.type] || { label: tx.type, color: "bg-gray-100 text-gray-600" };
          return (
            <div key={tx.id} className="bg-white rounded-lg p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs px-2 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
                <span className={`font-semibold ${tx.type === "spend" ? "text-red-600" : "text-emerald-600"}`}>
                  {tx.type === "spend" ? "-" : "+"}{formatTime(tx.amount)}
                </span>
              </div>
              {tx.remark && <p className="text-sm text-gray-500 mt-1">{tx.remark}</p>}
              <p className="text-xs text-gray-400 mt-2">
                {new Date(tx.createdAt).toLocaleString("zh-CN")}
              </p>
            </div>
          );
        })}
      </div>

      {hasMore && transactions.length > 0 && (
        <button
          onClick={() => loadTransactions()}
          className="w-full py-3 mt-4 text-center text-emerald-600 hover:bg-emerald-50 rounded-lg"
        >
          加载更多
        </button>
      )}

      {!loading && transactions.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <p>暂无交易记录</p>
        </div>
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
