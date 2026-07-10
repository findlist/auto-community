-- 用户注销申请表迁移
-- 设计原因：data-deletion.service.ts 中大量使用 deletion_requests 表（提交/取消/审核/清理），
-- 但该表从未在任何迁移中创建，生产部署后所有账号注销请求都会因
-- "relation deletion_requests does not exist" 而失败。
-- 本迁移补建表结构与索引，消除生产阻塞 BUG。对应 node-pg-migrate 迁移：server/src/migrations/1704067200026_deletion_requests.ts

CREATE TABLE IF NOT EXISTS deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT deletion_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'completed'))
);

-- 复合索引：覆盖 submitDeletionRequest 中 WHERE user_id = $1 AND status IN ('pending','approved') 查重
CREATE INDEX IF NOT EXISTS idx_deletion_requests_user_status
    ON deletion_requests(user_id, status);

-- 复合索引：覆盖管理后台按状态筛选 + 按时间倒序列表查询
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status_created
    ON deletion_requests(status, created_at);

COMMENT ON TABLE deletion_requests IS '用户注销申请表';
COMMENT ON COLUMN deletion_requests.user_id IS '申请注销的用户 ID';
COMMENT ON COLUMN deletion_requests.reason IS '注销原因（用户可选填）';
COMMENT ON COLUMN deletion_requests.status IS '审核状态：pending/approved/rejected/completed';
COMMENT ON COLUMN deletion_requests.reviewed_by IS '审核人 ID（管理员）';
COMMENT ON COLUMN deletion_requests.reviewed_at IS '审核时间';
COMMENT ON COLUMN deletion_requests.completed_at IS '匿名化完成时间';
