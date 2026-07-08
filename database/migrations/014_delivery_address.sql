-- 配送地址簿表：用户管理自己的配送地址，下单时快捷选择
CREATE TABLE IF NOT EXISTS delivery_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient VARCHAR(32) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  address TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_addresses_user_id ON delivery_addresses(user_id);

COMMENT ON TABLE delivery_addresses IS '配送地址簿';
COMMENT ON COLUMN delivery_addresses.recipient IS '收件人姓名';
COMMENT ON COLUMN delivery_addresses.phone IS '收件人电话';
COMMENT ON COLUMN delivery_addresses.is_default IS '是否为默认地址';
