-- ============================================================
-- 邻里圈测试数据种子脚本（纯 SQL，幂等可重复执行）
--
-- 用法：
--   PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f scripts/seed.sql
--
-- 前置条件：
--   1. 已执行所有数据库迁移（含 fix-db.sql 补丁）
--   2. pgcrypto 扩展已启用（脚本内自动启用）
--
-- 测试账号（密码统一为 123456）：
--   13800138000 / 张三      / 普通用户
--   13800138001 / 李四      / 普通用户
--   13800138002 / 王五      / 普通用户
--   13800138003 / 管理员    / 管理员
--
-- 注意：phone 字段为 AES-256-GCM 加密存储，加密逻辑在应用层（依赖 PII_ENCRYPT_KEY 环境变量）。
--   本脚本无法在 SQL 层生成正确密文，故插入占位值。登录基于 phone_hash（SHA-256），功能完全正常。
--   仅"本人查看手机号"会显示 ******（解密占位值失败的安全降级），不影响测试。
-- ============================================================

-- 启用 pgcrypto 扩展（用于计算 SHA-256 phone_hash）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ==================== 0. 清理旧测试数据（可选，按 phone_hash 识别）====================
-- 设计原因：保证幂等，重复执行不会产生重复数据
DELETE FROM credit_transactions
  WHERE user_id IN (
    SELECT id FROM users WHERE phone_hash IN (
      encode(digest('13800138000', 'sha256'), 'hex'),
      encode(digest('13800138001', 'sha256'), 'hex'),
      encode(digest('13800138002', 'sha256'), 'hex'),
      encode(digest('13800138003', 'sha256'), 'hex')
    )
  );
DELETE FROM reviews
  WHERE reviewer_id IN (
    SELECT id FROM users WHERE phone_hash IN (
      encode(digest('13800138000', 'sha256'), 'hex'),
      encode(digest('13800138001', 'sha256'), 'hex'),
      encode(digest('13800138002', 'sha256'), 'hex'),
      encode(digest('13800138003', 'sha256'), 'hex')
    )
  );
DELETE FROM skill_orders WHERE buyer_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM kitchen_orders WHERE user_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM time_orders WHERE requester_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM emergency_responses WHERE responder_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM emergency_requests WHERE user_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM skill_posts WHERE user_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM kitchen_posts WHERE user_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM time_services WHERE user_id IN (SELECT id FROM users WHERE nickname IN ('张三','李四','王五','管理员'));
DELETE FROM users WHERE phone_hash IN (
  encode(digest('13800138000', 'sha256'), 'hex'),
  encode(digest('13800138001', 'sha256'), 'hex'),
  encode(digest('13800138002', 'sha256'), 'hex'),
  encode(digest('13800138003', 'sha256'), 'hex')
);
DELETE FROM communities WHERE name = '阳光花园社区';

-- ==================== 1. 社区 ====================
INSERT INTO communities (id, name, address) VALUES
  ('a0000000-0000-0000-0000-000000000001', '阳光花园社区', '北京市朝阳区阳光花园小区')
ON CONFLICT (id) DO NOTHING;

