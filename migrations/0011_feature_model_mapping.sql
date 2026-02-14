-- Feature Model Mapping Table
-- Allows configuring specific models for specific features

CREATE TABLE IF NOT EXISTS feature_model_mappings (
  feature_key TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  temperature REAL DEFAULT 0.7,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (feature_key) REFERENCES credit_features(feature_key),
  FOREIGN KEY (model_id) REFERENCES model_registry(id)
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_feature_model_mappings_feature ON feature_model_mappings(feature_key);
