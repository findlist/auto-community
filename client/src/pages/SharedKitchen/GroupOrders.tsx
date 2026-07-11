import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getGroupOrders, createGroupOrder, joinGroupOrder } from "@/api/kitchen";
import type { GroupOrder } from "@/types";
import { toast } from "@/components/Toast";
import { getErrorMessage } from "@/utils/error";

export default function GroupOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<GroupOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState<GroupOrder | null>(null);
  const [joinAmount, setJoinAmount] = useState(0);

  // 创建表单状态
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState(100);
  const [minParticipants, setMinParticipants] = useState(3);
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [address, setAddress] = useState("");
  const [deadline, setDeadline] = useState("");

  // 加载拼单
  const loadOrders = useCallback(async (reset = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const newPage = reset ? 1 : page;
      const res = await getGroupOrders({ page: newPage, pageSize: 10 });
      if (reset) {
        setOrders(res.data.list);
      } else {
        setOrders(prev => [...prev, ...res.data.list]);
      }
      setHasMore(res.data.hasNext);
      setPage(newPage + 1);
    } catch (error) {
      console.error("加载失败:", error);
      toast.error("加载拼单列表失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [page, loading]);

  useEffect(() => {
    setPage(1);
    setHasMore(true);
    loadOrders(true);
    // 仅挂载时初始化；loadOrders 依赖 page/loading，纳入会导致分页后无限重载，故显式排除
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 创建拼单
  const handleCreate = async () => {
    if (!title || !targetAmount || !address || !deadline) {
      toast.error("请填写必填信息");
      return;
    }
    try {
      await createGroupOrder({
        title,
        description,
        targetAmount,
        minParticipants,
        maxParticipants,
        address,
        deadline: new Date(deadline).toISOString(),
      });
      toast.success("创建成功");
      setShowCreateModal(false);
      loadOrders(true);
      // 重置表单
      setTitle("");
      setDescription("");
      setTargetAmount(100);
      setAddress("");
    } catch (error) {
      toast.error(getErrorMessage(error, "创建失败"));
    }
  };

  // 参与拼单
  const handleJoin = async () => {
    if (!showJoinModal) return;
    try {
      await joinGroupOrder(showJoinModal.id, joinAmount);
      toast.success("参与成功");
      setShowJoinModal(null);
      loadOrders(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "参与失败"));
    }
  };

  // 渲染拼单卡片
  const renderCard = (order: GroupOrder) => (
    <div key={order.id} className="bg-white rounded-lg shadow-sm p-4 mb-3">
      <h3 className="font-medium text-gray-900 mb-1">{order.title}</h3>
      {order.description && (
        <p className="text-sm text-gray-500 mb-3">{order.description}</p>
      )}

      {/* 进度 */}
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span>¥{order.currentAmount} / ¥{order.targetAmount}</span>
          <span>{Math.round((order.currentAmount / order.targetAmount) * 100)}%</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(100, (order.currentAmount / order.targetAmount) * 100)}%` }}
          />
        </div>
      </div>

      <div className="flex justify-between text-sm text-gray-500 mb-3">
        <span>{order.currentParticipants}/{order.maxParticipants} 人</span>
        <span>截止: {new Date(order.deadline).toLocaleDateString()}</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => {
            setShowJoinModal(order);
            setJoinAmount(Math.ceil(order.targetAmount / order.maxParticipants));
          }}
          disabled={order.status !== "open"}
          className="flex-1 py-2 bg-emerald-600 text-white text-sm rounded-lg disabled:opacity-50"
        >
          参与拼单
        </button>
        <button
          onClick={() => navigate(`/kitchen/group-orders/${order.id}`)}
          className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg"
        >
          查看详情
        </button>
      </div>
    </div>
  );

  return (
    // max-w-2xl mx-auto：拼单列表页统一容器约束，桌面端避免横向拉伸过度影响可读性
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      {/* 创建按钮 */}
      <button
        onClick={() => setShowCreateModal(true)}
        className="w-full py-3 bg-emerald-600 text-white rounded-lg font-medium mb-4 flex items-center justify-center gap-2"
      >
        <span>+</span>
        <span>发起拼单</span>
      </button>

      {/* 拼单列表 */}
      {orders.map(renderCard)}

      {/* 加载更多 */}
      {hasMore && !loading && orders.length > 0 && (
        <button
          onClick={() => loadOrders()}
          className="w-full py-3 mt-4 text-center text-emerald-600 hover:bg-emerald-50 rounded-lg"
        >
          加载更多
        </button>
      )}

      {/* 空状态 */}
      {!loading && orders.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🛒</div>
          <p>暂无拼单，发起一个吧！</p>
        </div>
      )}

      {/* 创建弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50 p-4">
          <div className="bg-white w-full max-w-lg rounded-t-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium mb-4">发起拼单</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">标题 *</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="如：拼单买海鲜"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">描述</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="描述一下..."
                  className="w-full px-3 py-2 border rounded-lg"
                  rows={2}
                />
              </div>

              {/* 三栏字段：移动端单列堆叠，桌面端三列等分
                  设计原因：原 flex gap-4 在 <360px 窄屏三列 input 严重挤压，label 与 input 易错位 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">目标金额 *</label>
                  <input
                    type="number"
                    value={targetAmount}
                    onChange={e => setTargetAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">最小人数</label>
                  <input
                    type="number"
                    value={minParticipants}
                    onChange={e => setMinParticipants(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">最大人数</label>
                  <input
                    type="number"
                    value={maxParticipants}
                    onChange={e => setMaxParticipants(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">集合地点 *</label>
                <input
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="如：小区南门"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">截止时间 *</label>
                <input
                  type="datetime-local"
                  value={deadline}
                  onChange={e => setDeadline(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 py-3 border rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="flex-1 py-3 bg-emerald-600 text-white rounded-lg"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 参与弹窗 */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-lg font-medium mb-4">参与拼单</h3>
            <p className="text-sm text-gray-600 mb-4">{showJoinModal.title}</p>
            
            <div className="mb-4">
              <label className="block text-sm text-gray-600 mb-1">分摊金额</label>
              <input
                type="number"
                value={joinAmount}
                onChange={e => setJoinAmount(Number(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                建议: ¥{Math.ceil(showJoinModal.targetAmount / showJoinModal.maxParticipants)}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowJoinModal(null)}
                className="flex-1 py-3 border rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleJoin}
                className="flex-1 py-3 bg-emerald-600 text-white rounded-lg"
              >
                确认参与
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
