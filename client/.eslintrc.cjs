// ESLint 配置文件
// 适用于 React + TypeScript + Vite 项目
// 注意：项目 package.json 中 "type": "module"，因此使用 .cjs 扩展名以使用 CommonJS
module.exports = {
  // 解析器：使用 TypeScript ESLint 解析器以支持 TS 语法
  parser: '@typescript-eslint/parser',
  // 解析选项
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  // 运行环境
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  // 继承的规则集
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  // 插件
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  // 规则配置
  rules: {
    // 禁止 any 类型：前端 any 已全部清零，升级为 error 防止退化
    '@typescript-eslint/no-explicit-any': 'error',
    // 禁止未使用的变量
    '@typescript-eslint/no-unused-vars': 'error',
    // 强制 Hooks 规则
    'react-hooks/rules-of-hooks': 'error',
    // 依赖项检查（警告级别，避免过度严格）
    'react-hooks/exhaustive-deps': 'warn',
    // 仅允许组件文件导出 React 组件（用于 Fast Refresh）
    'react-refresh/only-export-components': 'warn',
  },
  // 忽略的文件/目录
  ignorePatterns: ['dist', 'node_modules', '*.config.ts', '*.config.js'],
};
