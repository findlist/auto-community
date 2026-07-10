import type { MigrationBuilder } from 'node-pg-migrate';

// P6 性能索引补齐 + credit_transactions 字段修复
// 设计原因：
// 1. BUG 修复：scheduler.ts 中两处 UPDATE credit_transactions SET updated_at = NOW()，
//    但 credit_transactions 表（001_init.sql）从未创建 updated_at 字段，
//    生产环境订单超时解冻积分时会因 "column updated_at does not exist" 报错。
//    补建 updated_at 字段以修复此生产阻塞 BUG。
// 2. 索引补齐：上述 UPDATE 使用 WHERE reference_id = $1 AND reference_type = $2 AND type = 'freeze'，
//    credit_transactions 是流水追加表，数据持续增长，无索引将退化为全表扫描。
// 3. service_disputes 表的 order_id / initiator_id 无索引，按订单或发起人查询争议时全表扫描。
// 对应 SQL：database/migrations/025_performance_indexes_p6.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. credit_transactions 补建 updated_at 字段
  // scheduler.ts 解冻积分时需要更新此字段记录最后修改时间
  pgm.addColumn('credit_transactions', {
    updated_at: {
      type: 'timestamp',
      default: pgm.func('NOW()'),
      comment: '最后更新时间（解冻操作时更新）',
    },
  });

  // 2. credit_transactions (reference_id, reference_type, type) 复合索引
  // 覆盖 scheduler.ts 中两处订单超时解冻积分的 UPDATE 查询：
  //   - WHERE reference_id = $1 AND reference_type = 'skill_order' AND type = 'freeze'
  //   - WHERE reference_id = $1 AND reference_type = 'kitchen_order' AND type = 'freeze'
  pgm.createIndex('credit_transactions', ['reference_id', 'reference_type', 'type'], {
    name: 'idx_credit_transactions_ref_type_type',
  });

  // 3. service_disputes (order_id) 索引
  // 覆盖 time-bank.service.ts 中 JOIN time_orders ON sd.order_id = o.id 的关联查询
  pgm.createIndex('service_disputes', 'order_id', {
    name: 'idx_service_disputes_order',
  });

  // 4. service_disputes (initiator_id) 索引
  // 覆盖 time-bank.service.ts 中 WHERE sd.initiator_id = $1 的争议列表查询
  pgm.createIndex('service_disputes', 'initiator_id', {
    name: 'idx_service_disputes_initiator',
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('service_disputes', 'initiator_id', {
    name: 'idx_service_disputes_initiator',
  });
  pgm.dropIndex('service_disputes', 'order_id', {
    name: 'idx_service_disputes_order',
  });
  pgm.dropIndex('credit_transactions', ['reference_id', 'reference_type', 'type'], {
    name: 'idx_credit_transactions_ref_type_type',
  });
  pgm.dropColumn('credit_transactions', 'updated_at');
};
