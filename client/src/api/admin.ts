import client from "./client";
import type { ApiResponse, PaginatedResponse } from "@/types";

// 管理后台数据统计
export interface DashboardData {
  totalUsers: number;
  todayNewUsers: number;
  skillOrders: number;
  kitchenOrders: number;
  timeBankOrders: number;
  emergencyRequests: number;
  pendingReports: number;
}

// 管理后台用户列表项
export interface AdminUser {
  id: string;
  phone: string;
  nickname: string;
  role: string;
  status: string;
  reputationScore: number;
  creditBalance: number;
  createdAt: string;
}

// 管理后台内容列表项：后端按 type 返回不同动态字段，统一声明为可选以覆盖所有场景
// 设计原因：getContent 接口对应 skill/kitchen/time_bank/emergency 四类内容，
// 后端通过 CONTENT_CONFIG.alias 动态映射一个业务字段，前端列表只渲染公共字段，
// 但详情/编辑场景会读取动态字段，故统一在类型层暴露，避免 any 逃逸
export interface AdminContentItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  userId: string;
  // skill 类型：积分价格
  creditsRequired?: number;
  // kitchen 类型：积分价格
  price?: number;
  // time_bank 类型：服务时长（分钟）
  durationMinutes?: number;
  // emergency 类型：紧急程度
  urgency?: string;
}

// 管理后台订单列表项：后端按 type 返回不同动态字段，统一声明为可选
// 设计原因：getOrders 接口对应 skill/kitchen/time_bank 三类订单，
// 后端通过 ORDER_CONFIG.alias 动态映射一个业务字段（金额或时长）
export interface AdminOrderItem {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  createdAt: string;
  // skill 类型：积分金额
  creditsAmount?: number;
  // kitchen 类型：总价
  totalPrice?: number;
  // time_bank 类型：服务时长（分钟）
  durationMinutes?: number;
}

// 举报列表项
export interface Report {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  handlerId?: string;
  handleNote?: string;
  createdAt: string;
  handledAt?: string;
}

// 管理后台数据统计
export function getDashboard() {
  return client.get<never, ApiResponse<DashboardData>>("/admin/dashboard");
}

export interface TrendItem {
  date: string;
  count: number;
}

export interface ReputationItem {
  label: string;
  count: number;
}

export interface ModuleItem {
  name: string;
  posts: number;
  orders: number;
}

export interface SystemStatsData {
  pendingReports: number;
  todayActiveUsers: number;
  totalMutualAids: number;
  monthNewUsers: number;
}

export function getDashboardTrend(type: 'registration' | 'order', days: number = 7) {
  return client.get<never, ApiResponse<TrendItem[]>>("/admin/dashboard/trend", {
    params: { type, days },
  });
}

export function getDashboardReputation() {
  return client.get<never, ApiResponse<ReputationItem[]>>("/admin/dashboard/reputation");
}

export function getDashboardModules() {
  return client.get<never, ApiResponse<ModuleItem[]>>("/admin/dashboard/modules");
}

export function getDashboardSystem() {
  return client.get<never, ApiResponse<SystemStatsData>>("/admin/dashboard/system");
}

// 获取用户列表
export function getUsers(page: number, pageSize: number, search?: string) {
  return client.get<never, ApiResponse<PaginatedResponse<AdminUser>>>("/admin/users", {
    params: { page, pageSize, search },
  });
}

// 封禁用户
export function banUser(id: string) {
  return client.put<never, ApiResponse<null>>(`/admin/users/${id}/ban`);
}

// 解封用户
export function unbanUser(id: string) {
  return client.put<never, ApiResponse<null>>(`/admin/users/${id}/unban`);
}

// 更新用户角色
export function updateUserRole(id: string, role: string) {
  return client.put<never, ApiResponse<null>>(`/admin/users/${id}/role`, { role });
}

// ===================== 批量操作 =====================

// 批量封禁结果：成功/跳过/失败明细，供前端给出汇总提示
export interface BatchBanResult {
  successfulIds: string[];
  skippedAdminIds: string[];
  skippedSelfId: string[];
  failedIds: string[];
}

// 通用批量结果：成功与未命中明细
export interface BatchResult {
  successfulIds: string[];
  failedIds: string[];
}

// 批量封禁用户
export function batchBanUsers(userIds: string[]) {
  return client.post<never, ApiResponse<BatchBanResult>>('/admin/users/batch-ban', { userIds });
}

// 批量解封用户
export function batchUnbanUsers(userIds: string[]) {
  return client.post<never, ApiResponse<BatchResult>>('/admin/users/batch-unban', { userIds });
}

