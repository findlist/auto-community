import { query, SqlParam } from '../config/database';
import { NotFoundError, BadRequestError, PermissionDeniedError } from '../utils/errors';
import { sanitizeObject, validateImageUrls } from '../utils/sanitize';
import { skillPostCache } from './cache.service';

// 技能帖子过期处理已由 scheduler.ts 的 handleSkillPostExpiry 统一调度（每小时执行），
// 将 status='active' AND expires_at < NOW() 的帖子置为 expired，无需在此重复实现

// 设计原因：原 toSkillPost(row: any) 让 row 字段误用静默通过编译，
// 定义 SkillPostRow 与 SELECT 列对齐（含 LEFT JOIN users 后的 nickname/avatar/reputation_score），
// 编译期即可发现字段名拼写错误或类型不匹配

// skill_posts 表响应构造列：覆盖 toSkillPost 在 INSERT/UPDATE 场景所需字段
// 设计原因：RETURNING * 会返回 deleted_at 等未消费字段，显式列名避免未来新增字段意外泄露；
// nickname/avatar/reputation_score 是 LEFT JOIN users 字段，不属于 skill_posts 表，不放入此常量
const SKILL_POST_COLUMNS = `id, user_id, type, category, title, description, credit_price,
  images, tags, location, address, status, expires_at, created_at, updated_at`;

interface SkillPostRow {
  id: string;
  user_id: string;
  type: string;
  category: string;
  title: string;
  description: string | null;
  credit_price: number;
  images: string[] | null;
  tags: string[] | null;
  location: string | null;
  address: string | null;
  status: string;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  // LEFT JOIN users 引入的可选字段，getPostList/getPostById 才会填充
  nickname?: string | null;
  avatar?: string | null;
  reputation_score?: number | string | null;
}

// 创建帖子入参：与 POST /skills/posts 的 body 字段对齐
// 导出 DTO 供 routes 层收窄 req.body 类型，避免重复定义
export interface CreateSkillPostDTO {
  type: string;
  category: string;
  title: string;
  description?: string;
  credit_price?: number;
  images?: string[];
  tags?: string[];
  location?: string;
  address?: string;
  expires_at?: Date;
}

export type UpdateSkillPostDTO = Partial<CreateSkillPostDTO>;// 更新帖子入参：所有字段可选，与 PUT /skills/posts/:id 的 body 对齐

// 列表筛选条件：与 GET /skills/posts 的 query 参数对齐
interface SkillPostFilters {
  type?: string;
  category?: string;
  keyword?: string;
}

function toSkillPost(row: SkillPostRow) {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    category: row.category,
    title: row.title,
    description: row.description,
    creditPrice: row.credit_price,
    images: row.images || [],
    tags: row.tags || [],
    location: row.location,
    address: row.address,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: row.nickname ? {
      id: row.user_id,
      nickname: row.nickname,
      avatar: row.avatar,
      reputationScore: row.reputation_score,
    } : undefined,
  };
}

async function createPost(userId: string, data: CreateSkillPostDTO) {
  if (data.type === 'offer' && (!data.credit_price || data.credit_price <= 0)) {
    throw new BadRequestError('发布技能提供时积分价格必须大于0');
  }

  // 入库前清洗富文本字段，防止存储型 XSS
  const sanitized = sanitizeObject(data, ['title', 'description']);
  // 校验图片 URL：必须 HTTPS 且在域名白名单内
  validateImageUrls(sanitized.images);

  const { rows } = await query<SkillPostRow>(
    `INSERT INTO skill_posts (user_id, type, category, title, description, credit_price, images, tags, location, address, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING ${SKILL_POST_COLUMNS}`,
    [
      userId, sanitized.type, sanitized.category, sanitized.title, sanitized.description ?? null,
      sanitized.credit_price || 0, sanitized.images || [], sanitized.tags || [],
      sanitized.location ?? null, sanitized.address ?? null, sanitized.expires_at ?? null,
    ],
  );

  return toSkillPost(rows[0]);
}

