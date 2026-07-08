-- P1 性能索引补齐：针对订单列表查询、用户订单查询、拼单参与者查重、举报列表过滤
-- 设计原因：
-- 1. 订单列表（admin.service.getOrders 与用户"我的订单"）按 status 过滤 + created_at DESC 排序，
--    原表仅主键 id 索引，列表查询需全表扫描 + filesort
-- 2. 用户视角"我的订单"按 buyer_id/seller_id 过滤 + 时间排序，无可用索引
-- 3. group_order_participants 拼单查重（group_order_id + user_id）无复合索引，
--    每次加入拼单都需全表扫描判断是否重复参与
-- 4. reports 举报列表按 status 过滤 + created_at DESC 排序，无覆盖索引
-- 全部为新增索引，不改表结构，回滚安全。

-- 1. skill_orders 状态+时间排序索引：覆盖 admin 列表与统计查询
CREATE INDEX IF NOT EXISTS idx_skill_orders_status_created
  ON skill_orders (status, created_at DESC);

-- 2. skill_orders 买方订单列表索引：覆盖 buyer_id 过滤 + created_at 排序
CREATE INDEX IF NOT EXISTS idx_skill_orders_buyer_created
  ON skill_orders (buyer_id, created_at DESC);

-- 3. skill_orders 卖方订单列表索引：覆盖 seller_id 过滤 + created_at 排序
CREATE INDEX IF NOT EXISTS idx_skill_orders_seller_created
  ON skill_orders (seller_id, created_at DESC);

-- 4. kitchen_orders 状态+时间排序索引：覆盖 admin 列表与统计查询
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_status_created
  ON kitchen_orders (status, created_at DESC);

-- 5. kitchen_orders 买方（拼单发起者）订单列表索引：覆盖 user_id 过滤 + created_at 排序
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_user_created
  ON kitchen_orders (user_id, created_at DESC);

-- 6. time_orders 状态+时间排序索引：覆盖 admin 列表与统计查询
CREATE INDEX IF NOT EXISTS idx_time_orders_status_created
  ON time_orders (status, created_at DESC);

-- 7. group_order_participants 拼单参与者查重复合索引：
--    WHERE group_order_id = $1 AND user_id = $2 高频调用，原无复合索引
CREATE INDEX IF NOT EXISTS idx_group_order_participants_group_user
  ON group_order_participants (group_order_id, user_id);

-- 8. reports 状态+时间排序索引：覆盖举报列表过滤与排序
CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports (status, created_at DESC);
