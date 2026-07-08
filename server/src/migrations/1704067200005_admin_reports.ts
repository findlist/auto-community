import type { MigrationBuilder } from 'node-pg-migrate';
import fs from 'fs';
import path from 'path';

// 004_admin_reports：后台管理与举报系统迁移
export const up = (pgm: MigrationBuilder) => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/004_admin_reports.sql'),
    'utf8'
  );
  pgm.sql(sql);
};

export const down = () => {
  // 原始 SQL 迁移未提供回滚脚本
};
