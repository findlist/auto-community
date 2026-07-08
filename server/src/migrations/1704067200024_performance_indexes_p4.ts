import type { MigrationBuilder } from 'node-pg-migrate';

// 021_performance_indexes_p4：补齐 P4 审计日志/虚假举报/应急资源查询索引
// 设计原因：
// 1. audit_logs 无筛选分页 ORDER BY created_at DESC，原复合索引均无法覆盖，全表扫描+filesort。
// 2. false_reports 查重 WHERE request_id=$1 AND reporter_id=$2 每次举报前都执行，
//    原 idx_false_reports_status(status) 无法覆盖查重，全表扫描。
// 3. emergency_resources 列表 WHERE deleted_at IS NULL ORDER BY created_at DESC，
//    原 community_id/type/status 单列索引无法覆盖软删除过滤+时间排序。
//    部分索引仅索引未软删除行，体积小、扫描快。
// 本迁移仅新增索引，不改表结构，回滚安全。详细分析见 database/migrations/021_performance_indexes_p4.sql
export const up = (pgm: MigrationBuilder) => {
  // 1. audit_logs 创建时间降序索引：单列 DESC 需用原生 SQL 保证方向
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_desc
     ON audit_logs (created_at DESC)`
  );

  // 2. false_reports 请求+举报人复合索引：两列均 ASC，可用标准 API
  pgm.createIndex('false_reports', ['request_id', 'reporter_id'], {
    name: 'idx_false_reports_request_reporter',
  });

  // 3. emergency_resources 活跃资源部分索引：含 WHERE 子句需用原生 SQL
  // 部分索引仅索引 deleted_at IS NULL 的行，体积远小于全表索引
  pgm.sql(
    `CREATE INDEX IF NOT EXISTS idx_emergency_resources_active_created
     ON emergency_resources (created_at DESC)
     WHERE deleted_at IS NULL`
  );
};

export const down = (pgm: MigrationBuilder) => {
  // 逆序 dropIndex 保证回滚顺序与创建顺序相反
  pgm.dropIndex('emergency_resources', 'idx_emergency_resources_active_created');
  pgm.dropIndex('false_reports', 'idx_false_reports_request_reporter');
  pgm.dropIndex('audit_logs', 'idx_audit_logs_created_desc');
};
