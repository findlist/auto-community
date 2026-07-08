import type { MigrationBuilder } from 'node-pg-migrate';
import fs from 'fs';
import path from 'path';

// 002_time_bank：时间银行模块补充表
export const up = (pgm: MigrationBuilder) => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/002_time_bank.sql'),
    'utf8'
  );
  pgm.sql(sql);
};

export const down = () => {
  // 原始 SQL 迁移未提供回滚脚本
};
