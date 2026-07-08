-- 应急邻里模块补充迁移

-- 为 emergency_requests 表新增 type 字段
ALTER TABLE emergency_requests ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'emergency';

-- 为 emergency_responses 表新增 eta 和 timeout_at 字段
ALTER TABLE emergency_responses ADD COLUMN IF NOT EXISTS eta INTEGER;
ALTER TABLE emergency_responses ADD COLUMN IF NOT EXISTS timeout_at TIMESTAMP;

-- 创建 emergency_resources 表
CREATE TABLE IF NOT EXISTS emergency_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    community_id UUID REFERENCES communities(id),
    type VARCHAR(50) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    location POINT,
    address VARCHAR(255),
    contact_phone VARCHAR(20),
    status VARCHAR(20) DEFAULT 'available',
    last_check TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_emergency_resources_community ON emergency_resources(community_id);
CREATE INDEX IF NOT EXISTS idx_emergency_resources_type ON emergency_resources(type);
CREATE INDEX IF NOT EXISTS idx_emergency_resources_status ON emergency_resources(status);
