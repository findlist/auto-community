-- P0 性能索引补齐：针对高频列表查询缺失索引导致全表扫描 + filesort 的问题
-- 设计原因：现有索引未覆盖 status+type+category 多条件过滤与 created_at 排序，
-- 列表查询需顺序扫描后内存排序，数据量增长后性能劣化明显。
-- 全部为新增索引，不改表结构，回滚安全。

-- 1. time_services 列表查询：WHERE status='active' AND type=$1 AND category=$2 ORDER BY created_at DESC
--    原仅 user_id 单列索引，列表查询无可用索引
CREATE INDEX IF NOT EXISTS idx_time_services_status_type_category
  ON time_services (status, type, category);

-- 2. kitchen_posts 列表查询：WHERE deleted_at IS NULL AND type=$1 AND category=$2
--    原 idx_kitchen_posts_status 仅覆盖 status，type/category 无索引，与 skill_posts 不对称
CREATE INDEX IF NOT EXISTS idx_kitchen_posts_status_category_type
  ON kitchen_posts (status, category, type);

-- 3. kitchen_posts 列表排序：WHERE deleted_at IS NULL ORDER BY created_at DESC
--    排序字段无索引导致 filesort
CREATE INDEX IF NOT EXISTS idx_kitchen_posts_deleted_created
  ON kitchen_posts (deleted_at, created_at DESC);

-- 4. skill_posts 列表查询：WHERE status='active' AND type=$1 ORDER BY created_at DESC
--    原 idx_skill_posts_status 无法覆盖 type 过滤与 created_at 排序
CREATE INDEX IF NOT EXISTS idx_skill_posts_status_type_created
  ON skill_posts (status, type, created_at DESC);

-- 5. notifications 未读统计：WHERE user_id=$1 AND read_at IS NULL（每次进入应用高频调用）
--    部分索引仅索引未读行，大幅减小索引体积与扫描成本
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
