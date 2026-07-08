import type { MigrationBuilder } from 'node-pg-migrate';

// 018_performance_indexes_p1：补齐 P1 订单/拼单/举报高频查询索引
// 设计原因：订单列表查询（admin 后台与用户"我的订单"）普遍缺索引导致全表扫描 + filesort；
// group_order_participants 拼单查重复合查询无覆盖索引；reports 列表过滤排序无索引。
// 本迁移仅新增索引，不改表结构，回滚安全。详细分析见 database/migrations/018_performance_indexes_p1.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. skill_orders 状态+时间排序索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_skill_orders_status_created
     ON skill_orders (status, created_at DESC)`
  );

  // 2. skill_orders 买方订单列表索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_skill_orders_buyer_created
     ON skill_orders (buyer_id, created_at DESC)`
  );

  // 3. skill_orders 卖方订单列表索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_skill_orders_seller_created
     ON skill_orders (seller_id, created_at DESC)`
  );

  // 4. kitchen_orders 状态+时间排序索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status_created
     ON kitchen_orders (status, created_at DESC)`
  );

  // 5. kitchen_orders 买方（拼单发起者）订单列表索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_orders_user_created
     ON kitchen_orders (user_id, created_at DESC)`
  );

  // 6. time_orders 状态+时间排序索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_time_orders_status_created
     ON time_orders (status, created_at DESC)`
  );

  // 7. group_order_participants 拼单查重复合索引
  pgm.createIndex('group_order_participants', ['group_order_id', 'user_id'], {
    name: 'idx_group_order_participants_group_user',
  });

  // 8. reports 状态+时间排序索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_reports_status_created
     ON reports (status, created_at DESC)`
  );
};

export const down = (pgm: MigrationBuilder) => {
  // 逆序 dropIndex 保证回滚顺序与创建顺序相反
  pgm.dropIndex('reports', 'idx_reports_status_created');
  pgm.dropIndex('group_order_participants', 'idx_group_order_participants_group_user');
  pgm.dropIndex('time_orders', 'idx_time_orders_status_created');
  pgm.dropIndex('kitchen_orders', 'idx_kitchen_orders_user_created');
  pgm.dropIndex('kitchen_orders', 'idx_kitchen_orders_status_created');
  pgm.dropIndex('skill_orders', 'idx_skill_orders_seller_created');
  pgm.dropIndex('skill_orders', 'idx_skill_orders_buyer_created');
  pgm.dropIndex('skill_orders', 'idx_skill_orders_status_created');
};
