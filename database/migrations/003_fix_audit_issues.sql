-- ===================== 审计问题修复迁移 =====================
-- 该迁移为多模块消息路由、角色权限以及列表查询性能提供支持

-- 1. messages 表新增 order_type 字段，用于区分消息所属业务模块
ALTER TABLE messages ADD COLUMN IF NOT EXISTS order_type VARCHAR(20) DEFAULT 'skill';

-- 2. users 表新增 role 字段，为后续角色权限校验做准备
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

-- 3. messages 表索引：加速未读消息查询与按订单维度查询
CREATE INDEX IF NOT EXISTS idx_messages_receiver_read ON messages(receiver_id, read_at);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id, order_type);

-- 4. credit_transactions 表索引：加速用户流水时间线查询
CREATE INDEX IF NOT EXISTS idx_credit_tx_user_created ON credit_transactions(user_id, created_at);

-- 5. reviews 表索引：加速按被评价人维度的评价列表查询
CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_created ON reviews(reviewed_id, created_at);

-- 6. skill_orders 表索引：加速买卖双方按状态筛选订单
CREATE INDEX IF NOT EXISTS idx_skill_orders_buyer_status ON skill_orders(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_skill_orders_seller_status ON skill_orders(seller_id, status);

-- 7. kitchen_orders 表索引：加速买卖双方按状态筛选订单
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_user_status ON kitchen_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_kitchen_orders_seller_status ON kitchen_orders(seller_id, status);

-- 8. emergency_requests 表索引：加速按状态与类型筛选应急请求
CREATE INDEX IF NOT EXISTS idx_emergency_requests_status_type ON emergency_requests(status, type);
