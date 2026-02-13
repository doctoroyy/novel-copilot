-- Migration to add allow_custom_provider field
-- Run with: wrangler d1 execute novel-copilot-db --local --file=migrations/0009_add_custom_provider_whitelist.sql

-- 1. Add allow_custom_provider column to users table
ALTER TABLE users ADD COLUMN allow_custom_provider INTEGER DEFAULT 0;

-- 2. Enable for specific users
UPDATE users SET allow_custom_provider = 1 WHERE username IN ('chao', 'fan');
