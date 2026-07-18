/**
 * auth.service 单元测试
 *
 * 测试目标：覆盖 toUserResponse / register / login / refreshToken / logout / forgotPassword / resetPassword
 * 测试策略：使用 vitest mock 替换 database、redis、auth middleware、tokenBlacklist、crypto、mask、bcryptjs、jsonwebtoken，
 *           避免触发真实 env 校验与 DB / Redis 连接，集中验证业务分支、加密/脱敏/校验逻辑。
 *           mock 路径相对测试文件解析（与 auth.service.ts 中相对路径解析为同一绝对模块）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryResultRow } from 'pg';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_PASSWORD = 'test-db-password';

// 使用 vi.hoisted 提前创建 mock 函数引用，确保 vi.mock 工厂（hoisted）内能访问
const {
  mockQuery,
  mockTransaction,
  mockRedisSetEx,
  mockRedisGet,
  mockRedisDel,
  mockGenerateAccessToken,
  mockGenerateRefreshToken,
  mockVerifyRefreshToken,
  mockAddToBlacklist,
  mockEncryptPhone,
  mockDecryptPhone,
  mockHashPhone,
  mockMaskPhone,
  mockBcryptHash,
  mockBcryptCompare,
  mockJwtDecode,
  mockLoggerInfo,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockTransaction: vi.fn(),
  mockRedisSetEx: vi.fn(),
  mockRedisGet: vi.fn(),
  mockRedisDel: vi.fn(),
  mockGenerateAccessToken: vi.fn(),
  mockGenerateRefreshToken: vi.fn(),
  mockVerifyRefreshToken: vi.fn(),
  mockAddToBlacklist: vi.fn(),
  mockEncryptPhone: vi.fn(),
  mockDecryptPhone: vi.fn(),
  mockHashPhone: vi.fn(),
  mockMaskPhone: vi.fn(),
  mockBcryptHash: vi.fn(),
  mockBcryptCompare: vi.fn(),
  mockJwtDecode: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

// mock database 模块：register 用 transaction，login/refresh/reset 等用 query
vi.mock('../../config/database', () => ({
  query: mockQuery,
  transaction: mockTransaction,
  pool: {},
}));

// mock redis 客户端：forgotPassword/resetPassword 依赖 setEx/get/del
vi.mock('../../config/redis', () => ({
  redisClient: {
    setEx: mockRedisSetEx,
    get: mockRedisGet,
    del: mockRedisDel,
  },
}));

// mock auth middleware：register/login/refresh 依赖 token 生成与校验
vi.mock('../../middleware/auth', () => ({
  generateAccessToken: mockGenerateAccessToken,
  generateRefreshToken: mockGenerateRefreshToken,
  verifyRefreshToken: mockVerifyRefreshToken,
}));

// mock tokenBlacklist：logout 依赖 addToBlacklist
vi.mock('../../utils/tokenBlacklist', () => ({
  tokenBlacklist: {
    addToBlacklist: mockAddToBlacklist,
  },
}));

// mock crypto：phone 字段加密 / 哈希，避免依赖 PII_ENCRYPT_KEY 环境变量
vi.mock('../../utils/crypto', () => ({
  encryptPhone: mockEncryptPhone,
  decryptPhone: mockDecryptPhone,
  hashPhone: mockHashPhone,
}));

// mock mask：避免依赖真实脱敏实现，断言调用入参即可
vi.mock('../../utils/mask', () => ({
  maskPhone: mockMaskPhone,
}));

// mock logger：捕获 info 调用参数，守护「日志不得记录明文验证码」安全不变式
vi.mock('../../utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// mock bcryptjs：避免 hash/compare 真实执行（耗时且依赖随机 salt）
// 设计原因：auth.service 已改为异步 bcrypt.hash/compare，mock 需返回 Promise
vi.mock('bcryptjs', () => ({
  default: {
    hash: mockBcryptHash,
    compare: mockBcryptCompare,
  },
}));

// mock jsonwebtoken：登出仅用 decode 获取 exp，不验证签名
vi.mock('jsonwebtoken', () => ({
  default: {
    decode: mockJwtDecode,
  },
}));

import { authService, toUserResponse } from '../auth.service';
import {
  UnauthorizedError,
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../../utils/errors';

// 测试用常量：集中定义避免散落各用例
const PHONE = '13812345678';
const ENCRYPTED_PHONE = 'encrypted-phone';
const PHONE_HASH = 'phone-hash';
const PASSWORD = 'password123';
const NICKNAME = 'test-user';
const PRIVACY_VERSION = 'v1.0';
const ACCESS_TOKEN = 'access-token';
const REFRESH_TOKEN = 'refresh-token';

// users 表行类型：与 auth.service.ts 中 UserRow 对齐，
// 继承 QueryResultRow 以兼容 pg 查询返回类型，并支持 overrides 展开任意字段
interface UserRow extends QueryResultRow {
  id: string;
  phone: string;
  nickname: string;
  avatar: string | null;
  credit_balance: number;
  time_balance: number;
  reputation_score: string | number;
  role: string | null;
  created_at: Date;
}

// 构造一个完整的 UserRow 测试数据，避免每个用例重复字段
function createMockUserRow(overrides: Record<string, unknown> = {}): UserRow {
  return {
    id: 'user-1',
    phone: ENCRYPTED_PHONE,
    nickname: NICKNAME,
    avatar: null,
    credit_balance: 100,
    time_balance: 50,
    reputation_score: '80',
    role: 'user',
    created_at: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  // 仅清空调用历史，保留默认 mockReturnValue（在下方统一设置）
  vi.clearAllMocks();
  // 默认返回值：每个测试依赖这些基础行为，单个用例可按需覆盖
  mockHashPhone.mockReturnValue(PHONE_HASH);
  mockEncryptPhone.mockReturnValue(ENCRYPTED_PHONE);
  mockDecryptPhone.mockReturnValue(PHONE);
  mockMaskPhone.mockReturnValue('138****5678');
  // 异步 mock：bcrypt.hash 返回 Promise，resolved 值为哈希字符串
  mockBcryptHash.mockResolvedValue('hashed-password');
  mockGenerateAccessToken.mockReturnValue(ACCESS_TOKEN);
  mockGenerateRefreshToken.mockReturnValue(REFRESH_TOKEN);
});

describe('auth.service - toUserResponse', () => {
  it('isSelf=true 时返回解密后的完整手机号', () => {
    const row = createMockUserRow();
    const result = toUserResponse(row, true);
    expect(result.phone).toBe(PHONE);
    // isSelf=true 不应调用 maskPhone（仅本人可见明文）
    expect(mockMaskPhone).not.toHaveBeenCalled();
  });

  it('isSelf=false 时返回脱敏后的手机号', () => {
    const row = createMockUserRow();
    const result = toUserResponse(row, false);
    expect(result.phone).toBe('138****5678');
    // isSelf=false 应调用 maskPhone，入参为解密后的明文
    expect(mockMaskPhone).toHaveBeenCalledWith(PHONE);
  });

  it('decryptPhone 失败时返回占位 "******"（历史数据未加密场景）', () => {
    // 模拟历史数据未加密导致解密异常
    mockDecryptPhone.mockImplementation(() => {
      throw new Error('密文格式错误');
    });
    const row = createMockUserRow();
    const result = toUserResponse(row, true);
    expect(result.phone).toBe('******');
  });

  it('reputation_score 为 string 时通过 Number() 转换为 number', () => {
    // pg 默认将 DECIMAL 解析为 string，序列化时需转 number 匹配 UserResponse 类型
    const row = createMockUserRow({ reputation_score: '95' });
    const result = toUserResponse(row, true);
    expect(result.reputationScore).toBe(95);
    expect(typeof result.reputationScore).toBe('number');
  });

  it('created_at 为 Date 时转为 ISO 字符串', () => {
    const date = new Date('2024-06-01T08:00:00Z');
    const row = createMockUserRow({ created_at: date });
    const result = toUserResponse(row, true);
    expect(result.createdAt).toBe(date.toISOString());
  });

  it('role 为 null 时默认 "user"', () => {
    const row = createMockUserRow({ role: null });
    const result = toUserResponse(row, true);
    expect(result.role).toBe('user');
  });
});

describe('auth.service - register', () => {
  it('注册成功：返回 token / refreshToken / user', async () => {
    // 第一次 query：手机号查重返回空
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // transaction 回调执行后返回 user 行
    const userRow = createMockUserRow();
    mockTransaction.mockImplementation(async (cb: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = {
        // 事务内 INSERT 用户 / INSERT 积分流水，仅第一次 RETURNING 需要返回 user
        query: vi.fn().mockResolvedValueOnce({ rows: [userRow] }).mockResolvedValueOnce({ rows: [] }),
      };
      return await cb(client);
    });

    const result = await authService.register(PHONE, PASSWORD, NICKNAME, PRIVACY_VERSION);

    expect(result.token).toBe(ACCESS_TOKEN);
    expect(result.refreshToken).toBe(REFRESH_TOKEN);
    expect(result.user.id).toBe('user-1');
    // 注册成功应基于用户 id 与 nickname 签发 JWT
    expect(mockGenerateAccessToken).toHaveBeenCalledWith({ id: 'user-1', nickname: NICKNAME });
    expect(mockGenerateRefreshToken).toHaveBeenCalledWith({ id: 'user-1', nickname: NICKNAME });
  });

  it('手机号格式错误时抛 BadRequestError', async () => {
    await expect(
      authService.register('12345', PASSWORD, NICKNAME, PRIVACY_VERSION),
    ).rejects.toBeInstanceOf(BadRequestError);
    // 校验失败不应查库
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('手机号已注册时抛 ConflictError', async () => {
    // 查重返回非空 → 已存在
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-user' }] });

    await expect(
      authService.register(PHONE, PASSWORD, NICKNAME, PRIVACY_VERSION),
    ).rejects.toBeInstanceOf(ConflictError);
    // 不应进入事务
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('transaction 回调被调用：事务内执行 INSERT 用户与 INSERT 积分流水', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const userRow = createMockUserRow();
    const clientQuerySpy = vi.fn();
    // 第一次：INSERT users RETURNING * 返回新建用户
    clientQuerySpy.mockResolvedValueOnce({ rows: [userRow] });
    // 第二次：INSERT credit_transactions 返回空
    clientQuerySpy.mockResolvedValueOnce({ rows: [] });

    mockTransaction.mockImplementation(async (cb: (client: { query: typeof clientQuerySpy }) => Promise<unknown>) => {
      return await cb({ query: clientQuerySpy });
    });

    await authService.register(PHONE, PASSWORD, NICKNAME, PRIVACY_VERSION);

    // transaction 应被调用一次
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // 事务内应执行两次 query：用户表 INSERT + 积分流水 INSERT
    expect(clientQuerySpy).toHaveBeenCalledTimes(2);
    expect(clientQuerySpy.mock.calls[0][0]).toContain('INSERT INTO users');
    expect(clientQuerySpy.mock.calls[1][0]).toContain('INSERT INTO credit_transactions');
  });

  // XSS 防护不变式：register 入库前应清洗 nickname 富文本字段
  // 设计原因：nickname 会在社区列表/详情/评论等多处前端场景渲染，未清洗将导致存储型 XSS；
  // 同时 JWT payload 内的 nickname 也应清洗，避免解码后被注入 XSS
  it('nickname 中的 XSS payload 应被清洗后再写入数据库与 JWT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const userRow = createMockUserRow();
    const clientQuerySpy = vi.fn();
    clientQuerySpy.mockResolvedValueOnce({ rows: [userRow] });
    clientQuerySpy.mockResolvedValueOnce({ rows: [] });

    mockTransaction.mockImplementation(async (cb: (client: { query: typeof clientQuerySpy }) => Promise<unknown>) => {
      return await cb({ query: clientQuerySpy });
    });

    const xssPayload = '<script>alert("xss")</script>用户';
    await authService.register(PHONE, PASSWORD, xssPayload, PRIVACY_VERSION);

    // 第1次事务内 query：INSERT INTO users，参数第4位为 nickname
    const insertCall = clientQuerySpy.mock.calls[0];
    const insertParams = insertCall[1] as unknown[];
    const nicknameParam = insertParams[3];
    expect(nicknameParam).not.toContain('<script>');
    expect(nicknameParam).not.toContain('</script>');

    // JWT 签发时 nickname 也应是清洗后的值
    expect(mockGenerateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
    );
    const jwtCallArgs = mockGenerateAccessToken.mock.calls[0][0] as { nickname?: string };
    expect(typeof jwtCallArgs.nickname === 'string').toBe(true);
    if (typeof jwtCallArgs.nickname === 'string') {
      expect(jwtCallArgs.nickname).not.toContain('<script>');
      expect(jwtCallArgs.nickname).not.toContain('</script>');
    }
  });
});

describe('auth.service - login', () => {
  it('登录成功：返回 token / refreshToken / user', async () => {
    const userRow = createMockUserRow({ password_hash: 'hashed-password' });
    mockQuery.mockResolvedValueOnce({ rows: [userRow] });
    // 密码校验通过（异步 compare 返回 Promise<true>）
    mockBcryptCompare.mockResolvedValue(true);

    const result = await authService.login(PHONE, PASSWORD);

    expect(result.token).toBe(ACCESS_TOKEN);
    expect(result.refreshToken).toBe(REFRESH_TOKEN);
    expect(result.user.id).toBe('user-1');
    // login 应按 phone_hash 查询
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM users WHERE phone_hash = $1'),
      [PHONE_HASH],
    );
  });

  it('用户不存在时抛 UnauthorizedError', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(authService.login(PHONE, PASSWORD)).rejects.toBeInstanceOf(UnauthorizedError);
    // 用户不存在时不应执行密码校验
    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  it('密码错误时抛 UnauthorizedError', async () => {
    const userRow = createMockUserRow({ password_hash: 'hashed-password' });
    mockQuery.mockResolvedValueOnce({ rows: [userRow] });
    // 密码校验失败（异步 compare 返回 Promise<false>）
    mockBcryptCompare.mockResolvedValue(false);

    await expect(authService.login(PHONE, PASSWORD)).rejects.toBeInstanceOf(UnauthorizedError);
    // 密码错误不应签发 token
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });
});

describe('auth.service - refreshToken', () => {
  it('刷新成功：返回新 token / refreshToken', async () => {
    mockVerifyRefreshToken.mockReturnValue({ id: 'user-1', nickname: NICKNAME });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1', nickname: NICKNAME }] });

    const result = await authService.refreshToken(REFRESH_TOKEN);

    expect(result.token).toBe(ACCESS_TOKEN);
    expect(result.refreshToken).toBe(REFRESH_TOKEN);
    expect(mockGenerateAccessToken).toHaveBeenCalledWith({ id: 'user-1', nickname: NICKNAME });
  });

  it('token 无效时抛 UnauthorizedError', async () => {
    // verifyRefreshToken 抛错时，service 应转为 UnauthorizedError
    mockVerifyRefreshToken.mockImplementation(() => {
      throw new Error('invalid token');
    });

    await expect(authService.refreshToken('bad-token')).rejects.toBeInstanceOf(UnauthorizedError);
    // token 无效不应查库
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('用户不存在时抛 UnauthorizedError', async () => {
    mockVerifyRefreshToken.mockReturnValue({ id: 'user-1', nickname: NICKNAME });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(authService.refreshToken(REFRESH_TOKEN)).rejects.toBeInstanceOf(UnauthorizedError);
    // 不应签发新 token
    expect(mockGenerateAccessToken).not.toHaveBeenCalled();
  });
});

describe('auth.service - logout', () => {
  it('成功登出：调用 addToBlacklist 写入黑名单', async () => {
    // jwt.decode 返回带 exp 的 payload（未来时间戳）
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    mockJwtDecode.mockReturnValue({ exp: futureExp });

    await authService.logout('valid-token');

    expect(mockJwtDecode).toHaveBeenCalledWith('valid-token');
    expect(mockAddToBlacklist).toHaveBeenCalledWith('valid-token', futureExp);
  });

  it('token 无 exp 时不调用 addToBlacklist', async () => {
    // jwt.decode 返回不含 exp 的 payload
    mockJwtDecode.mockReturnValue({ sub: 'user-1' });

    await authService.logout('no-exp-token');

    expect(mockAddToBlacklist).not.toHaveBeenCalled();
  });

  it('jwt.decode 返回 null 时不调用 addToBlacklist', async () => {
    // 无效 token 解码返回 null
    mockJwtDecode.mockReturnValue(null);

    await authService.logout('invalid-token');

    expect(mockAddToBlacklist).not.toHaveBeenCalled();
  });
});

describe('auth.service - forgotPassword', () => {
  it('用户存在时生成验证码并存入 Redis', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] });
    mockRedisSetEx.mockResolvedValue(undefined);

    await authService.forgotPassword(PHONE);

    // 应按 phone_hash 查询用户
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id FROM users WHERE phone_hash = $1'),
      [PHONE_HASH],
    );
    // 应调用 setEx 存储验证码，TTL 为 300 秒（5 分钟有效期）
    expect(mockRedisSetEx).toHaveBeenCalledTimes(1);
    const setExArgs = mockRedisSetEx.mock.calls[0];
    expect(setExArgs[0]).toBe(`verify:reset:${PHONE_HASH}`);
    expect(setExArgs[1]).toBe(300);
    // 验证码应为 6 位数字字符串
    expect(setExArgs[2]).toMatch(/^\d{6}$/);
  });

  it('用户不存在时不抛错但不调用 setEx', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // 安全考虑：不暴露用户是否存在，函数应正常返回 undefined
    await expect(authService.forgotPassword(PHONE)).resolves.toBeUndefined();
    // 未发验证码
    expect(mockRedisSetEx).not.toHaveBeenCalled();
  });

  it('手机号格式错误时抛 BadRequestError', async () => {
    await expect(authService.forgotPassword('12345')).rejects.toBeInstanceOf(BadRequestError);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('安全不变式：日志中不得记录明文验证码（防止日志泄露后被冒用重置密码）', async () => {
    // 用户存在场景：会生成验证码并写 Redis，但日志不应包含明文 code
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] });
    mockRedisSetEx.mockResolvedValue(undefined);

    await authService.forgotPassword(PHONE);

    // 断言 logger.info 被调用至少一次（用户存在分支）
    expect(mockLoggerInfo).toHaveBeenCalled();
    // 遍历所有 info 调用的入参，确保均不含 code 字段
    for (const callArgs of mockLoggerInfo.mock.calls) {
      const logPayload = callArgs[0] as Record<string, unknown> | undefined;
      if (logPayload && typeof logPayload === 'object') {
        expect(logPayload).not.toHaveProperty('code');
      }
    }
  });

  it('安全不变式：用户不存在分支日志也不得记录明文验证码', async () => {
    // 用户不存在分支：函数提前 return，但仍会调用 logger.info
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await authService.forgotPassword(PHONE);

    expect(mockLoggerInfo).toHaveBeenCalled();
    for (const callArgs of mockLoggerInfo.mock.calls) {
      const logPayload = callArgs[0] as Record<string, unknown> | undefined;
      if (logPayload && typeof logPayload === 'object') {
        expect(logPayload).not.toHaveProperty('code');
      }
    }
  });
});

describe('auth.service - resetPassword', () => {
  it('重置成功：更新密码并删除验证码', async () => {
    mockRedisGet.mockResolvedValueOnce('123456');
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] }); // 查询用户存在
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 更新密码
    mockRedisDel.mockResolvedValueOnce(undefined);

    await authService.resetPassword(PHONE, '123456', 'newpass123');

    // 应校验验证码
    expect(mockRedisGet).toHaveBeenCalledWith(`verify:reset:${PHONE_HASH}`);
    // 应执行两次 query：SELECT 用户 + UPDATE 密码
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toContain('UPDATE users SET password_hash');
    // 应删除验证码，防止重复使用
    expect(mockRedisDel).toHaveBeenCalledWith(`verify:reset:${PHONE_HASH}`);
  });

  it('验证码错误时抛 BadRequestError', async () => {
    mockRedisGet.mockResolvedValueOnce('123456');

    await expect(
      authService.resetPassword(PHONE, 'wrong-code', 'newpass123'),
    ).rejects.toBeInstanceOf(BadRequestError);
    // 验证码错误不应执行更新或删除
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it('验证码过期时抛 BadRequestError', async () => {
    // redis 返回 null 表示验证码已过期或未发送
    mockRedisGet.mockResolvedValueOnce(null);

    await expect(
      authService.resetPassword(PHONE, '123456', 'newpass123'),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('手机号格式错误时抛 BadRequestError', async () => {
    await expect(
      authService.resetPassword('12345', '123456', 'newpass123'),
    ).rejects.toBeInstanceOf(BadRequestError);
    // 校验失败不应读 Redis
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('密码太短时抛 BadRequestError', async () => {
    await expect(
      authService.resetPassword(PHONE, '123456', '12345'),
    ).rejects.toBeInstanceOf(BadRequestError);
    // 密码校验在验证码校验之前，不应读 Redis
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('用户不存在时抛 NotFoundError', async () => {
    mockRedisGet.mockResolvedValueOnce('123456');
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await expect(
      authService.resetPassword(PHONE, '123456', 'newpass123'),
    ).rejects.toBeInstanceOf(NotFoundError);
    // 只执行了 SELECT，未执行 UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(1);
    // 用户不存在时不应删除验证码（避免验证码被恶意消耗）
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});
