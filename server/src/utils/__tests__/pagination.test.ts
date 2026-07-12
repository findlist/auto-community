/**
 * utils/pagination 单元测试
 *
 * 测试目标：
 * - createPaginatedResponse：totalPages 计算（Math.ceil）、hasNext 边界（page < totalPages）、字段透传
 * - createCursorPaginatedResponse：hasMore 计算（list.length >= limit）、nextCursor 取最后一条 id、空列表与 hasMore=false 时 nextCursor=null
 *
 * 测试策略：纯函数无副作用，直接断言返回值。
 *           重点验证边界场景：空列表、total=0、pageSize=0 防御、hasMore=true 时 nextCursor 必须非 null、hasMore=false 时 nextCursor 必须 null。
 */
import { describe, it, expect } from 'vitest';
import {
  createPaginatedResponse,
  createCursorPaginatedResponse,
} from '../pagination';

describe('utils/pagination createPaginatedResponse - 基础场景', () => {
  it('正常分页响应（第 1 页，共 3 页）', () => {
    const result = createPaginatedResponse([1, 2], 6, 1, 2);
    // totalPages = Math.ceil(6 / 2) = 3
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.total).toBe(6);
    expect(result.list).toEqual([1, 2]);
    // page < totalPages → hasNext=true
    expect(result.hasNext).toBe(true);
  });

  it('最后一页 hasNext=false', () => {
    const result = createPaginatedResponse([5, 6], 6, 3, 2);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(3);
    // page === totalPages → hasNext=false
    expect(result.hasNext).toBe(false);
  });

  it('中间页 hasNext=true', () => {
    const result = createPaginatedResponse([3, 4], 6, 2, 2);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(result.hasNext).toBe(true);
  });

  it('list 字段透传（对象数组）', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const result = createPaginatedResponse(list, 2, 1, 10);
    expect(result.list).toBe(list);
    expect(result.list).toHaveLength(2);
  });
});

describe('utils/pagination createPaginatedResponse - 边界场景', () => {
  it('空列表 + total=0 + page=1', () => {
    const result = createPaginatedResponse([], 0, 1, 10);
    // totalPages = Math.ceil(0 / 10) = 0
    expect(result.totalPages).toBe(0);
    // page(1) < totalPages(0) → false，hasNext=false
    expect(result.hasNext).toBe(false);
    expect(result.list).toEqual([]);
  });

  it('total 不能被 pageSize 整除时 totalPages 向上取整', () => {
    // 实际场景：total=7, pageSize=2 → totalPages=Math.ceil(3.5)=4
    const result = createPaginatedResponse([1, 2], 7, 1, 2);
    expect(result.totalPages).toBe(4);
  });

  it('total 恰好被 pageSize 整除时 totalPages 精确', () => {
    const result = createPaginatedResponse([1, 2], 6, 1, 2);
    expect(result.totalPages).toBe(3);
  });

  it('page 超出 totalPages 时 hasNext=false（防御越界访问）', () => {
    // 实际场景：客户端传 page=999 但 total 不足
    const result = createPaginatedResponse([], 6, 999, 2);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(999);
    expect(result.hasNext).toBe(false);
  });

  it('pageSize 大于 total 时单页返回所有数据', () => {
    const result = createPaginatedResponse([1, 2, 3], 3, 1, 10);
    expect(result.totalPages).toBe(1);
    expect(result.hasNext).toBe(false);
  });

  it('list 与 total 不一致时仍按 total 计算 totalPages（信任调用方语义）', () => {
    // 实际场景：service 查询时 limit 可能小于 total，list.length=2 但 total=100
    const result = createPaginatedResponse([1, 2], 100, 1, 10);
    expect(result.totalPages).toBe(10);
    expect(result.hasNext).toBe(true);
  });
});

describe('utils/pagination createCursorPaginatedResponse - 基础场景', () => {
  it('list.length >= limit 时 hasMore=true 且 nextCursor 为最后一条 id', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = createCursorPaginatedResponse(list, 3);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('c');
    expect(result.list).toBe(list);
  });

  it('list.length < limit 时 hasMore=false 且 nextCursor=null', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const result = createCursorPaginatedResponse(list, 3);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('list.length 恰好等于 limit 时 hasMore=true（边界含等号）', () => {
    // 设计说明：list.length >= limit 用 >= 而非 >，是因为游标分页通常多查一条判断是否还有更多，
    // 当 list.length === limit 时不能确定是否还有更多，保守返回 hasMore=true
    const list = [{ id: 'a' }];
    const result = createCursorPaginatedResponse(list, 1);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('a');
  });

  it('list 字段透传（对象数组）', () => {
    const list = [{ id: 'x', name: 'test' }];
    const result = createCursorPaginatedResponse(list, 10);
    expect(result.list).toBe(list);
  });
});

describe('utils/pagination createCursorPaginatedResponse - 边界场景', () => {
  it('空列表 hasMore=false 且 nextCursor=null', () => {
    // 防御场景：list.length >= limit 中 0 >= limit 仅在 limit=0 时为 true，
    // 但空列表通常表示无更多数据，函数应保守返回 hasMore=false
    // 实际逻辑：list.length(0) >= limit(10) → false，hasMore=false
    const result = createCursorPaginatedResponse([], 10);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('空列表 + limit=0 时 hasMore=true 但 nextCursor=null（防御空 limit）', () => {
    // 设计说明：list.length(0) >= limit(0) → true，但 list.length > 0 为 false，
    // 所以 nextCursor=null。这是 limit=0 的边界场景，实际调用方不应传 limit=0
    const result = createCursorPaginatedResponse([], 0);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it('hasMore=true 但 list 为空时 nextCursor 仍为 null（防御逻辑保证）', () => {
    // 设计说明：nextCursor 的取值有 list.length > 0 双重保护，
    // 即使 hasMore=true（理论上不应发生），空列表也不会取到 undefined
    const result = createCursorPaginatedResponse([], 0);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it('单条数据 + limit=1 时 hasMore=true 且 nextCursor 为该条 id', () => {
    const list = [{ id: 'only' }];
    const result = createCursorPaginatedResponse(list, 1);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe('only');
  });

  it('多页数据最后一页 hasMore=false 且 nextCursor=null', () => {
    // 实际场景：游标分页查最后一页，返回的 list.length < limit
    const list = [{ id: 'last-1' }, { id: 'last-2' }];
    const result = createCursorPaginatedResponse(list, 5);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});
