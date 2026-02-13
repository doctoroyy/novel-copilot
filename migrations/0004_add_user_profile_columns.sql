-- Add user profile/auth fields required by auth routes
-- ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
-- ALTER TABLE users ADD COLUMN google_id TEXT;
-- ALTER TABLE users ADD COLUMN email TEXT;
-- ALTER TABLE users ADD COLUMN avatar_url TEXT;

-- CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
