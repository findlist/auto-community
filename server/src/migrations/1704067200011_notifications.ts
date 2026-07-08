import type { MigrationBuilder } from 'node-pg-migrate';

// 011_notifications：站内信通知表
export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('notifications', {
    id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    type: { type: 'varchar(50)', notNull: true },
    title: { type: 'varchar(200)', notNull: true },
    content: { type: 'text' },
    reference_id: { type: 'uuid' },
    reference_type: { type: 'varchar(50)' },
    read_at: { type: 'timestamp' },
    created_at: { type: 'timestamp', default: pgm.func('NOW()') },
  });

  // 紧急程度索引：按用户和时间倒序查询，支持快速获取用户最新通知
  pgm.createIndex('notifications', ['user_id', 'created_at'], {
    name: 'idx_notifications_user',
    orderBy: { created_at: 'DESC' },
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('notifications', 'idx_notifications_user');
  pgm.dropTable('notifications');
};