/**
 * utils/safeNotify 安全通知工具单元测试
 *
 * 测试目标：守护 safeNotify 的核心契约——吞错不阻塞主流程 + 记录 warn 日志
 * - 成功路径：不记录任何日志，避免成功通知产生噪音
 * - 失败路径：记录 warn 日志，包含原始错误与上下文，便于告警系统采集
 * - fire-and-forget：函数立即返回 void，不等待 promise settle，不抛出异常
 *
 * 设计原因：safeNotify 已被 10 个文件（5 个 service + 3 个 routes + notification.service）
 * 用于收口通知类异步操作的错误处理，替换了 26+ 处 .catch(() => {}) 静默吞错。
 * 若实现有 bug（如忘记 catch、日志缺失、抛出异常），所有通知错误路径会受影响，
 * 严重时可能导致 unhandled rejection 进程崩溃
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 在导入 safeNotify 前 mock logger，确保能捕获 warn 调用
vi.mock('../logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from '../logger';
import { safeNotify } from '../safeNotify';

describe('utils/safeNotify - 成功路径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功 resolve 时不应记录 warn 日志', async () => {
    const promise = Promise.resolve('ok');
    safeNotify(promise, { userId: 'u1' });
    // 等待 microtask 队列清空，确保 promise 已 settle
    await Promise.resolve();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('成功 resolve 但无返回值时应正常处理', async () => {
    const promise = Promise.resolve(undefined);
    safeNotify(promise);
    await Promise.resolve();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('utils/safeNotify - 失败路径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('失败时应记录 warn 日志，包含原始错误与上下文', async () => {
    const error = new Error('SMTP 连接超时');
    const promise = Promise.reject(error);
    const context = { userId: 'u1', type: 'email' };
    safeNotify(promise, context);
    // 等待 microtask 队列清空，确保 .catch 回调已执行
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    // 验证 warn 调用参数：第一参数为含 err + 上下文的对象，第二参数为日志消息
    const [logPayload, logMessage] = logger.warn.mock.calls[0];
    expect(logPayload.err).toBe(error);
    expect(logPayload.userId).toBe('u1');
    expect(logPayload.type).toBe('email');
    expect(logMessage).toContain('通知');
  });

  it('失败时未传 context 也应记录 warn 日志，仅含 err', async () => {
    const error = new Error('短信服务不可用');
    const promise = Promise.reject(error);
    safeNotify(promise);
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [logPayload] = logger.warn.mock.calls[0];
    expect(logPayload.err).toBe(error);
  });

  it('失败时错误应为非 Error 对象（如字符串）也应记录', async () => {
    // 设计原因：第三方库可能 reject 字符串或对象，safeNotify 不应假设 err 是 Error 实例
    const promise = Promise.reject('字符串错误');
    safeNotify(promise, { channel: 'sms' });
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [logPayload] = logger.warn.mock.calls[0];
    expect(logPayload.err).toBe('字符串错误');
    expect(logPayload.channel).toBe('sms');
  });
});

describe('utils/safeNotify - fire-and-forget 契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应立即返回 void，不等待 promise settle', () => {
    // 设计原因：safeNotify 用于通知类异步操作，主流程不应等待通知完成
    // 验证返回值为 undefined，且未 await promise
    const pendingPromise = new Promise<string>(() => {}); // 永不 settle 的 promise
    const result = safeNotify(pendingPromise, { userId: 'u1' });
    expect(result).toBeUndefined();
  });

  it('不应抛出异常，即使 promise 立即 reject', () => {
    // 设计原因：若 safeNotify 抛出异常，调用方需要 try/catch 包裹，
    // 违背 fire-and-forget 设计初衷
    expect(() => {
      safeNotify(Promise.reject(new Error('immediate')), {});
    }).not.toThrow();
  });

  it('不产生 unhandled rejection', async () => {
    // 设计原因：safeNotify 必须在内部消化 rejection，否则 Node.js 进程会因
    // unhandled rejection 退出。验证 promise.reject 被 catch 后无 unhandled 事件
    // 通过 process.on('unhandledRejection') 监听验证
    const unhandledHandler = vi.fn();
    process.on('unhandledRejection', unhandledHandler);

    safeNotify(Promise.reject(new Error('test rejection')), { type: 'test' });
    // 等待多个 microtask 周期确保 rejection 已被 catch 处理
    await new Promise((resolve) => setImmediate(resolve));

    expect(unhandledHandler).not.toHaveBeenCalled();
    process.removeListener('unhandledRejection', unhandledHandler);
  });
});

describe('utils/safeNotify - 并发调用', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('多个 safeNotify 并发调用应各自独立记录日志', async () => {
    const err1 = new Error('err1');
    const err2 = new Error('err2');
    const err3 = new Error('err3');
    safeNotify(Promise.reject(err1), { idx: 1 });
    safeNotify(Promise.reject(err2), { idx: 2 });
    safeNotify(Promise.reject(err3), { idx: 3 });
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledTimes(3);
    // 验证每次调用的 context 都正确传递
    expect(logger.warn.mock.calls[0][0].idx).toBe(1);
    expect(logger.warn.mock.calls[1][0].idx).toBe(2);
    expect(logger.warn.mock.calls[2][0].idx).toBe(3);
  });

  it('成功与失败混合调用应仅对失败的记录日志', async () => {
    safeNotify(Promise.resolve('ok'), { idx: 1 });
    safeNotify(Promise.reject(new Error('fail')), { idx: 2 });
    safeNotify(Promise.resolve('ok'), { idx: 3 });
    await Promise.resolve();
    await Promise.resolve();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0].idx).toBe(2);
  });
});
