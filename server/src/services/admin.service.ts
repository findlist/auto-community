import { query, transaction, SqlParam, isSqlParam } from '../config/database';
import { QueryResultRow } from 'pg';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { createPaginatedResponse } from '../utils/pagination';
import { logger } from '../utils/logger';
import { userCache } from './cache.service';
import { sanitizeObject } from '../utils/sanitize';
import ExcelJS from 'exceljs';

// ===================== 类型定义 =====================

type ContentType = 'skill' | 'kitchen' | 'time_bank' | 'emergency';
type OrderType = 'skill' | 'kitchen' | 'time_bank';
// 导出 UserRole 供 routes 层收窄 req.body.role 类型，编译期即可校验角色值合法性
export type UserRole = 'admin' | 'user';
export type ReportStatus = 'pending' | 'resolved' | 'rejected';
export type ReportTargetType = 'skill' | 'kitchen' | 'time_bank' | 'emergency' | 'user';

// 批量操作单次最大条数：防止误操作大批量数据导致服务不可控
// 设计原因：50 条既能覆盖典型后台审核场景，又能在异常情况下快速回滚
const BATCH_LIMIT = 50;

// admin 强制取消订单时查询的列：仅包含取消逻辑消费的字段，避免返回不必要数据
// 设计原因：admin.service 的 FOR UPDATE 查询只需判断状态和退款金额，无需订单全部字段；
// 各表完整列常量定义在对应业务 service 中，此处不复用避免跨模块耦合
const ADMIN_SKILL_ORDER_COLUMNS = 'id, buyer_id, seller_id, credit_amount, status';
const ADMIN_KITCHEN_ORDER_COLUMNS = 'id, post_id, user_id, seller_id, credit_amount, status';
const ADMIN_TIME_ORDER_COLUMNS = 'id, status';
// verification_requests 包含加密身份证号(id_card_encrypted)等敏感字段，
// 显式列名避免 SELECT * 返回敏感数据，仅返回审核逻辑消费的 3 个字段
const VERIFICATION_REQUEST_COLUMNS = 'id, user_id, status';

// ===================== 用户管理 =====================

