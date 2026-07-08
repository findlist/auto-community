// 统一分页响应格式：所有列表接口返回此结构
interface PaginatedResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
}

// 根据列表数据与分页参数构造统一的分页响应对象
function createPaginatedResponse<T>(list: T[], total: number, page: number, pageSize: number): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / pageSize);
  return {
    list,
    total,
    page,
    pageSize,
    totalPages,
    hasNext: page < totalPages,
  };
}

// 游标分页响应格式：基于索引范围查询，性能稳定
interface CursorPaginatedResponse<T> {
  list: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// 游标分页参数
interface CursorPaginationParams {
  cursor?: string;  // 上一页最后一条记录的 ID
  limit: number;    // 每页条数
}

// 游标分页结果
interface CursorPaginationResult<T> {
  list: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * 构造游标分页响应
 * @param list 当前页数据
 * @param limit 每页条数
 * @returns 游标分页响应，包含 nextCursor 和 hasMore
 */
function createCursorPaginatedResponse<T extends { id: string }>(
  list: T[],
  limit: number,
): CursorPaginationResult<T> {
  // 如果返回数据少于 limit，说明没有更多数据
  const hasMore = list.length >= limit;
  // nextCursor 为当前页最后一条记录的 ID，无更多数据时为 null
  const nextCursor = hasMore && list.length > 0 ? list[list.length - 1].id : null;

  return {
    list,
    nextCursor,
    hasMore,
  };
}

export {
  createPaginatedResponse,
  PaginatedResponse,
  createCursorPaginatedResponse,
  CursorPaginatedResponse,
  CursorPaginationParams,
  CursorPaginationResult,
};
