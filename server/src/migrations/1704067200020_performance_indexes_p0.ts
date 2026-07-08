import type { MigrationBuilder } from 'node-pg-migrate';

// 017_performance_indexes_p0：补齐 P0 高频查询索引
// 设计原因：列表查询 WHERE status+type+category + ORDER BY created_at 普遍缺索引，
// 导致全表扫描 + filesort。本迁移仅新增索引，不改表结构，回滚安全。
// 详细分析见 database/migrations/017_performance_indexes_p0.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. time_services 列表查询索引：覆盖 status+type+category 多条件过滤
  pgm.createIndex('time_services', ['status', 'type', 'category'], {
    name: 'idx_time_services_status_type_category',
  });

  // 2. kitchen_posts 列表查询索引：补齐 category+type，与 skill_posts 对称
  pgm.createIndex('kitchen_posts', ['status', 'category', 'type'], {
    name: 'idx_kitchen_posts_status_category_type',
  });

  // 3. kitchen_posts 软删除+排序索引：避免 filesort
  // node-pg-migrate 的 sort 绑定 DESC 仅作用于单列名，这里用 raw 语句保证 created_at DESC
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_posts_deleted_created
     ON kitchen_posts (deleted_at, created_at DESC)`
  );

  // 4. skill_posts 列表查询+排序索引：覆盖 status+type 过滤 + created_at 排序
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_skill_posts_status_type_created
     ON skill_posts (status, type, created_at DESC)`
  );

  // 5. notifications 未读统计部分索引：仅索引未读行，减小体积
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
     ON notifications (user_id, created_at DESC)
     WHERE read_at IS NULL`
  );
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('notifications', 'idx_notifications_user_unread');
  pgm.dropIndex('skill_posts', 'idx_skill_posts_status_type_created');
  pgm.dropIndex('kitchen_posts', 'idx_kitchen_posts_deleted_created');
  pgm.dropIndex('kitchen_posts', 'idx_kitchen_posts_status_category_type');
  pgm.dropIndex('time_services', 'idx_time_services_status_type_category');
};
