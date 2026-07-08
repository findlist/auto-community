import type { MigrationBuilder } from 'node-pg-migrate';

// 隐私政策同意记录迁移 - 满足 PIPL 合规要求
export const up = (pgm: MigrationBuilder) => {
  // users 表新增隐私政策同意相关字段
  pgm.addColumn('users', {
    privacy_consent_version: {
      type: 'varchar(20)',
      default: pgm.func('NULL'),
      comment: '用户同意的隐私政策版本',
    },
    privacy_consent_at: {
      type: 'timestamp',
      default: pgm.func('NULL'),
      comment: '用户同意隐私政策的时间',
    },
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropColumn('users', 'privacy_consent_at');
  pgm.dropColumn('users', 'privacy_consent_version');
};