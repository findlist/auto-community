import type { MigrationBuilder } from 'node-pg-migrate';

// 020_performance_indexes_p3：补齐 P3 应急/评价模块列表查询与排序索引
// 设计原因：
// 1. emergency_requests 列表 WHERE deleted_at IS NULL ORDER BY created_at DESC，
//    原 (user_id)/(status)/(status,type) 索引无法覆盖软删除过滤与时间排序，全表扫描+filesort。
// 2. emergency_responses 详情页 WHERE request_id=$1 ORDER BY created_at ASC，
//    原 idx_emergency_responses_request 仅覆盖过滤，created_at 排序需 filesort。
// 3. reviews 订单评价 WHERE order_id=$1 AND order_type=$2 ORDER BY created_at DESC，
//    原 (reviewed_id) 系列索引覆盖被评价者维度，订单维度评价列表无索引覆盖。
// 注意：messages (receiver_id, order_type, read_at) 索引已在 012_add_performance_indexes 中创建，
// 此处不再重复声明，避免 node-pg-migrate createIndex 无 IF NOT EXISTS 保护导致新部署报错。
// 本迁移仅新增索引，不改表结构，回滚安全。详细分析见 database/migrations/020_performance_indexes_p3.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. emergency_requests 软删除列表索引：created_at DESC 需用原生 SQL 保证方向
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_emergency_requests_deleted_created
     ON emergency_requests (deleted_at, created_at DESC)`
  );

  // 2. emergency_responses 请求维度时间序列索引：两列均 ASC，可用标准 API
  pgm.createIndex('emergency_responses', ['request_id', 'created_at'], {
    name: 'idx_emergency_responses_request_created',
  });

  // 3. reviews 订单维度评价索引：created_at DESC 需用原生 SQL 保证方向
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_reviews_order_type_created
     ON reviews (order_id, order_type, created_at DESC)`
  );
};

export const down = (pgm: MigrationBuilder) => {
  // 逆序 dropIndex 保证回滚顺序与创建顺序相反
  // 注意：messages 索引由 012_add_performance_indexes 负责 drop，此处不再重复
  pgm.dropIndex('reviews', 'idx_reviews_order_type_created');
  pgm.dropIndex('emergency_responses', 'idx_emergency_responses_request_created');
  pgm.dropIndex('emergency_requests', 'idx_emergency_requests_deleted_created');
};
