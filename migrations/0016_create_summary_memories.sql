-- 章节级剧情摘要记忆快照表
CREATE TABLE IF NOT EXISTS summary_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  rolling_summary TEXT NOT NULL,
  open_loops TEXT DEFAULT '[]',
  summary_updated INTEGER DEFAULT 1,
  update_reason TEXT DEFAULT 'interval',
  model_provider TEXT,
  model_name TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_summary_memories_project_chapter
  ON summary_memories(project_id, chapter_index DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_summary_memories_created_at
  ON summary_memories(project_id, created_at DESC);
