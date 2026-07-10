-- P6 性能索引补齐 + credit_transactions 字段修复
-- 设计原因：
-- 1. BUG 修复：scheduler.ts 中两处 UPDATE credit_transactions SET updated_at = NOW()，
--    但 credit_transactions 表（001_init.sql）从未创建 updated_at 字段，
--    生产环境订单超时解冻积分时会因 "column updated_at does not exist" 报错。
--    补建 updated_at 字段以修复此生产阻塞 BUG。
-- 2. 索引补齐：上述 UPDATE 使用 WHERE reference_id = $1 AND reference_type = $2 AND type = 'freeze'，
--    credit_transactions 是流水追加表，数据持续增长，无索引将退化为全表扫描。
-- 3. service_disputes 表的 order_id / initiator_id 无索引，按订单或发起人查询争议时全表扫描。
-- 对应 node-pg-migrate 迁移：server/src/migrations/1704067200027_performance_indexes_p6.ts

-- 1. credit_transactions 补建 updated_at 字段
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
COMMENT ON COLUMN credit_transactions.updated_at IS '最后更新时间（解冻操作时更新）';

-- 2. credit_transactions (reference_id, reference_type, type) 复合索引
-- 覆盖 scheduler.ts 中两处订单超时解冻积分的 UPDATE 查询
CREATE INDEX IF NOT EXISTS idx_credit_transactions_ref_type_type
    ON credit_transactions(reference_id, reference_type, type);

-- 3. service_disputes (order_id) 索引
-- 覆盖 time-bank.service.ts 中 JOIN time_orders ON sd.order_id = o.id 的关联查询
CREATE INDEX IF NOT EXISTS idx_service_disputes_order
    ON service_disputes(order_id);

-- 4. service_disputes (initiator_id) 索引
-- 覆盖 time-bank.service.ts 中 WHERE sd.initiator_id = $1 的争议列表查询
CREATE INDEX IF NOT EXISTS idx_service_disputes_initiator
    ON service_disputes(initiator_id);
