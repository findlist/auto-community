/**
 * user.service 单元测试
 *
 * 测试目标：
 * - getProfile：本人查询、用户不存在
 * - updateProfile：avatar 校验（非法域名/HTTP/路径遍历）、avatar 为空/null/undefined 跳过校验、昵称独立更新、用户不存在
 * - getUserById：缓存命中/未命中、用户不存在
 * - getCreditHistory / getTimeHistory：分页、空结果、offset 透传、totalPages 向上取整
 * - submitVerification：身份证号格式、姓名长度、用户状态、身份证号查重、正常提交
 * - getVerificationStatus：用户不存在、无认证记录、有认证记录
 *
 * 测试策略：mock database 的 query 与 transaction、cache.service 的 userCache、auth.service 的 toUserResponse、
 *           utils/crypto 的 encryptIdCard/hashIdCard（避免依赖 PII_ENCRYPT_KEY 环境变量），
 *           保留 sanitize 的 validateImageUrl 真实运行（纯函数，现有测试已验证）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 通过 vi.hoisted 提前创建 mock 引用，确保 vi.mock 工厂内能安全访问
const {
  mockQuery,
  mockTransaction,
  mockEncryptIdCard,
  mockHashIdCard,
  mockUserCacheGet,
  mockUserCacheInvalidate,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockEncryptIdCard: vi.fn(),
  mockHashIdCard: vi.fn(),
  mockUserCacheGet: vi.fn(),
  mockUserCacheInvalidate: vi.fn(),
}));

vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
  pool: {},
}));

// mock cache.service：userCache.get 与 invalidate 均使用可重置的 mock 引用
vi.mock('../cache.service', () => ({
  userCache: {
    get: mockUserCacheGet,
    invalidate: mockUserCacheInvalidate,
  },
}));

// mock auth.service 的 toUserResponse，直接回显 row 模拟序列化结果
vi.mock('../auth.service', () => ({
  toUserResponse: (row: unknown) => row,
}));

// mock crypto 模块：避免依赖 PII_ENCRYPT_KEY 环境变量，返回固定值便于断言
vi.mock('../../utils/crypto', () => ({
  encryptIdCard: mockEncryptIdCard,
  hashIdCard: mockHashIdCard,
}));

import { userService } from '../user.service';
import { BadRequestError, NotFoundError, ConflictError } from '../../utils/errors';

beforeEach(() => {
  mockQuery.mockReset();
  mockTransaction.mockReset();
  mockUserCacheGet.mockReset();
  mockUserCacheInvalidate.mockReset();
  // invalidate 默认解析为 undefined（清除缓存操作无返回值）
  mockUserCacheInvalidate.mockResolvedValue(undefined);
  // crypto mock 默认返回固定哈希/密文字符串
  mockHashIdCard.mockReturnValue('mocked-id-card-hash');
  mockEncryptIdCard.mockReturnValue('mocked-id-card-encrypted');
});

describe('user.service updateProfile avatar 校验', () => {
  it('avatar 含非白名单域名时抛 BadRequestError', async () => {
    await expect(
      userService.updateProfile('user-1', { avatar: 'https://evil.com/avatar.png' }),
    ).rejects.toThrow(BadRequestError);
    // 校验失败不应触发数据库写入
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('avatar 含 HTTP（非 HTTPS）协议时抛 BadRequestError', async () => {
    await expect(
      userService.updateProfile('user-1', { avatar: 'http://trae-api-cn.mchost.guru/avatar.png' }),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('avatar 含路径遍历（..）时抛 BadRequestError', async () => {
    await expect(
      userService.updateProfile('user-1', { avatar: '/uploads/../etc/passwd' }),
    ).rejects.toThrow(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('avatar 含 /uploads/ 相对路径时正常入库', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'user-1', avatar: '/uploads/avatar.png' }] });

    const result = await userService.updateProfile('user-1', { avatar: '/uploads/avatar.png' });

    expect(result.id).toBe('user-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    // SQL 与参数数组：avatar 应出现在参数中
    expect(callArgs[1]).toContain('/uploads/avatar.png');
  });

  it('avatar 含 HTTPS 白名单域名时正常入库', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'user-1' }] });

    await userService.updateProfile('user-1', {
      avatar: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=avatar',
    });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('avatar 为空字符串时跳过校验并入库（允许清空头像）', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'user-1', avatar: '' }] });

    await userService.updateProfile('user-1', { avatar: '' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('avatar 为 null 时跳过校验并入库', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'user-1' }] });

    await userService.updateProfile('user-1', { avatar: null as unknown as string });

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('仅更新昵称不传 avatar 时跳过校验', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'user-1', nickname: '新昵称' }] });

    await userService.updateProfile('user-1', { nickname: '新昵称' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[1]).toContain('新昵称');
  });
});

// ===================== getProfile =====================
describe('user.service getProfile', () => {
  it('正常返回用户资料（本人查询，isSelf=true）', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ id: 'user-1', phone: '13800000000', nickname: '张三', credit_balance: 100 }],
    });

    const result = await userService.getProfile('user-1');

    expect(result.id).toBe('user-1');
    // SQL 应包含 deleted_at IS NULL 条件，过滤软删除用户
    expect(mockQuery.mock.calls[0][0]).toContain('deleted_at IS NULL');
    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('用户不存在时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(userService.getProfile('nonexistent')).rejects.toThrow(NotFoundError);
  });
});

// ===================== updateProfile 边界 =====================
describe('user.service updateProfile 边界', () => {
  it('UPDATE 返回空行时抛 NotFoundError（用户已被软删除）', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(
      userService.updateProfile('user-1', { nickname: '新昵称' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('同时更新昵称和 avatar 时两个字段都进入 SQL SET 子句', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'user-1' }] });

    await userService.updateProfile('user-1', {
      nickname: '新昵称',
      avatar: '/uploads/new.png',
    });

    const [sql, params] = mockQuery.mock.calls[0];
    // SET 子句应同时包含 nickname 和 avatar
    expect(sql).toContain('nickname = $1');
    expect(sql).toContain('avatar = $2');
    expect(params).toEqual(['新昵称', '/uploads/new.png', 'user-1']);
  });

  it('更新后清除用户缓存', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'user-1' }] });

    await userService.updateProfile('user-1', { nickname: '新昵称' });

    expect(mockUserCacheInvalidate).toHaveBeenCalledWith('user-1');
  });
});

// ===================== getUserById =====================
describe('user.service getUserById', () => {
  it('缓存命中时直接返回缓存值，不查数据库', async () => {
    const cachedUser = { id: 'user-1', nickname: '缓存用户' };
    mockUserCacheGet.mockResolvedValue(cachedUser);

    const result = await userService.getUserById('user-1');

    expect(result).toEqual(cachedUser);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('缓存未命中时调用 fetchFn 查数据库', async () => {
    // 模拟 userCache.get 调用 fetchFn 的行为：缓存未命中时执行 fetchFn
    mockUserCacheGet.mockImplementation(async (_userId: string, fetchFn: () => Promise<unknown>) => {
      return fetchFn();
    });
    mockQuery.mockResolvedValue({
      rows: [{ id: 'user-1', phone: '13800000000', nickname: '张三' }],
    });

    const result = await userService.getUserById('user-1');

    expect(result.id).toBe('user-1');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // 他人查询 SQL 应只查公开字段（不含 credit_balance 等敏感字段）
    expect(mockQuery.mock.calls[0][0]).not.toContain('credit_balance');
  });

  it('用户不存在时 fetchFn 抛 NotFoundError', async () => {
    mockUserCacheGet.mockImplementation(async (_userId: string, fetchFn: () => Promise<unknown>) => {
      return fetchFn();
    });
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(userService.getUserById('nonexistent')).rejects.toThrow(NotFoundError);
  });
});

// ===================== getCreditHistory =====================
describe('user.service getCreditHistory', () => {
  it('正常分页返回，totalPages 向上取整', async () => {
    // count 查询返回 25 条，pageSize=10 → totalPages=3
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'tx-1', user_id: 'user-1', type: 'earn', amount: 10, balance_after: 110, reference_id: null, reference_type: null, description: null, created_at: new Date('2026-01-01') },
      ],
    });

    const result = await userService.getCreditHistory('user-1', 1, 10);

    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
    expect(result.list).toHaveLength(1);
    expect(result.list[0].userId).toBe('user-1');
  });

  it('空结果时 totalPages 为 0', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await userService.getCreditHistory('user-1', 1, 10);

    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.list).toEqual([]);
  });

  it('page=2 时 offset 透传为 pageSize', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '15' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await userService.getCreditHistory('user-1', 2, 10);

    // 第二次 query 是 list 查询，参数 [userId, pageSize, offset]
    const listCallParams = mockQuery.mock.calls[1][1];
    expect(listCallParams).toEqual(['user-1', 10, 10]);
  });
});

// ===================== getTimeHistory =====================
describe('user.service getTimeHistory', () => {
  it('正常分页返回，SQL 包含 time_earn/time_spend 过滤', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'tx-1', user_id: 'user-1', type: 'time_earn', amount: 60, balance_after: 360, reference_id: 'svc-1', reference_type: 'time_service', description: '服务报酬', created_at: new Date('2026-01-01') },
      ],
    });

    const result = await userService.getTimeHistory('user-1', 1, 10);

    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(1);
    expect(result.list[0].type).toBe('time_earn');
    // count 与 list 查询都应包含 time 类型过滤
    expect(mockQuery.mock.calls[0][0]).toContain("type IN ('time_earn', 'time_spend')");
    expect(mockQuery.mock.calls[1][0]).toContain("type IN ('time_earn', 'time_spend')");
  });

  it('空结果时返回空列表', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await userService.getTimeHistory('user-1', 1, 10);

    expect(result.list).toEqual([]);
    expect(result.totalPages).toBe(0);
  });

  it('page=3 时 offset 为 2 * pageSize', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '25' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await userService.getTimeHistory('user-1', 3, 10);

    const listCallParams = mockQuery.mock.calls[1][1];
    expect(listCallParams).toEqual(['user-1', 10, 20]);
  });
});

// ===================== submitVerification =====================
describe('user.service submitVerification', () => {
  it('身份证号格式错误（非18位）时抛 BadRequestError', async () => {
    await expect(
      userService.submitVerification('user-1', '张三', '1234567890'),
    ).rejects.toThrow(BadRequestError);
    // 格式校验失败不应查数据库
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('身份证号格式错误（错误月份）时抛 BadRequestError', async () => {
    await expect(
      userService.submitVerification('user-1', '张三', '110101199013011234'),
    ).rejects.toThrow(BadRequestError);
  });

  it('身份证号最后一位为 X 时格式合法（通过格式校验后命中状态校验）', async () => {
    // 设置用户已 approved，让校验在格式之后失败，验证格式校验通过
    mockQuery.mockResolvedValueOnce({ rows: [{ verify_status: 'approved' }] });

    // 格式合法时才会查数据库并命中 approved 校验，抛错信息应为"已完成实名认证"而非"格式不正确"
    await expect(
      userService.submitVerification('user-1', '张三', '11010119900101123X'),
    ).rejects.toThrow('已完成实名认证');
  });

  it('真实姓名长度小于 2 时抛 BadRequestError', async () => {
    await expect(
      userService.submitVerification('user-1', '张', '110101199001011234'),
    ).rejects.toThrow(BadRequestError);
  });

  it('真实姓名长度大于 100 时抛 BadRequestError', async () => {
    await expect(
      userService.submitVerification('user-1', '张'.repeat(101), '110101199001011234'),
    ).rejects.toThrow(BadRequestError);
  });

  it('用户不存在时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      userService.submitVerification('nonexistent', '张三', '110101199001011234'),
    ).rejects.toThrow(NotFoundError);
  });

  it('用户已 approved 时抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ verify_status: 'approved' }] });

    await expect(
      userService.submitVerification('user-1', '张三', '110101199001011234'),
    ).rejects.toThrow('已完成实名认证');
  });

  it('用户已 pending 时抛 BadRequestError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ verify_status: 'pending' }] });

    await expect(
      userService.submitVerification('user-1', '张三', '110101199001011234'),
    ).rejects.toThrow('正在审核中');
  });

  it('身份证号已被其他用户认证时抛 ConflictError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ verify_status: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'other-user' }] });

    await expect(
      userService.submitVerification('user-1', '张三', '110101199001011234'),
    ).rejects.toThrow(ConflictError);
    // 身份证号查重前应先计算哈希
    expect(mockHashIdCard).toHaveBeenCalledWith('110101199001011234');
  });

  it('正常提交时事务内创建认证申请并更新用户状态', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ verify_status: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 身份证号未被占用
    // transaction mock：执行回调并返回其结果
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    mockTransaction.mockImplementation(async (cb: (client: typeof mockClient) => Promise<unknown>) => {
      return cb(mockClient);
    });

    const result = await userService.submitVerification('user-1', '张三', '110101199001011234');

    expect(result.status).toBe('pending');
    // 事务内应执行 INSERT 认证申请 + UPDATE 用户状态
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    // INSERT 参数应包含加密后的身份证号与哈希
    const insertCall = mockClient.query.mock.calls[0];
    expect(insertCall[1]).toEqual(['user-1', '张三', 'mocked-id-card-encrypted', 'mocked-id-card-hash']);
    // 提交后清除用户缓存
    expect(mockUserCacheInvalidate).toHaveBeenCalledWith('user-1');
  });
});

// ===================== getVerificationStatus =====================
describe('user.service getVerificationStatus', () => {
  it('用户不存在时抛 NotFoundError', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await expect(userService.getVerificationStatus('nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('无认证记录时返回 verifyStatus 为 null 且 request 为 null', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        verify_status: null,
        verify_submitted_at: null,
        request_id: null,
        real_name: null,
        request_status: null,
        reject_reason: null,
        created_at: null,
        reviewed_at: null,
      }],
    });

    const result = await userService.getVerificationStatus('user-1');

    expect(result.verifyStatus).toBeNull();
    expect(result.submittedAt).toBeNull();
    expect(result.request).toBeNull();
  });

  it('有认证记录时返回完整的 request 对象', async () => {
    const submittedAt = new Date('2026-01-01');
    const createdAt = new Date('2026-01-01');
    const reviewedAt = new Date('2026-01-02');
    mockQuery.mockResolvedValue({
      rows: [{
        verify_status: 'approved',
        verify_submitted_at: submittedAt,
        request_id: 'req-1',
        real_name: '张三',
        request_status: 'approved',
        reject_reason: null,
        created_at: createdAt,
        reviewed_at: reviewedAt,
      }],
    });

    const result = await userService.getVerificationStatus('user-1');

    expect(result.verifyStatus).toBe('approved');
    expect(result.submittedAt).toEqual(submittedAt);
    expect(result.request).toEqual({
      id: 'req-1',
      realName: '张三',
      status: 'approved',
      rejectReason: null,
      createdAt,
      reviewedAt,
    });
  });

  it('被拒绝的认证记录返回 rejectReason', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        verify_status: 'rejected',
        verify_submitted_at: new Date('2026-01-01'),
        request_id: 'req-2',
        real_name: '李四',
        request_status: 'rejected',
        reject_reason: '证件模糊',
        created_at: new Date('2026-01-01'),
        reviewed_at: new Date('2026-01-02'),
      }],
    });

    const result = await userService.getVerificationStatus('user-1');

    expect(result.request?.rejectReason).toBe('证件模糊');
  });
});
