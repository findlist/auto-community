/**
 * auth 相关单元测试
 *
 * 测试目标：
 * - authenticate 中间件：权限校验（无 token / 格式错误 / 无效 / 黑名单 / 用户禁用 / 正常）
 * - requireRole 中间件：角色校验（未登录 / 用户不存在 / 角色不匹配 / 通过）
 * - tokenBlacklist：Redis 化的黑名单写入与查询（Task 10 改造）
 * - authService.logout：登出时写入黑名单
 *
 * 测试策略：mock database 与 redis 模块，避免依赖真实 DB/Redis。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

// 设置必需的环境变量，避免 env 模块加载时退出进程
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-test';
process.env.DB_PASSWORD = 'test-db-password';

// mock database 模块
vi.mock('../../config/database', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  pool: {},
}));

// mock redis 模块：使用 vi.hoisted 确保 mock 对象在 vi.mock 工厂执行前已初始化
// vi.mock 调用会被提升到文件顶部，普通变量无法在工厂函数中引用
const { mockRedisClient } = vi.hoisted(() => ({
  mockRedisClient: {
    get: vi.fn(),
    setEx: vi.fn(),
    del: vi.fn(),
    quit: vi.fn(),
    connect: vi.fn(),
    on: vi.fn(),
  },
}));
vi.mock('../../config/redis', () => ({
  redisClient: mockRedisClient,
  connectRedis: vi.fn(),
  disconnectRedis: vi.fn(),
}));

import { authenticate, requireRole, generateAccessToken } from '../auth';
import { query } from '../../config/database';
import { tokenBlacklist } from '../../utils/tokenBlacklist';
import { UnauthorizedError, ForbiddenError } from '../../utils/errors';
import { env } from '../../config/env';

const mockedQuery = vi.mocked(query);

// 局部类型别名：避免每个 mock 调用处重复书写冗长的泛型
// 设计原因：query 返回 Promise<QueryResult<QueryResultRow>>，测试 mock 只需提供 rows，
// 用 as unknown as DbResult 替代 as any 以消除 no-explicit-any warning
type DbResult = Awaited<ReturnType<typeof query>>;

// 构造 Express 请求/响应/next 的辅助函数
function createReqRes(authHeader?: string) {
  const req = {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
  const res = {} as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

// 提取 next 被调用时传入的错误对象
// 设计原因：vi.mocked(next).mock.calls[0][0] 的类型为 NextFunction 参数类型，
// Express NextFunction 签名包含 next('route') 路由跳转字面量，类型推断为 "route"，
// 需断言为 Error 才能访问 .message 属性。此处集中断言避免每处重复书写
function getNextError(next: NextFunction): Error {
  return vi.mocked(next).mock.calls[0][0] as unknown as Error;
}

// 生成一个有效的 JWT（用于测试通过场景）
function makeValidToken(payload: { id: string; nickname: string }): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '1h' });
}

beforeEach(() => {
  // 使用 resetAllMocks 彻底清除 mock 调用记录与实现（含 mockResolvedValueOnce 队列），
  // 避免上一个测试中未被消耗的 mockResolvedValueOnce 残留到下一个测试
  vi.resetAllMocks();
  // 默认 redis get 返回 null（token 不在黑名单）
  mockRedisClient.get.mockResolvedValue(null);
});

describe('authenticate 中间件 - 权限校验', () => {
  it('未提供 Authorization header 应调用 next(UnauthorizedError)', async () => {
    const { req, res, next } = createReqRes();
    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('未提供认证令牌');
  });

  it('Authorization 格式错误（非 Bearer）应调用 next(UnauthorizedError)', async () => {
    const { req, res, next } = createReqRes('Basic abc123');
    await authenticate(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('认证令牌格式错误');
  });

  it('Bearer 后 token 为空应调用 next(UnauthorizedError)', async () => {
    const { req, res, next } = createReqRes('Bearer ');
    await authenticate(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('认证令牌为空');
  });

  it('无效 token 应调用 next(UnauthorizedError)', async () => {
    const { req, res, next } = createReqRes('Bearer invalid.token.here');
    await authenticate(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('无效的认证令牌');
  });

  it('token 在黑名单中应调用 next(UnauthorizedError)', async () => {
    const token = makeValidToken({ id: 'user-1', nickname: 'tester' });
    // 模拟 Redis 中存在该 token 的黑名单记录
    // 黑名单检查在 query 用户状态之前执行，命中后直接抛错，不会调用 query
    mockRedisClient.get.mockResolvedValueOnce('1');

    const { req, res, next } = createReqRes(`Bearer ${token}`);
    await authenticate(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('认证令牌已失效');
  });

  it('用户被禁用（status !== active）应调用 next(UnauthorizedError)', async () => {
    const token = makeValidToken({ id: 'user-1', nickname: 'tester' });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ deleted_at: null, status: 'disabled' }],
    } as unknown as DbResult);

    const { req, res, next } = createReqRes(`Bearer ${token}`);
    await authenticate(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('用户账号已被禁用或删除');
  });

  it('用户被软删除（deleted_at !== null）应调用 next(UnauthorizedError)', async () => {
    const token = makeValidToken({ id: 'user-1', nickname: 'tester' });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ deleted_at: new Date(), status: 'active' }],
    } as unknown as DbResult);

    const { req, res, next } = createReqRes(`Bearer ${token}`);
    await authenticate(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('用户账号已被禁用或删除');
  });

  it('用户不存在（rows 为空）应调用 next(UnauthorizedError)', async () => {
    const token = makeValidToken({ id: 'user-1', nickname: 'tester' });
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const { req, res, next } = createReqRes(`Bearer ${token}`);
    await authenticate(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('用户账号已被禁用或删除');
  });

  it('有效 token 且用户状态正常应调用 next（无错误）并填充 req.user', async () => {
    const token = makeValidToken({ id: 'user-1', nickname: 'tester' });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ deleted_at: null, status: 'active' }],
    } as unknown as DbResult);

    const { req, res, next } = createReqRes(`Bearer ${token}`);
    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toBeDefined();
    expect(req.user!.id).toBe('user-1');
    expect(req.user!.nickname).toBe('tester');
  });
});

describe('requireRole 中间件 - 角色校验', () => {
  it('未登录（req.user 为空）应调用 next(UnauthorizedError)', async () => {
    const { req, res, next } = createReqRes();
    const middleware = requireRole('admin');
    await middleware(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('未登录');
  });

  it('用户不存在应调用 next(UnauthorizedError)', async () => {
    const { req, res, next } = createReqRes();
    req.user = { id: 'user-1', nickname: 'tester' };
    mockedQuery.mockResolvedValueOnce({ rows: [] } as unknown as DbResult);

    const middleware = requireRole('admin');
    await middleware(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('用户不存在');
  });

  it('角色不匹配应调用 next(ForbiddenError)', async () => {
    const { req, res, next } = createReqRes();
    req.user = { id: 'user-1', nickname: 'tester' };
    mockedQuery.mockResolvedValueOnce({ rows: [{ role: 'user' }] } as unknown as DbResult);

    const middleware = requireRole('admin');
    await middleware(req, res, next);

    const err = getNextError(next);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('权限不足');
  });

  it('角色匹配应调用 next（无错误）', async () => {
    const { req, res, next } = createReqRes();
    req.user = { id: 'user-1', nickname: 'tester' };
    mockedQuery.mockResolvedValueOnce({ rows: [{ role: 'admin' }] } as unknown as DbResult);

    const middleware = requireRole('admin', 'super_admin');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// 守护 algorithms 显式锁定：构造 HS384 签名的 token，authenticate 必须拒绝
// 设计原因：jsonwebtoken 默认虽阻 alg:none，但显式锁定 HS256 后，HS384/HS512/RS256 等其他算法必须被拒
describe('authenticate - algorithms 显式锁定 HS256', () => {
  it('HS384 签名的 token 应被拒绝（algorithms 锁定生效）', async () => {
    // 构造 HS384 签名的 token：同密钥但不同算法
    const hs384Token = jwt.sign(
      { id: 'user-1', nickname: 'tester' },
      env.JWT_SECRET,
      { algorithm: 'HS384', expiresIn: '1h' }
    );
    const { req, res, next } = createReqRes(`Bearer ${hs384Token}`);

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('无效的认证令牌');
  });

  it('alg:none 的 token 应被拒绝（algorithms 锁定生效）', async () => {
    // 构造 alg:none 的 token：jsonwebtoken 不允许直接 sign none，用 decode + 重组方式构造
    // 这里直接用一个无效 alg 的 header + 空签名，模拟 alg:none 攻击载荷
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 'user-1', nickname: 'tester' })).toString('base64url');
    const noneToken = `${header}.${payload}.`;
    const { req, res, next } = createReqRes(`Bearer ${noneToken}`);

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = getNextError(next);
    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(err.message).toBe('无效的认证令牌');
  });
});

describe('tokenBlacklist - Redis 化黑名单（Task 10）', () => {
  it('addToBlacklist 应调用 redisClient.setEx 写入并设置 TTL', async () => {
    const token = 'token-abc';
    // exp 设为当前时间 + 60 秒
    const exp = Math.floor(Date.now() / 1000) + 60;
    await tokenBlacklist.addToBlacklist(token, exp);

    // 应使用 setEx 写入，key 为 blacklist:token:{token}
    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      `blacklist:token:${token}`,
      expect.any(Number),
      '1',
    );
    // TTL 应接近 60 秒（允许 1 秒误差）
    const ttl = mockRedisClient.setEx.mock.calls[0][1];
    expect(ttl).toBeGreaterThan(58);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('exp 已过期的 token 应跳过写入（不调用 setEx）', async () => {
    const token = 'token-expired';
    const exp = Math.floor(Date.now() / 1000) - 10; // 已过期 10 秒
    await tokenBlacklist.addToBlacklist(token, exp);

    expect(mockRedisClient.setEx).not.toHaveBeenCalled();
  });

  it('isBlacklisted 命中（Redis 返回非 null）应返回 true', async () => {
    mockRedisClient.get.mockResolvedValueOnce('1');
    const result = await tokenBlacklist.isBlacklisted('token-blacklisted');
    expect(result).toBe(true);
    expect(mockRedisClient.get).toHaveBeenCalledWith('blacklist:token:token-blacklisted');
  });

  it('isBlacklisted 未命中（Redis 返回 null）应返回 false', async () => {
    mockRedisClient.get.mockResolvedValueOnce(null);
    const result = await tokenBlacklist.isBlacklisted('token-not-in-list');
    expect(result).toBe(false);
  });
});

describe('generateAccessToken - JWT 生成', () => {
  it('应生成包含 payload 的有效 JWT', () => {
    const token = generateAccessToken({ id: 'user-1', nickname: 'tester' });
    const decoded = jwt.verify(token, env.JWT_SECRET) as unknown as jwt.JwtPayload;
    expect(decoded.id).toBe('user-1');
    expect(decoded.nickname).toBe('tester');
    // 应包含 exp 字段
    expect(decoded.exp).toBeDefined();
  });
});