// 批量更新内容状态（上架/下架）
export function batchUpdateContentStatus(type: string, ids: string[], status: string) {
  return client.post<never, ApiResponse<BatchResult>>(`/admin/content/${type}/batch-status`, { ids, status });
}

// 获取内容列表
export function getContent(type: string, status: string, page: number, pageSize: number) {
  return client.get<never, ApiResponse<PaginatedResponse<AdminContentItem>>>("/admin/content", {
    params: { type, status, page, pageSize },
  });
}

// 更新内容状态（上架/下架）
export function updateContentStatus(type: string, id: string, status: string) {
  return client.put<never, ApiResponse<null>>(`/admin/content/${type}/${id}/status`, { status });
}

// 内容详情（含图片等可编辑字段）
export interface ContentDetail {
  id: string;
  title: string;
  description?: string;
  status: string;
  createdAt: string;
  creditPrice?: number;
  images?: string[];
  tags?: string[];
  address?: string;
  category?: string;
  durationMinutes?: number;
  portions?: number;
  pickupAddress?: string;
  allergens?: string[];
  urgency?: string;
}

// 获取内容详情
export function getContentDetail(type: string, id: string) {
  return client.get<never, ApiResponse<ContentDetail>>(`/admin/content/${type}/${id}`);
}

// 管理员编辑内容（字段按需传入）
export function updateContent(type: string, id: string, data: Partial<ContentDetail>) {
  return client.put<never, ApiResponse<ContentDetail>>(`/admin/content/${type}/${id}`, data);
}

// ===================== 首页展示图片管理 =====================

// 获取首页展示图片（管理员）
export function getHomepageImage() {
  return client.get<never, ApiResponse<{ url: string | null }>>(`/admin/homepage-image`);
}

// 设置首页展示图片
export function setHomepageImage(url: string) {
  return client.put<never, ApiResponse<{ url: string; updatedBy: string }>>(`/admin/homepage-image`, { url });
}

// ===================== 系统配置管理 =====================

// 配置值类型：驱动前端滑块步长精度，与后端 site_settings.value_type 对齐
// 设计原因：用元数据驱动替代 key 关键词正则，符合开闭原则——新增类型只需扩展枚举
export type SettingValueType = 'string' | 'int' | 'float';

