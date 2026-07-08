import { useState, useRef, useCallback } from 'react';
import { X, Upload, Loader2 } from 'lucide-react';
import { uploadImages } from '@/api/upload';
import { ApiError } from '@/api/client';
// 允许的文件类型
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
// 最大文件大小：5MB
const MAX_SIZE = 5 * 1024 * 1024;
// 最大上传数量
const MAX_COUNT = 5;

interface ImageUploadProps {
  // 已上传的图片 URL 列表
  value?: string[];
  // 上传完成回调
  onChange?: (urls: string[]) => void;
  // 最大上传数量
  maxCount?: number;
  // 是否禁用
  disabled?: boolean;
  // 上传失败回调
  onError?: (error: string) => void;
}

interface PreviewImage {
  id: string;
  url: string; // 本地预览 URL 或已上传 URL
  file?: File;
  uploading?: boolean;
  error?: string;
}

export default function ImageUpload({
  value = [],
  onChange,
  maxCount = MAX_COUNT,
  disabled = false,
  onError
}: ImageUploadProps) {
  const [previews, setPreviews] = useState<PreviewImage[]>(() =>
    value.map((url, index) => ({
      id: `existing-${index}`,
      url,
      uploading: false
    }))
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 校验文件
  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `不支持的文件类型，仅支持 JPEG、PNG、GIF`;
    }
    if (file.size > MAX_SIZE) {
      return `文件大小超过限制，最大允许 5MB`;
    }
    return null;
  };

  // 处理文件选择
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    // 检查数量限制
    const remainingCount = maxCount - previews.length;
    if (remainingCount <= 0) {
      onError?.(`最多上传 ${maxCount} 张图片`);
      return;
    }
    
    const filesToUpload = fileArray.slice(0, remainingCount);
    
    // 校验所有文件
    for (const file of filesToUpload) {
      const error = validateFile(file);
      if (error) {
        onError?.(error);
        return;
      }
    }
    
    // 创建本地预览
    const newPreviews: PreviewImage[] = filesToUpload.map(file => ({
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: URL.createObjectURL(file),
      file,
      uploading: true
    }));
    
    setPreviews(prev => [...prev, ...newPreviews]);
    setUploading(true);
    
    try {
      // 批量上传
      const result = await uploadImages(filesToUpload);
      
      // 更新预览状态，替换本地 URL 为服务器 URL
      setPreviews(prev => {
        // 按上传顺序匹配结果
        let uploadIndex = 0;
        const updated = prev.map(p => {
          // 检查是否是本次上传的预览项
          const isUploadingItem = newPreviews.some(np => np.id === p.id);
          if (isUploadingItem && p.file && uploadIndex < result.images.length) {
            const uploadedImage = result.images[uploadIndex];
            uploadIndex++;
            if (uploadedImage) {
              // 释放本地预览 URL
              URL.revokeObjectURL(p.url);
              return {
                ...p,
                url: uploadedImage.url,
                uploading: false,
                file: undefined
              };
            }
          }
          return p;
        });
        
        // 回调通知
        const urls = updated.filter(p => !p.uploading).map(p => p.url);
        onChange?.(urls);
        
        return updated;
      });
    } catch (error) {
      // 上传失败，移除失败的预览
      setPreviews(prev => {
        const cleaned = prev.filter(p => !newPreviews.some(np => np.id === p.id));
        newPreviews.forEach(np => URL.revokeObjectURL(np.url));
        return cleaned;
      });
      
      const message = error instanceof ApiError 
        ? error.message 
        : '上传失败，请稍后重试';
      onError?.(message);
    } finally {
      setUploading(false);
    }
  }, [previews, maxCount, onChange, onError]);

  // 点击上传按钮
  const handleClick = () => {
    if (disabled || uploading) return;
    fileInputRef.current?.click();
  };

  // 文件选择事件
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
    // 清空 input，允许重复选择同一文件
    e.target.value = '';
  };

  // 删除图片
  const handleRemove = (id: string) => {
    setPreviews(prev => {
      const removed = prev.find(p => p.id === id);
      // 释放本地预览 URL
      if (removed?.file) {
        URL.revokeObjectURL(removed.url);
      }
      
      const updated = prev.filter(p => p.id !== id);
      // 回调通知
      const urls = updated.filter(p => !p.uploading).map(p => p.url);
      onChange?.(urls);
      
      return updated;
    });
  };

  // 拖拽上传
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || uploading) return;
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const canAddMore = previews.length < maxCount && !disabled;

  return (
    <div className="w-full">
      {/* 图片预览网格 */}
      {previews.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-2">
          {previews.map(preview => (
            <div
              key={preview.id}
              className="relative aspect-square rounded-lg overflow-hidden bg-gray-100"
            >
              <img
                src={preview.url}
                alt="预览图片"
                className="w-full h-full object-cover"
              />
              
              {/* 上传中遮罩 */}
              {preview.uploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}
              
              {/* 删除按钮 */}
              {!disabled && !preview.uploading && (
                <button
                  onClick={() => handleRemove(preview.id)}
                  className="absolute top-1 right-1 w-6 h-6 bg-black/50 rounded-full flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* 上传区域 */}
      {canAddMore && (
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center cursor-pointer transition-colors ${
            uploading 
              ? 'border-gray-200 bg-gray-50 cursor-not-allowed' 
              : 'border-gray-300 hover:border-emerald-500 hover:bg-emerald-50'
          }`}
        >
          {uploading ? (
            <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-400 mb-2" />
              <p className="text-sm text-gray-500">
                点击或拖拽上传图片
              </p>
              <p className="text-xs text-gray-400 mt-1">
                支持 JPEG、PNG、GIF，最大 5MB
              </p>
              {previews.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  还可上传 {maxCount - previews.length} 张
                </p>
              )}
            </>
          )}
        </div>
      )}
      
      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif"
        multiple
        onChange={handleInputChange}
        className="hidden"
        disabled={disabled || uploading}
      />
    </div>
  );
}