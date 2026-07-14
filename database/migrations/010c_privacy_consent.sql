-- users 隐私同意字段（对应 TS 迁移 1704067200013_privacy_consent.ts）
-- ★ 关键：注册接口 INSERT 包含 privacy_consent_version / privacy_consent_at，
--   缺失时会导致注册 500 错误
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent_version VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent_at TIMESTAMP;
COMMENT ON COLUMN users.privacy_consent_version IS '用户同意的隐私政策版本';
COMMENT ON COLUMN users.privacy_consent_at IS '用户同意隐私政策的时间';
