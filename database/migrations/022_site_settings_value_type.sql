-- 站点配置表增加 value_type 字段：实现配置项类型元数据驱动
-- 设计原因：原前端用 FLOAT_CONFIG_PATTERN 正则按 key 关键词识别浮点类配置，
-- 新增浮点配置需手动更新前端正则，违反开闭原则。
-- 改为后端元数据驱动后，管理员在后台选择配置类型即可，前端根据 value_type 判断滑块步长。

ALTER TABLE site_settings ADD COLUMN value_type VARCHAR(16) NOT NULL DEFAULT 'string';
COMMENT ON COLUMN site_settings.value_type IS '配置值类型：string（字符串）| int（整数）| float（浮点），驱动前端滑块步长';

-- 回填预设配置项类型：4 个均为整数类配置
-- homepage_hero_image 是 URL 字符串，保持默认 'string' 无需回填
UPDATE site_settings SET value_type = 'int' WHERE key IN ('skill_publish_reward', 'daily_earn_limit', 'order_auto_expire_hours', 'emergency_response_timeout');
