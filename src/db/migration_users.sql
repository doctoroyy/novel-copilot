-- User Authentication System Migration
-- Run with: wrangler d1 execute novel-copilot-db --file=src/db/migration_users.sql

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  google_id TEXT UNIQUE,
  email TEXT UNIQUE,
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  last_login_at INTEGER DEFAULT NULL
);

-- 邀请码表
CREATE TABLE IF NOT EXISTS invitation_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used_by TEXT REFERENCES users(id) DEFAULT NULL,
  used_at INTEGER DEFAULT NULL,
  expires_at INTEGER DEFAULT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Add user_id to projects (will be NULL for existing projects)
-- Note: SQLite doesn't support ADD COLUMN with REFERENCES in older versions,
-- so we add the column without the constraint
ALTER TABLE projects ADD COLUMN user_id TEXT DEFAULT NULL;

-- Add index for user_id
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