-- ==================== 2. 用户（4 个测试用户）====================
-- 密码哈希：bcrypt cost=10，明文密码 123456
-- phone 字段：插入占位值（登录基于 phone_hash，不依赖 phone 字段内容）
-- phone_hash：用 pgcrypto 的 digest 函数计算 SHA-256
INSERT INTO users (phone, phone_hash, password_hash, nickname, community_id, credit_balance, time_balance, reputation_score, role, status, privacy_consent_version, privacy_consent_at) VALUES
  (
    'TEST_PLACEHOLDER_13800138000',
    encode(digest('13800138000', 'sha256'), 'hex'),
    '$2a$10$cYbhLlT7U7F155gnD23/A.S96abhhmenxVFZ2yMYDphWMz15ThrMC',
    '张三',
    'a0000000-0000-0000-0000-000000000001',
    320, 80, 4.80, 'user', 'active', 'v1.0', NOW()
  ),
  (
    'TEST_PLACEHOLDER_13800138001',
    encode(digest('13800138001', 'sha256'), 'hex'),
    '$2a$10$cYbhLlT7U7F155gnD23/A.S96abhhmenxVFZ2yMYDphWMz15ThrMC',
    '李四',
    'a0000000-0000-0000-0000-000000000001',
    180, 120, 4.60, 'user', 'active', 'v1.0', NOW()
  ),
  (
    'TEST_PLACEHOLDER_13800138002',
    encode(digest('13800138002', 'sha256'), 'hex'),
    '$2a$10$cYbhLlT7U7F155gnD23/A.S96abhhmenxVFZ2yMYDphWMz15ThrMC',
    '王五',
    'a0000000-0000-0000-0000-000000000001',
    150, 200, 4.90, 'user', 'active', 'v1.0', NOW()
  ),
  (
    'TEST_PLACEHOLDER_13800138003',
    encode(digest('13800138003', 'sha256'), 'hex'),
    '$2a$10$cYbhLlT7U7F155gnD23/A.S96abhhmenxVFZ2yMYDphWMz15ThrMC',
    '管理员',
    'a0000000-0000-0000-0000-000000000001',
    500, 300, 5.00, 'admin', 'active', 'v1.0', NOW()
  )
ON CONFLICT (phone_hash) DO NOTHING;

-- ==================== 3. 积分交易记录（注册奖励 + 活动奖励）====================
INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
SELECT id, 'earn', 100, credit_balance, '新用户注册奖励'
FROM users WHERE nickname = '张三' AND phone_hash = encode(digest('13800138000', 'sha256'), 'hex')
ON CONFLICT DO NOTHING;

INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
SELECT id, 'earn', 100, credit_balance, '新用户注册奖励'
FROM users WHERE nickname = '李四' AND phone_hash = encode(digest('13800138001', 'sha256'), 'hex')
ON CONFLICT DO NOTHING;

INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
SELECT id, 'earn', 100, credit_balance, '新用户注册奖励'
FROM users WHERE nickname = '王五' AND phone_hash = encode(digest('13800138002', 'sha256'), 'hex')
ON CONFLICT DO NOTHING;

INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
SELECT id, 'earn', 100, credit_balance, '新用户注册奖励'
FROM users WHERE nickname = '管理员' AND phone_hash = encode(digest('13800138003', 'sha256'), 'hex')
ON CONFLICT DO NOTHING;

-- 额外积分记录（技能发布奖励等）
INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
SELECT id, 'earn', 50, credit_balance, '技能发布奖励'
FROM users WHERE nickname = '张三' AND phone_hash = encode(digest('13800138000', 'sha256'), 'hex')
ON CONFLICT DO NOTHING;

INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
SELECT id, 'earn', 50, credit_balance, '技能发布奖励'
FROM users WHERE nickname = '李四' AND phone_hash = encode(digest('13800138001', 'sha256'), 'hex')
ON CONFLICT DO NOTHING;

-- ==================== 4. 技能交换帖子（6 条）====================
INSERT INTO skill_posts (user_id, category, type, title, description, credit_price, tags, address, status) VALUES
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
    '生活技能', 'offer', '教你做家常红烧肉',
    '十年厨艺，手把手教你做正宗红烧肉。从选料到火候，一对一教学，包教包会。',
    20, ARRAY['美食', '烹饪'], '阳光花园小区3栋101室', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
    '数码', 'offer', '电脑维修与系统重装',
    '各类电脑故障排查、系统安装、软件调试、数据恢复。10 年 IT 运维经验，上门服务。',
    30, ARRAY['电脑', '维修'], '阳光花园小区5栋202室', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138002', 'sha256'), 'hex')),
    '语言', 'request', '求英语口语陪练',
    '备考雅思，寻找英语口语陪练伙伴。每周 2-3 次，每次 1 小时，希望对方英语流利。',
    25, ARRAY['英语', '口语'], '社区活动中心', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
    '运动', 'offer', '羽毛球陪练',
    '国家二级运动员，周末羽毛球陪练。技术指导 + 实战对练，帮助你快速提升。',
    35, ARRAY['羽毛球', '运动'], '社区体育馆', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
    '家政', 'offer', '专业保洁服务',
    '日常保洁、深度清洁、开荒保洁。自带工具，价格公道，2 小时起约。',
    40, ARRAY['保洁', '家政'], '本小区上门服务', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138002', 'sha256'), 'hex')),
    '教育', 'request', '小学数学周末辅导',
    '孩子三年级，数学基础薄弱，寻找周末上门辅导。希望有教学经验的邻居。',
    50, ARRAY['数学', '辅导'], '阳光花园小区7栋305室', 'active'
  )
