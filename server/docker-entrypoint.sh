#!/bin/sh
# 容器启动入口脚本：等待数据库就绪 → 执行迁移 → 启动 Node 服务

set -e

echo "[启动] 等待 PostgreSQL 就绪..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -q; do
  echo "[启动] 数据库未就绪，3 秒后重试..."
  sleep 3
done
echo "[启动] PostgreSQL 已就绪"

# 按文件名顺序执行所有迁移文件
for sql_file in /app/migrations/*.sql; do
  if [ -f "$sql_file" ]; then
    echo "[迁移] 执行 $(basename "$sql_file") ..."
    PGPASSWORD="$DB_PASSWORD" psql \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
      -f "$sql_file" -v ON_ERROR_STOP=1
    echo "[迁移] $(basename "$sql_file") 完成"
  fi
done
echo "[迁移] 所有迁移文件执行完毕"

echo "[启动] 启动 Node 服务..."
exec node dist/index.js
