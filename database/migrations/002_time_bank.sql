-- 时间银行模块补充表：时间账户、交易记录、家庭绑定

-- ===================== 时间账户 =====================

CREATE TABLE IF NOT EXISTS time_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id),
    balance INTEGER DEFAULT 0 NOT NULL,
    total_earned INTEGER DEFAULT 0 NOT NULL,
    total_spent INTEGER DEFAULT 0 NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 交易记录 =====================

CREATE TABLE IF NOT EXISTS time_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID REFERENCES time_services(id),
    -- from_user_id 可空：系统发放的奖励(earn/bonus)无来源用户
    from_user_id UUID REFERENCES users(id),
    to_user_id UUID NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('earn', 'spend', 'transfer', 'donate', 'bonus')),
    status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
    remark TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- ===================== 家庭绑定 =====================

CREATE TABLE IF NOT EXISTS family_bindings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    parent_id UUID NOT NULL REFERENCES users(id),
    relationship VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 索引 =====================

CREATE INDEX IF NOT EXISTS idx_time_transactions_from_user ON time_transactions(from_user_id);
CREATE INDEX IF NOT EXISTS idx_time_transactions_to_user ON time_transactions(to_user_id);
CREATE INDEX IF NOT EXISTS idx_family_bindings_user ON family_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_family_bindings_parent ON family_bindings(parent_id);
