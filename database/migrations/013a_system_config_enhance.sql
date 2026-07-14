-- 站点配置表增强：description 字段 + value_type 字段 + 预设配置项
-- 对应 TS 迁移 1704067200017_system_config_enhance.ts + 1704067200031_site_settings_value_type.ts
-- 必须在 013_site_settings.sql 之后执行（依赖 site_settings 表）

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
