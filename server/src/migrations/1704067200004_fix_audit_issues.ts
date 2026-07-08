import type { MigrationBuilder } from 'node-pg-migrate';
import fs from 'fs';
import path from 'path';

// 003_fix_audit_issues：审计问题修复迁移
export const up = (pgm: MigrationBuilder) => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/003_fix_audit_issues.sql'),
    'utf8'
  );
  pgm.sql(sql);
};

export const down = () => {
  // 原始 SQL 迁移未提供回滚脚本
};
