import type { MigrationBuilder } from 'node-pg-migrate';

// 019_performance_indexes_p2：补齐 P2 用户视角订单列表与订单详情 JOIN 查询索引
// 设计原因：
// 1. time_orders 用户视角"我的订单"按 provider_id/requester_id 过滤 + created_at DESC 排序，
//    P1 仅补齐 (status, created_at DESC) 无法覆盖用户维度查询
// 2. kitchen_orders 卖方订单列表按 seller_id 过滤 + created_at DESC 排序，
//    P1 仅补齐 (user_id, created_at DESC) 买方维度，卖方维度无覆盖
// 3. skill_orders/kitchen_orders 详情查询 LEFT JOIN skill_posts/kitchen_posts ON post_id，
//    原 post_id 列无索引，JOIN 时需扫描全表匹配
// 本迁移仅新增索引，不改表结构，回滚安全。详细分析见 database/migrations/019_performance_indexes_p2.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. time_orders 服务提供方订单列表索引：覆盖 provider_id 过滤 + created_at DESC 排序
  // 设计原因：node-pg-migrate 的 createIndex 对复合索引列排序方向绑定为 ASC，
  // created_at DESC 需用 pgm.sql 原生 SQL 保证
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_time_orders_provider_created
     ON time_orders (provider_id, created_at DESC)`
  );

  // 2. time_orders 服务请求方订单列表索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_time_orders_requester_created
     ON time_orders (requester_id, created_at DESC)`
  );

  // 3. kitchen_orders 卖方订单列表索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_kitchen_orders_seller_created
     ON kitchen_orders (seller_id, created_at DESC)`
  );

  // 4. skill_orders 关联帖子索引：单列 ASC，可用标准 API
  pgm.createIndex('skill_orders', 'post_id', {
    name: 'idx_skill_orders_post_id',
  });

  // 5. kitchen_orders 关联帖子索引
  pgm.createIndex('kitchen_orders', 'post_id', {
    name: 'idx_kitchen_orders_post_id',
  });
};

export const down = (pgm: MigrationBuilder) => {
  // 逆序 dropIndex 保证回滚顺序与创建顺序相反
  pgm.dropIndex('kitchen_orders', 'idx_kitchen_orders_post_id');
  pgm.dropIndex('skill_orders', 'idx_skill_orders_post_id');
  pgm.dropIndex('kitchen_orders', 'idx_kitchen_orders_seller_created');
  pgm.dropIndex('time_orders', 'idx_time_orders_requester_created');
  pgm.dropIndex('time_orders', 'idx_time_orders_provider_created');
};
