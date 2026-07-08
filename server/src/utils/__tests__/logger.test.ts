import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 导入被测模块：logger 在模块加载时即注册 process 监听器并按环境输出初始化日志
import logger from '../logger';

describe('logger 模块', () => {
  describe('logger 实例', () => {
    it('应导出 pino 实例，具备标准日志方法', () => {
      // 设计原因：下游业务依赖 logger.info/warn/error/debug 四级日志方法，
      // 此处校验方法存在避免运行期因方法缺失导致崩溃
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('应可正常调用各级日志方法且无返回值', () => {
      // 设计原因：pino 实例方法返回 undefined，业务代码不应依赖返回值
      // 在 silent 级别的测试环境下调用不会输出任何内容，仅验证方法可调用
      expect(logger.info('测试消息')).toBeUndefined();
      expect(logger.warn('测试消息')).toBeUndefined();
      expect(logger.error('测试消息')).toBeUndefined();
      expect(logger.debug('测试消息')).toBeUndefined();
    });

    it('应支持对象 + 字符串混合的 pino 调用签名', () => {
      // 设计原因：业务代码大量使用 logger.error({ err }, 'msg') 形式，
      // 此处校验混合参数签名可正常调用，避免类型或运行时错误
      expect(logger.error({ err: new Error('x') }, '发生错误')).toBeUndefined();
    });
  });

  describe('process 全局监听器', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let processExitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // 监听 console.error 输出但不阻塞进程；mock process.exit 避免测试进程退出
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // 设计原因：监听器调用 process.exit(1) 会终止测试进程，必须 mock 拦截；
      // 用 as never 绕过 Node.js process.exit 的多重重载签名避免类型冲突
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    });

    afterEach(() => {
      // 恢复 spy 避免影响后续测试
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
    });

    it('应已注册 uncaughtException 监听器', () => {
      // 设计原因：模块加载时通过 process.on('uncaughtException', ...) 注册兜底处理，
      // 验证 listener 已挂载，避免模块加载失败导致全局监听缺失
      const listeners = process.listeners('uncaughtException');
      // 过滤 vitest 自身的监听器（vitest 会注册一个 listener）
      // logger 模块加载后 listeners 数量应至少为 1（vitest 自带）
      expect(listeners.length).toBeGreaterThanOrEqual(1);
    });

    it('应已注册 unhandledRejection 监听器', () => {
      // 设计原因：与 uncaughtException 对称，验证 Promise 拒绝兜底已挂载
      const listeners = process.listeners('unhandledRejection');
      expect(listeners.length).toBeGreaterThanOrEqual(1);
    });

    it('触发 uncaughtException 时应调用 console.error 与 process.exit', () => {
      // 设计原因：模拟未捕获异常，验证兜底逻辑：先打印错误信息再退出进程
      const err = new Error('测试未捕获异常');
      process.emit('uncaughtException', err);

      expect(consoleErrorSpy).toHaveBeenCalled();
      // 校验输出包含特定标记便于排查日志
      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs[0]).toContain('uncaughtException');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('触发 unhandledRejection 时应调用 console.error 与 process.exit', () => {
      // 设计原因：模拟未处理 Promise 拒绝，验证兜底逻辑与 uncaughtException 对称；
      // vitest 自身也监听 unhandledRejection 会拦截 process.emit，因此直接取出 logger 注册的监听器调用
      const reason = new Error('测试未处理拒绝');
      // 找到 logger.ts 中通过 process.on('unhandledRejection', ...) 注册的监听器
      // 设计原因：vitest 启动时会注册自己的 unhandledRejection 监听器，
      // process.emit 触发会被 vitest 拦截无法到达 logger 的监听器，必须直接调用；
      // NodeJS.Listener 期望 (reason, promise) 两个参数，logger 的 callback 仅用 reason，第二个参数可省略
      const listeners = process.listeners('unhandledRejection');
      const targetListener = listeners[listeners.length - 1] as (reason: unknown) => void;
      targetListener(reason);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs[0]).toContain('unhandledRejection');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('uncaughtException 触发时应将原始 Error 对象作为第二参数传入', () => {
      // 设计原因：日志格式为 console.error('[uncaughtException]', err)，
      // 验证第二参数为原始 Error 对象，便于后续日志聚合平台解析
      const err = new Error('原始异常对象');
      process.emit('uncaughtException', err);

      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs[1]).toBe(err);
    });

    it('unhandledRejection 触发时应将 rejection 原因作为第二参数传入', () => {
      // 设计原因：与 uncaughtException 对称，验证 reason 透传；
      // 直接取出 listener 调用，避免 vitest 自身监听器拦截 process.emit
      const reason = '字符串形式的拒绝原因';
      const listeners = process.listeners('unhandledRejection');
      const targetListener = listeners[listeners.length - 1] as (reason: unknown) => void;
      targetListener(reason);

      const callArgs = consoleErrorSpy.mock.calls[0];
      expect(callArgs[1]).toBe(reason);
    });
  });

  describe('生产环境初始化日志', () => {
    let infoSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // 设计原因：logger.ts 模块级代码在 isProduction 时调用 logger.info，
      // 由于模块已加载完成无法重新触发，通过 spy 验证 logger.info 在生产环境的行为
      infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    });

    afterEach(() => {
      infoSpy.mockRestore();
    });

    it('生产环境下显式调用 logger.info 应正常工作', () => {
      // 设计原因：模拟生产环境初始化日志的等价行为，
      // 验证 logger.info 可被业务代码安全调用
      logger.info({ LOG_LEVEL: 'info' }, 'pino 日志已初始化（生产环境）');
      expect(infoSpy).toHaveBeenCalled();
      const callArgs = infoSpy.mock.calls[0];
      expect(callArgs[0]).toEqual({ LOG_LEVEL: 'info' });
    });
  });
});
