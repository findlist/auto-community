/**
 * AI 智能匹配 API 封装
 */
import client from "./client";

export interface MatchCandidate {
  userId: string;
  nickname: string;
  reputationScore: number;
  matchScore: number; // 0-1
  distance: number | null; // 米
  post?: {
    id: string;
    title: string;
    category: string;
  };
}

/**
 * 获取技能帖子 AI 推荐匹配
 * 路径说明：client baseURL 已为 /api，这里用相对路径 /ai/match/...
 * 与其他 API 文件（admin.ts/users.ts 等）保持一致，避免拼成 /api/api/ai/...
 */
export async function matchSkill(postId: string): Promise<MatchCandidate[]> {
  const res = await client.get(`/ai/match/skills/${postId}`);
  return res.data?.data || [];
}

/**
 * 获取时间银行服务 AI 推荐匹配
 */
export async function matchTimeService(serviceId: string): Promise<MatchCandidate[]> {
  const res = await client.get(`/ai/match/time-bank/${serviceId}`);
  return res.data?.data || [];
}
