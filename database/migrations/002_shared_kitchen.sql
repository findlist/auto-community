-- ===================== 共享厨房模块迁移 =====================

-- 1. 修改 kitchen_posts 表
ALTER TABLE kitchen_posts ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE kitchen_posts ADD COLUMN IF NOT EXISTS health_cert BOOLEAN DEFAULT false;
ALTER TABLE kitchen_posts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

-- 修改 type 字段的 CHECK 约束：share/group_buy -> offer/need
ALTER TABLE kitchen_posts DROP CONSTRAINT IF EXISTS kitchen_posts_type_check;
ALTER TABLE kitchen_posts ADD CONSTRAINT kitchen_posts_type_check CHECK (type IN ('offer', 'need'));

-- 修改 status 字段的 CHECK 约束：添加 sold_out 和 expired 状态
ALTER TABLE kitchen_posts DROP CONSTRAINT IF EXISTS kitchen_posts_status_check;
ALTER TABLE kitchen_posts ADD CONSTRAINT kitchen_posts_status_check CHECK (status IN ('active', 'inactive', 'sold_out', 'expired'));

-- 2. 修改 kitchen_orders 表
ALTER TABLE kitchen_orders ADD COLUMN IF NOT EXISTS seller_id UUID REFERENCES users(id);
ALTER TABLE kitchen_orders ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMP;
ALTER TABLE kitchen_orders ADD COLUMN IF NOT EXISTS remark TEXT;

-- 修改 status 字段的 CHECK 约束：添加 confirmed 和 timeout 状态
ALTER TABLE kitchen_orders DROP CONSTRAINT IF EXISTS kitchen_orders_status_check;
ALTER TABLE kitchen_orders ADD CONSTRAINT kitchen_orders_status_check CHECK (status IN ('pending', 'paid', 'confirmed', 'completed', 'cancelled', 'timeout'));

-- 3. 创建 group_orders 表
CREATE TABLE IF NOT EXISTS group_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    initiator_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(100) NOT NULL,
    description TEXT,
    target_amount INTEGER NOT NULL,
    current_amount INTEGER DEFAULT 0,
    min_participants INTEGER NOT NULL,
    max_participants INTEGER NOT NULL,
    current_participants INTEGER DEFAULT 0,
    address VARCHAR(255),
    deadline TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'full', 'ongoing', 'completed', 'cancelled')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

-- 4. 创建 group_order_participants 表
CREATE TABLE IF NOT EXISTS group_order_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_order_id UUID NOT NULL REFERENCES group_orders(id),
    user_id UUID NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'refunded')),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_order_id, user_id)
);

-- 5. 添加索引
CREATE INDEX IF NOT EXISTS idx_group_orders_initiator ON group_orders(initiator_id);
CREATE INDEX IF NOT EXISTS idx_group_orders_status ON group_orders(status);
CREATE INDEX IF NOT EXISTS idx_group_order_participants_order ON group_order_participants(group_order_id);
CREATE INDEX IF NOT EXISTS idx_group_order_participants_user ON group_order_participants(user_id);