ON CONFLICT DO NOTHING;

-- ==================== 5. 共享厨房帖子（4 条）====================
INSERT INTO kitchen_posts (user_id, type, title, description, food_type, allergens, portions, remaining_portions, credit_price, pickup_type, pickup_address, status) VALUES
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
    'offer', '手工韭菜鸡蛋饺子分享',
    '妈妈亲手包的韭菜鸡蛋饺子，新鲜出锅，皮薄馅大。4 份，先到先得！',
    '面食', ARRAY['鸡蛋'], 4, 4, 5, 'self_pickup', '3栋101室', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
    'need', '有机蔬菜社区团购',
    '直采有机农场，新鲜配送。西红柿、黄瓜、生菜等时令蔬菜，10 份成团。',
    '蔬菜', ARRAY[]::TEXT[], 10, 8, 15, 'self_pickup', '小区南门自提点', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138002', 'sha256'), 'hex')),
    'offer', '自制蛋糕分享',
    '孩子生日做多了蛋糕，奶油草莓口味，无添加。分享给邻居 3 份。',
    '甜品', ARRAY['牛奶', '鸡蛋'], 3, 3, 8, 'self_pickup', '7栋305室', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
    'offer', '红烧排骨打包分享',
    '周末炖了一大锅红烧排骨，吃不完分享给邻居。2 份，加热即食。',
    '肉类', ARRAY[]::TEXT[], 2, 2, 10, 'self_pickup', '3栋101室', 'active'
  )
ON CONFLICT DO NOTHING;

-- ==================== 6. 时间银行服务（5 条）====================
INSERT INTO time_services (user_id, category, type, title, description, duration_minutes, address, status) VALUES
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
    '家政', 'provide', '日常保洁服务',
    '专业保洁，两小时起约。自带清洁工具，厨房卫浴深度清洁。',
    120, '本小区上门服务', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
    '陪伴', 'provide', '老人陪聊散步',
    '陪伴独居老人聊天散步，有耐心有爱心。每周可服务 2-3 次。',
    60, '本小区', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138002', 'sha256'), 'hex')),
    '学业', 'request', '小学数学辅导',
    '三年级数学周末辅导，希望有教学经验的邻居。每次 1.5 小时。',
    90, '社区活动室', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
    '医疗', 'provide', '陪诊服务',
    '陪同老人就医，帮忙挂号、取药、记录医嘱。有基础医疗常识。',
    180, '附近医院', 'active'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138002', 'sha256'), 'hex')),
    '维修', 'provide', '家电维修',
    '空调、洗衣机、热水器等家电维修。15 年维修经验，配件成本另算。',
    60, '本小区上门服务', 'active'
  )
ON CONFLICT DO NOTHING;