// 分页查询用户列表，支持按手机号/昵称搜索
async function getUsers(page: number, pageSize: number, search?: string) {
  const conditions: string[] = ['deleted_at IS NULL'];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (search) {
    conditions.push(`(phone LIKE $${paramIndex++} OR nickname LIKE $${paramIndex++})`);
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM users WHERE ${whereClause}`, params),
    query(
      `SELECT id, phone, nickname, role, status, created_at, reputation_score, credit_balance
       FROM users
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const list = listResult.rows.map((row) => ({
    id: row.id,
    phone: row.phone,
    nickname: row.nickname,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    reputationScore: row.reputation_score,
    creditBalance: row.credit_balance,
  }));

  return createPaginatedResponse(list, total, page, pageSize);
}

// 封禁用户
async function banUser(userId: string) {
  const { rows } = await query(
    "UPDATE users SET status = 'banned', updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, status",
    [userId],
  );
  if (rows.length === 0) throw new NotFoundError('用户');
  return { id: rows[0].id, status: rows[0].status };
}

// 解封用户
async function unbanUser(userId: string) {
  const { rows } = await query(
    "UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, status",
    [userId],
  );
  if (rows.length === 0) throw new NotFoundError('用户');
  return { id: rows[0].id, status: rows[0].status };
}

// 修改用户角色
async function updateUserRole(userId: string, role: UserRole) {
  const { rows } = await query(
    'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING id, role',
    [role, userId],
  );
  if (rows.length === 0) throw new NotFoundError('用户');
  return { id: rows[0].id, role: rows[0].role };
}

// 批量封禁用户：跳过管理员与操作者自身，避免误封导致后台失联
// 设计原因：批量封禁是高风险操作，必须排除 admin 角色与当前操作者，
// 否则可能把全部管理员一次封禁，造成后台无人可用的事故
async function batchBanUsers(userIds: string[], operatorId: string) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new BadRequestError('用户ID列表不能为空');
  }
  if (userIds.length > BATCH_LIMIT) {
    throw new BadRequestError(`单次批量操作不能超过 ${BATCH_LIMIT} 条`);
  }
  // 去重，避免同一 ID 多次出现导致返回明细重复
  const uniqueIds = Array.from(new Set(userIds));

  // 查询待处理用户当前角色，用于识别需跳过的管理员
  const { rows: existingRows } = await query(
    `SELECT id, role FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
    [uniqueIds],
  );
  const existingMap = new Map(existingRows.map((r) => [r.id, r.role]));
  // 跳过：管理员角色 + 操作者自身（自身被禁将导致后台瘫痪）
  const skippedAdminIds: string[] = [];
  const skippedSelfId: string[] = [];
  const targetIds: string[] = [];
  for (const id of uniqueIds) {
    if (id === operatorId) {
      skippedSelfId.push(id);
    } else if (existingMap.get(id) === 'admin') {
      skippedAdminIds.push(id);
    } else {
      targetIds.push(id);
    }
  }

  if (targetIds.length === 0) {
    return { successfulIds: [] as string[], skippedAdminIds, skippedSelfId, failedIds: [] as string[] };
  }

  // 单条 UPDATE 批量更新，只封禁未被封禁的用户，避免重复写入
  const { rows: updated } = await query(
    `UPDATE users SET status = 'banned', updated_at = NOW()
     WHERE id = ANY($1) AND deleted_at IS NULL AND status != 'banned'
     RETURNING id`,
    [targetIds],
  );
  const successfulIds = updated.map((r) => r.id);
  const successSet = new Set(successfulIds);
  // 失败：目标集合中未出现在成功集合的（已删除或已封禁等）
  const failedIds = targetIds.filter((id) => !successSet.has(id));

  logger.warn(
    { operatorId, total: uniqueIds.length, success: successfulIds.length, skippedAdmin: skippedAdminIds.length, skippedSelf: skippedSelfId.length },
    '管理员批量封禁用户',
  );

  return { successfulIds, skippedAdminIds, skippedSelfId, failedIds };
}

// 批量解封用户：单条 UPDATE 完成，返回成功与未命中明细
async function batchUnbanUsers(userIds: string[]) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new BadRequestError('用户ID列表不能为空');
  }
  if (userIds.length > BATCH_LIMIT) {
    throw new BadRequestError(`单次批量操作不能超过 ${BATCH_LIMIT} 条`);
  }
  const uniqueIds = Array.from(new Set(userIds));

  const { rows: updated } = await query(
    `UPDATE users SET status = 'active', updated_at = NOW()
     WHERE id = ANY($1) AND deleted_at IS NULL AND status = 'banned'
     RETURNING id`,
    [uniqueIds],
  );
  const successfulIds = updated.map((r) => r.id);
  const successSet = new Set(successfulIds);
  const failedIds = uniqueIds.filter((id) => !successSet.has(id));

  return { successfulIds, failedIds };
}

// ===================== 内容审核 =====================

// 各模块内容查询配置：表名与返回字段映射
const CONTENT_CONFIG: Record<ContentType, { table: string; extraColumn: string; alias: string }> = {
  skill: { table: 'skill_posts', extraColumn: 'credit_price', alias: 'creditsRequired' },
  kitchen: { table: 'kitchen_posts', extraColumn: 'credit_price', alias: 'price' },
  time_bank: { table: 'time_services', extraColumn: 'duration_minutes', alias: 'durationMinutes' },
  emergency: { table: 'emergency_requests', extraColumn: 'urgency', alias: 'urgency' },
};

// 按模块查询内容列表
async function getContent(type: ContentType, status: string | undefined, page: number, pageSize: number) {
  const config = CONTENT_CONFIG[type];
  if (!config) throw new BadRequestError('无效的内容类型');

  const conditions: string[] = ['deleted_at IS NULL'];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM ${config.table} WHERE ${whereClause}`, params),
    query(
      `SELECT id, title, status, created_at, user_id, ${config.extraColumn}
       FROM ${config.table}
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const list = listResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    userId: row.user_id,
    [config.alias]: row[config.extraColumn],
  }));

  return createPaginatedResponse(list, total, page, pageSize);
}

// 更新内容状态（下架/上架）
async function updateContentStatus(type: ContentType, id: string, status: string) {
  const config = CONTENT_CONFIG[type];
  if (!config) throw new BadRequestError('无效的内容类型');

  const { rows } = await query(
    `UPDATE ${config.table} SET status = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING id, status`,
    [status, id],
  );
  if (rows.length === 0) throw new NotFoundError('内容');
  return { id: rows[0].id, status: rows[0].status };
}

// 批量更新内容状态：单条 UPDATE 完成，避免循环写入
// 设计原因：批量上下架是审核高频操作，循环单条更新会产生 N 次 DB 往返，
// 用 WHERE id = ANY($2) 一次性处理，且返回成功/失败明细便于排查
async function batchUpdateContentStatus(type: ContentType, ids: string[], status: string) {
  const config = CONTENT_CONFIG[type];
  if (!config) throw new BadRequestError('无效的内容类型');
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new BadRequestError('内容ID列表不能为空');
  }
  if (ids.length > BATCH_LIMIT) {
    throw new BadRequestError(`单次批量操作不能超过 ${BATCH_LIMIT} 条`);
  }
  const uniqueIds = Array.from(new Set(ids));

  const { rows: updated } = await query(
    `UPDATE ${config.table} SET status = $1, updated_at = NOW()
     WHERE id = ANY($2) AND deleted_at IS NULL
     RETURNING id`,
    [status, uniqueIds],
  );
  const successfulIds = updated.map((r) => r.id);
  const successSet = new Set(successfulIds);
  const failedIds = uniqueIds.filter((id) => !successSet.has(id));

  return { successfulIds, failedIds };
}

// ===================== 内容编辑（管理员） =====================

// 各内容类型可编辑字段配置：字段白名单 + 富文本字段 + 详情查询字段
const CONTENT_EDIT_CONFIG: Record<ContentType, {
  table: string;
  editableFields: string[];
  textFields: string[];
  detailSelect: string;
}> = {
  skill: {
    table: 'skill_posts',
    editableFields: ['title', 'description', 'credit_price', 'images', 'tags', 'address'],
    textFields: ['title', 'description'],
    detailSelect: 'id, title, description, credit_price, images, tags, address, status, created_at',
  },
  kitchen: {
    table: 'kitchen_posts',
    editableFields: ['title', 'description', 'credit_price', 'images', 'category', 'portions', 'pickup_address', 'allergens'],
    textFields: ['title', 'description'],
    detailSelect: 'id, title, description, credit_price, images, category, portions, pickup_address, allergens, status, created_at',
  },
  time_bank: {
    table: 'time_services',
    editableFields: ['title', 'description', 'duration_minutes', 'category', 'address'],
    textFields: ['title', 'description'],
    detailSelect: 'id, title, description, duration_minutes, category, address, status, created_at',
  },
  emergency: {
    table: 'emergency_requests',
    editableFields: ['title', 'description', 'images', 'urgency', 'category', 'address'],
    textFields: ['title', 'description'],
    detailSelect: 'id, title, description, images, urgency, category, address, status, created_at',
  },
};

// 获取内容详情（含图片等可编辑字段）
async function getContentDetail(type: ContentType, id: string) {
  const config = CONTENT_EDIT_CONFIG[type];
  if (!config) throw new BadRequestError('无效的内容类型');

  const { rows } = await query(
    `SELECT ${config.detailSelect} FROM ${config.table} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (rows.length === 0) throw new NotFoundError('内容');

  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    creditPrice: row.credit_price ?? undefined,
    images: row.images ?? [],
    tags: row.tags ?? [],
    address: row.address ?? undefined,
    category: row.category ?? undefined,
    durationMinutes: row.duration_minutes ?? undefined,
    portions: row.portions ?? undefined,
    pickupAddress: row.pickup_address ?? undefined,
    allergens: row.allergens ?? [],
    urgency: row.urgency ?? undefined,
  };
}

