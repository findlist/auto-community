-- ===================== 手机号加密存储迁移 =====================
-- 背景：审查发现用户手机号明文存储，违反 PIPL 合规要求。
-- 本迁移将 phone 字段改为密文存储（AES-256-GCM），并新增 phone_hash 字段用于唯一性约束与查询。
--
-- 注意：本文件仅包含 DDL，现有数据迁移需通过独立脚本完成（见下方注释）。
-- 现有数据迁移脚本示例（请在执行本迁移后单独运行）：
--   1. 为每个现有用户读取明文 phone
--   2. 调用后端 encryptPhone(phone) 得到密文，调用 hashPhone(phone) 得到哈希
--   3. UPDATE users SET phone = $cipher, phone_hash = $hash WHERE id = $userId
--   4. 迁移完成后校验：所有 phone_hash 非空且唯一

-- 1. 新增 phone_hash 字段：用于唯一性约束与按手机号查询（避免对密文做等值查询）
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash VARCHAR(64);

-- 2. phone 字段扩容为密文存储：AES-256-GCM 密文格式为 base64(iv).base64(authTag).base64(cipherText)
--    IV(12B) + authTag(16B) + 密文(11B 手机号) 经 base64 后约 60+ 字节，VARCHAR(255) 足以容纳
ALTER TABLE users ALTER COLUMN phone TYPE VARCHAR(255);

-- 3. 删除原 phone 上的唯一索引/约束（若存在），改在 phone_hash 上建立唯一约束
--    注：PostgreSQL 中 UNIQUE 约束名通常为 users_phone_key
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;
DROP INDEX IF EXISTS idx_users_phone;

-- 4. 在 phone_hash 上建立唯一索引，保证手机号唯一性（哈希值相同即手机号相同）
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_hash ON users(phone_hash);

-- 5. 为 phone_hash 建立普通索引以加速等值查询（唯一索引已隐含此功能，此处显式声明便于维护说明）
--    说明：phone 字段不再建立索引（密文无查询意义）
