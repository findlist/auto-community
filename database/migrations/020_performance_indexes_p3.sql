-- P3 性能索引补齐：覆盖应急/评价/消息模块的列表查询与排序场景
-- 设计原因：
-- 1. emergency_requests 列表查询 WHERE deleted_at IS NULL + ORDER BY created_at DESC，
--    原表仅有 (user_id)/(status)/(status,type) 索引，软删除过滤与时间排序无索引覆盖导致全表扫描+filesort。
--    与 idx_kitchen_posts_deleted_created 对称，补齐 (deleted_at, created_at DESC) 复合索引。
-- 2. emergency_responses 详情页查询 WHERE request_id=$1 ORDER BY created_at ASC，
--    原 idx_emergency_responses_request 仅覆盖 request_id 过滤，created_at 排序仍需 filesort。
--    补齐 (request_id, created_at) 复合索引同时覆盖过滤与排序。
-- 3. reviews 订单评价查询 WHERE order_id=$1 AND order_type=$2 ORDER BY created_at DESC，
--    原表仅有 (reviewed_id)/(reviewed_id, created_at) 索引覆盖被评价者维度，
--    订单维度的评价列表查询（emergency/skill/kitchen/time 订单详情页评价区）无索引覆盖。
--    补齐 (order_id, order_type, created_at) 复合索引覆盖订单维度过滤与排序。
-- 4. messages 订单未读计数查询 WHERE receiver_id=$1 AND order_type=$2 AND read_at IS NULL，
--    原 idx_messages_receiver_read(receiver_id, read_at) 不能覆盖 order_type 过滤，
--    进入订单消息列表时需扫描该接收者全部订单消息再过滤。补齐 (receiver_id, order_type, read_at) 复合索引。
-- 全部为新增索引，不改表结构，回滚安全。down 函数逆序 dropIndex 保证回滚顺序。

-- 1. emergency_requests 软删除列表索引：覆盖 deleted_at IS NULL + created_at DESC 排序
CREATE INDEX IF NOT EXISTS idx_emergency_requests_deleted_created
  ON emergency_requests (deleted_at, created_at DESC);

-- 2. emergency_responses 请求维度时间序列索引：覆盖 request_id 过滤 + created_at 排序
CREATE INDEX IF NOT EXISTS idx_emergency_responses_request_created
  ON emergency_responses (request_id, created_at);

-- 3. reviews 订单维度评价索引：覆盖 order_id+order_type 过滤 + created_at DESC 排序
CREATE INDEX IF NOT EXISTS idx_reviews_order_type_created
  ON reviews (order_id, order_type, created_at DESC);

-- 4. messages 订单未读计数索引：覆盖 receiver_id+order_type 过滤 + read_at IS NULL
CREATE INDEX IF NOT EXISTS idx_messages_receiver_order_read
  ON messages (receiver_id, order_type, read_at);
