import client, { ApiError } from './client';
import type { ApiResponse } from '@/types';

// 上传单张图片返回结果
export interface UploadResult {
  url: string;
  filename: string;
  size: number;
  mimetype: string;
}

// 上传多张图片返回结果
export interface MultiUploadResult {
  images: UploadResult[];
}

// 上传单张图片
export async function uploadImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  try {
    // 响应拦截器返回完整 ApiResponse（{ code, message, data }），需取 .data 获取实际业务数据
    const res = await client.post<never, ApiResponse<UploadResult>>('/upload/image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return res.data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('上传失败，请稍后重试', 500);
  }
}

// 批量上传图片（最多 5 张）
export async function uploadImages(files: File[]): Promise<MultiUploadResult> {
  const formData = new FormData();
  files.forEach(file => {
    formData.append('files', file);
  });

  try {
    const res = await client.post<never, ApiResponse<MultiUploadResult>>('/upload/images', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return res.data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('上传失败，请稍后重试', 500);
  }
}