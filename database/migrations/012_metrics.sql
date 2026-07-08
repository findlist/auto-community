CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  value DECIMAL(10,2) NOT NULL,
  tags JSONB DEFAULT '{}',
  recorded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_metrics_name_time ON metrics(name, recorded_at);
CREATE INDEX idx_metrics_tags ON metrics USING GIN(tags);

COMMENT ON TABLE metrics IS '效果度量数据表，记录核心业务指标';
COMMENT ON COLUMN metrics.name IS '指标名称：emergency_response_time, match_success_rate, order_completion_rate, user_satisfaction_score, ai_recommendation_accuracy';
COMMENT ON COLUMN metrics.value IS '指标值';
COMMENT ON COLUMN metrics.tags IS '标签，如 {"module":"skill","user_id":123}';
