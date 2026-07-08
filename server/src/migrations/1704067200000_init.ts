import type { MigrationBuilder } from 'node-pg-migrate';
import fs from 'fs';
import path from 'path';

// 001_init：初始化数据库表结构与索引
export const up = (pgm: MigrationBuilder) => {
  // 读取原始 SQL 文件并执行，保持迁移内容不变
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/001_init.sql'),
    'utf8'
  );
  pgm.sql(sql);
};

export const down = () => {
  // 原始 SQL 迁移未提供回滚脚本，此处不执行任何操作
};