// 管理员编辑内容：按字段白名单更新，富文本做 XSS 清洗
// 接受驼峰字段名（与 getContentDetail 返回一致），内部映射为数据库下划线列名
//
// 设计原因：data/normalized 使用 unknown 而非 any，避免 any 静默吞掉类型不匹配；
// 收集待更新字段时通过 isSqlParam type guard 显式校验运行时类型，校验失败抛
// BadRequestError，比 pg 运行时序列化报错更早暴露问题并返回友好错误。
async function updateContent(type: ContentType, id: string, data: Record<string, unknown>, adminId: string) {
  const config = CONTENT_EDIT_CONFIG[type];
  if (!config) throw new BadRequestError('无效的内容类型');

  // 校验内容存在
  const { rows: existing } = await query(
    `SELECT id FROM ${config.table} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (existing.length === 0) throw new NotFoundError('内容');

  // 驼峰入参 → 下划线列名映射，统一使用下划线键进行后续处理
  const camelToSnake: Record<string, string> = {
    creditPrice: 'credit_price',
    durationMinutes: 'duration_minutes',
    pickupAddress: 'pickup_address',
  };
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    normalized[camelToSnake[key] || key] = value;
  }

  // 清洗富文本字段，防止存储型 XSS
  const sanitized = sanitizeObject(normalized, config.textFields);

  // 按白名单收集待更新字段
  // 设计原因：sanitized[field] 是 unknown，必须通过 isSqlParam type guard 校验
  // 运行时类型后才可入 values。校验失败的非法类型（如函数、Symbol 等）立即抛
  // BadRequestError，避免脏数据下传到 pg 序列化阶段。
  // 提取 value 到局部变量让 TS 在 type guard 后正确收窄类型，避免索引访问窄化失效。
  const fields: string[] = [];
  const values: SqlParam[] = [];
  let paramIndex = 1;
  for (const field of config.editableFields) {
    const value = sanitized[field];
    if (value === undefined) continue;
    if (!isSqlParam(value)) {
      throw new BadRequestError(`字段 ${field} 类型不合法`);
    }
    fields.push(`${field} = $${paramIndex++}`);
    values.push(value);
  }

  // 无字段更新时直接返回详情
  if (fields.length === 0) return getContentDetail(type, id);

  fields.push('updated_at = NOW()');
  values.push(id);

  await query(
    `UPDATE ${config.table} SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
    values,
  );

  logger.info({ type, id, adminId }, '管理员编辑内容');

  return getContentDetail(type, id);
}

// ===================== 首页展示图片管理 =====================

const HOMEPAGE_HERO_KEY = 'homepage_hero_image';

// 获取首页 Hero 图 URL（公开接口使用）
async function getHomepageImage(): Promise<string | null> {
  const { rows } = await query(
    'SELECT value FROM site_settings WHERE key = $1',
    [HOMEPAGE_HERO_KEY],
  );
  return rows[0]?.value || null;
}

// 设置首页 Hero 图 URL（管理员接口使用）
async function setHomepageImage(url: string, adminId: string) {
  if (!url || typeof url !== 'string') {
    throw new BadRequestError('图片 URL 不能为空');
  }

  await query(
    `INSERT INTO site_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = NOW()`,
    [HOMEPAGE_HERO_KEY, url, adminId],
  );

  logger.info({ adminId }, '管理员更新首页展示图片');

  return { url, updatedBy: adminId };
}

// ===================== 系统配置管理 =====================

// 受保护配置键：禁止删除，避免误操作导致核心功能（如首页图片）异常
const PROTECTED_SETTING_KEYS = ['homepage_hero_image'];

// 配置键命名规范：仅允许小写字母、数字、下划线，且以字母开头，长度 1-64
// 设计原因：与表结构 varchar(64) 主键对齐，同时防止注入与异常键名
const SETTING_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

// 配置值最大长度，防止滥用大文本占用存储
const SETTING_VALUE_MAX_LENGTH = 2000;

// 配置值类型白名单：驱动前端滑块步长精度
// 设计原因：用白名单校验避免非法值写入，前端按 value_type 判断 int/float 步长
const ALLOWED_VALUE_TYPES = ['string', 'int', 'float'] as const;
type ValueType = typeof ALLOWED_VALUE_TYPES[number];

// 新增配置缺省 value_type 为 string，保证向后兼容历史调用方
const DEFAULT_VALUE_TYPE: ValueType = 'string';

// 列出全部系统配置项，按 key 字典序返回，便于后台分页或一次性展示
async function listSettings() {
  const { rows } = await query(
    'SELECT key, value, value_type, description, updated_by, updated_at FROM site_settings ORDER BY key ASC'
  );
  return rows.map((row) => ({
    key: row.key,
    value: row.value,
    valueType: row.value_type,
    description: row.description,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }));
}

