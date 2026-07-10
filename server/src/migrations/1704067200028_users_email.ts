import type { MigrationBuilder } from 'node-pg-migrate';

// 用户邮箱字段补建
// 设计原因：
// 1. BUG 修复：notification-channels.ts 的 dispatchExternalChannels 函数执行
//    `SELECT email, phone FROM users WHERE id = $1` 查询用户联系信息用于邮件通知，
//    但 users 表（001_init.sql）从未创建 email 字段，生产环境启用邮件通知通道时
//    会因 "column email does not exist" 报错，导致外部通知分发功能完全不可用。
// 2. 字段约束：email 为可选字段（非所有用户都注册邮箱），允许 NULL；
//    不加 UNIQUE 约束以兼容历史数据，邮箱唯一性应在用户绑定邮箱后由业务层校验。
// 3. 索引：按主键 id 查询，无需额外索引。
// 对应 SQL：database/migrations/026_users_email.sql
export const up = (pgm: MigrationBuilder) => {
  pgm.addColumn('users', {
    email: {
      type: 'varchar(255)',
      comment: '用户邮箱（可选，用于邮件通知）',
    },
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropColumn('users', 'email');
};
