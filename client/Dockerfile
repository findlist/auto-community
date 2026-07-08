# ---- 构建阶段 ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

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
