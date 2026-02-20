-- Credit System + Model Registry Migration
-- Run with: wrangler d1 execute novel-copilot-db --local --file=migrations/0005_credit_system.sql

-- 1. Add credit fields to users table
-- ALTER TABLE users ADD COLUMN credit_balance INTEGER DEFAULT 150;
-- ALTER TABLE users ADD COLUMN vip_type TEXT DEFAULT 'free';
-- ALTER TABLE users ADD COLUMN vip_expire_at INTEGER DEFAULT NULL;
-- ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1;

-- 2. Credit Features table (功能定价配置)
CREATE TABLE IF NOT EXISTS credit_features (
  feature_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  base_cost INTEGER NOT NULL DEFAULT 10,
  model_multiplier_enabled INTEGER DEFAULT 1,
  is_vip_only INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  category TEXT DEFAULT 'basic',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- 3. Credit Transactions table (消费流水记录)
CREATE TABLE IF NOT EXISTS credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  feature_key TEXT,
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('consume', 'recharge', 'reward', 'refund')),
  description TEXT,
  metadata TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_time ON credit_transactions(user_id, created_at DESC);

-- 4. Model Registry table (模型注册中心)
CREATE TABLE IF NOT EXISTS model_registry (
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
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(provider, model_name)
);

-- 5. Seed data: default credit features
INSERT OR IGNORE INTO credit_features (feature_key, name, description, base_cost, category)
VALUES
  ('generate_chapter', '生成章节', '生成单个章节（约1000字）', 10, 'basic'),
  ('generate_outline', '生成大纲', '生成小说大纲结构', 15, 'basic'),
  ('generate_characters', '生成人设', '生成角色设定', 10, 'basic'),
  ('rewrite_chapter', '重写章节', '续写或重写章节内容', 8, 'basic'),
  ('consistency_check', '一致性检测', 'AI 检测章节一致性', 12, 'advanced'),
  ('refine_outline', '细化大纲', '优化和细化大纲', 15, 'advanced'),
  ('ai_imagine', 'AI 自动想象', '创意性增强生成', 20, 'advanced');
