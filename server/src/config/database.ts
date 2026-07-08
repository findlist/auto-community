import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from './env';
import { logger } from '../utils/logger';

// SQL 参数合法类型联合：覆盖项目所有查询参数使用场景
// 设计原因：原 params?: any[] 放弃类型检查，调用方可传入任意类型静默通过，
// 收紧为联合类型后编译期即可捕获非法参数类型（如传入函数、Symbol 等）
// Date 用于 timestamp 列，Record<string, unknown> 用于 JSONB 列（如 certification）
export type SqlParam = string | number | boolean | null | string[] | Date | Record<string, unknown>;

/**
 * Type guard：运行时校验值是否为 SqlParam 合法类型
 *
 * 设计原因：service 层从客户端入参拿到的是 unknown，编译期的联合类型无法阻止
 * 实际传入的非法值（如函数、Symbol、循环引用对象）。在写入 SQL 参数前显式校验，
 * 既能让 TS 在分支内自动收窄类型，又能比 pg 运行时报错更早暴露问题并返回友好错误。
 *
 * 校验规则：
 * - null 直接放行（用于清空字段）
 * - number 必须有限（排除 NaN/Infinity，避免 pg 序列化异常）
 * - string[] 数组元素必须全部为字符串（images/tags 等字段）
 * - 对象必须是普通对象（排除 class 实例、Date 等），用于 JSONB 列
 */
export function isSqlParam(value: unknown): value is SqlParam {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return true;
  if (t === 'number') return Number.isFinite(value);
  if (value instanceof Date) return true;
  if (Array.isArray(value)) {
    // 数组元素必须全部为字符串，匹配 string[] 类型
    return value.every((item) => typeof item === 'string');
  }
  if (t === 'object') {
    // 仅允许普通对象（{} 或 JSON 解析结果），排除 class 实例等非 SQL 友好对象
    return Object.prototype.toString.call(value) === '[object Object]';
  }
  // 函数、Symbol、undefined 等均拒绝
  return false;
}

// 创建PostgreSQL连接池
export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// 连接池事件监听
pool.on('connect', () => {
  logger.debug('数据库连接池: 新连接建立');
});

pool.on('error', (err) => {
  logger.error({ err }, '数据库连接池错误');
});

// 查询辅助函数
// 设计原因：泛型默认值 any 改为 QueryResultRow，与 pg 类型契约对齐，
// 调用方未显式指定泛型时返回 QueryResultRow 而非 any，编译期即可暴露字段误用；
// params 收紧为 SqlParam[]，禁止传入非 SQL 合法类型
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: SqlParam[]): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  // SQL 日志：仅记录 SQL 文本与执行耗时，不记录 params（避免泄露密码、手机号等敏感数据）
  logger.debug({ sql: text, durationMs: duration, rows: result.rowCount }, '执行查询');

  return result;
}

// 事务辅助函数
// 设计原因：回调 client 从 any 收紧为 PoolClient，让编译期校验事务内调用的方法签名，
// 避免误用 pool 客户端不存在的 API；调用方回调签名会自动推断为 PoolClient，无需手动标注
export async function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// 测试数据库连接
export async function testConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.info({ now: result.rows[0] }, '数据库连接成功');
    return true;
  } catch (error) {
    logger.error({ err: error }, '数据库连接失败');
    return false;
  }
}

// 关闭连接池
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('数据库连接池已关闭');
}
