import { useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, Save, Check } from "lucide-react";
import { getHomepageImage, setHomepageImage } from "@/api/admin";
import { uploadImage } from "@/api/upload";
import { ApiError } from "@/api/client";

export default function HomepageImage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // 保存成功提示定时器引用：组件卸载时清理，避免 setState 作用于已卸载组件
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // 加载当前首页图片
  const loadImage = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getHomepageImage();
      setUrl(res.data.url || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImage();
  }, []);

  // 上传图片文件
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadImage(file);
      setUrl(res.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "上传失败");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // 保存图片配置
  const handleSave = async () => {
    if (!url.trim()) {
      setError("图片 URL 不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await setHomepageImage(url.trim());
      setSuccess(true);
      successTimerRef.current = setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-neutral-800 mb-1">首页展示图片</h2>
      <p className="text-sm text-neutral-500 mb-5">
        配置首页 Hero 区的全幅背景图，建议使用 16:9 横向图片。
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-neutral-100 p-5 space-y-5">
        {/* 预览区 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-2">当前图片预览</label>
          <div className="aspect-video w-full max-w-2xl rounded-lg overflow-hidden bg-neutral-100 border border-neutral-200">
            {url ? (
              <img src={url} alt="首页展示图片" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-neutral-400 text-sm">
                暂未配置，将使用默认图片
              </div>
            )}
          </div>
        </div>

        {/* URL 输入 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">图片 URL</label>
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setSuccess(false);
            }}
            placeholder="粘贴图片 URL，或使用下方按钮上传"
            className="w-full max-w-2xl px-3 py-2 border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
          />
        </div>

        {/* 上传按钮 */}
        <div>
          <label className="block text-sm font-medium text-neutral-700 mb-1">上传本地图片</label>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-100 text-neutral-700 rounded-lg cursor-pointer hover:bg-neutral-200 text-sm">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {uploading ? "上传中..." : "选择图片上传"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif"
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <p className="text-xs text-neutral-400 mt-1">支持 JPEG、PNG、GIF，最大 5MB</p>
        </div>

        {/* 保存按钮 */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            className="flex items-center gap-1.5 px-5 py-2 text-sm text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            保存配置
          </button>
          {success && (
            <span className="flex items-center gap-1 text-sm text-emerald-600">
              <Check className="w-4 h-4" />
              已保存
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
