-- ===================== 操作审计日志迁移 =====================
-- 用于追踪敏感操作（登录、资金变动、订单状态变更等）
-- 提供安全审计、合规追溯能力

-- 1. 创建 audit_logs 表
CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    -- 操作者用户 ID，未登录场景（如登录失败）允许为空
    user_id UUID,
    -- 操作类型，如 LOGIN/LOGOUT/REGISTER/TRANSFER/COMPLETE_ORDER 等
    action VARCHAR(64) NOT NULL,
    -- 资源类型，如 user/order/transaction
    resource_type VARCHAR(32),
    -- 资源 ID，统一使用字符串以兼容 UUID 与业务编号
    resource_id VARCHAR(64),
    -- 客户端 IP（兼容 IPv6 最大长度）
    ip VARCHAR(45),
    -- 客户端 User-Agent
    user_agent TEXT,
    -- 请求体（脱敏后存储，移除密码等敏感字段）
    request_body JSONB,
    -- 操作结果状态：success / failed
    status VARCHAR(16) NOT NULL,
    -- 失败时的错误信息
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 索引：按用户维度查询操作历史（user_id + created_at）
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
    ON audit_logs(user_id, created_at);

-- 3. 索引：按操作类型查询（action + created_at）
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
    ON audit_logs(action, created_at);

-- 4. 索引：按资源维度追溯（resource_type + resource_id）
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource
    ON audit_logs(resource_type, resource_id);