// 获取单个配置项，不存在时抛 NotFoundError，便于后台编辑前预加载
async function getSetting(key: string) {
  const { rows } = await query(
    'SELECT key, value, value_type, description, updated_by, updated_at FROM site_settings WHERE key = $1',
    [key],
  );
  if (rows.length === 0) throw new NotFoundError('配置项');
  const row = rows[0];
  return {
    key: row.key,
    value: row.value,
    valueType: row.value_type,
    description: row.description,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

// 新增或更新配置项（upsert）
// 设计原因：管理员可能新增自定义配置或修改现有配置，统一用 ON CONFLICT 处理；
// description 传 null 时用 COALESCE 保留原值，避免误清空已有说明；
// valueType 传 undefined 时用 COALESCE 保留原值（编辑时仅改 value 不改类型场景）
async function setSetting(
  key: string,
  value: string,
  // description 允许 null（显式清空说明）或 undefined（不传），与 validator optional+nullable 对齐
  description: string | null | undefined,
  adminId: string,
  valueType?: string,
) {
  if (!SETTING_KEY_PATTERN.test(key)) {
    throw new BadRequestError('配置键只能包含小写字母、数字、下划线，且以字母开头');
  }
  if (value.length > SETTING_VALUE_MAX_LENGTH) {
    throw new BadRequestError(`配置值长度不能超过 ${SETTING_VALUE_MAX_LENGTH}`);
  }
  // value_type 白名单校验：非法值拒绝写入，避免脏数据驱动前端异常
  // 显式传入时校验白名单；缺省时绑定 null，让 SQL 的 COALESCE 保留原值（编辑场景）
  // 新增场景由 INSERT VALUES 的 COALESCE($3, 'string') 兜底默认类型，避免 NOT NULL 约束冲突
  const resolvedValueType: ValueType | null = valueType
    ? (ALLOWED_VALUE_TYPES as readonly string[]).includes(valueType)
      ? (valueType as ValueType)
      : (() => { throw new BadRequestError(`配置类型非法，仅允许：${ALLOWED_VALUE_TYPES.join('/')}`); })()
    : null;

  await query(
    `INSERT INTO site_settings (key, value, value_type, description, updated_by, updated_at)
     VALUES ($1, $2, COALESCE($3, 'string'), $4, $5, NOW())
     ON CONFLICT (key) DO UPDATE SET
       value = $2,
       value_type = COALESCE($3, site_settings.value_type),
       description = COALESCE($4, site_settings.description),
       updated_by = $5,
       updated_at = NOW()`,
    [key, value, resolvedValueType, description ?? null, adminId],
  );

  logger.info({ adminId, key, valueType: resolvedValueType }, '管理员更新系统配置');

  // 返回值 valueType：显式传入时用传入值，缺省时用 DEFAULT_VALUE_TYPE 兜底
  // 设计原因：编辑场景缺省时实际写入的是原值，但前端编辑时始终显式传入（从 listSettings 获取），
  // 不会走到缺省分支；新增场景缺省时 DB 写入 'string'，返回 'string' 与 DB 一致
  return { key, value, valueType: resolvedValueType ?? DEFAULT_VALUE_TYPE, description: description ?? null, updatedBy: adminId };
}

// 删除配置项，受保护键禁止删除，避免误删核心配置导致功能异常
async function deleteSetting(key: string) {
  if (PROTECTED_SETTING_KEYS.includes(key)) {
    throw new BadRequestError(`配置项 ${key} 受保护，禁止删除`);
  }
  const { rowCount } = await query('DELETE FROM site_settings WHERE key = $1', [key]);
  if (rowCount === 0) throw new NotFoundError('配置项');
  return { key };
}

// ===================== 订单管理 =====================

// 各模块订单查询配置
const ORDER_CONFIG: Record<OrderType, { table: string; extraColumn: string; alias: string; buyerColumn: string; sellerColumn: string }> = {
  skill: { table: 'skill_orders', extraColumn: 'credit_amount', alias: 'creditsAmount', buyerColumn: 'buyer_id', sellerColumn: 'seller_id' },
  kitchen: { table: 'kitchen_orders', extraColumn: 'credit_amount', alias: 'totalPrice', buyerColumn: 'user_id', sellerColumn: 'seller_id' },
  time_bank: { table: 'time_orders', extraColumn: 'duration_minutes', alias: 'durationMinutes', buyerColumn: 'requester_id', sellerColumn: 'provider_id' },
};

// 按模块查询订单列表
async function getOrders(type: OrderType, status: string | undefined, page: number, pageSize: number) {
  const config = ORDER_CONFIG[type];
  if (!config) throw new BadRequestError('无效的订单类型');

  // WHERE 条件使用 o. 表前缀，避免 JOIN users 后 status 列与 users.status 产生歧义
  const conditions: string[] = ['1=1'];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`o.status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  // JOIN users 取买方/卖方昵称，避免前端只能展示 ID
  // 设计原因：原 SELECT 仅返回 buyer_id/seller_id，前端 OrderManagement 已声明 buyer/seller
  // 嵌套字段并 fallback 到 ID 显示，但后端未返回昵称导致始终退化为 ID，体验差
  const [countResult, listResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM ${config.table} o WHERE ${whereClause}`, params),
    query(
      `SELECT o.id, o.${config.buyerColumn} AS buyer_id, o.${config.sellerColumn} AS seller_id,
              o.${config.extraColumn}, o.status, o.created_at,
              buyer.nickname AS buyer_nickname,
              seller.nickname AS seller_nickname
       FROM ${config.table} o
       LEFT JOIN users buyer ON o.${config.buyerColumn} = buyer.id
       LEFT JOIN users seller ON o.${config.sellerColumn} = seller.id
       WHERE ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const list = listResult.rows.map((row) => ({
    id: row.id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    // 仅在昵称存在时构造嵌套对象，与前端 OrderItem.buyer/seller 可选类型对齐
    buyer: row.buyer_nickname ? { nickname: row.buyer_nickname } : undefined,
    seller: row.seller_nickname ? { nickname: row.seller_nickname } : undefined,
    status: row.status,
    createdAt: row.created_at,
    [config.alias]: row[config.extraColumn],
  }));

  return createPaginatedResponse(list, total, page, pageSize);
}

// 强制取消订单：退还积分/时长给买家
async function forceCancelOrder(type: OrderType, orderId: string, reason: string, adminId: string) {
  const config = ORDER_CONFIG[type];
  if (!config) throw new BadRequestError('无效的订单类型');

  if (type === 'skill') {
    return forceCancelSkillOrder(orderId, reason, adminId);
  }
  if (type === 'kitchen') {
    return forceCancelKitchenOrder(orderId, reason, adminId);
  }
  // time_bank：完成时才结算，取消无需退还
  return forceCancelTimeOrder(orderId, reason, adminId);
}

// 强制取消技能订单：退还买家积分
async function forceCancelSkillOrder(orderId: string, reason: string, adminId: string) {
  return transaction(async (client) => {
    const orderResult = await client.query(
      `SELECT ${ADMIN_SKILL_ORDER_COLUMNS} FROM skill_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.status === 'cancelled') {
      throw new BadRequestError('订单已取消');
    }

    // 已结算的订单（completed）不退还积分
    const needRefund = !['completed', 'cancelled'].includes(order.status);

    await client.query(
      "UPDATE skill_orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1",
      [orderId],
    );

    if (needRefund) {
      // 退还买家积分
      await client.query(
        'UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2',
        [order.credit_amount, order.buyer_id],
      );
      await client.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
         SELECT $1, 'refund', $2, credit_balance, $3, 'skill_order', $4
         FROM users WHERE id = $1`,
        [order.buyer_id, order.credit_amount, orderId, `管理员强制取消：${reason}`],
      );

      // 已接受状态：扣回卖家已收入积分
      if (order.status === 'accepted' || order.status === 'in_progress') {
        await client.query(
          'UPDATE users SET credit_balance = credit_balance - $1 WHERE id = $2',
          [order.credit_amount, order.seller_id],
        );
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
           SELECT $1, 'spend', $2, credit_balance, $3, 'skill_order', $4
           FROM users WHERE id = $1`,
          [order.seller_id, -order.credit_amount, orderId, `管理员强制取消扣回：${reason}`],
        );
      }
    }

    return { id: orderId, status: 'cancelled', reason, adminId };
  });
}

