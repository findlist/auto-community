import { query, transaction, SqlParam } from '../config/database';
import { NotFoundError } from '../utils/errors';
import { sanitizeObject } from '../utils/sanitize';

// delivery_addresses 表显式查询列：替代 SELECT *，防御未来新增字段意外泄露
// 字段对齐 DeliveryAddressRow 接口声明，列为硬编码常量非用户输入，模板插值无注入风险
const DELIVERY_ADDRESS_COLUMNS = `id, user_id, recipient, phone, address, is_default,
  created_at, updated_at`;

// delivery_addresses 表行类型：与数据库列结构对齐，所有字段均为 NOT NULL
// 设计原因：原 row: any 让字段拼写错误静默通过编译，收紧后访问错误字段立即报错
interface DeliveryAddressRow {
  id: string;
  user_id: string;
  recipient: string;
  phone: string;
  address: string;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

// 地址数据序列化：数据库下划线 → 前端驼峰
function toAddress(row: DeliveryAddressRow) {
  return {
    id: row.id,
    userId: row.user_id,
    recipient: row.recipient,
    phone: row.phone,
    address: row.address,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 获取用户所有地址（默认地址排在最前）
async function listByUser(userId: string) {
  // 泛型 DeliveryAddressRow：SELECT * 结果传给 toAddress，需精确类型
  const { rows } = await query<DeliveryAddressRow>(
    `SELECT ${DELIVERY_ADDRESS_COLUMNS} FROM delivery_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, updated_at DESC`,
    [userId],
  );
  return rows.map(toAddress);
}

// 创建地址：若为首个地址或标记为默认，自动处理默认状态
async function create(
  userId: string,
  data: { recipient: string; phone: string; address: string; isDefault?: boolean },
) {
  // 入库前清洗收件人姓名与详细地址，防止存储型 XSS
  // 设计原因：recipient 与 address 会在地址列表、订单详情、配送通知等多处直接渲染，
  // phone 为数字字符串不涉及 XSS 风险，无需清洗
  const safeData = sanitizeObject(data, ['recipient', 'address']);

  return transaction(async (client) => {
    // 设为默认时，先取消其他默认地址
    if (safeData.isDefault) {
      await client.query(
        'UPDATE delivery_addresses SET is_default = false WHERE user_id = $1',
        [userId],
      );
    }

    // 检查是否为首个地址，是则自动设为默认
    // COUNT 返回字符串，泛型 { count: string } 让 parseInt 拿到字符串
    const countResult = await client.query<{ count: string }>(
      'SELECT COUNT(*) FROM delivery_addresses WHERE user_id = $1',
      [userId],
    );
    const isFirst = parseInt(countResult.rows[0].count, 10) === 0;

    // INSERT RETURNING 显式列名，避免新增字段意外泄露到响应
    const { rows } = await client.query<DeliveryAddressRow>(
      `INSERT INTO delivery_addresses (user_id, recipient, phone, address, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${DELIVERY_ADDRESS_COLUMNS}`,
      [userId, safeData.recipient, safeData.phone, safeData.address, safeData.isDefault || isFirst],
    );

    return toAddress(rows[0]);
  });
}

// 更新地址
async function update(
  id: string,
  userId: string,
  data: Partial<{ recipient: string; phone: string; address: string; isDefault: boolean }>,
) {
  // 入库前清洗收件人姓名与详细地址（仅清洗已传入的字段），防止存储型 XSS
  // 设计原因：recipient 与 address 会在地址列表、订单详情、配送通知等多处直接渲染，
  // 未清洗会触发存储型 XSS；phone 为数字字符串不涉及 XSS 风险，无需清洗
  const safeData = sanitizeObject(data, ['recipient', 'address']);

  return transaction(async (client) => {
    // 校验地址归属权：SELECT * FOR UPDATE 结果含完整行，泛型 DeliveryAddressRow 精确化
    const existing = await client.query<DeliveryAddressRow>(
      `SELECT ${DELIVERY_ADDRESS_COLUMNS} FROM delivery_addresses WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [id, userId],
    );
    if (existing.rows.length === 0) throw new NotFoundError('地址');

    // 设为默认时，先取消其他默认地址
    if (safeData.isDefault) {
      await client.query(
        'UPDATE delivery_addresses SET is_default = false WHERE user_id = $1 AND id != $2',
        [userId, id],
      );
    }

    // 按需收集更新字段
    const fields: string[] = [];
    // SqlParam 收紧：data 字段为 string | boolean，均属合法 SqlParam
    const values: SqlParam[] = [];
    let paramIndex = 1;
    const fieldMap: Record<string, string> = {
      recipient: 'recipient',
      phone: 'phone',
      address: 'address',
      isDefault: 'is_default',
    };
    for (const [key, column] of Object.entries(fieldMap)) {
      if (safeData[key as keyof typeof safeData] !== undefined) {
        fields.push(`${column} = $${paramIndex++}`);
        // safeData[key] 类型为 string | boolean | undefined，过滤 undefined 后为 string | boolean
        values.push(safeData[key as keyof typeof safeData] as SqlParam);
      }
    }
    fields.push('updated_at = NOW()');

    // UPDATE RETURNING 显式列名，避免新增字段意外泄露到响应
    const { rows } = await client.query<DeliveryAddressRow>(
      `UPDATE delivery_addresses SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING ${DELIVERY_ADDRESS_COLUMNS}`,
      [...values, id],
    );

    return toAddress(rows[0]);
  });
}

// 删除地址：若删除的是默认地址，自动将最近的一条设为默认
async function remove(id: string, userId: string) {
  return transaction(async (client) => {
    // SELECT * 结果用于访问 is_default，泛型 DeliveryAddressRow 精确化
    const existing = await client.query<DeliveryAddressRow>(
      `SELECT ${DELIVERY_ADDRESS_COLUMNS} FROM delivery_addresses WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (existing.rows.length === 0) throw new NotFoundError('地址');

    const wasDefault = existing.rows[0].is_default;

    await client.query('DELETE FROM delivery_addresses WHERE id = $1', [id]);

    // 删除默认地址后，自动将最近一条设为默认
    if (wasDefault) {
      await client.query(
        `UPDATE delivery_addresses SET is_default = true
         WHERE user_id = $1 AND id = (
           SELECT id FROM delivery_addresses WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1
         )`,
        [userId],
      );
    }
  });
}

// 设为默认地址
async function setDefault(id: string, userId: string) {
  return transaction(async (client) => {
    // 仅需校验存在性，泛型 { id: string } 收窄结果
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM delivery_addresses WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    if (existing.rows.length === 0) throw new NotFoundError('地址');

    await client.query(
      'UPDATE delivery_addresses SET is_default = false WHERE user_id = $1',
      [userId],
    );
    await client.query(
      'UPDATE delivery_addresses SET is_default = true, updated_at = NOW() WHERE id = $1',
      [id],
    );
  });
}

export const addressService = {
  listByUser,
  create,
  update,
  remove,
  setDefault,
};
