-- Project-level Copilot sidebar: platform skills, project settings, sessions, messages, proposals

CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  source_url TEXT,
  instructions TEXT NOT NULL,
  starter_prompts_json TEXT NOT NULL DEFAULT '[]',
  references_json TEXT NOT NULL DEFAULT '[]',
  tool_allowlist_json TEXT NOT NULL DEFAULT '[]',
  default_enabled INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS project_agent_settings (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  enabled_skill_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  enabled_skill_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  archived_at INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'trace', 'result', 'system')),
  content TEXT NOT NULL DEFAULT '',
  payload_json TEXT DEFAULT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS agent_proposals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  assistant_message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  goal TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  reasoning_summary TEXT NOT NULL DEFAULT '',
  actions_json TEXT NOT NULL DEFAULT '[]',
  preview_json TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK(risk_level IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'executed', 'failed', 'rejected')),
  result_summary TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  executed_at INTEGER DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_active ON agent_skills(is_active, default_enabled, name);
CREATE INDEX IF NOT EXISTS idx_project_agent_settings_enabled ON project_agent_settings(enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created ON agent_messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_session_created ON agent_proposals(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_proposals_status ON agent_proposals(status, updated_at DESC);
