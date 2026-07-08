-- 站点配置表：管理员可配置首页展示图片等全站级设置
CREATE TABLE IF NOT EXISTS site_settings (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT,
  updated_by UUID,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 插入首页 Hero 图默认配置
INSERT INTO site_settings (key, value)
VALUES ('homepage_hero_image', NULL)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE site_settings IS '站点配置表，键值对存储全站级设置';
COMMENT ON COLUMN site_settings.key IS '配置键名，如 homepage_hero_image';
COMMENT ON COLUMN site_settings.value IS '配置值，如图片 URL';
COMMENT ON COLUMN site_settings.updated_by IS '最后更新该配置的管理员 ID';
