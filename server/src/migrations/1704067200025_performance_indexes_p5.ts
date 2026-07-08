import type { MigrationBuilder } from 'node-pg-migrate';

// P5 性能索引补齐：覆盖定时任务过期清理与拼单截止扫描场景
// 设计原因：
// 1. scheduler.ts 中 6 处过期清理查询使用 updated_at / timeout_at / expires_at 字段过滤，
//    现有 P0-P4 索引仅覆盖 created_at 排序，无法高效支持过期清理，
//    定时任务每次执行都会对相关表全表扫描，数据量增长后将显著拖慢任务调度。
// 2. group_orders 截止时间扫描 WHERE deadline < NOW() AND status IN ('open','full','ongoing')，
//    现有 idx_group_orders_status_deadline (status, deadline) 中 deadline 是第二列，
//    当 status IN 多值时复合索引需要多次索引扫描或退化为全表扫描，
//    补齐 deadline 单列索引可一次性覆盖按截止时间过滤的查询。
// 本迁移仅新增索引，不改表结构，回滚安全。详细分析见 database/migrations/023_performance_indexes_p5.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. skill_orders (status, updated_at) 复合索引
  // 覆盖 scheduler.ts 中：
  //   - accepted 状态超过 7 天的订单提醒买家确认完成
  //   - in_progress 状态超过 30 天的订单标记需处理
  pgm.createIndex('skill_orders', ['status', 'updated_at'], {
    name: 'idx_skill_orders_status_updated',
  });

  // 2. kitchen_orders (status, updated_at) 复合索引
  // 覆盖 scheduler.ts 中 confirmed 状态超过 24 小时的订单自动完成并结算积分
  pgm.createIndex('kitchen_orders', ['status', 'updated_at'], {
    name: 'idx_kitchen_orders_status_updated',
  });

  // 3. emergency_responses (status, timeout_at) 复合索引
  // 覆盖 scheduler.ts 中 accepted 状态且 timeout_at 已过期的响应自动回退为超时
  pgm.createIndex('emergency_responses', ['status', 'timeout_at'], {
    name: 'idx_emergency_responses_status_timeout',
  });

  // 4. emergency_resources (expires_at) 部分索引
  // 覆盖 scheduler.ts 中可用资源过期清理（status='available' AND expires_at < NOW()）
  // 部分索引仅索引未软删除的资源，体积远小于全表索引，扫描成本更低
  // 使用 pgm.sql 原生 SQL 因 node-pg-migrate createIndex 不支持 WHERE 子句
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_emergency_resources_active_expires
     ON emergency_resources (expires_at)
     WHERE deleted_at IS NULL`
  );

  // 5. skill_posts (expires_at) 部分索引
  // 覆盖 scheduler.ts 中活跃帖子过期清理（status='active' AND expires_at < NOW()）
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_skill_posts_active_expires
     ON skill_posts (expires_at)
     WHERE deleted_at IS NULL`
  );

  // 6. time_transactions (status, type) 复合索引
  // 覆盖 scheduler.ts 中 pending 状态且 type IN ('earn', 'bonus') 的待结算流水批量处理
  pgm.createIndex('time_transactions', ['status', 'type'], {
    name: 'idx_time_transactions_status_type',
  });

  // 7. group_orders (deadline) 单列索引
  // 覆盖 group-order.service.ts 中 checkExpired 拼单截止扫描
  // 与现有 idx_group_orders_status_deadline (status, deadline) 互补：
  //   - 复合索引适合 status = ? AND deadline < ? 的等值+范围联合过滤
  //   - 本索引适合 status IN (...) AND deadline < ? 的多值+范围过滤（避免多次索引扫描）
  pgm.createIndex('group_orders', 'deadline', {
    name: 'idx_group_orders_deadline',
  });
};

export const down = (pgm: MigrationBuilder) => {
  // 逆序 dropIndex 保证回滚顺序与创建顺序相反，避免依赖冲突
  pgm.dropIndex('group_orders', 'deadline', {
    name: 'idx_group_orders_deadline',
  });
  pgm.dropIndex('time_transactions', ['status', 'type'], {
    name: 'idx_time_transactions_status_type',
  });
  pgm.dropIndex('skill_posts', 'expires_at', {
    name: 'idx_skill_posts_active_expires',
  });
  pgm.dropIndex('emergency_resources', 'expires_at', {
    name: 'idx_emergency_resources_active_expires',
  });
  pgm.dropIndex('emergency_responses', ['status', 'timeout_at'], {
    name: 'idx_emergency_responses_status_timeout',
  });
  pgm.dropIndex('kitchen_orders', ['status', 'updated_at'], {
    name: 'idx_kitchen_orders_status_updated',
  });
  pgm.dropIndex('skill_orders', ['status', 'updated_at'], {
    name: 'idx_skill_orders_status_updated',
  });
};
