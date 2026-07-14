import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Edit2, Trash2, Star, Loader2, X, Save, AlertCircle } from "lucide-react";
import Empty from "@/components/Empty";
import {
  getAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  type Address,
} from "@/api/address";
import { ApiError } from "@/api/client";

// 表单数据：新增/编辑共用
interface FormData {
  recipient: string;
  phone: string;
  address: string;
  isDefault: boolean;
}

const EMPTY_FORM: FormData = { recipient: "", phone: "", address: "", isDefault: false };

export default function AddressBook() {
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // 删除确认弹窗状态：保存待删除地址 ID
  // 设计原因：原生 confirm() 阻塞主线程且移动端样式不可控，改用状态驱动的自定义 Modal，
  // 用户点击"确定"后才真正调用 deleteAddress，与 SystemStatus/SkillExchange 弹窗风格统一
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // 加载地址列表
  const loadAddresses = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getAddresses();
      setAddresses(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

  // 打开新增表单
  const handleAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
    setFieldErrors({});
  };

  // 打开编辑表单
  const handleEdit = (addr: Address) => {
    setForm({
      recipient: addr.recipient,
      phone: addr.phone,
      address: addr.address,
      isDefault: addr.isDefault,
    });
    setEditingId(addr.id);
    setShowForm(true);
    setFieldErrors({});
  };

  // 表单校验
  const validate = () => {
    const errors: Record<string, string> = {};
    if (!form.recipient.trim()) errors.recipient = "请输入收件人姓名";
    if (!/^1[3-9]\d{9}$/.test(form.phone)) errors.phone = "请输入正确的手机号";
    if (!form.address.trim()) errors.address = "请输入详细地址";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // 保存（新增或更新）
  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await updateAddress(editingId, form);
      } else {
        await createAddress(form);
      }
      setShowForm(false);
      loadAddresses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 打开删除确认弹窗：仅记录待删除 ID，实际调用由弹窗内"确定"按钮触发
  const handleDelete = (id: string) => {
    setPendingDeleteId(id);
  };

  // 用户在弹窗中点击"确定"后执行实际删除
  // 先清空 pendingDeleteId 关闭弹窗，避免重复点击；try/catch 内已有 setError 兜底
  const confirmDelete = async () => {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await deleteAddress(id);
      loadAddresses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "删除失败");
    }
  };

  // 设为默认
  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultAddress(id);
      loadAddresses();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "设置失败");
    }
  };

  return (
    <div className="px-4 py-4 pb-20 max-w-2xl mx-auto">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1 hover:bg-gray-100 rounded">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-bold text-gray-900">配送地址簿</h1>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-sm hover:bg-emerald-600"
        >
          <Plus className="w-4 h-4" />
          新增
        </button>
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
      ) : addresses.length === 0 ? (
        <Empty
          title="暂无配送地址"
          description="添加地址后会在这里显示"
          action={
            <button onClick={handleAdd} className="mt-3 text-emerald-500 text-sm">
              添加第一个地址
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {addresses.map((addr) => (
            <div key={addr.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">{addr.recipient}</span>
                    <span className="text-sm text-gray-500">{addr.phone}</span>
                    {addr.isDefault && (
                      <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded">
                        默认
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{addr.address}</p>
                </div>
              </div>
              <div className="flex gap-3 mt-3 pt-3 border-t border-gray-50">
                {!addr.isDefault && (
                  <button
                    onClick={() => handleSetDefault(addr.id)}
                    // 触摸目标提升：原 text-xs 无 padding 仅 12px 高，移动端难以点击
                    // py-1.5 + px-2 让触摸目标达到约 32px，配合 rounded 与 hover 视觉反馈
                    className="flex items-center gap-1 text-xs text-emerald-600 py-1.5 px-2 rounded hover:bg-emerald-50 transition-colors"
                  >
                    <Star className="w-3.5 h-3.5" />
                    设为默认
                  </button>
                )}
                <button
                  onClick={() => handleEdit(addr)}
                  className="flex items-center gap-1 text-xs text-blue-600 py-1.5 px-2 rounded hover:bg-blue-50 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(addr.id)}
                  className="flex items-center gap-1 text-xs text-red-600 py-1.5 px-2 rounded hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">
                {editingId ? "编辑地址" : "新增地址"}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">收件人</label>
                <input
                  type="text"
                  value={form.recipient}
                  onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                  placeholder="请输入收件人姓名"
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm ${
                    fieldErrors.recipient ? "border-red-500" : "border-gray-300"
                  }`}
                />
                {fieldErrors.recipient && (
                  <p className="mt-1 text-xs text-red-500">{fieldErrors.recipient}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="请输入手机号"
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm ${
                    fieldErrors.phone ? "border-red-500" : "border-gray-300"
                  }`}
                />
                {fieldErrors.phone && (
                  <p className="mt-1 text-xs text-red-500">{fieldErrors.phone}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">详细地址</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  rows={2}
                  placeholder="请输入详细地址"
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm resize-none ${
                    fieldErrors.address ? "border-red-500" : "border-gray-300"
                  }`}
                />
                {fieldErrors.address && (
                  <p className="mt-1 text-xs text-red-500">{fieldErrors.address}</p>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="text-emerald-500"
                />
                <span className="text-sm text-gray-700">设为默认地址</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗：替代原生 confirm()，与 SystemStatus/SkillExchange 弹窗风格统一 */}
      {/* role="dialog" 提升无障碍语义，便于测试用 within 精确定位弹窗内按钮 */}
      {pendingDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setPendingDeleteId(null)}
        >
          <div
            role="dialog"
            aria-label="删除确认"
            className="w-full max-w-sm bg-white rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-neutral-800 mb-2">删除确认</h3>
            <p className="text-sm text-neutral-600 mb-6">确定删除此地址？</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setPendingDeleteId(null)}
                className="px-4 py-2 text-sm text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
