ALTER TABLE generation_tasks
ADD COLUMN task_type TEXT NOT NULL DEFAULT 'chapters';

CREATE INDEX IF NOT EXISTS idx_tasks_user_status_type
ON generation_tasks(user_id, status, task_type);
