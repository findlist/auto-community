import pino from 'pino';

// 直接从 process.env 读取配置，避免与 config/env.ts 形成循环依赖
// （env.ts 在校验过程中也需要使用 logger 输出错误信息）
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';

// 日志级别：优先使用 LOG_LEVEL 环境变量；未配置时按环境兜底
// - 测试环境：silent（完全静默，避免 JSON 日志噪音干扰测试结果阅读）
// - 开发环境：debug（便于本地调试，输出尽可能多的诊断信息）
// - 生产环境：info（仅记录关键信息，避免日志量过大影响性能与存储）
const LOG_LEVEL = process.env.LOG_LEVEL || (isTest ? 'silent' : isDevelopment ? 'debug' : 'info');

// 创建 pino 实例
// 生产与开发环境均输出 JSON 格式（避免引入 pino-pretty 额外依赖，符合规范"禁止引入非必要依赖"原则）
// 通过 level 控制输出详细程度，开发环境 level=debug 可看到更多日志
export const logger = pino({
  level: LOG_LEVEL,
  // 生产环境关闭时间戳的 ISO 字符串冗余（pino 默认输出 numeric 时间）
  // 开发环境保留 pino 默认行为，便于阅读
  timestamp: pino.stdTimeFunctions.isoTime,
  // 基础字段：附加 app 与 env 标签，便于日志聚合平台筛选
  base: {
    app: 'linli-circle-server',
    env: process.env.NODE_ENV || 'development',
  },
});

// 进程级未捕获异常与未处理的 Promise 拒绝
// 此处必须使用 console.error 作为最终兜底，避免 logger 自身故障导致日志丢失
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exit(1);
});

// 仅在生产环境提示日志级别，避免开发环境噪音
if (isProduction) {
  logger.info({ LOG_LEVEL }, 'pino 日志已初始化（生产环境）');
}

export default logger;
