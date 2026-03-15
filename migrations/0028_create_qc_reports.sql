CREATE TABLE IF NOT EXISTS qc_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  scan_mode TEXT NOT NULL DEFAULT 'standard',
  report_json TEXT NOT NULL,
  overall_score INTEGER DEFAULT 0,
  total_issues INTEGER DEFAULT 0,
  critical_count INTEGER DEFAULT 0,
  major_count INTEGER DEFAULT 0,
  minor_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_qc_reports_project ON qc_reports(project_id, created_at DESC);
