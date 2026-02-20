-- 移除 model_registry 表的 UNIQUE(provider, model_name) 约束
-- 允许同一 provider 下注册多个模型
-- SQLite 需要重建表来移除约束，需先处理外键引用

-- 1. 禁用外键检查
PRAGMA foreign_keys=OFF;

-- 2. 备份 feature_model_mappings 数据
CREATE TABLE IF NOT EXISTS feature_model_mappings_backup AS SELECT * FROM feature_model_mappings;

-- 3. 删除引用 model_registry 的表
DROP TABLE IF EXISTS feature_model_mappings;

-- 4. 重建 model_registry（无唯一约束）
CREATE TABLE IF NOT EXISTS model_registry_new (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  api_key_encrypted TEXT,
  base_url TEXT,
  credit_multiplier REAL DEFAULT 1.0,
  capabilities TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  is_default INTEGER DEFAULT 0,
  config_json TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

INSERT INTO model_registry_new SELECT * FROM model_registry;
DROP TABLE model_registry;
ALTER TABLE model_registry_new RENAME TO model_registry;

-- 5. 重建 feature_model_mappings（带外键引用新表）
CREATE TABLE IF NOT EXISTS feature_model_mappings (
  feature_key TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  temperature REAL DEFAULT 0.7,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (feature_key) REFERENCES credit_features(feature_key),
  FOREIGN KEY (model_id) REFERENCES model_registry(id)
);

INSERT INTO feature_model_mappings SELECT * FROM feature_model_mappings_backup;
DROP TABLE feature_model_mappings_backup;

CREATE INDEX IF NOT EXISTS idx_feature_model_mappings_feature ON feature_model_mappings(feature_key);

-- 6. 重新启用外键检查
PRAGMA foreign_keys=ON;