async function getPostList(filters: SkillPostFilters, page: number, pageSize: number) {
  const conditions: string[] = [
    "sp.deleted_at IS NULL",
    "sp.status = 'active'",
    // 过滤过期帖子：expires_at 为 NULL 表示永久有效，否则必须晚于当前时间
    "(sp.expires_at IS NULL OR sp.expires_at > NOW())",
  ];
  // SQL 参数数组：收紧为 SqlParam[]，避免误传函数/Symbol 等非 SQL 友好类型
  const values: SqlParam[] = [];
  let paramIndex = 1;

  if (filters.type) {
    conditions.push(`sp.type = $${paramIndex++}`);
    values.push(filters.type);
  }
  if (filters.category) {
    conditions.push(`sp.category = $${paramIndex++}`);
    values.push(filters.category);
  }
  if (filters.keyword) {
    conditions.push(`(sp.title ILIKE $${paramIndex} OR sp.description ILIKE $${paramIndex})`);
    values.push(`%${filters.keyword}%`);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  // 并行查询总数和列表
  const [countResult, listResult] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*) FROM skill_posts sp WHERE ${whereClause}`, values),
    query<SkillPostRow>(
      `SELECT sp.*, u.nickname, u.avatar, u.reputation_score
       FROM skill_posts sp
       LEFT JOIN users u ON sp.user_id = u.id
       WHERE ${whereClause}
       ORDER BY sp.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...values, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  return {
    list: listResult.rows.map(toSkillPost),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

async function getPostById(id: string) {
  // 使用缓存：先查缓存，未命中时查数据库并缓存结果
  return skillPostCache.get(id, async () => {
    const { rows } = await query<SkillPostRow>(
      `SELECT sp.*, u.nickname, u.avatar, u.reputation_score
       FROM skill_posts sp
       LEFT JOIN users u ON sp.user_id = u.id
       WHERE sp.id = $1 AND sp.deleted_at IS NULL`,
      [id],
    );

    if (rows.length === 0) throw new NotFoundError('技能帖子');
    const post = toSkillPost(rows[0]);

    // 过期校验：expires_at 已过且状态仍为 active 时，标注 expired 状态供前端展示
    // 不直接返回 404，以便用户查看帖子内容并理解为何无法下单（实际下单由 createOrder 拦截）
    const isExpired = !!(post.expiresAt && new Date(post.expiresAt) < new Date());
    if (isExpired) {
      return { ...post, expired: true };
    }
    return post;
  });
}

async function updatePost(id: string, userId: string, data: UpdateSkillPostDTO) {
  const { rows: existing } = await query<{ user_id: string }>(
    'SELECT user_id FROM skill_posts WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (existing.length === 0) throw new NotFoundError('技能帖子');
  if (existing[0].user_id !== userId) throw new PermissionDeniedError('无权修改此帖子');

  // 更新前清洗富文本字段并校验图片 URL
  const sanitized = sanitizeObject(data, ['title', 'description']);
  if (sanitized.images !== undefined) {
    validateImageUrls(sanitized.images);
  }

  const allowedFields = ['title', 'description', 'credit_price', 'images', 'tags', 'address', 'expires_at'] as const;
  const fields: string[] = [];
  // SQL 参数数组：收紧为 SqlParam[]，避免误传函数/Symbol 等非 SQL 友好类型
  const values: SqlParam[] = [];
  let paramIndex = 1;

  // 设计原因：sanitized 是 UpdateSkillPostDTO，TS 不允许用 string 索引，
  // 转为 Record<string, unknown> 后可按字段名动态取值，运行时安全
  const sanitizedRecord = sanitized as unknown as Record<string, unknown>;
  for (const field of allowedFields) {
    if (sanitizedRecord[field] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      values.push(sanitizedRecord[field] as SqlParam);
    }
  }

  if (fields.length === 0) return getPostById(id);

  fields.push('updated_at = NOW()');
  values.push(id);

  const { rows } = await query<SkillPostRow>(
    `UPDATE skill_posts SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING ${SKILL_POST_COLUMNS}`,
    values,
  );

  // 帖子更新后清除缓存
  await skillPostCache.invalidate(id);

  return toSkillPost(rows[0]);
}

async function deletePost(id: string, userId: string) {
  const { rows: existing } = await query<{ user_id: string }>(
    'SELECT user_id FROM skill_posts WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (existing.length === 0) throw new NotFoundError('技能帖子');
  if (existing[0].user_id !== userId) throw new PermissionDeniedError('无权删除此帖子');

  await query('UPDATE skill_posts SET deleted_at = NOW() WHERE id = $1', [id]);

  // 帖子删除后清除缓存
  await skillPostCache.invalidate(id);
}

async function getUserPosts(userId: string, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;

  const [countResult, listResult] = await Promise.all([
    query<{ count: string }>(
      `SELECT COUNT(*) FROM skill_posts WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    ),
    query<SkillPostRow>(
      `SELECT sp.*, u.nickname, u.avatar, u.reputation_score
       FROM skill_posts sp
       LEFT JOIN users u ON sp.user_id = u.id
       WHERE sp.user_id = $1 AND sp.deleted_at IS NULL
       ORDER BY sp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    ),
  ]);

  const total = parseInt(countResult.rows[0].count, 10);

  return {
    list: listResult.rows.map(toSkillPost),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export const skillService = {
  createPost,
  getPostList,
  getPostById,
  updatePost,
  deletePost,
  getUserPosts,
};
