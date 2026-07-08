-- ===================== 应急模块增强迁移 =====================
-- 支持：1) 虚假举报审核流程  2) 应急资源 CRUD 与巡检
-- 注意：emergency_resources.last_check 字段已在 002_emergency.sql 中创建，此处不重复添加

-- 1. users 表新增 ban_until 字段，用于支持限时封禁（ban_7d / ban_30d）
--    permanent_banned 状态时 ban_until 为 NULL，表示永久封禁
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_until TIMESTAMP;

-- 2. false_reports 表新增 resolution 字段，记录管理员处理意见
--    penalty 字段已存在，用于存储处罚类型（warning/ban_7d/ban_30d/permanent）
ALTER TABLE false_reports ADD COLUMN IF NOT EXISTS resolution TEXT;

-- 3. emergency_resources 表新增 deleted_at 字段，支持软删除（与项目其他表保持一致）
ALTER TABLE emergency_resources ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- 4. 索引：加速按封禁到期时间查询需要自动解封的用户
CREATE INDEX IF NOT EXISTS idx_users_ban_until ON users(ban_until) WHERE ban_until IS NOT NULL;

-- 5. 索引：加速按状态查询待审核的虚假举报
CREATE INDEX IF NOT EXISTS idx_false_reports_status ON false_reports(status);

