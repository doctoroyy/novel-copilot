CREATE TABLE IF NOT EXISTS bible_generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  request_json TEXT NOT NULL,
  result_bible TEXT,
  template_applied_json TEXT,
  fallback_model_provider TEXT,
  fallback_model_name TEXT,
  message TEXT,
  error_message TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_bible_jobs_user_created ON bible_generation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bible_jobs_user_status ON bible_generation_jobs(user_id, status, created_at DESC);
