-- ===================== 技能订单争议处理迁移 =====================
-- 为 skill_orders 表新增争议相关字段，支持 dispute/resolveDispute 流程
-- 解决订单卡在 accepted/in_progress 状态无法处理纠纷的问题

-- 1. 新增争议字段
ALTER TABLE skill_orders
    -- 争议原因，由发起方填写
    ADD COLUMN IF NOT EXISTS dispute_reason TEXT,
    -- 争议发起时间
    ADD COLUMN IF NOT EXISTS dispute_time TIMESTAMPTZ,
    -- 争议前的原状态，用于 resolveDispute action='continue' 时恢复
    ADD COLUMN IF NOT EXISTS previous_status VARCHAR(20),
    -- 争议处理结果说明，由管理员填写
    ADD COLUMN IF NOT EXISTS resolution TEXT,
    -- 争议处理时间
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    -- 处理争议的管理员 ID
    ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id);

-- 2. 索引：加速按争议状态查询待处理纠纷
CREATE INDEX IF NOT EXISTS idx_skill_orders_dispute_time
    ON skill_orders(dispute_time)
    WHERE dispute_time IS NOT NULL;
