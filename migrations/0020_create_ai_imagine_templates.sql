CREATE TABLE IF NOT EXISTS ai_imagine_template_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'fanqie_rank',
  source_url TEXT NOT NULL,
  ranking_json TEXT NOT NULL,
  templates_json TEXT NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'error')),
  error_message TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_ai_imagine_snapshot_created
ON ai_imagine_template_snapshots(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_imagine_snapshot_status_date
ON ai_imagine_template_snapshots(status, snapshot_date DESC);
