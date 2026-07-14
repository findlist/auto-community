import { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  X,
  Save,
  Upload,
  Archive,
} from "lucide-react";
import {
  getContent,
  getContentDetail,
  updateContentStatus,
  updateContent,
  batchUpdateContentStatus,
  type ContentDetail,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";
import type { PaginatedResponse } from "@/types";
import ImageUpload from "@/components/Upload/ImageUpload";
import Empty from "@/components/Empty";

const PAGE_SIZE = 20;

// 内容模块配置：tabKey 用于前端状态，apiType 用于后端接口
const typeTabs = [
  { key: "skill", label: "技能", apiType: "skill" },
  { key: "kitchen", label: "厨房", apiType: "kitchen" },
  { key: "timeBank", label: "时间银行", apiType: "time_bank" },
  { key: "emergency", label: "应急", apiType: "emergency" },
];

// 状态筛选配置
const statusTabs = [
  { key: "active", label: "已上架" },
  { key: "inactive", label: "已下架" },
];

// 内容列表项类型
interface ContentItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

// 编辑表单数据：聚合所有类型可能出现的字段
interface EditFormData {
  title: string;
  description: string;
  creditPrice?: number;
  images: string[];
  tags: string[];
  address?: string;
  category?: string;
  durationMinutes?: number;
  portions?: number;
  pickupAddress?: string;
  allergens: string[];
  urgency?: string;
}

const EMPTY_FORM: EditFormData = {
  title: "",
  description: "",
  images: [],
  tags: [],
  allergens: [],
};

export default function ContentReview() {
  const [type, setType] = useState("skill");
  const [status, setStatus] = useState("active");
  const [list, setList] = useState<ContentItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // 批量选中集合：切换类型/状态/分页时清空，避免跨列表误操作
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 批量操作确认弹窗
  const [batchConfirm, setBatchConfirm] = useState<{ action: 'batchActive' | 'batchInactive'; count: number } | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  // 编辑弹窗状态
  const [editing, setEditing] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EditFormData>(EMPTY_FORM);

  // 当前 tab 对应的后端类型
  const apiType = typeTabs.find((t) => t.key === type)?.apiType || type;

  // 加载内容列表
  const loadContent = useCallback(async (t: string, s: string, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const currentApiType = typeTabs.find((tab) => tab.key === t)?.apiType || t;
      const res = await getContent(currentApiType, s, p, PAGE_SIZE);
      const data: PaginatedResponse<ContentItem> = res.data;
      setList(data.list);
      setTotalPages(data.totalPages);
      setTotal(data.total);
      setPage(data.page);
      // 列表数据变更后清空选中，避免对已不在视图中的内容执行批量操作
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 单个选择切换
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // 当前页全选/取消全选
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = list.length > 0 && list.every((it) => prev.has(it.id));
      if (allSelected) {
        const next = new Set(prev);
        list.forEach((it) => next.delete(it.id));
        return next;
      }
      const next = new Set(prev);
      list.forEach((it) => next.add(it.id));
      return next;
    });
  };

  // 执行批量上下架确认操作
  const handleBatchConfirm = async () => {
    if (!batchConfirm) return;
    setBatchSubmitting(true);
    try {
      const ids = Array.from(selectedIds);
      const targetStatus = batchConfirm.action === 'batchActive' ? 'active' : 'inactive';
      const res = await batchUpdateContentStatus(apiType, ids, targetStatus);
      const label = batchConfirm.action === 'batchActive' ? '上架' : '下架';
      toast.success(`成功${label} ${res.data.successfulIds.length} 条内容`);
      setBatchConfirm(null);
      setSelectedIds(new Set());
      loadContent(type, status, page);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '批量操作失败');
    } finally {
      setBatchSubmitting(false);
    }
  };

  useEffect(() => {
    loadContent(type, status, 1);
  }, [type, status, loadContent]);

  // 切换内容状态（上架/下架）
  const handleToggleStatus = async (item: ContentItem) => {
    const newStatus = item.status === "active" ? "inactive" : "active";
    setActioningId(item.id);
    try {
      await updateContentStatus(apiType, item.id, newStatus);
      loadContent(type, status, page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setActioningId(null);
    }
  };

  // 打开编辑弹窗：拉取详情后填充表单
  const handleOpenEdit = async (item: ContentItem) => {
    setEditing(true);
    setEditId(item.id);
    setEditError(null);
    setEditLoading(true);
    setForm(EMPTY_FORM);
    try {
      const res = await getContentDetail(apiType, item.id);
      const d: ContentDetail = res.data;
      setForm({
        title: d.title || "",
        description: d.description || "",
        creditPrice: d.creditPrice,
        images: d.images || [],
        tags: d.tags || [],
        address: d.address,
        category: d.category,
        durationMinutes: d.durationMinutes,
        portions: d.portions,
        pickupAddress: d.pickupAddress,
        allergens: d.allergens || [],
        urgency: d.urgency,
      });
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "加载详情失败");
    } finally {
      setEditLoading(false);
    }
  };

  const handleCloseEdit = () => {
    setEditing(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    setEditError(null);
  };

  // 提交编辑：按需收集变更字段
  const handleSaveEdit = async () => {
    if (!editId) return;
    setEditSaving(true);
    setEditError(null);
    try {
      // 仅传入当前类型支持的字段，避免写入无关字段
      // 用 Partial<ContentDetail> 精确约束 payload，与 updateContent 入参契约对齐，
      // 避免原 Record<string, any> 让非法字段静默通过编译
      const payload: Partial<ContentDetail> = { title: form.title, description: form.description };
      if (type === "skill") {
        payload.creditPrice = form.creditPrice;
        payload.images = form.images;
        payload.tags = form.tags;
        payload.address = form.address;
      } else if (type === "kitchen") {
        payload.creditPrice = form.creditPrice;
        payload.images = form.images;
        payload.category = form.category;
        payload.portions = form.portions;
        payload.pickupAddress = form.pickupAddress;
        payload.allergens = form.allergens;
      } else if (type === "timeBank") {
        payload.durationMinutes = form.durationMinutes;
        payload.category = form.category;
        payload.address = form.address;
      } else if (type === "emergency") {
        payload.images = form.images;
        payload.urgency = form.urgency;
        payload.category = form.category;
        payload.address = form.address;
      }
      await updateContent(apiType, editId, payload);
      handleCloseEdit();
      loadContent(type, status, page);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setEditSaving(false);
    }
  };

  // 通用表单字段更新
  const updateField = <K extends keyof EditFormData>(key: K, value: EditFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-neutral-800 mb-4">内容审核</h2>

      {/* 模块切换标签 */}
      <div className="flex gap-1 mb-3 border-b border-neutral-200 overflow-x-auto">
        {typeTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setType(tab.key)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
              type === tab.key
                ? "border-emerald-500 text-emerald-600 font-medium"
                : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4">
        {statusTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatus(tab.key)}
            className={`px-3 py-1.5 text-sm rounded-lg ${
              status === tab.key
                ? "bg-emerald-500 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
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

      {/* 批量操作工具栏：仅在选中内容时显示 */}
      {selectedIds.size > 0 && !loading && (
        <div className="flex items-center justify-between gap-2 p-3 mb-4 bg-emerald-50 rounded-lg text-sm flex-wrap">
          <span className="text-emerald-700 font-medium">已选择 {selectedIds.size} 条内容</span>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setBatchConfirm({ action: 'batchActive', count: selectedIds.size })}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-xs hover:bg-emerald-600"
            >
              <Upload className="w-3.5 h-3.5" />
              批量上架
            </button>
            <button
              onClick={() => setBatchConfirm({ action: 'batchInactive', count: selectedIds.size })}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-neutral-600 text-white rounded-lg text-xs hover:bg-neutral-700"
            >
              <Archive className="w-3.5 h-3.5" />
              批量下架
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
      ) : list.length === 0 ? (
        <Empty title="暂无数据" description="待审核内容会在这里显示" />
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
                      checked={list.length > 0 && list.every((it) => selectedIds.has(it.id))}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">标题</th>
                  <th className="px-4 py-3 text-left">状态</th>
                  <th className="px-4 py-3 text-left">创建时间</th>
                  <th className="px-4 py-3 text-left">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {list.map((item) => (
                  <tr key={item.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`选择 ${item.title}`}
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="px-4 py-3">{item.title}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          item.status === "active"
                            ? "bg-green-100 text-green-700"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {item.status === "active" ? "已上架" : "已下架"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 flex gap-3">
                      <button
                        onClick={() => handleOpenEdit(item)}
                        // 触摸目标提升：原无 padding 行内按钮，移动端难以精准点击
                        className="text-xs text-blue-600 hover:underline py-1 px-2 rounded hover:bg-blue-50 transition-colors"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleToggleStatus(item)}
                        disabled={actioningId === item.id}
                        // 触摸目标提升：原无 padding 行内按钮，移动端难以精准点击
                        className={`text-xs hover:underline disabled:opacity-50 py-1 px-2 rounded hover:bg-neutral-50 transition-colors ${
                          item.status === "active"
                            ? "text-red-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {actioningId === item.id
                          ? "处理中..."
                          : item.status === "active"
                          ? "下架"
                          : "上架"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片布局 */}
          <div className="md:hidden space-y-3">
            {list.map((item) => (
              <div key={item.id} className="bg-white rounded-xl border border-neutral-100 p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-start gap-2 flex-1 mr-2">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${item.title}`}
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="mt-1 w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="font-medium text-neutral-800">{item.title}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                      item.status === "active"
                        ? "bg-green-100 text-green-700"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {item.status === "active" ? "已上架" : "已下架"}
                  </span>
                </div>
                <div className="text-sm text-neutral-500 mb-3">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleOpenEdit(item)}
                    // 触摸目标提升：原无 padding 行内按钮，移动端难以精准点击
                    className="text-xs text-blue-600 hover:underline py-1 px-2 rounded hover:bg-blue-50 transition-colors"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => handleToggleStatus(item)}
                    disabled={actioningId === item.id}
                    className={`text-xs disabled:opacity-50 py-1 px-2 rounded hover:bg-neutral-50 transition-colors ${
                      item.status === "active" ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {actioningId === item.id
                      ? "处理中..."
                      : item.status === "active"
                      ? "下架"
                      : "上架"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 分页控件 */}
          <div className="flex items-center justify-between mt-4 text-sm text-neutral-600">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadContent(type, status, page - 1)}
                disabled={page <= 1}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span>
                {page} / {totalPages || 1}
              </span>
              <button
                onClick={() => loadContent(type, status, page + 1)}
                disabled={page >= totalPages}
                className="p-2.5 rounded-lg border border-neutral-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-50"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ============ 编辑弹窗 ============ */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-100">
              <h3 className="font-semibold text-neutral-800">编辑内容</h3>
              <button onClick={handleCloseEdit} className="p-1 hover:bg-neutral-100 rounded">
                <X className="w-5 h-5 text-neutral-500" />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="flex-1 overflow-y-auto p-5">
              {editLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                </div>
              ) : editError ? (
                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {editError}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 标题：所有类型通用 */}
                  <Field label="标题">
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => updateField("title", e.target.value)}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                  </Field>

                  {/* 描述：所有类型通用 */}
                  <Field label="详细描述">
                    <textarea
                      value={form.description}
                      onChange={(e) => updateField("description", e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none"
                    />
                  </Field>

                  {/* 图片：除时间银行外都支持 */}
                  {type !== "timeBank" && (
                    <Field label="图片">
                      <ImageUpload
                        value={form.images}
                        onChange={(urls) => updateField("images", urls)}
                        maxCount={5}
                        onError={(msg) => setEditError(msg)}
                      />
                    </Field>
                  )}

                  {/* 类型相关字段 */}
                  {type === "skill" && (
                    <>
                      <Field label="积分价格">
                        <NumberInput
                          value={form.creditPrice}
                          onChange={(v) => updateField("creditPrice", v)}
                        />
                      </Field>
                      <Field label="标签（逗号分隔）">
                        <input
                          type="text"
                          value={form.tags.join(",")}
                          onChange={(e) =>
                            updateField(
                              "tags",
                              e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                            )
                          }
                          className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                        />
                      </Field>
                      <Field label="地址">
                        <TextInput value={form.address} onChange={(v) => updateField("address", v)} />
                      </Field>
                    </>
                  )}

                  {type === "kitchen" && (
                    <>
                      <Field label="积分价格">
                        <NumberInput
                          value={form.creditPrice}
                          onChange={(v) => updateField("creditPrice", v)}
                        />
                      </Field>
                      <Field label="分类">
                        <TextInput value={form.category} onChange={(v) => updateField("category", v)} />
                      </Field>
                      <Field label="份数">
                        <NumberInput value={form.portions} onChange={(v) => updateField("portions", v)} />
                      </Field>
                      <Field label="取餐地址">
                        <TextInput
                          value={form.pickupAddress}
                          onChange={(v) => updateField("pickupAddress", v)}
                        />
                      </Field>
                      <Field label="过敏原（逗号分隔）">
                        <input
                          type="text"
                          value={form.allergens.join(",")}
                          onChange={(e) =>
                            updateField(
                              "allergens",
                              e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                            )
                          }
                          className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                        />
                      </Field>
                    </>
                  )}

                  {type === "timeBank" && (
                    <>
                      <Field label="分类">
                        <TextInput value={form.category} onChange={(v) => updateField("category", v)} />
                      </Field>
                      <Field label="服务时长（分钟）">
                        <NumberInput
                          value={form.durationMinutes}
                          onChange={(v) => updateField("durationMinutes", v)}
                        />
                      </Field>
                      <Field label="地址">
                        <TextInput value={form.address} onChange={(v) => updateField("address", v)} />
                      </Field>
                    </>
                  )}

                  {type === "emergency" && (
                    <>
                      <Field label="紧急程度">
                        <select
                          value={form.urgency || ""}
                          onChange={(e) => updateField("urgency", e.target.value)}
                          className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                        >
                          <option value="">请选择</option>
                          <option value="low">低</option>
                          <option value="medium">中</option>
                          <option value="high">高</option>
                          <option value="critical">紧急</option>
                        </select>
                      </Field>
                      <Field label="分类">
                        <TextInput value={form.category} onChange={(v) => updateField("category", v)} />
                      </Field>
                      <Field label="地址">
                        <TextInput value={form.address} onChange={(v) => updateField("address", v)} />
                      </Field>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 弹窗底部操作 */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-100">
              <button
                onClick={handleCloseEdit}
                className="px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={editSaving || editLoading}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50"
              >
                {editSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ 批量操作确认弹窗 ============ */}
      {batchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-bold text-neutral-800">
                {batchConfirm.action === "batchActive" ? "批量上架" : "批量下架"}
              </h3>
              <button
                onClick={() => setBatchConfirm(null)}
                className="text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-neutral-600 mb-2">
              选中数量: <span className="font-medium">{batchConfirm.count} 条内容</span>
            </p>
            <p className="text-sm text-neutral-500 mb-4">
              {batchConfirm.action === "batchActive" ? "将所选内容批量上架，用户可见" : "将所选内容批量下架，用户不可见"}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setBatchConfirm(null)}
                className="px-4 py-2 text-sm text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                onClick={handleBatchConfirm}
                disabled={batchSubmitting}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${
                  batchConfirm.action === "batchActive"
                    ? "bg-emerald-500 hover:bg-emerald-600"
                    : "bg-neutral-600 hover:bg-neutral-700"
                }`}
              >
                {batchSubmitting ? "处理中..." : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ 表单原子组件 ============

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
    />
  );
}

function NumberInput({ value, onChange }: { value?: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      className="w-full px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
    />
  );
}
