-- Add updated_at to projects, and change enable_agent_mode default to 1
-- SQLite ALTER TABLE ADD COLUMN only allows constant defaults
ALTER TABLE projects ADD COLUMN updated_at INTEGER;
UPDATE projects SET updated_at = (unixepoch() * 1000) WHERE updated_at IS NULL;

-- New projects should default to agent mode ON
-- SQLite doesn't support ALTER COLUMN DEFAULT, so we leave the schema default as-is
-- and handle it in application code (INSERT with explicit value 1)
