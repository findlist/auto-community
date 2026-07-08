const path = require('path');
const fs = require('fs');

// 加载 .env 文件：从多个候选路径查找，兼容不同运行场景
// server/ → 项目根目录（.env 通常放在根目录）
const envCandidates = [
  path.resolve(__dirname, '../.env'),      // server/ → 项目根目录
  path.resolve(process.cwd(), '.env'),     // 当前工作目录
  path.resolve(process.cwd(), '../.env'),  // 工作目录上级（如在 server/ 下运行）
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    break;
  }
}

// 构建数据库连接字符串：
// 优先使用 DATABASE_URL 环境变量；否则从单独的 DB_* 变量拼接
function buildDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_NAME || 'linli_circle';
  // 密码需要 URL 编码，避免特殊字符（如 @、:、/）破坏连接串
  const encodedPassword = encodeURIComponent(password);
  return `postgres://${user}:${encodedPassword}@${host}:${port}/${database}`;
}

module.exports = {
  // 数据库连接字符串
  databaseUrl: buildDatabaseUrl(),
  // 迁移文件目录：指向 server/src/migrations
  migrationsDir: path.resolve(__dirname, 'src/migrations'),
  // 迁移文件语言：TypeScript（项目使用 .ts 迁移文件）
  language: 'ts',
  // 迁移记录表名：用于跟踪已执行的迁移版本
  migrationsTable: 'pgmigrations',
  // 日志输出函数
  log: console.log,
};
