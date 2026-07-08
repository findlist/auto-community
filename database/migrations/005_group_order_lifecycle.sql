-- ===================== 拼单生命周期管理迁移 =====================
-- 为 group_orders 表新增 cancel_reason 字段，用于记录拼单取消原因
-- 支持手动取消（发起人主动取消）与自动取消（过期未达最低人数）两种场景

-- 1. 新增 cancel_reason 字段：记录取消原因，便于后续审计与用户查询
ALTER TABLE group_orders ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(255);

-- 2. 新增 cancelled_at 字段：记录取消时间，与 completed 状态的时间字段对齐
ALTER TABLE group_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

-- 3. 新增 completed_at 字段：记录完成时间，便于结算统计
ALTER TABLE group_orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

-- 4. 新增索引：加速过期拼单的定时扫描（status + deadline 组合查询）
CREATE INDEX IF NOT EXISTS idx_group_orders_status_deadline ON group_orders(status, deadline);
