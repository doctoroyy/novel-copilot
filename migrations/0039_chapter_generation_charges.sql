CREATE TABLE IF NOT EXISTS chapter_generation_charges (
  task_id INTEGER NOT NULL,
  chapter_index INTEGER NOT NULL,
  PRIMARY KEY (task_id, chapter_index),
  FOREIGN KEY (task_id) REFERENCES generation_tasks(id) ON DELETE CASCADE
);
