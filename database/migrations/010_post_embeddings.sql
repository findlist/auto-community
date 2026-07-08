CREATE TABLE IF NOT EXISTS post_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL,
  post_type VARCHAR(20) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  embedding JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, post_type)
);

CREATE INDEX idx_post_embeddings_type ON post_embeddings(post_type);
CREATE INDEX idx_post_embeddings_hash ON post_embeddings(content_hash);