/**
 * admin.service getOrders 单元测试
 *
 * 测试目标：覆盖三种订单类型（skill/kitchen/time_bank）的查询逻辑、
 *           买方/卖方昵称 JOIN 映射、status 过滤 SQL 表前缀、分页参数传递。
 * 测试策略：mock database 模块，按调用顺序链式返回 count 与 list 结果，
 *           断言 SQL 文本与返回结构。
 * 设计原因：getOrders 新增 JOIN users 返回昵称，需验证不同订单类型的
 *           buyerColumn/sellerColumn 在 SQL 中正确拼接，且昵称缺失时降级到 undefined。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: {},
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../cache.service', () => ({
  userCache: { get: vi.fn(), invalidate: vi.fn() },
  kitchenPostCache: { get: vi.fn(), invalidate: vi.fn() },
}));

import { adminService } from '../admin.service';
import { query } from '../../config/database';
import { BadRequestError } from '../../utils/errors';

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  mockedQuery.mockReset();
});

describe('admin.service - getOrders 订单列表查询', () => {
  it('skill 类型使用 buyer_id/seller_id 列名 JOIN users 返回昵称', async () => {
    // 第一次 query 为 count，第二次为 list
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: 'so-1',
          buyer_id: 'u-buyer',
          seller_id: 'u-seller',
          credit_amount: 50,
          status: 'completed',
          created_at: new Date(),
          buyer_nickname: '买家小明',
          seller_nickname: '卖家老王',
        }],
      } as any);

    const result = await adminService.getOrders('skill', undefined, 1, 20);

    expect(result.total).toBe(1);
    expect(result.list[0].buyer).toEqual({ nickname: '买家小明' });
    expect(result.list[0].seller).toEqual({ nickname: '卖家老王' });
    expect(result.list[0].creditsAmount).toBe(50);

    // list SQL 应包含 skill 类型的列名与 JOIN 语句
    const listSql = mockedQuery.mock.calls[1][0] as string;
    expect(listSql).toContain('o.buyer_id AS buyer_id');
    expect(listSql).toContain('o.seller_id AS seller_id');
    expect(listSql).toContain('LEFT JOIN users buyer ON o.buyer_id = buyer.id');
    expect(listSql).toContain('LEFT JOIN users seller ON o.seller_id = seller.id');
  });

  it('kitchen 类型使用 user_id/seller_id 列名', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await adminService.getOrders('kitchen', undefined, 1, 20);

    const listSql = mockedQuery.mock.calls[1][0] as string;
    // kitchen 类型 buyerColumn 为 user_id（拼单发起者）
    expect(listSql).toContain('o.user_id AS buyer_id');
    expect(listSql).toContain('LEFT JOIN users buyer ON o.user_id = buyer.id');
  });

  it('time_bank 类型使用 requester_id/provider_id 列名，durationMinutes 字段映射', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: 'to-1',
          buyer_id: 'u-req',
          seller_id: 'u-pro',
          duration_minutes: 60,
          status: 'completed',
          created_at: new Date(),
          buyer_nickname: '请求者',
          seller_nickname: '服务者',
        }],
      } as any);

    const result = await adminService.getOrders('time_bank', undefined, 1, 20);

    expect(result.list[0].durationMinutes).toBe(60);

    const listSql = mockedQuery.mock.calls[1][0] as string;
    expect(listSql).toContain('o.requester_id AS buyer_id');
    expect(listSql).toContain('o.provider_id AS seller_id');
  });

  it('status 过滤使用 o.status 表前缀避免 JOIN 歧义', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await adminService.getOrders('skill', 'completed', 1, 20);

    // count 与 list SQL 均应使用 o.status 前缀
    const countSql = mockedQuery.mock.calls[0][0] as string;
    const listSql = mockedQuery.mock.calls[1][0] as string;
    expect(countSql).toContain('FROM skill_orders o WHERE');
    expect(countSql).toContain('o.status = $1');
    expect(listSql).toContain('o.status = $1');
  });

  it('买方昵称缺失时 buyer 字段为 undefined（用户被删除场景）', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '1' }] } as any)
      .mockResolvedValueOnce({
        rows: [{
          id: 'so-2',
          buyer_id: 'u-deleted',
          seller_id: 'u-seller',
          credit_amount: 10,
          status: 'pending',
          created_at: new Date(),
          buyer_nickname: null,
          seller_nickname: '卖家',
        }],
      } as any);

    const result = await adminService.getOrders('skill', undefined, 1, 20);

    // 买方被删除（LEFT JOIN 未命中），buyer 字段降级为 undefined，前端 fallback 到 buyerId
    expect(result.list[0].buyer).toBeUndefined();
    expect(result.list[0].seller).toEqual({ nickname: '卖家' });
  });

  it('分页参数正确传递 LIMIT/OFFSET', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ count: '50' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    await adminService.getOrders('skill', undefined, 3, 20);

    // 第 3 页偏移量应为 40
    const listCall = mockedQuery.mock.calls[1];
    const listParams = listCall[1] as any[];
    expect(listParams).toContain(20);  // LIMIT
    expect(listParams).toContain(40);  // OFFSET = (3-1) * 20
  });

  it('无效订单类型抛 BadRequestError', async () => {
    // typescript 在编译期阻止字面量传参，用 any 绕过测试运行时校验
    await expect(adminService.getOrders('invalid' as any, undefined, 1, 20))
      .rejects.toBeInstanceOf(BadRequestError);
  });
});