// 强制取消厨房订单：退还买家积分，恢复帖子份数
async function forceCancelKitchenOrder(orderId: string, reason: string, adminId: string) {
  return transaction(async (client) => {
    const orderResult = await client.query(
      `SELECT ${ADMIN_KITCHEN_ORDER_COLUMNS} FROM kitchen_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.status === 'cancelled') {
      throw new BadRequestError('订单已取消');
    }

    // 已完成订单不退还积分
    const needRefund = order.status !== 'completed' && order.credit_amount > 0;

    await client.query(
      "UPDATE kitchen_orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1",
      [orderId],
    );

    if (needRefund) {
      // 退还买家积分
      await client.query(
        'UPDATE users SET credit_balance = credit_balance + $1 WHERE id = $2',
        [order.credit_amount, order.user_id],
      );
      await client.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
         SELECT $1, 'refund', $2, credit_balance, $3, 'kitchen_order', $4
         FROM users WHERE id = $1`,
        [order.user_id, order.credit_amount, orderId, `管理员强制取消：${reason}`],
      );

      // 已确认状态：扣回卖家已收入积分
      if (order.status === 'confirmed') {
        await client.query(
          'UPDATE users SET credit_balance = credit_balance - $1 WHERE id = $2',
          [order.credit_amount, order.seller_id],
        );
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
           SELECT $1, 'spend', $2, credit_balance, $3, 'kitchen_order', $4
           FROM users WHERE id = $1`,
          [order.seller_id, -order.credit_amount, orderId, `管理员强制取消扣回：${reason}`],
        );
      }
    }

    // 恢复帖子份数（无论是否退款，份数都应恢复）
    await client.query(
      'UPDATE kitchen_posts SET remaining_portions = remaining_portions + $1 WHERE id = $2',
      [order.portions, order.post_id],
    );
    // 若帖子之前因售罄变为 sold_out，恢复为 active
    await client.query(
      "UPDATE kitchen_posts SET status = 'active' WHERE id = $1 AND status = 'sold_out' AND remaining_portions > 0",
      [order.post_id],
    );

    return { id: orderId, status: 'cancelled', reason, adminId };
  });
}

// 强制取消时间银行订单：完成时才结算，取消无需退还
async function forceCancelTimeOrder(orderId: string, reason: string, adminId: string) {
  return transaction(async (client) => {
    const orderResult = await client.query(
      `SELECT ${ADMIN_TIME_ORDER_COLUMNS} FROM time_orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    if (orderResult.rows.length === 0) throw new NotFoundError('订单');
    const order = orderResult.rows[0];

    if (order.status === 'cancelled') {
      throw new BadRequestError('订单已取消');
    }

    await client.query(
      "UPDATE time_orders SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1",
      [orderId],
    );

    return { id: orderId, status: 'cancelled', reason, adminId };
  });
}

// ===================== 数据统计 =====================

// 返回平台概览数据
async function getDashboard() {
  const [
    usersResult,
    todayNewUsersResult,
    skillOrdersResult,
    kitchenOrdersResult,
    timeBankOrdersResult,
    emergencyRequestsResult,
    pendingReportsResult,
  ] = await Promise.all([
    query('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'),
    query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= CURRENT_DATE"),
    query('SELECT COUNT(*) FROM skill_orders'),
    query('SELECT COUNT(*) FROM kitchen_orders'),
    query('SELECT COUNT(*) FROM time_orders'),
    query('SELECT COUNT(*) FROM emergency_requests WHERE deleted_at IS NULL'),
    query("SELECT COUNT(*) FROM reports WHERE status = 'pending'"),
  ]);

  return {
    totalUsers: parseInt(usersResult.rows[0].count, 10),
    todayNewUsers: parseInt(todayNewUsersResult.rows[0].count, 10),
    skillOrders: parseInt(skillOrdersResult.rows[0].count, 10),
    kitchenOrders: parseInt(kitchenOrdersResult.rows[0].count, 10),
    timeBankOrders: parseInt(timeBankOrdersResult.rows[0].count, 10),
    emergencyRequests: parseInt(emergencyRequestsResult.rows[0].count, 10),
    pendingReports: parseInt(pendingReportsResult.rows[0].count, 10),
  };
}

async function getRegistrationTrend(days: number) {
  const { rows } = await query(
    `SELECT TO_CHAR(d.date, 'YYYY-MM-DD') AS date, COUNT(u.id) AS count
     FROM generate_series(CURRENT_DATE - $1::interval, CURRENT_DATE, '1 day') AS d(date)
     LEFT JOIN users u ON DATE(u.created_at) = d.date AND u.deleted_at IS NULL
     GROUP BY d.date
     ORDER BY d.date`,
    [`${days - 1} days`],
  );
  return rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) }));
}

async function getOrderTrend(days: number) {
  const interval = `${days - 1} days`;
  const { rows } = await query(
    `SELECT TO_CHAR(d.date, 'YYYY-MM-DD') AS date, COALESCE(SUM(cnt), 0) AS count
     FROM generate_series(CURRENT_DATE - $1::interval, CURRENT_DATE, '1 day') AS d(date)
     LEFT JOIN (
       SELECT DATE(created_at) AS date, COUNT(*) AS cnt FROM skill_orders WHERE created_at >= CURRENT_DATE - $1::interval GROUP BY DATE(created_at)
       UNION ALL
       SELECT DATE(created_at) AS date, COUNT(*) AS cnt FROM kitchen_orders WHERE created_at >= CURRENT_DATE - $1::interval GROUP BY DATE(created_at)
       UNION ALL
       SELECT DATE(created_at) AS date, COUNT(*) AS cnt FROM time_orders WHERE created_at >= CURRENT_DATE - $1::interval GROUP BY DATE(created_at)
     ) o ON o.date = d.date
     GROUP BY d.date
     ORDER BY d.date`,
    [interval],
  );
  return rows.map((r) => ({ date: r.date, count: parseInt(r.count, 10) }));
}

async function getReputationDistribution() {
  const { rows } = await query(
    `SELECT
       CASE
         WHEN reputation_score >= 4.5 THEN '优秀 (4.5+)'
         WHEN reputation_score >= 4.0 THEN '良好 (4.0-4.5)'
         WHEN reputation_score >= 3.5 THEN '一般 (3.5-4.0)'
         ELSE '较差 (<3.5)'
       END AS label,
       COUNT(*) AS count
     FROM users
     WHERE deleted_at IS NULL
     GROUP BY label
     ORDER BY MIN(reputation_score) DESC`,
  );
  return rows.map((r) => ({ label: r.label, count: parseInt(r.count, 10) }));
}

