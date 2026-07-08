-- P4 性能索引补齐：覆盖审计日志分页、虚假举报查重、应急资源列表查询场景
-- 设计原因：
-- 1. audit_logs 列表查询 ORDER BY a.created_at DESC LIMIT/OFFSET（无筛选分页），
--    原表仅有 (user_id, created_at)/(action, created_at)/(resource_type, resource_id) 复合索引，
--    无筛选场景下无可用索引，全表扫描+filesort。补齐 created_at DESC 单列索引覆盖排序。
--    注：PG 优化器可反向扫描 ASC 索引，但 DESC 索引可避免反向扫描开销且语义更清晰。
-- 2. false_reports 查重查询 WHERE request_id=$1 AND reporter_id=$2（每次举报前都执行），
--    原表仅有 idx_false_reports_status(status) 单列索引，无法覆盖查重查询，全表扫描。
--    补齐 (request_id, reporter_id) 复合索引覆盖查重，避免重复举报校验全表扫描。
-- 3. emergency_resources 列表查询 WHERE deleted_at IS NULL [AND type=$1] ORDER BY created_at DESC，
--    原表仅有 community_id/type/status 单列索引，软删除过滤与时间排序无索引覆盖。
--    补齐 (created_at DESC) WHERE deleted_at IS NULL 部分索引，仅索引未软删除资源，体积小、扫描快。
-- 全部为新增索引，不改表结构，回滚安全。down 函数逆序 dropIndex 保证回滚顺序。

-- 1. audit_logs 创建时间降序索引：覆盖无筛选分页排序
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_desc
  ON audit_logs (created_at DESC);

-- 2. false_reports 请求+举报人复合索引：覆盖查重查询
CREATE INDEX IF NOT EXISTS idx_false_reports_request_reporter
  ON false_reports (request_id, reporter_id);

-- 3. emergency_resources 活跃资源部分索引：覆盖软删除过滤+时间排序
-- 部分索引仅索引 deleted_at IS NULL 的行，体积远小于全表索引，扫描成本更低
CREATE INDEX IF NOT EXISTS idx_emergency_resources_active_created
  ON emergency_resources (created_at DESC)
  WHERE deleted_at IS NULL;
