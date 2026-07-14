-- ============================================================
-- 数据库结构修复脚本（幂等，可重复执行）
--
-- 背景：TS 迁移文件存在版本号冲突（1704067200012 / 1704067200018 各有两个），
--      导致 node-pg-migrate 可能跳过部分迁移，数据库结构不完整。
--      注册接口需要 privacy_consent_version / privacy_consent_at 字段，
--      缺失时 INSERT 报错 → 500 内部服务器错误 → 无法注册 → 系统无测试数据。
--
-- 用法：
--   PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f fix-db.sql
-- ============================================================

BEGIN;

-- ==================== 1. notifications 表（对应 1704067200011_notifications.ts） ====================
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

-- ==================== 2. verification_requests 表 + users 认证字段（对应 1704067200012_verification.ts） ====================
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

-- ==================== 3. users 隐私同意字段（对应 1704067200013_privacy_consent.ts） ====================
-- ★ 关键修复：注册接口 INSERT 包含 privacy_consent_version / privacy_consent_at，
--   缺失这两个字段会导致注册 500 错误
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMP;
COMMENT ON COLUMN users.privacy_consent_version IS '用户同意的隐私政策版本';
COMMENT ON COLUMN users.privacy_consent_at IS '用户同意隐私政策的时间';

-- ==================== 4. site_settings 增强（对应 1704067200017 + 1704067200018_site_settings_value_type.ts） ====================
-- description 字段
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS description VARCHAR(255);
COMMENT ON COLUMN site_settings.description IS '配置项描述，便于管理员理解用途';

-- value_type 字段
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS value_type VARCHAR(16) NOT NULL DEFAULT 'string';
COMMENT ON COLUMN site_settings.value_type IS '配置值类型：string | int | float';

-- 预设业务配置项（ON CONFLICT 保证幂等）
INSERT INTO site_settings (key, value, description, value_type) VALUES
  ('skill_publish_reward', '10', '技能发布奖励积分', 'int'),
  ('daily_earn_limit', '200', '每日积分获取上限', 'int'),
  ('order_auto_expire_hours', '24', '订单自动过期小时数', 'int'),
  ('emergency_response_timeout', '30', '紧急响应超时分钟数', 'int')
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type;

-- ==================== 5. family_bindings 状态约束增强（对应 1704067200018_family_binding_unbind.ts） ====================
-- 新增 unbound 状态支持解绑
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'family_bindings_status_check'
  ) THEN
    ALTER TABLE family_bindings DROP CONSTRAINT family_bindings_status_check;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'family_bindings') THEN
    ALTER TABLE family_bindings ADD CONSTRAINT family_bindings_status_check
      CHECK (status IN ('pending', 'confirmed', 'rejected', 'unbound'));
  END IF;
END $$;

-- ==================== 6. 补建缺失的索引（对应 1704067200012_add_performance_indexes.ts） ====================
CREATE INDEX IF NOT EXISTS idx_messages_receiver_order_read
  ON messages (receiver_id, order_type, read_at);
CREATE INDEX IF NOT EXISTS idx_time_orders_provider_status
  ON time_orders (provider_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_order_reviewer
  ON reviews (order_id, reviewer_id);

COMMIT;

-- ==================== 验证 ====================
DO $$
DECLARE
  missing_column TEXT;
BEGIN
  -- 校验关键字段是否存在
  SELECT column_name INTO missing_column
  FROM information_schema.columns
  WHERE table_name = 'users' AND column_name = 'privacy_consent_version'
  LIMIT 1;

  IF missing_column IS NULL THEN
    RAISE EXCEPTION '修复失败：users.privacy_consent_version 字段仍不存在';
  END IF;

  RAISE NOTICE '✅ 数据库结构修复完成，所有缺失的表和字段已补建';
END $$;
