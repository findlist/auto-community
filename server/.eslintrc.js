// ESLint 配置：TypeScript + Node 环境
// 用于邻里圈后端服务的代码质量检查
module.exports = {
  // 使用 TypeScript 解析器以支持 TS 语法
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  // 启用 TS 与 Node 推荐规则
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es2022: true,
  },
  // 忽略编译输出与迁移脚本目录（迁移脚本由 node-pg-migrate 单独管理）
  ignorePatterns: ['dist/', 'node_modules/', 'src/migrations/'],
  rules: {
    // 未使用变量告警，避免阻塞既有代码
    'no-unused-vars': 'warn',
    // 未使用变量告警（TS 版本）：忽略以 _ 开头的参数，与 TS 编译器 noUnusedParameters 行为一致
    // 便于 Express 错误处理中间件等必须保留参数签名但参数未使用的场景
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    // 警告 any 类型使用，逐步收敛类型边界
    '@typescript-eslint/no-explicit-any': 'warn',
    // 关闭 console 限制，日志体系由 Task 23 统一处理
    'no-console': 'off',
    // 强制 const 声明，避免误用 let
    'prefer-const': 'error',
    // 强制严格相等，防止隐式转换 bug
    'eqeqeq': 'error',
  },
};
