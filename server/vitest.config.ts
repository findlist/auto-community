import { defineConfig } from 'vitest/config';

// vitest 配置：node 环境，匹配 src 下所有 __tests__ 目录中的 .test.ts 文件
export default defineConfig({
  test: {
    // 测试运行环境：后端服务无 DOM 依赖，使用 node 环境
    environment: 'node',
    // flaky test 自动重试 1 次
    // 设计原因：19 个路由集成测试文件并行执行时各自启动/关闭 HTTP 服务器，
    // coverage 插桩导致性能下降，偶发 server.address() 时序问题使 fetch 报 "bad port"。
    // retry:1 给 flaky 用例第二次机会；持续失败的真正 bug 连续 2 次失败仍会报错，不会被掩盖
    retry: 1,
    // 测试文件匹配模式：覆盖 src 下任意层级的 __tests__ 目录
    include: ['src/**/__tests__/**/*.test.ts'],
    // 排除编译产物、node_modules 以及预先存在的非 vitest 格式测试文件：
    // - *.concurrent.test.ts：依赖真实数据库的并发集成测试，需单独配置 DB 环境运行
    // - tokenBlacklist.test.ts：使用 node:assert 的自执行脚本，依赖真实 Redis 实例
    // - broadcast.test.ts：WebSocket 集成测试，需运行中服务器
    // 注：crypto.test.ts 已重写为 vitest describe/it 风格，不再排除
    // 注：time-bank.security.test.ts 已重写为 vitest describe/it 风格（通过 mock 调用真实 updateService），2026-07-17 纳入 CI 套件
    exclude: [
      'node_modules',
      'dist',
      'src/**/__tests__/*.concurrent.test.ts',
      'src/**/__tests__/tokenBlacklist.test.ts',
      'src/**/__tests__/broadcast.test.ts',
    ],
    // 覆盖率配置：使用 v8 provider，统计 src 下 ts 文件
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/types/**',
        // 排除迁移脚本：DDL 语句无业务逻辑，由集成测试覆盖
        'src/migrations/**',
        // 排除入口文件：依赖完整运行时环境，由集成测试覆盖
        'src/index.ts',
      ],
      // 质量门禁：设置略低于当前实际覆盖率的阈值，防止覆盖率退化
      // 2026-07-08 第十五次评估：实际 Stmts 95.36% / Branch 88.34% / Funcs 92.1% / Lines 95.91%
      // 主要增长点：scheduler.ts 从 56.93% 提升至 95.04%（initScheduler 6 个 cron 回调覆盖）；
      // websocket/index.ts 从 85.05% 提升至 88.5%（initPubSub catch + heartbeat ping 覆盖）；
      // ai.service.ts 从 66.91% 提升至 93.75%（LLM 真实路径 + parsePoint 三分支覆盖）
      // 提升 thresholds 至 92/86/90/93（留 ~2-3% 余量防退化），四维度全面突破 86%
      thresholds: {
        statements: 92,
        branches: 86,
        functions: 90,
        lines: 93,
      },
    },
  },
});
