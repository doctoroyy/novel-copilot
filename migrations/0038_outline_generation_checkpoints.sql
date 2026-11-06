CREATE TABLE IF NOT EXISTS outline_generation_checkpoints (
  task_id INTEGER PRIMARY KEY,
  outline_json TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);