-- ==================== 7. 应急求助（2 条）====================
-- 注意：status 必须用 'open'（前端 STATUS_LABEL 仅识别 open/responding/resolved/closed/false_report，
--   且后端 respondToRequest 仅允许 open/responding 状态被响应）；'pending' 会导致状态徽章空白且无法响应。
-- category 使用英文 value（medical/repair/safety/other），与前端 CATEGORIES 定义对齐。
INSERT INTO emergency_requests (user_id, type, category, title, description, urgency, address, contact_phone, is_anonymous, status) VALUES
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
    'emergency', 'repair', '水管爆裂急需维修',
    '厨房水管突然爆裂，漏水严重，物业下班联系不上。急需有维修经验的邻居帮忙！',
    'high', '阳光花园小区5栋202室', '13800138001', false, 'open'
  ),
  (
    (SELECT id FROM users WHERE phone_hash = encode(digest('13800138002', 'sha256'), 'hex')),
    'emergency', 'medical', '老人跌倒需要帮助',
    '家中老人在小区花园跌倒，无法独自起身，需要邻居帮忙搀扶。已拨打 120，等待期间需要帮助。',
    'critical', '阳光花园小区中心花园', '13800138002', false, 'open'
  )
ON CONFLICT DO NOTHING;

-- ==================== 8. 评价（2 条，需对应已完成订单）====================
-- 设计原因：评价表有 order_id 外键约束，这里插入示例评价关联到技能订单
-- 先创建一个已完成的技能订单作为评价载体
INSERT INTO skill_orders (post_id, buyer_id, seller_id, credit_amount, status, completed_at)
SELECT
  sp.id,
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
  20, 'completed', NOW() - INTERVAL '3 days'
FROM skill_posts sp
WHERE sp.title = '教你做家常红烧肉'
  AND sp.user_id = (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex'))
ON CONFLICT DO NOTHING;

INSERT INTO skill_orders (post_id, buyer_id, seller_id, credit_amount, status, completed_at)
SELECT
  sp.id,
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
  30, 'completed', NOW() - INTERVAL '2 days'
FROM skill_posts sp
WHERE sp.title = '电脑维修与系统重装'
  AND sp.user_id = (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex'))
ON CONFLICT DO NOTHING;

-- 插入评价
INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
SELECT
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
  so.id, 'skill', 5.0, '张三教做红烧肉非常耐心，从选料到火候都讲得很细致，做出的红烧肉很好吃！'
FROM skill_orders so
WHERE so.status = 'completed'
  AND so.buyer_id = (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex'))
ON CONFLICT DO NOTHING;

INSERT INTO reviews (reviewer_id, reviewed_id, order_id, order_type, rating, content)
SELECT
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex')),
  (SELECT id FROM users WHERE phone_hash = encode(digest('13800138001', 'sha256'), 'hex')),
  so.id, 'skill', 4.5, '李四修电脑很专业，系统重装后速度快了很多，还帮忙清理了灰尘。'
FROM skill_orders so
WHERE so.status = 'completed'
  AND so.buyer_id = (SELECT id FROM users WHERE phone_hash = encode(digest('13800138000', 'sha256'), 'hex'))
ON CONFLICT DO NOTHING;

COMMIT;

-- ==================== 验证 ====================
DO $$
DECLARE
  user_count INTEGER;
  post_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count
  FROM users WHERE phone_hash IN (
    encode(digest('13800138000', 'sha256'), 'hex'),
    encode(digest('13800138001', 'sha256'), 'hex'),
    encode(digest('13800138002', 'sha256'), 'hex'),
    encode(digest('13800138003', 'sha256'), 'hex')
  );

  SELECT COUNT(*) INTO post_count
  FROM skill_posts
  WHERE user_id IN (
    SELECT id FROM users WHERE phone_hash IN (
      encode(digest('13800138000', 'sha256'), 'hex'),
      encode(digest('13800138001', 'sha256'), 'hex'),
      encode(digest('13800138002', 'sha256'), 'hex'),
      encode(digest('13800138003', 'sha256'), 'hex')
    )
  );

  RAISE NOTICE '✅ 种子数据创建完成：% 个用户，% 条技能帖子', user_count, post_count;
  RAISE NOTICE '测试账号（密码 123456）：';
  RAISE NOTICE '  13800138000 / 张三 / 普通用户';
  RAISE NOTICE '  13800138001 / 李四 / 普通用户';
  RAISE NOTICE '  13800138002 / 王五 / 普通用户';
  RAISE NOTICE '  13800138003 / 管理员 / 管理员';
END $$;
