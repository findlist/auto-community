/**
 * 审计日志中间件单元测试
 *
 * 测试目标：auditMiddleware 包装 res.send 捕获响应、脱敏请求体、异步写审计日志
 * 测试策略：mock audit.service 的 writeAuditLog 与 logger，通过断言 writeAuditLog 入参验证
 *           敏感字段脱敏、错误信息提取、动态 action、资源 ID 提取等逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// mock 审计服务：捕获 writeAuditLog 调用参数，默认 resolve 不抛错
vi.mock('../../services/audit.service', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

// mock logger：避免真实日志输出，验证 catch 吞错分支
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { auditMiddleware } from '../auditLog';
import { writeAuditLog } from '../../services/audit.service';
import { logger } from '../../utils/logger';

const mockedWriteAuditLog = vi.mocked(writeAuditLog);
const mockedLoggerError = vi.mocked(logger.error);

// 构造 mock 请求：含 user/ip/socket/get/body，部分字段可覆盖
// overrides 用 Record<string, unknown>：socket/user 等字段的 mock 结构无法满足完整类型（Socket 等），放宽入参避免调用侧类型冲突
function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    user: { id: 42 },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get: vi.fn().mockReturnValue('Mozilla/5.0'),
    body: { username: 'test', password: 'secret123' },
    ...overrides,
  } as unknown as Request;
}

// 构造 mock 响应：statusCode 可配置，send 为可覆盖的 mock
function createMockRes(statusCode = 200): Response {
  const res = {
    statusCode,
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedWriteAuditLog.mockResolvedValue(undefined);
});

describe('auditMiddleware - 基本行为', () => {
  it('应返回 RequestHandler 函数', () => {
    const handler = auditMiddleware('LOGIN');
    expect(typeof handler).toBe('function');
  });

  it('应调用 next() 放行请求', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    auditMiddleware('LOGIN')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('成功响应（statusCode<400）应异步写入 status=success 的审计日志', async () => {
    const req = createMockReq();
    const res = createMockRes(200);
    const next = vi.fn() as unknown as NextFunction;

    const handler = auditMiddleware('LOGIN');
    handler(req, res, next);
    // 触发被覆盖的 res.send，捕获响应内容
    (res.send as unknown as (b?: unknown) => unknown)({ code: 'SUCCESS' });

    expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1);
    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params).toMatchObject({
      action: 'LOGIN',
      userId: 42,
      status: 'success',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    });
    expect(params.errorMessage).toBeUndefined();
  });

  it('失败响应（statusCode>=400）应写入 status=failed 并提取 errorMessage', async () => {
    const req = createMockReq();
    const res = createMockRes(401);
    const next = vi.fn() as unknown as NextFunction;

    auditMiddleware('LOGIN')(req, res, next);
    // 响应体为 JSON 字符串，含 message 字段
    (res.send as unknown as (b?: unknown) => unknown)(JSON.stringify({ message: '密码错误' }));

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.status).toBe('failed');
    expect(params.errorMessage).toBe('密码错误');
  });
});

describe('auditMiddleware - 敏感字段脱敏', () => {
  it('password 字段值应替换为 ***（保留字段名）', async () => {
    const req = createMockReq({ body: { username: 'test', password: 'secret123' } });
    const res = createMockRes(200);

    auditMiddleware('LOGIN')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.requestBody).toEqual({ username: 'test', password: '***' });
  });

  it('phone 字段应脱敏（不区分大小写匹配）', async () => {
    const req = createMockReq({ body: { Phone: '13812345678', name: '张三' } });
    const res = createMockRes(200);

    auditMiddleware('UPDATE')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.requestBody).toEqual({ Phone: '***', name: '张三' });
  });

  it('无可脱敏字段的请求体（null/基本类型数组）应原样透传', async () => {
    // null
    const req1 = createMockReq({ body: null });
    const res1 = createMockRes(200);
    auditMiddleware('A')(req1, res1, vi.fn());
    (res1.send as unknown as (b?: unknown) => unknown)('ok');
    expect(mockedWriteAuditLog.mock.calls[0][0].requestBody).toBeNull();

    // 基本类型数组：元素全为数字，无可脱敏字段，递归后结构不变
    mockedWriteAuditLog.mockClear();
    const req2 = createMockReq({ body: [1, 2, 3] });
    const res2 = createMockRes(200);
    auditMiddleware('A')(req2, res2, vi.fn());
    (res2.send as unknown as (b?: unknown) => unknown)('ok');
    expect(mockedWriteAuditLog.mock.calls[0][0].requestBody).toEqual([1, 2, 3]);
  });

  it('嵌套对象内层敏感字段应递归脱敏（防止 PII 经嵌套结构泄露）', async () => {
    // 构造 { user: { phone, password }, meta: { token } } 嵌套结构
    // 设计原因：早期实现仅顶层脱敏，嵌套字段会原样写入审计日志
    const req = createMockReq({
      body: {
        user: { phone: '13812345678', password: 'secret' },
        meta: { token: 'tk-123', trace: 'abc' },
      },
    });
    const res = createMockRes(200);

    auditMiddleware('UPDATE')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.requestBody).toEqual({
      user: { phone: '***', password: '***' },
      meta: { token: '***', trace: 'abc' },
    });
  });

  it('数组内嵌套对象的敏感字段也应递归脱敏', async () => {
    // 构造 { users: [{ phone, name }, { password, name }] } 结构
    // 设计原因：sanitizeRequestBody 对数组直接返回原值，但数组元素若是对象则需递归处理
    const req = createMockReq({
      body: {
        users: [
          { phone: '13812345678', name: '张三' },
          { password: 'pwd', name: '李四' },
        ],
      },
    });
    const res = createMockRes(200);

    auditMiddleware('BATCH')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.requestBody).toEqual({
      users: [
        { phone: '***', name: '张三' },
        { password: '***', name: '李四' },
      ],
    });
  });

  it('超过最大递归深度（5）的对象应整体脱敏为 ***（防止恶意构造超深嵌套导致栈溢出）', async () => {
    // 构造深度为 6 的嵌套对象，第 6 层应直接脱敏为 ***
    // 深度 1: { a: { ... } }
    // 深度 2: { a: { b: { ... } } }
    // ...
    // 深度 6: 应被替换为 ***
    const deepBody = {
      l1: {
        l2: {
          l3: {
            l4: {
              l5: {
                l6: { password: 'should-be-masked' },
              },
            },
          },
        },
      },
    };
    const req = createMockReq({ body: deepBody });
    const res = createMockRes(200);

    auditMiddleware('NESTED')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    // 深度 5 的 l5 对象会被处理，但其值 l6（深度 6）应被整体脱敏为 ***
    expect(params.requestBody).toEqual({
      l1: { l2: { l3: { l4: { l5: '***' } } } },
    });
  });

  it('字段名变体应被子串匹配命中（phoneNumber/user_phone/idCardNumber/accessToken/sessionId 等）', async () => {
    // 设计原因：原 SENSITIVE_FIELDS 精确匹配，无法覆盖字段名变体；
    // 改用子串匹配后，以下变体均应被脱敏，防止 PII 经字段名变体泄露
    const req = createMockReq({
      body: {
        phoneNumber: '13812345678',     // 包含 phone
        user_phone: '13900000000',      // 包含 phone
        mobileNumber: '13700000000',    // 包含 mobile
        idCardNumber: '110101199001011234', // toLowerCase 后包含 idcard
        id_card_number: '110101199001011235', // 包含 id_card
        accessToken: 'at-xxx',          // 包含 token
        refreshToken: 'rt-yyy',         // 包含 token
        csrf_token: 'csrf-zzz',         // 包含 token
        clientSecret: 'cs-aaa',         // 包含 secret
        apiKey: 'ak-bbb',               // toLowerCase 后包含 apikey
        api_key: 'ak-ccc',              // 包含 api_key
        sessionId: 'sid-ddd',           // 包含 session
        // 非敏感字段应原样保留
        username: 'test',
        orderId: 'order-1',
      },
    });
    const res = createMockRes(200);

    auditMiddleware('SENSITIVE')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.requestBody).toEqual({
      phoneNumber: '***',
      user_phone: '***',
      mobileNumber: '***',
      idCardNumber: '***',
      id_card_number: '***',
      accessToken: '***',
      refreshToken: '***',
      csrf_token: '***',
      clientSecret: '***',
      apiKey: '***',
      api_key: '***',
      sessionId: '***',
      username: 'test',
      orderId: 'order-1',
    });
  });

  it('非敏感字段不应被子串匹配误伤（如 orderId/nickname/userAgent 等）', async () => {
    // 设计原因：子串匹配存在误伤风险，需验证常见非敏感字段不会被错误脱敏
    const req = createMockReq({
      body: {
        orderId: 'order-1',
        nickname: '张三',
        userAgent: 'Mozilla/5.0',
        description: '订单描述',
        category: 'food',
      },
    });
    const res = createMockRes(200);

    auditMiddleware('SAFE')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.requestBody).toEqual({
      orderId: 'order-1',
      nickname: '张三',
      userAgent: 'Mozilla/5.0',
      description: '订单描述',
      category: 'food',
    });
  });
});

describe('auditMiddleware - 错误信息提取', () => {
  it('响应体为对象时取 message 字段', async () => {
    const req = createMockReq();
    const res = createMockRes(500);
    auditMiddleware('A')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ message: '服务器内部错误' });
    expect(mockedWriteAuditLog.mock.calls[0][0].errorMessage).toBe('服务器内部错误');
  });

  it('响应体为对象时取 error 字段（message 不存在）', async () => {
    const req = createMockReq();
    const res = createMockRes(500);
    auditMiddleware('A')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ error: 'DB down' });
    expect(mockedWriteAuditLog.mock.calls[0][0].errorMessage).toBe('DB down');
  });

  it('响应体为非 JSON 字符串应截取前 500 字符作为 errorMessage', async () => {
    const req = createMockReq();
    const res = createMockRes(500);
    auditMiddleware('A')(req, res, vi.fn());
    // 非 JSON 字符串，JSON.parse 抛错走 catch 分支
    (res.send as unknown as (b?: unknown) => unknown)('plain error text');
    expect(mockedWriteAuditLog.mock.calls[0][0].errorMessage).toBe('plain error text');
  });

  it('成功响应不应提取 errorMessage', async () => {
    const req = createMockReq();
    const res = createMockRes(200);
    auditMiddleware('A')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ message: 'ok' });
    expect(mockedWriteAuditLog.mock.calls[0][0].errorMessage).toBeUndefined();
  });
});

describe('auditMiddleware - options 配置', () => {
  it('getAction 动态生成 action 名称', async () => {
    const req = createMockReq({ body: { type: 'transfer' } });
    const res = createMockRes(200);
    const getAction = vi.fn().mockReturnValue('TRANSFER');

    auditMiddleware('DEFAULT', { getAction })(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    expect(getAction).toHaveBeenCalledWith(req);
    expect(mockedWriteAuditLog.mock.calls[0][0].action).toBe('TRANSFER');
  });

  it('resourceType 与 getResourceId 应透传到审计参数', async () => {
    const req = createMockReq({ params: { id: 'order-99' } });
    const res = createMockRes(200);
    const getResourceId = vi.fn().mockReturnValue('order-99');

    auditMiddleware('CREATE_ORDER', { resourceType: 'order', getResourceId })(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.resourceType).toBe('order');
    expect(params.resourceId).toBe('order-99');
  });

  it('未提供 options 时 resourceType/resourceId 应为 undefined', async () => {
    const req = createMockReq();
    const res = createMockRes(200);

    auditMiddleware('LOGIN')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    const params = mockedWriteAuditLog.mock.calls[0][0];
    expect(params.resourceType).toBeUndefined();
    expect(params.resourceId).toBeUndefined();
  });
});

describe('auditMiddleware - 异常容错', () => {
  it('writeAuditLog reject 时应记录 logger.error 且不抛出', async () => {
    mockedWriteAuditLog.mockRejectedValueOnce(new Error('DB connection lost'));
    const req = createMockReq();
    const res = createMockRes(200);

    auditMiddleware('LOGIN')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    // 等待 Promise.catch 微任务执行
    await new Promise(resolve => setImmediate(resolve));
    expect(mockedLoggerError).toHaveBeenCalledTimes(1);
  });

  it('req.ip 缺失时应回退到 req.socket.remoteAddress', async () => {
    const req = createMockReq({ ip: undefined, socket: { remoteAddress: '10.0.0.1' } });
    const res = createMockRes(200);

    auditMiddleware('A')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    expect(mockedWriteAuditLog.mock.calls[0][0].ip).toBe('10.0.0.1');
  });

  it('req.user 缺失时 userId 应为 undefined', async () => {
    const req = createMockReq({ user: undefined });
    const res = createMockRes(200);

    auditMiddleware('A')(req, res, vi.fn());
    (res.send as unknown as (b?: unknown) => unknown)({ ok: true });

    expect(mockedWriteAuditLog.mock.calls[0][0].userId).toBeUndefined();
  });
});
