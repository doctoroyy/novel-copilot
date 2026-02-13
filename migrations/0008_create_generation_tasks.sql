-- Create generation_tasks table
CREATE TABLE IF NOT EXISTS generation_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  start_chapter INTEGER NOT NULL,
  completed_chapters TEXT DEFAULT '[]',
  failed_chapters TEXT DEFAULT '[]',
  current_progress INTEGER DEFAULT 0,
  current_message TEXT DEFAULT NULL,
  status TEXT DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed')),
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON generation_tasks(project_id, status);
