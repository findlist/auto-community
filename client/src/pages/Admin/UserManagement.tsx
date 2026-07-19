import { useEffect, useState, useCallback, useRef } from "react";
import {
  Search,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
  ShieldBan,
  ShieldCheck,
} from "lucide-react";
import {
  getUsers,
  banUser,
  unbanUser,
  updateUserRole,
  batchBanUsers,
  batchUnbanUsers,
  type AdminUser,
  type BatchBanResult,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";
import ExportButton from "@/components/ExportButton";
import Empty from "@/components/Empty";
import type { PaginatedResponse } from "@/types";

const PAGE_SIZE = 20;

// 确认弹窗配置：单条操作携带 userId/nickname，批量操作携带 count
interface ConfirmConfig {
  userId?: string;
  nickname?: string;
  count?: number;
  action: "ban" | "unban" | "setAdmin" | "removeAdmin" | "batchBan" | "batchUnban";
}

export default function UserManagement() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 批量选中集合：使用 Set 保证 O(1) 查找，切换分页/搜索时清空避免跨页误操作
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 竞态守卫：跟踪当前活跃的请求标识（页码+搜索词），快速切换分页/搜索时旧请求返回不再覆盖新数据
  // 设计原因：loadUsers 依赖 targetPage/targetSearch，切换时旧请求返回后会 setUsers 旧列表覆盖新列表，
  // 且旧请求的 setSelectedIds 会清空用户基于新列表已选中的 id，导致批量操作错位风险
  const activeRequestKeyRef = useRef<string>("");

  // 加载用户列表
  const loadUsers = useCallback(async (targetPage: number, targetSearch: string) => {
    // 闭包捕获当前请求标识，await 后比对是否仍为最新请求
    const requestKey = `${targetPage}|${targetSearch}`;
    activeRequestKeyRef.current = requestKey;
    setLoading(true);
    setError(null);
    try {
      const res = await getUsers(targetPage, PAGE_SIZE, targetSearch || undefined);
      // 竞态守卫：await 期间若页码/搜索词已变化，跳过所有 setState（含 setSelectedIds），
      // 避免旧请求清空用户基于新列表已选中的 id，或旧列表覆盖新列表导致批量操作错位
      if (activeRequestKeyRef.current !== requestKey) return;
      const data: PaginatedResponse<AdminUser> = res.data;
      setUsers(data.list);
      setTotalPages(data.totalPages);
      setTotal(data.total);
      setPage(data.page);
      // 列表数据变更后清空选中，避免对已不在视图中的用户执行批量操作
      setSelectedIds(new Set());
    } catch (err) {
      if (activeRequestKeyRef.current !== requestKey) return;
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      // 仅当前活跃请求才清除 loading，避免旧请求 finally 误刷新请求的 loading 状态
      if (activeRequestKeyRef.current === requestKey) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadUsers(1, "");
  }, [loadUsers]);

  // 搜索按钮触发
  const handleSearch = () => {
    loadUsers(1, search);
  };

  // 单个/全选切换
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // 全选/取消全选当前页
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      // 当前页已全部选中 → 清空；否则选中当前页全部
      const allSelected = users.length > 0 && users.every((u) => prev.has(u.id));
      if (allSelected) {
        const next = new Set(prev);
        users.forEach((u) => next.delete(u.id));
        return next;
      }
      const next = new Set(prev);
      users.forEach((u) => next.add(u.id));
      return next;
    });
  };

  // 批量封禁结果汇总提示：成功/跳过管理员/失败分别提示，便于排查
  const summarizeBanResult = (r: BatchBanResult) => {
    const parts = [`成功 ${r.successfulIds.length} 个`];
    if (r.skippedAdminIds.length > 0) parts.push(`跳过管理员 ${r.skippedAdminIds.length} 个`);
    if (r.failedIds.length > 0) parts.push(`失败 ${r.failedIds.length} 个`);
    return parts.join("，");
  };

  // 执行确认操作
  const handleConfirmAction = async () => {
    // 入口守卫：与 disabled + 文案变化形成三重防御，避免 React 批处理延迟导致弱网下连点产生多次封禁/解封/角色变更
    if (submitting) return;
    if (!confirm) return;
    setSubmitting(true);
    try {
      if (confirm.action === "ban") {
        await banUser(confirm.userId!);
        toast.success("用户已封禁");
      } else if (confirm.action === "unban") {
        await unbanUser(confirm.userId!);
        toast.success("用户已解封");
      } else if (confirm.action === "setAdmin") {
        await updateUserRole(confirm.userId!, "admin");
        toast.success("已设为管理员");
      } else if (confirm.action === "removeAdmin") {
        await updateUserRole(confirm.userId!, "user");
        toast.success("已取消管理员");
      } else if (confirm.action === "batchBan") {
        const ids = Array.from(selectedIds);
        const res = await batchBanUsers(ids);
        toast.success(summarizeBanResult(res.data));
      } else if (confirm.action === "batchUnban") {
        const ids = Array.from(selectedIds);
        const res = await batchUnbanUsers(ids);
        toast.success(`成功解封 ${res.data.successfulIds.length} 个用户`);
      }
      setConfirm(null);
      // 重新加载当前页（loadUsers 内部会清空选中）
      loadUsers(page, search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  // 操作按钮文案
  const getConfirmText = (action: ConfirmConfig["action"]) => {
    const map = {
      ban: { title: "确认封禁", desc: "封禁后该用户将无法登录系统", btn: "确认封禁" },
      unban: { title: "确认解封", desc: "解封后该用户可正常使用系统", btn: "确认解封" },
      setAdmin: { title: "设为管理员", desc: "该用户将拥有管理后台权限", btn: "确认设置" },
      removeAdmin: { title: "取消管理员", desc: "将撤销该用户的管理员权限", btn: "确认取消" },
      batchBan: { title: "批量封禁", desc: "将封禁所选用户，管理员与本人会被自动跳过", btn: "确认批量封禁" },
      batchUnban: { title: "批量解封", desc: "将解封所选已封禁用户", btn: "确认批量解封" },
    };
    return map[action];
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-neutral-800">用户管理</h2>
        <ExportButton type="users" />
      </div>

      {/* 搜索框：focus 环细化、按钮 active 反馈，与设计令牌 emerald 主色一致 */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="按手机号/昵称搜索"
          aria-label="按手机号或昵称搜索用户"
          className="flex-1 px-3 py-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 transition-all"
        />
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 active:scale-95 transition-all flex items-center gap-1"
        >
          <Search className="w-4 h-4" />
          搜索
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {/* 批量操作工具栏：仅在选中用户时显示 */}
      {selectedIds.size > 0 && !loading && (
        <div className="flex items-center justify-between gap-2 p-3 mb-4 bg-emerald-50 rounded-lg text-sm flex-wrap">
          <span className="text-emerald-700 font-medium">已选择 {selectedIds.size} 个用户</span>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setConfirm({ action: "batchBan", count: selectedIds.size })}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs hover:bg-red-600"
            >
              <ShieldBan className="w-3.5 h-3.5" />
              批量封禁
            </button>
            <button
              onClick={() => setConfirm({ action: "batchUnban", count: selectedIds.size })}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs hover:bg-emerald-600"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              批量解封
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-neutral-600 border border-neutral-300 rounded-lg text-xs hover:bg-neutral-50"
            >
              清除选择
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : error ? (
        // 加载失败时展示错误空态与重试入口，避免用户被卡在错误页只能刷新整个页面
        // 设计原因：上方 banner 已显示具体错误原因，此处 Empty 仅提供视觉占位与重试动作，
        // 不传 description 避免与 banner 文本重复导致 getByText 多元素匹配错误
        <Empty
          variant="error"
          action={
            <button
              onClick={() => loadUsers(page, search)}
              className="px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600 transition-colors"
            >
              重新加载
            </button>
          }
        />
      ) : users.length === 0 ? (
        <Empty title="暂无数据" description="用户记录会在这里显示" />
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden md:block overflow-x-auto bg-white rounded-xl border border-neutral-100">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      aria-label="全选当前页"
                      checked={users.length > 0 && users.every((u) => selectedIds.has(u.id))}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">昵称</th>
                  <th className="px-4 py-3 text-left">手机号</th>
                  <th className="px-4 py-3 text-left">角色</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">信誉分</th>
                  <th className="px-4 py-3 text-left">注册时间</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${u.nickname}`}
                        checked={selectedIds.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                        className="w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-4 py-3">{u.nickname}</td>
                    <td className="px-4 py-3">{u.phone}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          u.role === "admin"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {u.role === "admin" ? "管理员" : "普通用户"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          u.status === "banned"
                            ? "bg-red-100 text-red-700"
                            : "bg-green-100 text-green-700"
                        }`}
                      >
                        {u.status === "banned" ? "已封禁" : "正常"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{u.reputationScore}</td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 flex-wrap">
                        {u.status === "banned" ? (
                          <button
                            onClick={() =>
                              setConfirm({ userId: u.id, nickname: u.nickname, action: "unban" })
                            }
                            className="text-emerald-600 text-xs px-3 py-2 rounded-lg hover:bg-emerald-50 transition-colors"
                          >
                            解封
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              setConfirm({ userId: u.id, nickname: u.nickname, action: "ban" })
                            }
                            className="text-red-600 text-xs px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            封禁
                          </button>
                        )}
                        {u.role === "admin" ? (
                          <button
                            onClick={() =>
                              setConfirm({
                                userId: u.id,
                                nickname: u.nickname,
                                action: "removeAdmin",
                              })
                            }
                            className="text-neutral-600 text-xs px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors"
                          >
                            取消管理员
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              setConfirm({
                                userId: u.id,
                                nickname: u.nickname,
                                action: "setAdmin",
                              })
                            }
                            // 与同文件"解封"按钮对齐 emerald 色板：均为积极正向操作
                            className="text-emerald-600 text-xs px-3 py-2 rounded-lg hover:bg-emerald-50 transition-colors"
                          >
                            设为管理员
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片布局 */}
          <div className="md:hidden space-y-3">
            {users.map((u) => (
              <div key={u.id} className="bg-white rounded-xl border border-neutral-100 p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${u.nickname}`}
                      checked={selectedIds.has(u.id)}
                      onChange={() => toggleSelect(u.id)}
                      className="mt-1 w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="font-medium text-neutral-800">{u.nickname}</div>
                      <div className="text-sm text-neutral-500">{u.phone}</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        u.role === "admin"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-neutral-100 text-neutral-600"
                      }`}
                    >
                      {u.role === "admin" ? "管理员" : "普通用户"}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        u.status === "banned"
                          ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {u.status === "banned" ? "已封禁" : "正常"}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-neutral-500 mb-3">
                  信誉分: {u.reputationScore} · 注册:{" "}
                  {new Date(u.createdAt).toLocaleDateString()}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {u.status === "banned" ? (
                    <button
                      onClick={() =>
                        setConfirm({ userId: u.id, nickname: u.nickname, action: "unban" })
                      }
                      className="text-emerald-600 text-xs px-3 py-2 rounded-lg hover:bg-emerald-50 transition-colors"
                    >
                      解封
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setConfirm({ userId: u.id, nickname: u.nickname, action: "ban" })
                      }
                      className="text-red-600 text-xs px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
                    >
                      封禁
                    </button>
                  )}
                  {u.role === "admin" ? (
                    <button
                      onClick={() =>
                        setConfirm({
                          userId: u.id,
                          nickname: u.nickname,
                          action: "removeAdmin",
                        })
                      }
                      className="text-neutral-600 text-xs px-3 py-2 rounded-lg hover:bg-neutral-100 transition-colors"
                    >
                      取消管理员
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        setConfirm({
                          userId: u.id,
                          nickname: u.nickname,
                          action: "setAdmin",
                        })
                      }
                      // 与同文件"解封"按钮对齐 emerald 色板：均为积极正向操作
                      className="text-emerald-600 text-xs px-3 py-2 rounded-lg hover:bg-emerald-50 transition-colors"
                    >
                      设为管理员
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* 分页控件：当前页以胶囊高亮，前后按钮加 active 反馈 */}
          <div className="flex items-center justify-between mt-6 text-sm text-neutral-600">
            <span className="text-neutral-500">共 <span className="font-semibold text-neutral-800 tabular-nums">{total}</span> 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadUsers(page - 1, search)}
                disabled={page <= 1}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50 hover:border-neutral-400 active:scale-95 transition-all"
                aria-label="上一页"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-100 tabular-nums">
                <span className="font-semibold text-neutral-900">{page}</span>
                <span className="text-neutral-400">/</span>
                <span className="text-neutral-500">{totalPages || 1}</span>
              </span>
              <button
                onClick={() => loadUsers(page + 1, search)}
                disabled={page >= totalPages}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50 hover:border-neutral-400 active:scale-95 transition-all"
                aria-label="下一页"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* 确认弹窗 */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-backdrop">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm animate-modal-enter">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-neutral-800">
                {getConfirmText(confirm.action).title}
              </h3>
              <button
                onClick={() => setConfirm(null)}
                className="text-neutral-400 hover:text-neutral-600 p-1 rounded hover:bg-neutral-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-600 mb-2">
              {confirm.count !== undefined ? (
                <>选中数量: <span className="font-medium">{confirm.count} 个用户</span></>
              ) : (
                <>用户: <span className="font-medium">{confirm.nickname}</span></>
              )}
            </p>
            <p className="text-sm text-neutral-500 mb-4">
              {getConfirmText(confirm.action).desc}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmAction}
                disabled={submitting}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 transition-colors ${
                  confirm.action === "batchBan"
                    ? "bg-red-500 hover:bg-red-600"
                    : "bg-emerald-500 hover:bg-emerald-600"
                }`}
              >
                {submitting ? "处理中..." : getConfirmText(confirm.action).btn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
