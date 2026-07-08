-- 启用 UUID 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===================== 用户模块 =====================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    avatar VARCHAR(500),
    real_name VARCHAR(50),
    id_card_encrypted VARCHAR(255),
    community_id UUID,
    credit_balance INTEGER DEFAULT 0,
    time_balance INTEGER DEFAULT 0,
    reputation_score DECIMAL(3,2) DEFAULT 5.00,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE TABLE communities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    address VARCHAR(255),
    location POINT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 技能交换模块 =====================

CREATE TABLE skill_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    category VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('offer', 'request')),
    title VARCHAR(100) NOT NULL,
    description TEXT,
    credit_price INTEGER DEFAULT 0,
    images TEXT[],
    tags VARCHAR(50)[],
    location POINT,
    address VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE TABLE skill_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES skill_posts(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    credit_amount INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    timeout_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID NOT NULL REFERENCES users(id),
    receiver_id UUID NOT NULL REFERENCES users(id),
    order_id UUID,
    content TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'text',
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 共享厨房模块 =====================

CREATE TABLE kitchen_posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL CHECK (type IN ('share', 'group_buy')),
    title VARCHAR(100) NOT NULL,
    description TEXT,
    food_type VARCHAR(50),
    allergens TEXT[],
    portions INTEGER DEFAULT 1,
    remaining_portions INTEGER DEFAULT 1,
    credit_price INTEGER DEFAULT 0,
    pickup_type VARCHAR(20) DEFAULT 'self_pickup',
    pickup_time TIMESTAMP,
    pickup_address VARCHAR(255),
    delivery_address VARCHAR(255),
    images TEXT[],
    location POINT,
    status VARCHAR(20) DEFAULT 'active',
    timeout_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE TABLE kitchen_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES kitchen_posts(id),
    user_id UUID NOT NULL REFERENCES users(id),
    portions INTEGER DEFAULT 1,
    credit_amount INTEGER NOT NULL,
    pickup_type VARCHAR(20) DEFAULT 'self_pickup',
    delivery_address VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending',
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    timeout_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 时间银行模块 =====================

CREATE TABLE time_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    category VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('provide', 'request')),
    title VARCHAR(100) NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL,
    certification JSONB,
    location POINT,
    address VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE TABLE time_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES time_services(id),
    provider_id UUID NOT NULL REFERENCES users(id),
    requester_id UUID NOT NULL REFERENCES users(id),
    duration_minutes INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE service_disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES time_orders(id),
    initiator_id UUID NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    evidence TEXT[],
    status VARCHAR(20) DEFAULT 'pending',
    resolution TEXT,
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 应急邻里模块 =====================

CREATE TABLE emergency_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    category VARCHAR(50) NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    urgency VARCHAR(20) DEFAULT 'normal',
    location POINT,
    address VARCHAR(255),
    contact_phone VARCHAR(20),
    is_anonymous BOOLEAN DEFAULT false,
    images TEXT[],
    status VARCHAR(20) DEFAULT 'pending',
    timeout_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE TABLE emergency_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES emergency_requests(id),
    responder_id UUID NOT NULL REFERENCES users(id),
    message TEXT,
    status VARCHAR(20) DEFAULT 'accepted',
    arrived_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE false_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES emergency_requests(id),
    reporter_id UUID NOT NULL REFERENCES users(id),
    reason TEXT NOT NULL,
    evidence TEXT[],
    status VARCHAR(20) DEFAULT 'pending',
    penalty VARCHAR(20),
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 积分系统 =====================

CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reference_id UUID,
    reference_type VARCHAR(50),
    description VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 信誉系统 =====================

CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    reviewed_id UUID NOT NULL REFERENCES users(id),
    order_id UUID NOT NULL,
    order_type VARCHAR(20) NOT NULL,
    rating DECIMAL(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
    content TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ===================== 索引 =====================

CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_community ON users(community_id);
CREATE INDEX idx_skill_posts_user ON skill_posts(user_id);
CREATE INDEX idx_skill_posts_category ON skill_posts(category);
CREATE INDEX idx_skill_posts_status ON skill_posts(status);
CREATE INDEX idx_skill_orders_buyer ON skill_orders(buyer_id);
CREATE INDEX idx_skill_orders_seller ON skill_orders(seller_id);
CREATE INDEX idx_kitchen_posts_user ON kitchen_posts(user_id);
CREATE INDEX idx_kitchen_posts_status ON kitchen_posts(status);
CREATE INDEX idx_time_services_user ON time_services(user_id);
CREATE INDEX idx_time_orders_provider ON time_orders(provider_id);
CREATE INDEX idx_time_orders_requester ON time_orders(requester_id);
CREATE INDEX idx_emergency_requests_user ON emergency_requests(user_id);
CREATE INDEX idx_emergency_requests_status ON emergency_requests(status);
CREATE INDEX idx_emergency_responses_request ON emergency_responses(request_id);
CREATE INDEX idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX idx_reviews_reviewed ON reviews(reviewed_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_receiver ON messages(receiver_id);
