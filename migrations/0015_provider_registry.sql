-- Provider Registry + Model Registry Normalization (Improved)
PRAGMA foreign_keys=OFF;

-- 1. Create provider_registry
CREATE TABLE IF NOT EXISTS provider_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_encrypted TEXT,
  base_url TEXT,
  protocol TEXT NOT NULL DEFAULT 'openai',
  config_json TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- 2. Migrate existing unique provider configurations
INSERT OR IGNORE INTO provider_registry (id, name, api_key_encrypted, base_url, protocol)
SELECT 
  provider as id,
  provider as name,
  api_key_encrypted,
  base_url,
  CASE 
    WHEN provider = 'gemini' THEN 'gemini'
    WHEN provider = 'anthropic' THEN 'anthropic'
    ELSE 'openai'
  END as protocol
FROM model_registry
GROUP BY provider;

-- 3. Create new model_registry table
CREATE TABLE IF NOT EXISTS model_registry_new (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES provider_registry(id),
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  credit_multiplier REAL DEFAULT 1.0,
  capabilities TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  is_default INTEGER DEFAULT 0,
  config_json TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(provider_id, model_name)
);

-- 4. Copy data
INSERT INTO model_registry_new (
  id, provider_id, model_name, display_name, credit_multiplier, 
  capabilities, is_active, is_default, config_json, created_at, updated_at
)
SELECT 
  id, provider, model_name, display_name, credit_multiplier, 
  capabilities, is_active, is_default, config_json, created_at, updated_at
FROM model_registry;

-- 5. Re-create feature_model_mappings to point to new model_registry
CREATE TABLE IF NOT EXISTS feature_model_mappings_new (
  feature_key TEXT PRIMARY KEY REFERENCES credit_features(feature_key),
  model_id TEXT NOT NULL REFERENCES model_registry_new(id),
  temperature REAL DEFAULT 0.7,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

INSERT INTO feature_model_mappings_new SELECT * FROM feature_model_mappings;

-- 6. Swap all tables
DROP TABLE feature_model_mappings;
DROP TABLE model_registry;

ALTER TABLE model_registry_new RENAME TO model_registry;
ALTER TABLE feature_model_mappings_new RENAME TO feature_model_mappings;

-- 7. Re-create indexes
CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider_id);
CREATE INDEX IF NOT EXISTS idx_model_registry_active ON model_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_feature_model_mappings_feature ON feature_model_mappings(feature_key);

PRAGMA foreign_keys=ON;
