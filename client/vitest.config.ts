import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // 覆盖率配置：使用 v8 provider，统计 src 下 ts/tsx 文件
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        // 排除类型声明文件：无运行时逻辑
        'src/**/*.d.ts',
        // 排除测试设置文件：测试基础设施，非业务代码
        'src/test-setup.ts',
        // 排除入口文件：依赖完整运行时环境，由 E2E 测试覆盖
        'src/main.tsx',
      ],
      // 质量门禁：显式 include 所有 src 文件后的真实覆盖率
      // 第十七次评估（session 023）：补充 TransferModal/DonateModal/ServiceCard/mockInterceptor 后
      // 实际覆盖率 Stmts 59.61 / Branch 59.76 / Funcs 50.67 / Lines 61.38
      // 按"留 1.5-2% 余量避免微小波动导致 CI 失败"原则，门禁继续上调
      // 后续随 Auth 页面/Home/FoodReview/Verify 等补全再上调
      thresholds: {
        statements: 58,
        branches: 58,
        functions: 49,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