async function getModuleActivity() {
  // 30 天间隔直接内联到 SQL 字面量：纯字面量无注入风险，且使用数据库服务器时间 NOW() 避免应用服务器时钟漂移
  // 原实现用 const since = "NOW() - INTERVAL '30 days'" + ${since} 拼接，虽无注入风险但不符合参数化 SQL 规范
  const [skillPosts, skillOrders, kitchenPosts, kitchenOrders, timeServices, timeOrders, emergencyRequests] =
    await Promise.all([
      query(`SELECT COUNT(*) FROM skill_posts WHERE created_at >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL`),
      query(`SELECT COUNT(*) FROM skill_orders WHERE created_at >= NOW() - INTERVAL '30 days'`),
      query(`SELECT COUNT(*) FROM kitchen_posts WHERE created_at >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL`),
      query(`SELECT COUNT(*) FROM kitchen_orders WHERE created_at >= NOW() - INTERVAL '30 days'`),
      query(`SELECT COUNT(*) FROM time_services WHERE created_at >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL`),
      query(`SELECT COUNT(*) FROM time_orders WHERE created_at >= NOW() - INTERVAL '30 days'`),
      query(`SELECT COUNT(*) FROM emergency_requests WHERE created_at >= NOW() - INTERVAL '30 days' AND deleted_at IS NULL`),
    ]);

  return [
    {
      name: '技能交换',
      posts: parseInt(skillPosts.rows[0].count, 10),
      orders: parseInt(skillOrders.rows[0].count, 10),
    },
    {
      name: '共享厨房',
      posts: parseInt(kitchenPosts.rows[0].count, 10),
      orders: parseInt(kitchenOrders.rows[0].count, 10),
    },
    {
      name: '时间银行',
      posts: parseInt(timeServices.rows[0].count, 10),
      orders: parseInt(timeOrders.rows[0].count, 10),
    },
    {
      name: '应急邻里',
      posts: parseInt(emergencyRequests.rows[0].count, 10),
      orders: 0,
    },
  ];
}

async function getSystemMetrics() {
  const [pendingReports, todayActiveUsers, totalMutualAids, monthNewUsers] = await Promise.all([
    query("SELECT COUNT(*) FROM reports WHERE status = 'pending'"),
    query("SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE created_at >= CURRENT_DATE"),
    query(
      `SELECT SUM(cnt) FROM (
         SELECT COUNT(*) AS cnt FROM skill_orders WHERE status = 'completed'
         UNION ALL
         SELECT COUNT(*) FROM kitchen_orders WHERE status = 'completed'
         UNION ALL
         SELECT COUNT(*) FROM time_orders WHERE status = 'completed'
       ) t`,
    ),
    query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= DATE_TRUNC('month', CURRENT_DATE)"),
  ]);

  return {
    pendingReports: parseInt(pendingReports.rows[0].count, 10),
    todayActiveUsers: parseInt(todayActiveUsers.rows[0].count, 10),
    totalMutualAids: parseInt(totalMutualAids.rows[0].sum || '0', 10),
    monthNewUsers: parseInt(monthNewUsers.rows[0].count, 10),
  };
}

// ===================== 举报处理 =====================

