import client, { ApiError } from './client';

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
    const response = await client.post<UploadResult>('/upload/image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response as unknown as UploadResult;
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
    const response = await client.post<MultiUploadResult>('/upload/images', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    return response as unknown as MultiUploadResult;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError('上传失败，请稍后重试', 500);
  }
}