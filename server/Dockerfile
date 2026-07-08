# ---- 构建阶段 ----
# 构建上下文为项目根目录（docker-compose.yml 中 context: .）
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制 package 文件，利用 Docker 层缓存加速依赖安装
COPY server/package.json server/package-lock.json* ./
RUN npm ci

# 复制源码并编译
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-alpine AS runner

WORKDIR /app

# 仅安装生产依赖
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev

# 复制编译产物
COPY --from=builder /app/dist ./dist

# 复制数据库迁移文件（容器启动时自动执行）
COPY database/migrations ./migrations

# 安装 postgresql-client 用于执行迁移和健康检查
RUN apk add --no-cache postgresql-client

EXPOSE 3000

# 启动脚本：等待数据库就绪 → 执行迁移 → 启动服务
COPY server/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
