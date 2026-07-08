export interface User {
  id: string;
  phone: string;
  nickname: string;
  avatar?: string;
  creditBalance: number;
  timeBalance: number;
  reputationScore: number;
  role: "user" | "admin";
  createdAt: string;
}

export interface SkillPost {
  id: string;
  userId: string;
  user?: User;
  type: "offer" | "request";
  title: string;
  description: string;
  category: string;
  creditsRequired: number;
  location?: string;
  images: string[];
  status: "active" | "closed" | "completed";
  createdAt: string;
  updatedAt: string;
}

export interface SkillOrder {
  id: string;
  postId: string;
  post?: SkillPost;
  buyerId: string;
  buyer?: {
    id: string;
    nickname: string;
    avatar?: string;
  };
  sellerId: string;
  seller?: {
    id: string;
    nickname: string;
    avatar?: string;
  };
  creditsAmount: number;
  status: "pending" | "accepted" | "rejected" | "in_progress" | "completed" | "cancelled" | "disputed";
  // 争议相关字段
  disputeReason?: string;
  disputeTime?: string;
  resolution?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  completedAt?: string;
  createdAt: string;
}

export interface KitchenPost {
  id: string;
  userId: string;
  user?: {
    id: string;
    nickname: string;
    avatar?: string;
    reputationScore: number;
  };
  type: "offer" | "need";
  title: string;
  description: string;
  category: string;
  price: number;
  quantity: number;
  remaining: number;
  pickupTime: string;
  pickupLocation: string;
  pickupType: "self_pickup" | "delivery";
  images: string[];
  allergens?: string[];
  healthCert: boolean;
  status: "active" | "sold_out" | "closed" | "expired";
  distance?: number;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenOrder {
  id: string;
  postId: string;
  post?: {
    id: string;
    title: string;
    images: string[];
  };
  buyerId: string;
  buyer?: {
    id: string;
    nickname: string;
    avatar?: string;
  };
  sellerId: string;
  seller?: {
    id: string;
    nickname: string;
    avatar?: string;
  };
  quantity: number;
  totalPrice: number;
  pickupType: "self_pickup" | "delivery";
  pickupTime?: string;
  deliveryAddress?: string;
  remark?: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "timeout";
  createdAt: string;
  completedAt?: string;
  timeoutAt?: string;
}

export interface GroupOrder {
  id: string;
  initiatorId: string;
  initiator?: {
    id: string;
    nickname?: string;
    avatar?: string;
  };
  title: string;
  description?: string;
  targetAmount: number;
  currentAmount: number;
  minParticipants: number;
  maxParticipants: number;
  currentParticipants: number;
  address: string;
  deadline: string;
  status: "open" | "full" | "ongoing" | "completed" | "cancelled";
  participants?: GroupOrderParticipant[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupOrderParticipant {
  id: string;
  nickname?: string;
  avatar?: string;
  amount: number;
  status: "pending" | "paid" | "refunded";
}

export interface FoodReview {
  id: string;
  reviewerId: string;
  reviewer?: {
    nickname?: string;
    avatar?: string;
  };
  reviewedId: string;
  orderId: string;
  rating: number;
  content?: string;
  createdAt: string;
}

export interface TimeService {
  id: string;
  userId: string;
  user?: User;
  type: "provide" | "request";
  title: string;
  description: string;
  category: string;
  durationMinutes: number;
  location?: string;
  address?: string;
  certification?: Record<string, unknown>;
  // 服务配图：与 kitchen_posts.images 一致，由 ImageUpload 组件上传，后端校验白名单
  images?: string[];
  status: "active" | "matched" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface TimeOrder {
  id: string;
  serviceId: string;
  service?: TimeService;
  providerId: string;
  requesterId: string;
  durationMinutes: number;
  status: "pending" | "accepted" | "in_progress" | "completed" | "cancelled" | "disputed";
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  createdAt: string;
}

export interface EmergencyRequest {
  id: string;
  userId: string;
  user?: User;
  type: "emergency" | "daily";
  category: string;
  title: string;
  description: string;
  urgency: "critical" | "high" | "medium" | "low";
  location?: string;
  address?: string;
  contactPhone?: string;
  isAnonymous: boolean;
  images: string[];
  status: "open" | "responding" | "resolved" | "closed" | "false_report";
  responses: EmergencyResponse[];
  reviews: EmergencyReview[];
  createdAt: string;
  updatedAt: string;
}

export interface EmergencyResponse {
  id: string;
  requestId: string;
  userId: string;
  user?: User;
  message: string;
  eta?: number;
  status: "pending" | "accepted" | "arrived" | "completed" | "timeout";
  timeoutAt?: string;
  arrivedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface EmergencyReview {
  id: string;
  reviewerId: string;
  reviewedId: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface EmergencyResource {
  id: string;
  communityId?: string;
  type: string;
  name: string;
  description?: string;
  location?: string;
  address?: string;
  contactPhone?: string;
  status: "available" | "maintenance" | "unavailable";
  lastCheck?: string;
  createdAt: string;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// 统一分页响应格式（扁平结构）
export interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
}

// 游标分页响应格式：基于索引范围查询，性能稳定
export interface CursorPaginatedResponse<T> {
  list: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  amount: number;
  type: "earn" | "spend" | "freeze" | "unfreeze" | "refund" | "time_earn" | "time_spend";
  balanceAfter: number;
  referenceId?: string;
  referenceType?: string;
  description: string;
  createdAt: string;
}

export interface Review {
  id: string;
  orderId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface ServiceDispute {
  id: string;
  orderId: string;
  initiatorId: string;
  reason: string;
  evidence: string[];
  status: "pending" | "investigating" | "resolved" | "rejected";
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeAccount {
  id: string;
  userId: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  updatedAt: string;
}

export interface TimeTransaction {
  id: string;
  serviceId?: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  type: "earn" | "spend" | "transfer" | "donate";
  status: "pending" | "completed" | "cancelled";
  remark?: string;
  createdAt: string;
  completedAt?: string;
}

export interface FamilyBinding {
  id: string;
  userId: string;
  parentId: string;
  relationship: string;
  status: "pending" | "confirmed" | "rejected" | "unbound";
  createdAt: string;
  updatedAt: string;
  // 后端联表查询返回的对方信息，用于在 UI 中展示头像与昵称
  other?: {
    id: string;
    nickname?: string;
    avatar?: string;
  };
}

export interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  orderId?: string;
  orderType?: string;
  content: string;
  type?: string;
  read: boolean;
  createdAt: string;
}

// 通知类型
export type NotificationType = 'order_status' | 'emergency_response' | 'report_result' | 'system';

// 关联类型
export type NotificationReferenceType = 'skill_order' | 'kitchen_order' | 'emergency_request';

// 通知数据结构
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  content?: string;
  referenceId?: string;
  referenceType?: NotificationReferenceType;
  readAt?: string;
  createdAt: string;
}
