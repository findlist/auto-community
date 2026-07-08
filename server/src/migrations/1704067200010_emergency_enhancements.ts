import type { MigrationBuilder } from 'node-pg-migrate';
import fs from 'fs';
import path from 'path';

// 009_emergency_enhancements：应急模块增强迁移
export const up = (pgm: MigrationBuilder) => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/009_emergency_enhancements.sql'),
    'utf8'
  );
  pgm.sql(sql);
};

export const down = () => {
  // 原始 SQL 迁移未提供回滚脚本
};