// 创建举报
async function createReport(
  reporterId: string,
  targetType: ReportTargetType,
  targetId: string,
  reason: string,
) {
  const { rows } = await query(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id, reporter_id, target_type, target_id, reason, status, created_at`,
    [reporterId, targetType, targetId, reason],
  );

  const row = rows[0];
  return {
    id: row.id,
    reporterId: row.reporter_id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  };
}

// 分页查询举报列表
async function getReports(page: number, pageSize: number, status?: ReportStatus) {
  const conditions: string[] = ['1=1'];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM reports WHERE ${whereClause}`, params),
    query(
      `SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.status,
              r.handler_id, r.handle_note, r.created_at, r.handled_at,
              reporter.nickname AS reporter_nickname,
              handler.nickname AS handler_nickname
       FROM reports r
       LEFT JOIN users reporter ON r.reporter_id = reporter.id
       LEFT JOIN users handler ON r.handler_id = handler.id
       WHERE ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const list = listResult.rows.map((row) => ({
    id: row.id,
    reporterId: row.reporter_id,
    reporterNickname: row.reporter_nickname,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    handlerId: row.handler_id,
    handlerNickname: row.handler_nickname,
    handleNote: row.handle_note,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  }));

  return createPaginatedResponse(list, total, page, pageSize);
}

// 处理举报
async function handleReport(
  reportId: string,
  handlerId: string,
  status: ReportStatus,
  handleNote: string,
) {
  if (!['resolved', 'rejected'].includes(status)) {
    throw new BadRequestError('无效的举报处理状态');
  }

  const { rows } = await query(
    `UPDATE reports
     SET status = $1, handler_id = $2, handle_note = $3, handled_at = NOW()
     WHERE id = $4 AND status = 'pending'
     RETURNING id, status, handler_id, handle_note, handled_at`,
    [status, handlerId, handleNote, reportId],
  );

  if (rows.length === 0) {
    // 可能是不存在或已处理
    const existResult = await query('SELECT id, status FROM reports WHERE id = $1', [reportId]);
    if (existResult.rows.length === 0) {
      throw new NotFoundError('举报');
    }
    throw new BadRequestError('该举报已被处理，无法重复处理');
  }

  const row = rows[0];
  return {
    id: row.id,
    status: row.status,
    handlerId: row.handler_id,
    handleNote: row.handle_note,
    handledAt: row.handled_at,
  };
}

// ===================== 数据导出 =====================

type ExportType = 'users' | 'orders' | 'reports' | 'audit-logs';

interface ExportFilter {
  // 订单类型（仅 type=orders 时生效）：skill/kitchen/time_bank
  orderType?: 'skill' | 'kitchen' | 'time_bank';
  // 状态筛选：用户/订单/举报/审计日志的状态字段
  status?: string;
  // 时间范围（ISO 字符串），用于审计日志/订单按 created_at 过滤
  startDate?: string;
  endDate?: string;
}

interface ExportConfig {
  // 组装查询 SQL 与参数：返回完整 SQL（含 WHERE/LIMIT）与 params 数组
  buildQuery: (filter: ExportFilter) => { sql: string; params: SqlParam[] };
  // 列定义：field 为数据库列名（用于取值），header 为 CSV 表头
  columns: Array<{ field: string; header: string }>;
}

// 导出单次最大行数，避免内存占用过高（生产环境可通过分批导出规避）
const EXPORT_MAX_ROWS = 10000;

// 订单导出子类型配置：复用 ORDER_CONFIG 的表名与字段映射
const ORDER_EXPORT_SUB_CONFIG: Record<'skill' | 'kitchen' | 'time_bank', {
  table: string;
  amountColumn: string;
  amountHeader: string;
  buyerColumn: string;
  sellerColumn: string;
}> = {
  skill: { table: 'skill_orders', amountColumn: 'credit_amount', amountHeader: '积分金额', buyerColumn: 'buyer_id', sellerColumn: 'seller_id' },
  kitchen: { table: 'kitchen_orders', amountColumn: 'credit_amount', amountHeader: '积分金额', buyerColumn: 'user_id', sellerColumn: 'seller_id' },
  time_bank: { table: 'time_orders', amountColumn: 'duration_minutes', amountHeader: '时长(分钟)', buyerColumn: 'requester_id', sellerColumn: 'provider_id' },
};

// 各导出类型的查询与列映射配置
const EXPORT_CONFIG: Record<ExportType, ExportConfig> = {
  users: {
    buildQuery: (filter) => {
      const conditions: string[] = ['deleted_at IS NULL'];
      const params: SqlParam[] = [];
      let paramIndex = 1;
      if (filter.status) {
        conditions.push(`status = $${paramIndex++}`);
        params.push(filter.status);
      }
      // LIMIT 参数化：避免模板插值风格扩散到存在用户输入的场景
      params.push(EXPORT_MAX_ROWS);
      return {
        sql: `SELECT id, phone, nickname, role, status, reputation_score, credit_balance, created_at
              FROM users WHERE ${conditions.join(' AND ')}
              ORDER BY created_at DESC LIMIT $${paramIndex}`,
        params,
      };
    },
    columns: [
      { field: 'id', header: '用户ID' },
      { field: 'phone', header: '手机号' },
      { field: 'nickname', header: '昵称' },
      { field: 'role', header: '角色' },
      { field: 'status', header: '状态' },
      { field: 'reputation_score', header: '信誉分' },
      { field: 'credit_balance', header: '积分余额' },
      { field: 'created_at', header: '注册时间' },
    ],
  },
  orders: {
    buildQuery: (filter) => {
      const orderType = filter.orderType || 'skill';
      const cfg = ORDER_EXPORT_SUB_CONFIG[orderType];
      const conditions: string[] = ['1=1'];
      const params: SqlParam[] = [];
      let paramIndex = 1;
      if (filter.status) {
        conditions.push(`status = $${paramIndex++}`);
        params.push(filter.status);
      }
      if (filter.startDate) {
        conditions.push(`created_at >= $${paramIndex++}`);
        params.push(filter.startDate);
      }
      if (filter.endDate) {
        conditions.push(`created_at <= $${paramIndex++}`);
        params.push(filter.endDate);
      }
      // LIMIT 参数化：避免模板插值风格扩散到存在用户输入的场景
      params.push(EXPORT_MAX_ROWS);
      return {
        sql: `SELECT id, ${cfg.buyerColumn}, ${cfg.sellerColumn}, ${cfg.amountColumn}, status, created_at
              FROM ${cfg.table} WHERE ${conditions.join(' AND ')}
              ORDER BY created_at DESC LIMIT $${paramIndex}`,
        params,
      };
    },
    columns: [
      { field: 'id', header: '订单ID' },
      { field: 'buyer_id', header: '买家ID' },
      { field: 'seller_id', header: '卖家ID' },
      { field: 'amount', header: '金额' },
      { field: 'status', header: '状态' },
      { field: 'created_at', header: '创建时间' },
    ],
  },
  reports: {
    buildQuery: (filter) => {
      const conditions: string[] = ['1=1'];
      const params: SqlParam[] = [];
      let paramIndex = 1;
      if (filter.status) {
        conditions.push(`status = $${paramIndex++}`);
        params.push(filter.status);
      }
      // LIMIT 参数化：避免模板插值风格扩散到存在用户输入的场景
      params.push(EXPORT_MAX_ROWS);
      return {
        sql: `SELECT r.id, r.reporter_id, r.target_type, r.target_id, r.reason, r.status,
                     r.handler_id, r.handle_note, r.created_at, r.handled_at,
                     reporter.nickname AS reporter_nickname,
                     handler.nickname AS handler_nickname
              FROM reports r
              LEFT JOIN users reporter ON r.reporter_id = reporter.id
              LEFT JOIN users handler ON r.handler_id = handler.id
              WHERE ${conditions.join(' AND ')}
              ORDER BY r.created_at DESC LIMIT $${paramIndex}`,
        params,
      };
    },
    columns: [
      { field: 'id', header: '举报ID' },
      { field: 'reporter_nickname', header: '举报人' },
      { field: 'target_type', header: '对象类型' },
      { field: 'target_id', header: '对象ID' },
      { field: 'reason', header: '举报原因' },
      { field: 'status', header: '状态' },
      { field: 'handler_nickname', header: '处理人' },
      { field: 'handle_note', header: '处理说明' },
      { field: 'created_at', header: '举报时间' },
      { field: 'handled_at', header: '处理时间' },
    ],
  },
  'audit-logs': {
    buildQuery: (filter) => {
      const conditions: string[] = ['1=1'];
      const params: SqlParam[] = [];
      let paramIndex = 1;
      if (filter.status) {
        conditions.push(`status = $${paramIndex++}`);
        params.push(filter.status);
      }
      if (filter.startDate) {
        conditions.push(`created_at >= $${paramIndex++}`);
        params.push(filter.startDate);
      }
      if (filter.endDate) {
        conditions.push(`created_at <= $${paramIndex++}`);
        params.push(filter.endDate);
      }
      // LIMIT 参数化：避免模板插值风格扩散到存在用户输入的场景
      params.push(EXPORT_MAX_ROWS);
      return {
        // audit_logs 表无 metadata 字段，真实字段名为 request_body（007_audit_log.sql）
        // 此前误用 metadata 会导致导出审计日志时报 column does not exist
        sql: `SELECT id, user_id, action, status, ip, created_at, request_body
              FROM audit_logs WHERE ${conditions.join(' AND ')}
              ORDER BY created_at DESC LIMIT $${paramIndex}`,
        params,
      };
    },
    columns: [
      { field: 'id', header: '日志ID' },
      { field: 'user_id', header: '用户ID' },
      { field: 'action', header: '操作类型' },
      { field: 'status', header: '状态' },
      { field: 'ip', header: 'IP地址' },
      { field: 'created_at', header: '操作时间' },
      { field: 'request_body', header: '请求体' },
    ],
  },
};

/**
 * 查询导出数据：返回结构化行数组 + 列定义
 * 路由层据此转换为 CSV 流式输出
 */
async function getExportData(type: ExportType, filter: ExportFilter) {
  const config = EXPORT_CONFIG[type];
  if (!config) throw new BadRequestError('无效的导出类型');

  const { sql, params } = config.buildQuery(filter);
  const { rows } = await query(sql, params);

  // 订单导出统一字段名（buyer_id/seller_id/amount），便于 CSV 列定义统一
  if (type === 'orders') {
    const orderType = filter.orderType || 'skill';
    const cfg = ORDER_EXPORT_SUB_CONFIG[orderType];
    // 行数据按 QueryResultRow 收窄，字段访问统一从 row 取
    const orderRows = rows as QueryResultRow[];
    return {
      columns: config.columns,
      rows: orderRows.map((row) => ({
        ...row,
        buyer_id: row[cfg.buyerColumn],
        seller_id: row[cfg.sellerColumn],
        amount: row[cfg.amountColumn],
      })),
    };
  }

  return { columns: config.columns, rows };
}

// ===================== Excel 导出 =====================

// 导出列定义（公开类型，供路由层与测试复用，与内部 ExportConfig.columns 结构兼容）
export type ExportColumn = { field: string; header: string };
export type ExportRow = Record<string, unknown>;

/**
 * 将导出数据构建为 Excel(.xlsx) 二进制 Buffer
 * 设计原因：路由层据此设置 xlsx 响应头并返回，与 CSV 路径共用同一数据源(getExportData)
 * 性能：exceljs 在内存中构建，受 EXPORT_MAX_ROWS(10000) 上限保护，避免内存溢出
 */
async function buildExcelBuffer(
  columns: ExportColumn[],
  rows: ExportRow[],
  sheetName = '导出数据',
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  // 冻结首行，便于长列表滚动时始终可见表头
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });

  // 表头列定义：key 与行数据字段对齐，宽度按表头字符数估算并夹紧在 [12,40]
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.field,
    width: Math.max(12, Math.min(40, c.header.length * 2 + 4)),
  }));

  // 数据行：addRow 按 key 自动映射，未命中的多余字段会被忽略
  rows.forEach((row) => sheet.addRow(row));

  // 表头样式：加粗 + 浅灰底，提升可读性
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF3F4F6' },
  };

  // 日期对象格式化为可读字符串，避免 Excel 默认渲染为序列号
  // 设计原因：pg 返回的 created_at 为 Date 对象，直接写入会被 Excel 显示为数字
  sheet.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    row.eachCell((cell) => {
      if (cell.value instanceof Date) {
        cell.value = cell.value.toISOString().replace('T', ' ').slice(0, 19);
      }
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ===================== 实名认证审核 =====================

// 分页查询实名认证申请列表
async function getVerificationRequests(page: number, pageSize: number, status?: string) {
  const conditions: string[] = ['1=1'];
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query(`SELECT COUNT(*) FROM verification_requests WHERE ${whereClause}`, params),
    query(
      `SELECT vr.id, vr.user_id, vr.real_name, vr.status, vr.reject_reason,
              vr.created_at, vr.reviewed_at, vr.reviewed_by,
              u.nickname as user_nickname, u.phone as user_phone,
              reviewer.nickname as reviewer_nickname
       FROM verification_requests vr
       LEFT JOIN users u ON vr.user_id = u.id
       LEFT JOIN users reviewer ON vr.reviewed_by = reviewer.id
       WHERE ${whereClause}
       ORDER BY vr.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);
  const list = listResult.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userNickname: row.user_nickname,
    userPhone: row.user_phone,
    realName: row.real_name,
    status: row.status,
    rejectReason: row.reject_reason || null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewerNickname: row.reviewer_nickname || null,
  }));

  return createPaginatedResponse(list, total, page, pageSize);
}

