-- A/B 测试配置表
CREATE TABLE IF NOT EXISTS ab_test_configs (
  id SERIAL PRIMARY KEY,
  test_name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  variants JSONB NOT NULL DEFAULT '{"control": 50, "treatment": 50}',
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- A/B 测试结果表
CREATE TABLE IF NOT EXISTS ab_test_results (
  id SERIAL PRIMARY KEY,
  test_name VARCHAR(100) NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  variant VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ab_test_results_test_user ON ab_test_results(test_name, user_id);
CREATE INDEX idx_ab_test_results_test_event ON ab_test_results(test_name, event_type);

-- 初始 AI 推荐对比实验配置
INSERT INTO ab_test_configs (test_name, description, variants, status, start_date)
VALUES (
  'ai_recommendation_vs_keyword',
  '对比 AI 语义推荐与关键词搜索的用户点击率和下单转化率',
  '{"control": 50, "treatment": 50}',
  'active',
  NOW()
);
