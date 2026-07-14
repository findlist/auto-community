-- notifications 站内信通知表（对应 TS 迁移 1704067200011_notifications.ts）
-- 必须在 017_performance_indexes_p0.sql 之前执行（017 引用了 notifications 表）
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  reference_id UUID,
  reference_type VARCHAR(50),
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON notifications (user_id, created_at DESC);
