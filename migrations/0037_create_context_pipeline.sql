-- Phase 2: Context Builder pipeline — chapter blueprints, context packages, AI job ledger

-- Chapter Blueprints: the editable plan for a single chapter before drafting
CREATE TABLE IF NOT EXISTS chapter_blueprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  goal_json TEXT NOT NULL DEFAULT '{}',        -- { primary, secondary, emotional }
  conflict TEXT NOT NULL DEFAULT '',
  hook TEXT NOT NULL DEFAULT '',
  scene_beats_json TEXT NOT NULL DEFAULT '[]', -- [{ id, summary, action, emotion, info_reveal, characters:[] }]
  state_delta_plan_json TEXT NOT NULL DEFAULT '[]', -- planned character/thread state changes
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  author_notes TEXT NOT NULL DEFAULT '',        -- 本章禁忌 / 作者备注
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','generating','drafted','reviewing','committed','archived')),
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(project_id, chapter_index)
);
CREATE INDEX IF NOT EXISTS idx_chapter_blueprints_project_chapter ON chapter_blueprints(project_id, chapter_index);

-- Context Packages: a record of exactly what context was assembled for an AI call
CREATE TABLE IF NOT EXISTS context_packages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,                      -- 'chapter_draft' | 'blueprint' | 'repair' | 'summary' | 'qc' | 'extract'
  chapter_index INTEGER,
  blueprint_id TEXT,
  input_refs_json TEXT NOT NULL DEFAULT '[]',   -- [{ kind, refId, name, reason }]
  package_json TEXT NOT NULL DEFAULT '{}',      -- the full serialized context package
  token_budget_json TEXT NOT NULL DEFAULT '{}', -- { inputBudget, estimatedTokens }
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  prompt_hash TEXT NOT NULL DEFAULT '',
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_context_packages_project_chapter ON context_packages(project_id, chapter_index, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_packages_project_task ON context_packages(project_id, task_type, created_at DESC);

-- AI Job Ledger: every AI call records task, model, tokens, cost, duration, status
CREATE TABLE IF NOT EXISTS ai_job_ledger (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  context_package_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  phase TEXT NOT NULL,                          -- 'planning' | 'drafting' | 'review' | 'repair' | 'summary' | 'extract' | 'qc'
  task_type TEXT,
  chapter_index INTEGER,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  tool_read_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed','cancelled')),
  error_message TEXT,
  agent_turns INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS idx_ai_job_ledger_project ON ai_job_ledger(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_job_ledger_phase ON ai_job_ledger(phase, status, created_at DESC);
