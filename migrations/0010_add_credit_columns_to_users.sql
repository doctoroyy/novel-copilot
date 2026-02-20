-- Add credit-related columns to users table
-- These were commented out in 0005_credit_system.sql
ALTER TABLE users ADD COLUMN credit_balance INTEGER DEFAULT 150;
ALTER TABLE users ADD COLUMN vip_type TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN vip_expire_at INTEGER DEFAULT NULL;
ALTER TABLE users ADD COLUMN level INTEGER DEFAULT 1;
