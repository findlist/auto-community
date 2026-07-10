import type { MigrationBuilder } from 'node-pg-migrate';

// 用户注销申请表迁移
// 设计原因：data-deletion.service.ts 中大量使用 deletion_requests 表（提交/取消/审核/清理），
// 但该表从未在任何迁移中创建，生产部署后所有账号注销请求都会因
// "relation deletion_requests does not exist" 而失败。
// 本迁移补建表结构与索引，消除生产阻塞 BUG。对应 SQL：database/migrations/024_deletion_requests.sql
export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('deletion_requests', {
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
      comment: '申请注销的用户 ID',
    },
    reason: {
      type: 'text',
      comment: '注销原因（用户可选填）',
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'pending',
      comment: '审核状态：pending/approved/rejected/completed',
    },
    reviewed_by: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
      comment: '审核人 ID（管理员）',
    },
    reviewed_at: {
      type: 'timestamp',
      comment: '审核时间',
    },
    completed_at: {
      type: 'timestamp',
      comment: '匿名化完成时间',
    },
    created_at: {
      type: 'timestamp',
      default: pgm.func('NOW()'),
    },
  });

  // 约束：status 仅允许四种合法值，防止脏数据
  pgm.sql(
    `ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_status_check ` +
      `CHECK (status IN ('pending', 'approved', 'rejected', 'completed'))`
  );

  // 复合索引：覆盖 submitDeletionRequest 中 WHERE user_id = $1 AND status IN ('pending','approved') 查重
  pgm.createIndex('deletion_requests', ['user_id', 'status'], {
    name: 'idx_deletion_requests_user_status',
  });

  // 复合索引：覆盖管理后台按状态筛选 + 按时间倒序列表查询
  pgm.createIndex('deletion_requests', ['status', 'created_at'], {
    name: 'idx_deletion_requests_status_created',
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('deletion_requests', ['status', 'created_at'], {
    name: 'idx_deletion_requests_status_created',
  });
  pgm.dropIndex('deletion_requests', ['user_id', 'status'], {
    name: 'idx_deletion_requests_user_status',
  });
  pgm.sql(`ALTER TABLE deletion_requests DROP CONSTRAINT IF EXISTS deletion_requests_status_check`);
  pgm.dropTable('deletion_requests');
};
