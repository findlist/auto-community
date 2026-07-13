import { query, transaction } from '../config/database';
import { BadRequestError } from '../utils/errors';
import { prefixColumns } from '../utils/sql';

/**
 * reviews 表行类型
 * rating 为 string：pg DECIMAL 默认解析为 string，parseFloat(row.rating) 安全转换
 * content 为 string | null：评价内容可选（用户可能只打分不留言）
 */

// reviews 表响应构造列：覆盖 toReview 所需字段（不含 LEFT JOIN users 引入的 reviewer_nickname/reviewer_avatar）
// 设计原因：RETURNING * 会返回全部字段，显式列名避免未来新增字段意外泄露；导出供 time-bank.service 复用避免列名分裂
export const REVIEW_COLUMNS = `id, reviewer_id, reviewed_id, order_id, order_type, rating, content, created_at, updated_at`;

interface ReviewRow {
  id: string;
  reviewer_id: string;
  reviewed_id: string;
  order_id: string;
  order_type: string;
  rating: string;
  content: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * 评价列表查询行：extends ReviewRow + LEFT JOIN users 引入的评价人信息
 * JOIN 字段定义为 optional + nullable：createReview 的 INSERT RETURNING * 不含这些字段，
 * getReviewsByUser 的 LEFT JOIN 可能返回 NULL（用户被删除时），两种场景兼容同一接口
 */
interface ReviewListRow extends ReviewRow {
  reviewer_nickname?: string | null;
  reviewer_avatar?: string | null;
}

function toReview(row: ReviewListRow) {
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    reviewedId: row.reviewed_id,
    orderId: row.order_id,
    orderType: row.order_type,
    rating: parseFloat(row.rating),
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewer: row.reviewer_nickname ? {
      id: row.reviewer_id,
      nickname: row.reviewer_nickname,
      avatar: row.reviewer_avatar,
    } : undefined,
  };
}

async function createReview(
  reviewerId: string,
  reviewedId: string,
  orderId: string,
  orderType: string,
  rating: number,
  content?: string,
) {
  if (rating < 1 || rating > 5) {
    throw new BadRequestError('评分必须在1-5之间');
  }

  const existResult = await query<{ count: string }>(
    'SELECT COUNT(*) FROM reviews WHERE reviewer_id = $1 AND order_id = $2',
    [reviewerId, orderId],
  );
  if (parseInt(existResult.rows[0].count) > 0) {
    throw new BadRequestError('已评价过此订单');
  }

  const result = await query<ReviewListRow>(
    `INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${REVIEW_COLUMNS}`,
    [reviewerId, reviewedId, orderId, orderType, rating, content || null],
  );

  return toReview(result.rows[0]);
}

// 计算并更新用户信誉分
// 设计原因：原实现先 SELECT AVG 再 UPDATE，两步未包裹事务，并发评价场景下存在 lost update
// （事务 A/B 均读到旧 AVG，后写覆盖先算）。改用单条 UPDATE + 子查询原子完成计算与写入，
// 消除读-写间隙；RETURNING 返回更新后的值，保持函数返回平均分的语义
async function calculateReputation(userId: string) {
  return transaction(async (client) => {
    const result = await client.query<{ reputation_score: string }>(
      `UPDATE users SET reputation_score = (
         SELECT COALESCE(AVG(rating), 5.0) FROM (
           SELECT rating FROM reviews WHERE reviewed_id = $1 ORDER BY created_at DESC LIMIT 50
         ) recent
       ) WHERE id = $1 RETURNING reputation_score`,
      [userId],
    );
    return parseFloat(result.rows[0].reputation_score);
  });
}

async function getReviewsByUser(userId: string, page: number = 1, pageSize: number = 10) {
  const offset = (page - 1) * pageSize;

  const [dataResult, countResult] = await Promise.all([
    query<ReviewListRow>(
      `SELECT ${prefixColumns(REVIEW_COLUMNS, 'r')}, u.nickname AS reviewer_nickname, u.avatar AS reviewer_avatar
       FROM reviews r
       LEFT JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewed_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    ),
    query<{ count: string }>('SELECT COUNT(*) FROM reviews WHERE reviewed_id = $1', [userId]),
  ]);

  const total = parseInt(countResult.rows[0].count);

  return {
    list: dataResult.rows.map(toReview),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export const reviewService = {
  createReview,
  calculateReputation,
  getReviewsByUser,
};
