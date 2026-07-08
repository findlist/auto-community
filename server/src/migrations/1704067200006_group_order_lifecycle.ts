import type { MigrationBuilder } from 'node-pg-migrate';
import fs from 'fs';
import path from 'path';

// 005_group_order_lifecycle：拼单生命周期管理迁移
export const up = (pgm: MigrationBuilder) => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../database/migrations/005_group_order_lifecycle.sql'),
    'utf8'
  );
  pgm.sql(sql);
};

export const down = () => {
  // 原始 SQL 迁移未提供回滚脚本
};
