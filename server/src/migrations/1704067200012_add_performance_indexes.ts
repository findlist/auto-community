import type { MigrationBuilder } from 'node-pg-migrate';

// 012_add_performance_indexes：补充数据库索引优化查询性能
export const up = (pgm: MigrationBuilder) => {
  // messages 表：优化按接收者、订单类型和已读状态查询
  pgm.createIndex('messages', ['receiver_id', 'order_type', 'read_at'], {
    name: 'idx_messages_receiver_order_read',
  });

  // time_orders 表：优化按服务提供者和状态查询
  pgm.createIndex('time_orders', ['provider_id', 'status'], {
    name: 'idx_time_orders_provider_status',
  });

  // reviews 表：确保每个用户对同一订单只能评价一次
  pgm.createIndex('reviews', ['order_id', 'reviewer_id'], {
    name: 'uq_reviews_order_reviewer',
    unique: true,
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('reviews', 'uq_reviews_order_reviewer');
  pgm.dropIndex('time_orders', 'idx_time_orders_provider_status');
  pgm.dropIndex('messages', 'idx_messages_receiver_order_read');
};