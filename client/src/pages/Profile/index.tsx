import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { User, CreditCard, Clock, Star, FileText, ShoppingBag, LogOut, ShieldCheck, Trash2, Shield, MapPin, Camera, Loader2, AlertCircle, X, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { logout } from "@/api/auth";
import { updateProfile } from "@/api/user";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";
import ImageUpload from "@/components/Upload/ImageUpload";

const menuItems = [
  { icon: ShieldCheck, label: "实名认证", path: "/profile/verify" },
  { icon: CreditCard, label: "积分明细", path: "/profile/points" },
  { icon: MapPin, label: "配送地址簿", path: "/kitchen/addresses" },
  { icon: FileText, label: "我的发布", path: "/profile/posts" },
  { icon: ShoppingBag, label: "我的订单", path: "/profile/orders" },
  { icon: Trash2, label: "账号注销", path: "/profile/delete", danger: true },
];

export default function Profile() {
  const { user, isAuthenticated, logout: clearAuth, setUser } = useAuth();
  const navigate = useNavigate();
  // 头像编辑弹窗状态：editingAvatar 控制显隐，tempAvatar 临时存储待上传 URL
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [tempAvatar, setTempAvatar] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // 即使接口失败也清除本地状态
    }
    // clearAuth 内部通过 zustand persist 自动同步清除 localStorage["auth-storage"]
    // 设计原因：原实现同时手动 localStorage.removeItem("token")，与 store 状态清理重复且非原子
    clearAuth();
    navigate("/login");
  };

  // 打开头像编辑弹窗：预填当前头像（若有）
  const openAvatarEditor = () => {
    setTempAvatar(user?.avatar ? [user.avatar] : []);
    setAvatarError(null);
    setEditingAvatar(true);
  };

  // 保存头像：调用 updateProfile 后同步更新本地 user 状态
  const handleSaveAvatar = async () => {
    const avatar = tempAvatar[0];
    if (!avatar) {
      setAvatarError("请先上传头像");
      return;
    }
    setSaving(true);
    setAvatarError(null);
    try {
      const res = await updateProfile({ avatar });
      // 同步更新 useAuth 中的 user 状态，避免刷新页面
      setUser(res.data);
      toast.success("头像更新成功");
      setEditingAvatar(false);
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : "头像更新失败");
    } finally {
      setSaving(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
        <User className="w-16 h-16 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-4">请先登录</p>
        <Link to="/login" className="px-6 py-2 bg-emerald-500 text-white rounded-lg">
          去登录
        </Link>
      </div>
    );
  }

  return (
    // max-w-2xl mx-auto：桌面端约束内容宽度，避免横向拉伸过度影响可读性，与项目其他列表页一致
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center gap-4 p-4 bg-white rounded-xl mb-4">
        {/* 头像：点击触发编辑弹窗，相机图标提示可修改 */}
        <button
          onClick={openAvatarEditor}
          className="relative w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center group flex-shrink-0"
          aria-label="修改头像"
        >
          {/* 头像 alt 使用用户昵称，屏幕阅读器可识别用户身份，与 Layout 顶部头像保持一致 */}
          {user?.avatar ? (
            <img src={user.avatar} alt={user?.nickname ? `${user.nickname}的头像` : "用户头像"} className="w-14 h-14 rounded-full object-cover" />
          ) : (
            <User className="w-7 h-7 text-emerald-600" />
          )}
          <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
            <Camera className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </span>
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">{user?.nickname}</h2>
          <p className="text-sm text-gray-500">信誉分 {user?.reputationScore ?? 0}</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-full">
          <Shield className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-medium text-emerald-700">数据已加密保护</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="flex flex-col items-center p-3 bg-white rounded-xl">
          <CreditCard className="w-5 h-5 text-blue-500 mb-1" />
          <span className="text-lg font-semibold text-gray-900">{user?.creditBalance ?? 0}</span>
          <span className="text-xs text-gray-500">积分</span>
        </div>
        <div className="flex flex-col items-center p-3 bg-white rounded-xl">
          <Clock className="w-5 h-5 text-purple-500 mb-1" />
          <span className="text-lg font-semibold text-gray-900">{user?.timeBalance ?? 0}</span>
          <span className="text-xs text-gray-500">时间币</span>
        </div>
        <div className="flex flex-col items-center p-3 bg-white rounded-xl">
          <Star className="w-5 h-5 text-yellow-500 mb-1" />
          <span className="text-lg font-semibold text-gray-900">{user?.reputationScore ?? 0}</span>
          <span className="text-xs text-gray-500">信誉分</span>
        </div>
      </div>

      <div className="bg-white rounded-xl overflow-hidden">
        {menuItems.map(({ icon: Icon, label, path, danger }) => (
          <Link
            key={path}
            to={path}
            className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 ${
              danger ? "text-red-500" : ""
            }`}
          >
            <Icon className={`w-5 h-5 ${danger ? "text-red-500" : "text-gray-500"}`} />
            <span className={`flex-1 ${danger ? "text-red-500" : "text-gray-700"}`}>{label}</span>
            <ChevronRight className={`w-4 h-4 ${danger ? "text-red-300" : "text-gray-300"}`} />
          </Link>
        ))}
      </div>

      <button
        onClick={handleLogout}
        className="w-full mt-4 py-3 bg-white text-red-500 rounded-xl font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
      >
        <LogOut className="w-4 h-4" />
        退出登录
      </button>

      {/* 头像编辑弹窗：单图上传模式，遮罩点击关闭 */}
      {editingAvatar && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4"
          onClick={() => !saving && setEditingAvatar(false)}
        >
          <div
            className="bg-white rounded-xl p-4 w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">修改头像</h3>
              <button
                onClick={() => !saving && setEditingAvatar(false)}
                className="text-gray-400 hover:text-gray-600"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {avatarError && (
              <div className="flex items-center gap-2 p-2.5 mb-3 bg-red-50 text-red-600 rounded-lg text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {avatarError}
              </div>
            )}

            <ImageUpload
              value={tempAvatar}
              onChange={setTempAvatar}
              maxCount={1}
              onError={(msg) => toast.error(msg)}
            />

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setEditingAvatar(false)}
                disabled={saving}
                className="flex-1 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleSaveAvatar}
                disabled={saving}
                className="flex-1 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
