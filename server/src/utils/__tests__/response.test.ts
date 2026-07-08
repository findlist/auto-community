/**
 * 统一响应工具单元测试
 *
 * 测试目标：success/error/paginated/cursorPaginated/created/updated/deleted/noContent
 * 测试策略：构造 mock Response 对象，验证 res.status/res.json/res.send 的调用参数与默认值兜底逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import {
  success,
  error,
  paginated,
  cursorPaginated,
  created,
  updated,
  deleted,
  noContent,
} from '../response';
import { SUCCESS_CODE, CREATED_CODE } from '../errorCodes';

// 构造 mock Response：status 链式调用、json/send 记录调用参数
function createMockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('success - 成功响应', () => {
  it('带 data 与 message 应原样透传', () => {
    const res = createMockRes();
    success(res, { id: 1 }, '操作完成');
    expect(res.json).toHaveBeenCalledWith({
      code: SUCCESS_CODE,
      message: '操作完成',
      data: { id: 1 },
    });
  });

  it('未传 message 应使用默认 "操作成功"', () => {
    const res = createMockRes();
    success(res, { id: 2 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '操作成功', data: { id: 2 } }),
    );
  });

  it('未传 data 时 data 为 undefined', () => {
    const res = createMockRes();
    success(res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: undefined }),
    );
  });
});

describe('error - 错误响应', () => {
  it('默认 code 为 BAD_REQUEST，HTTP 状态 400', () => {
    const res = createMockRes();
    error(res, '参数错误');
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      message: '参数错误',
      errors: undefined,
    });
  });

  it('已知 code NOT_FOUND 应映射 HTTP 404', () => {
    const res = createMockRes();
    error(res, '未找到', 'NOT_FOUND');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('未知 code 应回退 HTTP 400', () => {
    const res = createMockRes();
    error(res, '未知错误', 'UNKNOWN_CODE');
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('errors 字段应透传 FieldError 数组', () => {
    const res = createMockRes();
    const errors = [{ field: 'email', message: '格式错误', value: 'abc' }];
    error(res, '校验失败', 'VALIDATION_ERROR', errors);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errors }),
    );
  });
});

describe('paginated - 分页响应', () => {
  it('应计算 totalPages 与 hasNext，默认 message "查询成功"', () => {
    const res = createMockRes();
    // total=21 pageSize=10 -> totalPages=3，page=1 < 3 -> hasNext=true
    paginated(res, [{ id: 1 }], 21, 1, 10);
    expect(res.json).toHaveBeenCalledWith({
      code: SUCCESS_CODE,
      message: '查询成功',
      data: { list: [{ id: 1 }], total: 21, page: 1, pageSize: 10, totalPages: 3, hasNext: true },
    });
  });

  it('最后一页 hasNext 应为 false', () => {
    const res = createMockRes();
    // page=3 totalPages=3 -> hasNext=false
    paginated(res, [], 21, 3, 10);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hasNext: false, totalPages: 3 }) }),
    );
  });

  it('total=0 时 totalPages=0，hasNext=false', () => {
    const res = createMockRes();
    paginated(res, [], 0, 1, 10);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalPages: 0, hasNext: false }) }),
    );
  });

  it('自定义 message 应透传', () => {
    const res = createMockRes();
    paginated(res, [], 0, 1, 10, '列表为空');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '列表为空' }),
    );
  });
});

describe('cursorPaginated - 游标分页响应', () => {
  it('应透传 nextCursor 与 hasMore，默认 message "查询成功"', () => {
    const res = createMockRes();
    cursorPaginated(res, [{ id: 1 }], 'cursor-abc', true);
    expect(res.json).toHaveBeenCalledWith({
      code: SUCCESS_CODE,
      message: '查询成功',
      data: { list: [{ id: 1 }], nextCursor: 'cursor-abc', hasMore: true },
    });
  });

  it('nextCursor 为 null 表示无更多数据', () => {
    const res = createMockRes();
    cursorPaginated(res, [], null, false, '已到底部');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ nextCursor: null, hasMore: false }),
        message: '已到底部',
      }),
    );
  });
});

describe('created - 创建成功响应', () => {
  it('应设置 HTTP 201 与 CREATED code', () => {
    const res = createMockRes();
    created(res, { id: 10 }, '创建完成');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      code: CREATED_CODE,
      message: '创建完成',
      data: { id: 10 },
    });
  });

  it('未传 message 应使用默认 "创建成功"', () => {
    const res = createMockRes();
    created(res, { id: 11 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '创建成功', code: CREATED_CODE }),
    );
  });
});

describe('updated / deleted / noContent', () => {
  it('updated 应使用 SUCCESS code 与默认 "更新成功"', () => {
    const res = createMockRes();
    updated(res, { id: 1 });
    expect(res.json).toHaveBeenCalledWith({
      code: SUCCESS_CODE,
      message: '更新成功',
      data: { id: 1 },
    });
  });

  it('updated 自定义 message 应透传', () => {
    const res = createMockRes();
    updated(res, undefined, '已修改');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: '已修改' }),
    );
  });

  it('deleted 应使用 SUCCESS code 与默认 "删除成功"，无 data 字段', () => {
    const res = createMockRes();
    deleted(res);
    expect(res.json).toHaveBeenCalledWith({
      code: SUCCESS_CODE,
      message: '删除成功',
    });
  });

  it('noContent 应设置 HTTP 204 并调用 send', () => {
    const res = createMockRes();
    noContent(res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});