// 系统配置项（对齐后端 site_settings 表返回结构）
export interface SystemSetting {
  key: string;
  // 配置值统一以字符串存储，业务侧自行解析，允许为空
  value: string | null;
  // 配置值类型：string/int/float，前端按此决定滑块步长，缺省为 string
  valueType: SettingValueType;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

// 获取全部系统配置项
export function getSettings() {
  return client.get<never, ApiResponse<SystemSetting[]>>("/admin/settings");
}

// 获取单个系统配置项
export function getSettingDetail(key: string) {
  return client.get<never, ApiResponse<SystemSetting>>(`/admin/settings/${key}`);
}

// 新增或更新系统配置（upsert）：description 省略时后端用 COALESCE 保留原值
// valueType 省略时后端缺省为 string；编辑已有配置时不传则保留原类型
export function setSetting(key: string, value: string, description?: string, valueType?: SettingValueType) {
  return client.put<never, ApiResponse<SystemSetting>>(`/admin/settings/${key}`, { value, description, valueType });
}

// 删除系统配置（受保护键后端会拒绝）
export function deleteSetting(key: string) {
  return client.delete<never, ApiResponse<{ key: string }>>(`/admin/settings/${key}`);
}

// ===================== 审计日志 =====================

export interface AuditLog {
  id: number;
  userId?: string;
  nickname?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
}

export interface AuditLogQuery {
  userId?: string;
  action?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

// 查询审计日志
export function getAuditLogs(params: AuditLogQuery) {
  return client.get<never, ApiResponse<PaginatedResponse<AuditLog>>>(`/admin/audit-logs`, { params });
}

// 获取订单列表
export function getOrders(type: string, status: string, page: number, pageSize: number) {
  return client.get<never, ApiResponse<PaginatedResponse<AdminOrderItem>>>(`/admin/orders/${type}`, {
    params: { status, page, pageSize },
  });
}

// 强制取消订单
export function forceCancelOrder(type: string, id: string, reason: string) {
  return client.put<never, ApiResponse<null>>(`/admin/orders/${type}/${id}/cancel`, { reason });
}

// 获取举报列表
export function getReports(page: number, pageSize: number, status?: string) {
  return client.get<never, ApiResponse<PaginatedResponse<Report>>>("/admin/reports", {
    params: { page, pageSize, status },
  });
}

// ===================== 数据导出 =====================

// 支持导出的数据类型
export type ExportType = 'users' | 'orders' | 'reports' | 'audit-logs';

// 导出格式：csv 为纯文本表格，xlsx 为 Excel 表格（办公场景兼容性更好）
export type ExportFormat = 'csv' | 'xlsx';

export interface ExportParams {
  // 订单类型（仅 type=orders 时生效）
  orderType?: 'skill' | 'kitchen' | 'time_bank';
  // 状态筛选
  status?: string;
  // 时间范围（ISO 字符串），用于订单/审计日志
  startDate?: string;
  endDate?: string;
}

/**
 * 导出数据为 CSV/Excel 并触发浏览器下载
 * 设计说明：responseType: 'blob' 让 axios 以二进制接收文件流，
 * 避免被默认 JSON 解析器破坏；下载文件名由前端生成，扩展名随 format 变化
 */
export async function exportData(
  type: ExportType,
  params: ExportParams = {},
  format: ExportFormat = 'csv',
): Promise<void> {
  const blob = await client.get<never, Blob>(`/admin/export/${type}`, {
    params: { ...params, format },
    responseType: 'blob',
  });
  // 创建临时 URL 触发下载，完成后立即释放避免内存泄漏
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.download = `export-${type}-${dateStr}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 处理举报
export function handleReport(id: string, status: string, handleNote: string) {
  return client.put<never, ApiResponse<null>>(`/admin/reports/${id}`, { status, handleNote });
}

// 创建举报
export function createReport(targetType: string, targetId: string, reason: string) {
  return client.post<never, ApiResponse<null>>("/reports", { targetType, targetId, reason });
}

// ===================== 实名认证审核 =====================

// 实名认证申请列表项
export interface VerificationRequest {
  id: string;
  userId: string;
  userNickname: string;
  userPhone: string;
  realName: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason?: string;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewerNickname?: string;
}

// 获取实名认证申请列表
export function getVerificationRequests(page: number, pageSize: number, status?: string) {
  return client.get<never, ApiResponse<PaginatedResponse<VerificationRequest>>>("/admin/verifications", {
    params: { page, pageSize, status },
  });
}

// 审核实名认证申请
export function reviewVerification(id: string, action: 'approve' | 'reject', rejectReason?: string) {
  return client.put<never, ApiResponse<null>>(`/admin/verifications/${id}`, { action, rejectReason });
}

// 系统指标类型定义
export interface SystemMetrics {
  database: {
    status: 'healthy' | 'unhealthy';
    poolSize: number;
    idleConnections: number;
    waitingCount: number;
  };
  redis: {
    status: 'healthy' | 'unhealthy';
    connected: boolean;
    memoryUsage: string;
  };
  server: {
    uptime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
    };
    requestQueueLength: number;
  };
}

// 告警日志类型
export interface AlertLog {
  timestamp: string;
  type: 'database' | 'redis' | 'memory';
  level: 'warning' | 'critical';
  message: string;
  details: Record<string, unknown>;
}

// 系统指标响应
export interface MetricsResponse {
  metrics: SystemMetrics;
  alerts: AlertLog[];
}

// 获取系统指标
export function getSystemMetrics() {
  return client.get<never, ApiResponse<MetricsResponse>>("/health/metrics");
}

// 清除告警日志
export function clearAlertLogs() {
  return client.delete<never, ApiResponse<null>>("/health/metrics/alerts");
}

// ===================== 效果度量 =====================

// 仪表盘指标数据类型
export interface DashboardMetric {
  name: string;
  value: number;
  // 标签结构由后端动态决定，使用 unknown 替代 any 强制消费方做类型收窄
  tags: Record<string, unknown>;
  recordedAt: string;
}

// 指标汇总数据类型
export interface MetricSummary {
  name: string;
  avg: number;
  min: number;
  max: number;
  count: number;
}

// 指标趋势数据类型
export interface MetricTrendItem {
  date: string;
  value: number;
}

// 获取仪表盘指标概览
export function getMetricsDashboard() {
  return client.get<never, ApiResponse<DashboardMetric[]>>("/metrics/dashboard");
}

// 获取指标汇总
export function getMetricSummary(name: string, startDate?: string, endDate?: string) {
  return client.get<never, ApiResponse<MetricSummary>>(`/metrics/${name}/summary`, {
    params: { startDate, endDate },
  });
}

// 获取指标趋势数据
export function getMetricTrend(
  name: string,
  startDate?: string,
  endDate?: string,
  granularity: "day" | "week" | "month" = "day"
) {
  return client.get<never, ApiResponse<MetricTrendItem[]>>(`/metrics/${name}/trend`, {
    params: { startDate, endDate, granularity },
  });
}