// 审核实名认证申请
async function reviewVerificationRequest(
  requestId: string,
  reviewerId: string,
  action: 'approve' | 'reject',
  rejectReason?: string,
) {
  // 查询申请记录
  const requestResult = await query(
    `SELECT ${VERIFICATION_REQUEST_COLUMNS} FROM verification_requests WHERE id = $1`,
    [requestId],
  );
  if (requestResult.rows.length === 0) {
    throw new NotFoundError('认证申请');
  }

  const request = requestResult.rows[0];
  if (request.status !== 'pending') {
    throw new BadRequestError('该申请已被审核，无法重复操作');
  }

  // 拒绝时必须提供原因
  if (action === 'reject' && !rejectReason) {
    throw new BadRequestError('拒绝认证时必须提供原因');
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  // 更新申请状态和用户认证状态
  await transaction(async (client) => {
    await client.query(
      `UPDATE verification_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), reject_reason = $3
       WHERE id = $4`,
      [newStatus, reviewerId, rejectReason || null, requestId],
    );

    await client.query(
      'UPDATE users SET verify_status = $1 WHERE id = $2',
      [newStatus, request.user_id],
    );
  });

  // 清除用户缓存
  await userCache.invalidate(request.user_id);

  return {
    id: requestId,
    status: newStatus,
    reviewedBy: reviewerId,
    reviewedAt: new Date().toISOString(),
  };
}

export const adminService = {
  getUsers,
  banUser,
  unbanUser,
  updateUserRole,
  batchBanUsers,
  batchUnbanUsers,
  getContent,
  updateContentStatus,
  batchUpdateContentStatus,
  getContentDetail,
  updateContent,
  getHomepageImage,
  setHomepageImage,
  getOrders,
  forceCancelOrder,
  getDashboard,
  getRegistrationTrend,
  getOrderTrend,
  getReputationDistribution,
  getModuleActivity,
  getSystemMetrics,
  createReport,
  getReports,
  handleReport,
  getVerificationRequests,
  reviewVerificationRequest,
  getExportData,
  buildExcelBuffer,
  listSettings,
  getSetting,
  setSetting,
  deleteSetting,
};  // 系统配置 CRUD：支持后台可视化管理 site_settings 表
