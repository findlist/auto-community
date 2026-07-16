import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      // 上传文件代理到后端，与 nginx.conf 的 /uploads/ location 对齐
      "/uploads": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    // 警戒线 600KB：超过则构建告警，便于及时发现超大 chunk
    // 设计原因：默认 500KB 在引入富文本编辑器/图表库等场景下易触发误报，600KB 兼顾灵敏度与噪音
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 拆分第三方依赖为独立 vendor chunk，提升首屏并行加载效率与缓存命中率
        // 设计原因：react/react-dom/react-router-dom 变更频率低，独立 chunk 可被浏览器长期缓存
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
