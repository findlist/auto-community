-- ===================== 后台管理与举报系统迁移 =====================

-- 1. 创建 reports 举报表
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id),
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('skill', 'kitchen', 'time_bank', 'emergency', 'user')),
    target_id UUID NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
    handler_id UUID REFERENCES users(id),
    handle_note TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    handled_at TIMESTAMP
);

-- 2. 添加索引
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_target ON reports(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
