/**
 * address.service 单元测试
 *
 * 测试目标：覆盖 listByUser / create / update / remove / setDefault
 * 测试策略：mock database 模块，transaction 回调直接以 mock client 执行，
 *           验证 SQL 拼装、默认地址唯一性、删除默认地址后自动迁移等逻辑。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// mock 事务 client：记录所有 query 调用，可按需配置返回值
const mockClient = {
  query: vi.fn(),
};

vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn((cb: (client: typeof mockClient) => Promise<unknown>) => cb(mockClient)),
  pool: {},
}));

import { addressService } from '../address.service';
import { query, transaction } from '../../config/database';
import { NotFoundError } from '../../utils/errors';

const mockedQuery = vi.mocked(query);
const mockedTransaction = vi.mocked(transaction);

// 局部类型别名：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需 rows
// 用 as unknown as DbResult 替代显式 any 断言以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;

// 构造一条地址行
function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'addr-1',
    user_id: 'user-1',
    recipient: '张三',
    phone: '13800000000',
    address: '北京市朝阳区某街道',
    is_default: false,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockClient.query.mockReset();
  mockedTransaction.mockClear();
});

describe('address.service - listByUser', () => {
  it('返回当前用户的所有地址，按默认优先', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [mockRow({ is_default: true }), mockRow({ id: 'addr-2' })],
    } as unknown as DbResult);

    const result = await addressService.listByUser('user-1');

    expect(result).toHaveLength(2);
    expect(result[0].isDefault).toBe(true);
    // 验证 SQL 末尾排序：is_default DESC
    expect(mockedQuery.mock.calls[0][0]).toContain('ORDER BY is_default DESC');
    expect(result[0].recipient).toBe('张三');
  });

  it('用户无地址时返回空数组', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    const result = await addressService.listByUser('user-1');
    expect(result).toEqual([]);
  });
});

describe('address.service - create', () => {
  it('首个地址自动设为默认', async () => {
    // count=0 → 自动默认
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as unknown as DbResult) // COUNT
      .mockResolvedValueOnce({ rows: [mockRow({ is_default: true })] } as unknown as DbResult); // INSERT RETURNING

    const result = await addressService.create('user-1', {
      recipient: '张三',
      phone: '13800000000',
      address: '北京市朝阳区',
      isDefault: false, // 入参未标记默认，但作为首条应自动默认
    });

    expect(result.isDefault).toBe(true);
    // 验证 INSERT 参数中 is_default = true（isFirst 计算结果）
    const insertCall = mockClient.query.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO delivery_addresses');
    expect(insertCall[1][4]).toBe(true);
  });

  it('标记为默认时，先取消其他默认地址', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // UPDATE 取消其他默认
      .mockResolvedValueOnce({ rows: [{ count: '2' }] } as unknown as DbResult) // COUNT 非首条
      .mockResolvedValueOnce({ rows: [mockRow({ is_default: true })] } as unknown as DbResult); // INSERT

    await addressService.create('user-1', {
      recipient: '李四',
      phone: '13900000000',
      address: '上海市浦东新区',
      isDefault: true,
    });

    // 第一次调用应为 UPDATE ... SET is_default = false
    expect(mockClient.query.mock.calls[0][0]).toContain('UPDATE delivery_addresses SET is_default = false');
  });
});

describe('address.service - update', () => {
  it('地址不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // SELECT FOR UPDATE

    await expect(
      addressService.update('addr-x', 'user-1', { recipient: '新名字' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('更新字段时按需收集并附加 updated_at', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [mockRow({ recipient: '新名字' })] } as unknown as DbResult); // UPDATE RETURNING

    const result = await addressService.update('addr-1', 'user-1', { recipient: '新名字' });

    expect(result.recipient).toBe('新名字');
    const updateSql = mockClient.query.mock.calls[1][0];
    expect(updateSql).toContain('recipient = $1');
    expect(updateSql).toContain('updated_at = NOW()');
  });

  it('设为默认时先取消其他默认地址', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // UPDATE 取消其他默认
      .mockResolvedValueOnce({ rows: [mockRow({ is_default: true })] } as unknown as DbResult); // UPDATE RETURNING

    await addressService.update('addr-1', 'user-1', { isDefault: true });

    // 第二次调用应为取消其他默认
    expect(mockClient.query.mock.calls[1][0]).toContain('UPDATE delivery_addresses SET is_default = false');
    expect(mockClient.query.mock.calls[1][0]).toContain('id != $2');
  });
});

describe('address.service - remove', () => {
  it('删除非默认地址时不触发自动迁移', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [mockRow({ is_default: false })] } as unknown as DbResult) // SELECT
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // DELETE

    await addressService.remove('addr-1', 'user-1');

    expect(mockClient.query).toHaveBeenCalledTimes(2);
    expect(mockClient.query.mock.calls[1][0]).toContain('DELETE FROM delivery_addresses');
  });

  it('删除默认地址时自动将最近一条设为默认', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [mockRow({ is_default: true })] } as unknown as DbResult) // SELECT
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // DELETE
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // UPDATE 自动迁移默认

    await addressService.remove('addr-1', 'user-1');

    expect(mockClient.query).toHaveBeenCalledTimes(3);
    const migrateSql = mockClient.query.mock.calls[2][0];
    expect(migrateSql).toContain('SET is_default = true');
    expect(migrateSql).toContain('ORDER BY updated_at DESC LIMIT 1');
  });

  it('地址不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(addressService.remove('addr-x', 'user-1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('address.service - setDefault', () => {
  it('地址不存在时抛 NotFoundError', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);
    await expect(addressService.setDefault('addr-x', 'user-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('先取消所有默认，再设置目标地址为默认', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [mockRow()] } as unknown as DbResult) // SELECT 校验归属
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult) // UPDATE 全部取消默认
      .mockResolvedValueOnce({ rows: [] } as unknown as DbResult); // UPDATE 目标设为默认

    await addressService.setDefault('addr-1', 'user-1');

    expect(mockClient.query.mock.calls[1][0]).toContain('SET is_default = false WHERE user_id = $1');
    expect(mockClient.query.mock.calls[2][0]).toContain('SET is_default = true, updated_at = NOW() WHERE id = $1');
  });
});
