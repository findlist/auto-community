import { query, SqlParam } from '../config/database';
import { NotFoundError, PermissionDeniedError } from '../utils/errors';
import { sanitizeObject, validateImageUrls } from '../utils/sanitize';
import { kitchenPostCache } from './cache.service';
import { prefixColumns } from '../utils/sql';

// kitchen_posts 表行类型：与数据库列结构对齐，避免 row: any 逃逸类型检查
// 设计原因：原 row: any 让字段拼写错误无法在编译期暴露，列变更不触发类型告警；
// 收紧后访问不存在的字段会立即报错，减少运行时「undefined 静默传递」的隐患

// kitchen_posts 表响应构造列：覆盖 toKitchenPostResponse 所需字段，不含 deleted_at
// 设计原因：INSERT/UPDATE RETURNING * 会返回 deleted_at 等未消费字段，显式列名避免未来新增字段意外泄露
const KITCHEN_POST_COLUMNS = `id, user_id, type, title, description, category, portions, remaining_portions,
  credit_price, pickup_type, pickup_time, pickup_address, images, allergens, health_cert,
  status, created_at, updated_at`;

interface KitchenPostRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string | null;
  category: string | null;
  portions: number;
  remaining_portions: number;
  credit_price: number;
  pickup_type: string | null;
  pickup_time: Date | null;
  pickup_address: string | null;
  images: string[] | null;
  allergens: string[] | null;
  health_cert: boolean | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

// 用户简要信息（toKitchenPostResponse 的 user 参数）
// 设计原因：LEFT JOIN users 后 nickname/avatar 可能为 NULL；
// reputation_score 为 DECIMAL 类型，pg 默认解析为 string，与 auth.service.ts 的 UserRow 保持一致
interface UserBrief {
  id: string;
  nickname: string | null;
  avatar: string | null;
  reputation_score: string | number | null;
}

// 列表查询行：KitchenPostRow + LEFT JOIN users 引入的字段
// 注意：SELECT kp.*, u.id as user_id 中 u.id 与 kp.user_id 同名，值相同（外键约束），类型上用 string 覆盖
interface KitchenPostListRow extends KitchenPostRow {
  nickname: string | null;
  avatar: string | null;
  reputation_score: string | number | null;
}

