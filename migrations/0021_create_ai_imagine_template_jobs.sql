CREATE TABLE IF NOT EXISTS ai_imagine_template_jobs (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  force INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',
  requested_by_user_id TEXT,
  requested_by_role TEXT NOT NULL DEFAULT 'user',
  source_urls_json TEXT,
  max_templates INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  message TEXT,
  error_message TEXT,
  result_template_count INTEGER NOT NULL DEFAULT 0,
  result_hot_count INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_created
ON ai_imagine_template_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_status
ON ai_imagine_template_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_snapshot_status
ON ai_imagine_template_jobs(snapshot_date, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_user_created
ON ai_imagine_template_jobs(requested_by_user_id, created_at DESC);
