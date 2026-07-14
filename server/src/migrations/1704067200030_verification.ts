import type { MigrationBuilder } from 'node-pg-migrate';

// 实名认证表迁移
// 注意：原文件名 1704067200012_verification.ts 与 1704067200012_add_performance_indexes.ts
// 版本号冲突，导致 node-pg-migrate 只能执行其中一个。改为 1704067200030 解决冲突。
export const up = (pgm: MigrationBuilder) => {
  // 1. users 表新增实名认证相关字段
  pgm.addColumn('users', {
    verify_status: {
      type: 'varchar(20)',
      default: pgm.func('NULL'),
      comment: '实名认证状态：pending/approved/rejected',
    },
    verify_submitted_at: {
      type: 'timestamp',
      default: pgm.func('NULL'),
      comment: '实名认证提交时间',
    },
  });

  // 2. 创建实名认证申请表
  pgm.createTable('verification_requests', {
    id: {
      type: 'uuid',
      default: pgm.func('gen_random_uuid()'),
      primaryKey: true,
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    real_name: {
      type: 'varchar(100)',
      notNull: true,
    },
    id_card_encrypted: {
      type: 'text',
      notNull: true,
      comment: 'AES-256-GCM 加密的身份证号',
    },
    id_card_hash: {
      type: 'varchar(64)',
      notNull: true,
      comment: 'SHA-256 哈希，用于唯一性校验',
    },
    status: {
      type: 'varchar(20)',
      default: 'pending',
      comment: '审核状态：pending/approved/rejected',
    },
    reviewed_by: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    reviewed_at: {
      type: 'timestamp',
      default: pgm.func('NULL'),
    },
    reject_reason: {
      type: 'text',
      default: pgm.func('NULL'),
    },
    created_at: {
      type: 'timestamp',
      default: pgm.func('NOW()'),
    },
  });

  // 3. 创建索引
  pgm.createIndex('verification_requests', 'user_id', {
    name: 'idx_verification_requests_user',
  });

  // 身份证号哈希唯一索引，防止同一身份证重复认证
  pgm.createIndex('verification_requests', 'id_card_hash', {
    name: 'idx_verification_requests_id_card_hash',
    unique: true,
  });

  // 状态索引，便于管理员筛选待审核申请
  pgm.createIndex('verification_requests', 'status', {
    name: 'idx_verification_requests_status',
  });
};

export const down = (pgm: MigrationBuilder) => {
  // 回滚：先删除表，再删除列
  pgm.dropIndex('verification_requests', 'status', {
    name: 'idx_verification_requests_status',
  });
  pgm.dropIndex('verification_requests', 'id_card_hash', {
    name: 'idx_verification_requests_id_card_hash',
  });
  pgm.dropIndex('verification_requests', 'user_id', {
    name: 'idx_verification_requests_user',
  });
  pgm.dropTable('verification_requests');
  pgm.dropColumn('users', 'verify_submitted_at');
  pgm.dropColumn('users', 'verify_status');
};