// 美食分享数据序列化（DB snake_case → API camelCase）
export function toKitchenPostResponse(row: KitchenPostRow, user?: UserBrief) {
  return {
    id: row.id,
    userId: row.user_id,
    user: user ? {
      id: user.id,
      nickname: user.nickname,
      avatar: user.avatar,
      reputationScore: user.reputation_score
    } : undefined,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    price: row.credit_price,
    quantity: row.portions,
    remaining: row.remaining_portions,
    pickupTime: row.pickup_time,
    pickupLocation: row.pickup_address,
    pickupType: row.pickup_type,
    images: row.images || [],
    allergens: row.allergens || [],
    healthCert: row.health_cert || false,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// 创建美食分享/需求
async function create(userId: string, data: {
  type: 'offer' | 'need';
  title: string;
  description?: string;
  category: string;
  price?: number;
  quantity: number;
  pickupTime?: string;
  pickupLocation?: string;
  pickupType?: 'self_pickup' | 'delivery';
  images?: string[];
  allergens?: string[];
  healthCert?: boolean;
}) {
  // 入库前清洗富文本字段，防止存储型 XSS
  const sanitized = sanitizeObject(data, ['title', 'description']);
  // 校验图片 URL：必须 HTTPS 且在域名白名单内
  validateImageUrls(sanitized.images);

  // 添加泛型 KitchenPostRow：INSERT RETURNING * 的结果传给 toKitchenPostResponse，需精确类型
  const result = await query<KitchenPostRow>(
    `INSERT INTO kitchen_posts
     (user_id, type, title, description, category, credit_price, portions, remaining_portions,
      pickup_time, pickup_address, pickup_type, images, allergens, health_cert, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, 'active')
     RETURNING ${KITCHEN_POST_COLUMNS}`,
    [
      userId,
      sanitized.type,
      sanitized.title,
      sanitized.description || null,
      sanitized.category,
      sanitized.price || 0,
      sanitized.quantity,
      sanitized.pickupTime || null,
      sanitized.pickupLocation || null,
      sanitized.pickupType || 'self_pickup',
      sanitized.images || [],
      sanitized.allergens || [],
      sanitized.healthCert || false
    ]
  );

  return toKitchenPostResponse(result.rows[0]);
}

// 获取美食列表
async function getList(filters: {
  type?: string;
  category?: string;
  keyword?: string;
} = {}, page: number = 1, pageSize: number = 20) {
  const conditions: string[] = ['kp.deleted_at IS NULL'];
  // SqlParam 收紧：filters.type/category/keyword 均为 string，pageSize/offset 为 number，均属合法 SqlParam
  const params: SqlParam[] = [];
  let paramIndex = 1;

  if (filters.type) {
    conditions.push(`kp.type = $${paramIndex++}`);
    params.push(filters.type);
  }
  if (filters.category) {
    conditions.push(`kp.category = $${paramIndex++}`);
    params.push(filters.category);
  }
  if (filters.keyword) {
    conditions.push(`(kp.title ILIKE $${paramIndex++} OR kp.description ILIKE $${paramIndex++})`);
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }

  const whereClause = conditions.join(' AND ');

  // 查询总数：COUNT 返回字符串，需泛型 { count: string } 让 parseInt 拿到字符串
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) FROM kitchen_posts kp WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // 查询列表：LEFT JOIN users 引入 nickname/avatar/reputation_score，用 KitchenPostListRow 覆盖
  const offset = (page - 1) * pageSize;
  const listResult = await query<KitchenPostListRow>(
    `SELECT ${prefixColumns(KITCHEN_POST_COLUMNS, 'kp')}, u.id as user_id, u.nickname, u.avatar, u.reputation_score
     FROM kitchen_posts kp
     LEFT JOIN users u ON kp.user_id = u.id
     WHERE ${whereClause}
     ORDER BY kp.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, pageSize, offset]
  );

  return {
    list: listResult.rows.map(row => toKitchenPostResponse(row, {
      id: row.user_id,
      nickname: row.nickname,
      avatar: row.avatar,
      reputation_score: row.reputation_score
    })),
    total,
    page,
    pageSize
  };
}

// 获取美食详情
async function getById(id: string) {
  // 使用缓存：先查缓存，未命中时查数据库并缓存结果
  return kitchenPostCache.get(id, async () => {
    // 详情查询与列表相同的 JOIN 结构，复用 KitchenPostListRow 精确化 row 字段
    const result = await query<KitchenPostListRow>(
      `SELECT ${prefixColumns(KITCHEN_POST_COLUMNS, 'kp')}, u.id as user_id, u.nickname, u.avatar, u.reputation_score
       FROM kitchen_posts kp
       LEFT JOIN users u ON kp.user_id = u.id
       WHERE kp.id = $1 AND kp.deleted_at IS NULL`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('美食');
    }

    const row = result.rows[0];
    return toKitchenPostResponse(row, {
      id: row.user_id,
      nickname: row.nickname,
      avatar: row.avatar,
      reputation_score: row.reputation_score
    });
  });
}

// 更新美食
async function update(id: string, userId: string, data: Partial<{
  title: string;
  description: string;
  category: string;
  price: number;
  quantity: number;
  pickupTime: string;
  pickupLocation: string;
  pickupType: string;
  images: string[];
  allergens: string[];
  status: string;
}>) {
  // 校验权限：仅需 user_id 字段做归属校验，泛型 { user_id: string } 收窄结果
  const existing = await query<{ user_id: string }>(
    'SELECT user_id FROM kitchen_posts WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (existing.rows.length === 0) {
    throw new NotFoundError('美食');
  }
  if (existing.rows[0].user_id !== userId) {
    throw new PermissionDeniedError();
  }

  // 更新前清洗富文本字段并校验图片 URL
  // 设计原因：data 收紧为 Record<string, unknown>，让 sanitized 字段读取后为 unknown，
  // 强制对图片字段做 string[] 类型断言后再传给 validateImageUrls，避免 any 静默吞掉类型不匹配
  const sanitized = sanitizeObject(data as Record<string, unknown>, ['title', 'description']);
  if (sanitized.images !== undefined) {
    validateImageUrls(sanitized.images as string[]);
  }

  const updates: string[] = [];
  // SqlParam 收紧：sanitized 字段可能为 string/number/boolean/string[]，均属合法 SqlParam
  const params: SqlParam[] = [];
  let paramIndex = 1;

  // 设计原因：sanitized 字段经 sanitizeObject 后为 unknown（富文本字段经 sanitizeXss 处理），
  // 用 as SqlParam 断言：编译期由 SqlParam[] 约束容器类型，运行时由 pg 校验参数合法性，
  // 与 skill.service.ts 的 updatePost 保持一致的取舍（避免逐字段 isSqlParam 校验导致代码冗长）
  if (sanitized.title !== undefined) {
    updates.push(`title = $${paramIndex++}`);
    params.push(sanitized.title as SqlParam);
  }
  if (sanitized.description !== undefined) {
    updates.push(`description = $${paramIndex++}`);
    params.push(sanitized.description as SqlParam);
  }
  if (sanitized.category !== undefined) {
    updates.push(`category = $${paramIndex++}`);
    params.push(sanitized.category as SqlParam);
  }
  if (sanitized.price !== undefined) {
    updates.push(`credit_price = $${paramIndex++}`);
    params.push(sanitized.price as SqlParam);
  }
  if (sanitized.quantity !== undefined) {
    updates.push(`portions = $${paramIndex++}`);
    params.push(sanitized.quantity as SqlParam);
  }
  if (sanitized.pickupTime !== undefined) {
    updates.push(`pickup_time = $${paramIndex++}`);
    params.push(sanitized.pickupTime as SqlParam);
  }
  if (sanitized.pickupLocation !== undefined) {
    updates.push(`pickup_address = $${paramIndex++}`);
    params.push(sanitized.pickupLocation as SqlParam);
  }
  if (sanitized.pickupType !== undefined) {
    updates.push(`pickup_type = $${paramIndex++}`);
    params.push(sanitized.pickupType as SqlParam);
  }
  if (sanitized.images !== undefined) {
    updates.push(`images = $${paramIndex++}`);
    params.push(sanitized.images as SqlParam);
  }
  if (sanitized.allergens !== undefined) {
    updates.push(`allergens = $${paramIndex++}`);
    params.push(sanitized.allergens as SqlParam);
  }
  if (sanitized.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    params.push(sanitized.status as SqlParam);
  }

  if (updates.length === 0) {
    return getById(id);
  }

  updates.push(`updated_at = NOW()`);
  params.push(id);

  // UPDATE RETURNING * 的结果传给 toKitchenPostResponse，需泛型 KitchenPostRow 精确化
  const result = await query<KitchenPostRow>(
    `UPDATE kitchen_posts SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING ${KITCHEN_POST_COLUMNS}`,
    params
  );

  // 帖子更新后清除缓存
  await kitchenPostCache.invalidate(id);

  return toKitchenPostResponse(result.rows[0]);
}

// 删除美食（软删除）
async function remove(id: string, userId: string) {
  // 权限校验：仅需 user_id 字段，与 update 保持一致
  const existing = await query<{ user_id: string }>(
    'SELECT user_id FROM kitchen_posts WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (existing.rows.length === 0) {
    throw new NotFoundError('美食');
  }
  if (existing.rows[0].user_id !== userId) {
    throw new PermissionDeniedError();
  }

  await query(
    'UPDATE kitchen_posts SET deleted_at = NOW(), status = $1 WHERE id = $2',
    ['closed', id]
  );

  // 帖子删除后清除缓存
  await kitchenPostCache.invalidate(id);

  return { success: true };
}

export const kitchenService = {
  create,
  getList,
  getById,
  update,
  remove,
  toKitchenPostResponse
};
