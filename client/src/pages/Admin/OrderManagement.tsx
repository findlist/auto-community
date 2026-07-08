import { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { getOrders, forceCancelOrder } from "@/api/admin";
import { ApiError } from "@/api/client";
import ExportButton from "@/components/ExportButton";
import type { PaginatedResponse } from "@/types";

const PAGE_SIZE = 20;

// 订单模块配置：key 为前端内部状态（camelCase），apiType 对齐后端 orderType（snake_case）
const typeTabs = [
  { key: "skill", label: "技能", apiType: "skill" as const },
  { key: "kitchen", label: "厨房", apiType: "kitchen" as const },
  { key: "timeBank", label: "时间银行", apiType: "time_bank" as const },
];

// 前端模块 key 映射为后端 orderType，避免 timeBank 直传后端导致 ORDER_CONFIG 查询失败
function toApiType(key: string): "skill" | "kitchen" | "time_bank" {
  const tab = typeTabs.find((t) => t.key === key);
  return tab ? tab.apiType : "skill";
}

// 订单状态筛选配置
const statusTabs = [
  { key: "completed", label: "已完成" },
  { key: "in_progress", label: "进行中" },
  { key: "pending", label: "待处理" },
  { key: "cancelled", label: "已取消" },
];

// 订单列表项：对齐后端 admin.service.getOrders 实际返回字段
// 后端按 type 返回不同动态字段（creditsAmount/totalPrice/durationMinutes），统一声明为可选
interface OrderItem {
  id: string;
  buyer?: { nickname?: string };
  seller?: { nickname?: string };
  buyerId?: string;
  sellerId?: string;
  // skill 订单：积分金额
  creditsAmount?: number;
  // kitchen 订单：总价
  totalPrice?: number;
  // time_bank 订单：服务时长（分钟），原接口缺失导致 time_bank 订单金额列显示 0
  durationMinutes?: number;
  amount?: number;
  status: string;
  createdAt: string;
}

// 取消订单弹窗状态
interface CancelTarget {
  id: string;
}

export default function OrderManagement() {
  const [type, setType] = useState("skill");
  const [status, setStatus] = useState("completed");
  const [list, setList] = useState<OrderItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 加载订单列表
  const loadOrders = useCallback(async (t: string, s: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOrders(toApiType(t), s, p, PAGE_SIZE);
      const data: PaginatedResponse<OrderItem> = res.data;
      setList(data.list);
      setTotalPages(data.totalPages);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders(type, status, 1);
  }, [type, status, loadOrders]);

  // 提交强制取消订单
  const handleConfirmCancel = async () => {
    if (!cancelTarget || !cancelReason.trim()) return;
    setSubmitting(true);
    try {
      await forceCancelOrder(toApiType(type), cancelTarget.id, cancelReason.trim());
      setCancelTarget(null);
      setCancelReason("");
      loadOrders(type, status, page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 获取订单金额/时长展示值
  // 设计原因：time_bank 订单无金额概念，后端返回 durationMinutes（分钟），
  // 原 fallback 链漏掉该字段导致 time_bank 订单金额列显示 0，此处补齐
  const getAmount = (item: OrderItem) => {
    const amount = item.creditsAmount ?? item.totalPrice ?? item.durationMinutes ?? item.amount ?? 0;
    return amount;
  };

  // 金额列表头文案：time_bank 显示"时长(分)"，其余显示"金额"
  const getAmountLabel = () => (toApiType(type) === "time_bank" ? "时长(分)" : "金额");

  // 获取买方昵称
  const getBuyerName = (item: OrderItem) => item.buyer?.nickname || item.buyerId || "-";

  // 获取卖方昵称
  const getSellerName = (item: OrderItem) => item.seller?.nickname || item.sellerId || "-";

  // 状态文案映射
  const getStatusText = (s: string) => {
    const map: Record<string, string> = {
      pending: "待处理",
      accepted: "已接受",
      in_progress: "进行中",
      completed: "已完成",
      cancelled: "已取消",
      disputed: "争议中",
      confirmed: "已确认",
      timeout: "已超时",
      rejected: "已拒绝",
    };
    return map[s] || s;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">订单管理</h2>
        {/* 导出当前类型+状态的订单：toApiType 统一映射前端 key 到后端 orderType */}
        <ExportButton
          type="orders"
          params={{
            orderType: toApiType(type),
            status,
          }}
        />
      </div>

      {/* 模块切换标签 */}
      <div className="flex gap-1 mb-3 border-b border-gray-200 overflow-x-auto">
        {typeTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setType(tab.key)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              type === tab.key
                ? "border-emerald-500 text-emerald-600 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {statusTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatus(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              status === tab.key
                ? "bg-emerald-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : list.length === 0 ? (
        <div className="text-center py-20 text-gray-500">暂无数据</div>
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-gray-100">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left">订单ID</th>
                  <th className="px-4 py-3 text-left">买方</th>
                  <th className="px-4 py-3 text-left">卖方</th>
                  <th className="px-4 py-3 text-left">{getAmountLabel()}</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">创建时间</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {item.id.length > 12 ? `${item.id.slice(0, 12)}...` : item.id}
                    </td>
                    <td className="px-4 py-3">{getBuyerName(item)}</td>
                    <td className="px-4 py-3">{getSellerName(item)}</td>
                    <td className="px-4 py-3">{getAmount(item)}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                        {getStatusText(item.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {item.status !== "cancelled" && item.status !== "completed" ? (
                        <button
                          onClick={() => setCancelTarget({ id: item.id })}
                          className="text-red-600 hover:underline text-xs"
                        >
                          强制取消
                        </button>
                      ) : (
                        <span className="text-gray-400 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片布局 */}
          <div className="md:hidden space-y-3">
            {list.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="font-mono text-xs text-gray-500">
                    {item.id.length > 16 ? `${item.id.slice(0, 16)}...` : item.id}
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                    {getStatusText(item.status)}
                  </span>
                </div>
                <div className="text-sm space-y-1 mb-3">
                  <div className="flex justify-between">
                    <span className="text-gray-500">买方</span>
                    <span>{getBuyerName(item)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">卖方</span>
                    <span>{getSellerName(item)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">{getAmountLabel()}</span>
                    <span className="font-medium">{getAmount(item)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">创建时间</span>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                {item.status !== "cancelled" && item.status !== "completed" && (
                  <button
                    onClick={() => setCancelTarget({ id: item.id })}
                    className="text-red-600 text-xs"
                  >
                    强制取消
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* 分页控件 */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadOrders(type, status, page - 1)}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>
                {page} / {totalPages || 1}
              </span>
              <button
                onClick={() => loadOrders(type, status, page + 1)}
                disabled={page >= totalPages}
                className="p-1.5 rounded-lg border border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* 强制取消订单弹窗 */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-gray-800">强制取消订单</h3>
              <button
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-2">
              订单 ID: <span className="font-mono">{cancelTarget.id}</span>
            </p>
            <label className="block text-sm text-gray-600 mb-1">取消原因</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="请输入取消原因"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason("");
                }}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={submitting || !cancelReason.trim()}
                className="px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50"
              >
                {submitting ? "处理中..." : "确认取消"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
