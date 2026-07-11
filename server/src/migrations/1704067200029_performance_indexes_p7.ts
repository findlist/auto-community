import type { MigrationBuilder } from 'node-pg-migrate';

// P7 性能索引补齐：慢查询风险点覆盖
// 设计原因：
// 1. audit_logs 多条件动态过滤 status 维度缺失索引
//    audit.service.ts getAuditLogs 与 admin.service.ts 导出审计日志均支持
//    按 status + 时间范围动态过滤。现有索引仅覆盖 (user_id, created_at) 与
//    (action, created_at)，当仅传 status + 时间范围时退化为全表扫描回表过滤。
//    audit_logs 是高频写入表，数据量随时间线性增长，需补建复合索引。
// 2. time_transactions fetchDailyEarned 四字段组合查询未覆盖
//    time-bank.service.ts fetchDailyEarned 被 createOrder（下单预检查）与
//    completeOrder（完成订单结算）调用，WHERE to_user_id + type='earn' +
//    status='completed' + created_at >= CURRENT_DATE。现有索引仅覆盖
//    to_user_id 单列，type/status/created_at 三个条件均需回表过滤。
//    completeOrder 在事务内调用，长查询会持锁影响并发。
// 3. credit_transactions getTimeHistory 三字段组合查询未覆盖
//    user.service.ts getTimeHistory 查询用户时间银行积分流水，
//    WHERE user_id + type IN ('time_earn', 'time_spend') + ORDER BY created_at DESC。
//    现有 idx_credit_tx_user_created(user_id, created_at) 可用最左前缀匹配 user_id，
//    但 type 条件需回表过滤。用户高频访问"积分明细"页面，需补建复合索引。
// 对应 SQL：database/migrations/027_performance_indexes_p7.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. audit_logs (status, created_at) 复合索引
  // 覆盖审计日志按状态+时间范围动态过滤并按 created_at DESC 排序的查询：
  //   - audit.service.ts getAuditLogs: WHERE status=$X AND created_at>=$Y AND created_at<=$Z ORDER BY created_at DESC
  //   - admin.service.ts getExportData audit-logs: WHERE status=$X AND created_at>=$Y AND created_at<=$Z
  // created_at DESC 排序方向匹配 ORDER BY created_at DESC，避免反向扫描开销
  pgm.createIndex('audit_logs', ['status', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_audit_logs_status_created',
  });

  // 2. time_transactions (to_user_id, type, status, created_at) 复合索引
  // 覆盖时间银行每日收益查询：
  //   - time-bank.service.ts fetchDailyEarned: WHERE to_user_id=$1 AND type='earn' AND status='completed' AND created_at>=CURRENT_DATE
  //   - scheduler handleDeferredTimeEarn: WHERE to_user_id=$1 AND type IN ('earn','bonus') AND status='completed' AND created_at>=CURRENT_DATE
  // 被 createOrder（下单预检查）与 completeOrder（事务内结算）高频调用
  pgm.createIndex(
    'time_transactions',
    ['to_user_id', 'type', 'status', 'created_at'],
    { name: 'idx_time_transactions_to_user_type_status_created' },
  );

  // 3. credit_transactions (user_id, type, created_at) 复合索引
  // 覆盖用户积分明细页查询：
  //   - user.service.ts getTimeHistory: WHERE user_id=$1 AND type IN ('time_earn','time_spend') ORDER BY created_at DESC
  // 现有 idx_credit_tx_user_created(user_id, created_at) 只能最左前缀匹配 user_id，type 需回表过滤
  pgm.createIndex(
    'credit_transactions',
    ['user_id', 'type', { name: 'created_at', sort: 'DESC' }],
    { name: 'idx_credit_transactions_user_type_created' },
  );
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('credit_transactions', ['user_id', 'type', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_credit_transactions_user_type_created',
  });
  pgm.dropIndex(
    'time_transactions',
    ['to_user_id', 'type', 'status', 'created_at'],
    { name: 'idx_time_transactions_to_user_type_status_created' },
  );
  pgm.dropIndex('audit_logs', ['status', { name: 'created_at', sort: 'DESC' }], {
    name: 'idx_audit_logs_status_created',
  });
};
