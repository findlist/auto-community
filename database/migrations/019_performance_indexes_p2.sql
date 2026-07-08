-- P2 性能索引补齐：覆盖用户视角"我的订单"列表与订单详情 JOIN 查询
-- 设计原因：
-- 1. time_orders 用户视角订单列表按 provider_id/requester_id 过滤 + created_at DESC 排序，
--    原 P1 仅补齐 (status, created_at DESC) 无法覆盖用户维度查询，需新增 provider/requester 索引
-- 2. kitchen_orders 卖方订单列表按 seller_id 过滤 + created_at DESC 排序，
--    原 P1 仅补齐 (user_id, created_at DESC) 买方维度，卖方维度无覆盖
-- 3. skill_orders/kitchen_orders 详情查询 LEFT JOIN skill_posts/kitchen_posts ON post_id，
--    原 post_id 列无索引，JOIN 时需扫描全表匹配
-- 全部为新增索引，不改表结构，回滚安全。
-- down 函数逆序 dropIndex 保证回滚顺序。

-- 1. time_orders 服务提供方订单列表索引：覆盖 provider_id 过滤 + created_at 排序
CREATE INDEX IF NOT EXISTS idx_time_orders_provider_created
  ON time_orders (provider_id, created_at DESC);

-- 2. time_orders 服务请求方订单列表索引：覆盖 requester_id 过滤 + created_at 排序
CREATE INDEX IF NOT EXISTS idx_time_orders_requester_created
  ON time_orders (requester_id, created_at DESC);

-- 3. kitchen_orders 卖方订单列表索引：覆盖 seller_id 过滤 + created_at 排序
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_seller_created
  ON kitchen_orders (seller_id, created_at DESC);

-- 4. skill_orders 关联帖子索引：详情查询 LEFT JOIN skill_posts ON post_id 时加速
CREATE INDEX IF NOT EXISTS idx_skill_orders_post_id
  ON skill_orders (post_id);

-- 5. kitchen_orders 关联帖子索引：详情查询 LEFT JOIN kitchen_posts ON post_id 时加速
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_post_id
  ON kitchen_orders (post_id);
