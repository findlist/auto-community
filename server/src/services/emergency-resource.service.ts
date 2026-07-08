import { query, SqlParam } from '../config/database';
import { QueryResultRow } from 'pg';
import { NotFoundError, BadRequestError } from '../utils/errors';

/**
 * 地理点：lng 经度，lat 纬度
 */
interface GeoPoint {
  lng: number;
  lat: number;
}

/**
 * emergency_resources 表行类型（toResourceResponse 实际消费的列）
 * 设计原因：原 row: any 导致字段拼写错误无法在编译期暴露，列变更不触发类型告警
 */
interface ResourceRow extends QueryResultRow {
  id: string;
  community_id: string | null;
  type: string;
  name: string;
  description: string;
  location: string | GeoPoint | null;
  address: string;
  contact_phone: string | null;
  status: string;
  last_check: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * 应急资源创建/更新请求体
 * 设计原因：动态字段集合，统一用 Record 接收，pickResourceFields 按白名单提取
 */
// 导出供 routes 层收窄 req.body 类型，避免重复定义
export interface ResourceMutationData {
  communityId?: string;
  type?: string;
  name?: string;
  description?: string;
  address?: string;
  contactPhone?: string;
  status?: string;
  location?: GeoPoint | null;
}

function toResourceResponse(row: ResourceRow) {
  return {
    id: row.id,
    communityId: row.community_id,
    type: row.type,
    name: row.name,
    description: row.description,
    location: row.location,
    address: row.address,
    contactPhone: row.contact_phone,
    status: row.status,
    lastCheck: row.last_check,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

// 应急资源允许更新的字段白名单，防止越权字段被写入
const ALLOWED_FIELDS = [
  'community_id',
  'type',
  'name',
  'description',
  'address',
  'contact_phone',
  'status',
] as const;

// 将请求体中的驼峰字段名映射为数据库下划线字段名
const FIELD_ALIAS: Record<string, string> = {
  communityId: 'community_id',
  contactPhone: 'contact_phone',
};

// 解析请求体，提取允许写入的字段并转换为数据库列名
// 设计原因：请求体字段动态，用 Record<string, unknown> 收窄后按白名单提取
function pickResourceFields(data: ResourceMutationData): Record<string, SqlParam> {
  const picked: Record<string, SqlParam> = {};
  for (const [key, value] of Object.entries(data)) {
    // 跳过 undefined 与空字符串，避免覆盖原有数据
    if (value === undefined || value === '') continue;
    const columnName = FIELD_ALIAS[key] || key;
    // 校验字段名在白名单内，避免越权写入（含 SQL 注入防护）
    if ((ALLOWED_FIELDS as readonly string[]).includes(columnName)) {
      picked[columnName] = value as SqlParam;
    }
  }
  return picked;
}

async function getResources(params: { type?: string; page: number; pageSize: number }) {
  const { type, page, pageSize } = params;
  const offset = (page - 1) * pageSize;

  const conditions: string[] = ['deleted_at IS NULL'];
  const values: SqlParam[] = [];

  if (type) {
    conditions.push(`type = $${values.length + 1}`);
    values.push(type);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const paramOffset = values.length;

  const [listResult, countResult] = await Promise.all([
    query(
      `SELECT * FROM emergency_resources ${whereClause} ORDER BY created_at DESC LIMIT $${paramOffset + 1} OFFSET $${paramOffset + 2}`,
      [...values, pageSize, offset]
    ),
    query(
      `SELECT COUNT(*)::int AS total FROM emergency_resources ${whereClause}`,
      values
    )
  ]);

  return {
    // 行数据按 ResourceRow 收窄，避免逐字段 any
    list: (listResult.rows as ResourceRow[]).map(toResourceResponse),
    total: countResult.rows[0].total,
    page,
    pageSize
  };
}

async function getResourceById(id: string) {
  const result = await query(
    'SELECT * FROM emergency_resources WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('应急资源');
  }

  return toResourceResponse(result.rows[0] as ResourceRow);
}

/**
 * 管理员创建应急资源
 * location 字段为 POINT 类型，需将 {lat, lng} 转换为 PostgreSQL point 字面量
 */
async function create(data: ResourceMutationData) {
  const fields = pickResourceFields(data);
  if (Object.keys(fields).length === 0) {
    throw new BadRequestError('未提供有效的资源字段');
  }

  // location 单独处理：将 {lat, lng} 转换为 PostgreSQL point 格式 (lng,lat)
  const location = data.location ? `(${data.location.lng},${data.location.lat})` : null;

  // 动态构建 INSERT 语句，仅写入提供的字段
  const columns = Object.keys(fields);
  const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
  // fields[col] 已是 SqlParam 类型，直接收集
  const values: SqlParam[] = columns.map((col) => fields[col]);

  // location 与 created_at/updated_at 固定追加
  const locationPlaceholderIdx = columns.length + 1;
  const fullColumns = [...columns, 'location'].join(', ');
  const fullPlaceholders = `${placeholders}, $${locationPlaceholderIdx}::point`;

  const result = await query(
    `INSERT INTO emergency_resources (${fullColumns})
     VALUES (${fullPlaceholders})
     RETURNING *`,
    [...values, location]
  );

  return toResourceResponse(result.rows[0] as ResourceRow);
}

/**
 * 管理员更新应急资源：仅更新请求中提供的字段
 */
async function update(id: string, data: ResourceMutationData) {
  const fields = pickResourceFields(data);
  // location 单独处理，不放入 fields 中
  const hasLocation = data.location !== undefined;

  if (Object.keys(fields).length === 0 && !hasLocation) {
    throw new BadRequestError('未提供有效的更新字段');
  }

  // 先校验资源存在且未删除，避免对不存在资源做无意义 UPDATE
  const existResult = await query(
    'SELECT id FROM emergency_resources WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (existResult.rows.length === 0) {
    throw new NotFoundError('应急资源');
  }

  // 动态构建 SET 子句
  const setClauses: string[] = [];
  const values: SqlParam[] = [];
  let idx = 1;
  for (const [col, val] of Object.entries(fields)) {
    setClauses.push(`${col} = $${idx++}`);
    values.push(val);
  }
  if (hasLocation) {
    const location = data.location ? `(${data.location.lng},${data.location.lat})` : null;
    setClauses.push(`location = $${idx++}::point`);
    values.push(location);
  }
  setClauses.push(`updated_at = NOW()`);

  values.push(id);
  const result = await query(
    `UPDATE emergency_resources SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return toResourceResponse(result.rows[0] as ResourceRow);
}

/**
 * 管理员删除应急资源：软删除，仅设置 deleted_at，保留数据用于审计
 */
async function remove(id: string) {
  const result = await query(
    `UPDATE emergency_resources SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('应急资源');
  }
}

export const emergencyResourceService = {
  getResources,
  getResourceById,
  create,
  update,
  remove
};
