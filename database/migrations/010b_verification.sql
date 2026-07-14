-- verification_requests 实名认证表 + users 认证字段
-- 对应 TS 迁移 1704067200030_verification.ts（原 1704067200012_verification.ts，因版本号冲突重命名）

-- users 表新增实名认证字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_status VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_submitted_at TIMESTAMP;
COMMENT ON COLUMN users.verify_status IS '实名认证状态：pending/approved/rejected';
COMMENT ON COLUMN users.verify_submitted_at IS '实名认证提交时间';

-- 实名认证申请表
CREATE TABLE IF NOT EXISTS verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  real_name VARCHAR(100) NOT NULL,
  id_card_encrypted TEXT NOT NULL,
  id_card_hash VARCHAR(64) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP,
  reject_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_requests_user ON verification_requests (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_requests_id_card_hash ON verification_requests (id_card_hash);
CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests (status);
