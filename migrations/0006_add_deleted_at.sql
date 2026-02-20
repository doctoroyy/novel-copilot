-- Add deleted_at column to projects table
-- ALTER TABLE projects ADD COLUMN deleted_at INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at);

-- Add deleted_at column to chapters table
-- ALTER TABLE chapters ADD COLUMN deleted_at INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_chapters_deleted ON chapters(project_id, deleted_at);
