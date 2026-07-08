# ---- 构建阶段 ----
FROM node:20-alpine AS builder

WORKDIR /app

# ★ 使用国内 npm 镜像（淘宝），加速依赖安装
RUN npm config set registry https://registry.npmmirror.com/

# 有 package-lock.json 用 npm ci（版本锁定），否则 fallback 到 npm install
# --no-fund/--no-audit 跳过资金提示和安全审计，加速安装
# 注意：monorepo 的 client 子项目可能没有自己的 lock 文件
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-fund --no-audit; else npm install --no-fund --no-audit; fi

COPY tsconfig.json tsconfig.*.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY src ./src

RUN npm run build

# ---- 运行阶段：Nginx 托管静态资源 ----
FROM nginx:alpine AS runner

# 复制构建产物到 Nginx 静态目录
COPY --from=builder /app/dist /usr/share/nginx/html

# 复制 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
