-- Novel Copilot D1 Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  google_id TEXT UNIQUE,
  email TEXT UNIQUE,
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  last_login_at INTEGER DEFAULT NULL
);

-- System settings (global runtime configuration)
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

INSERT OR IGNORE INTO system_settings (setting_key, setting_value, description)
VALUES ('summary_update_interval', '2', '批量生成时摘要更新间隔（章）');

-- Invitation codes table
CREATE TABLE IF NOT EXISTS invitation_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used_by TEXT REFERENCES users(id) DEFAULT NULL,
  used_at INTEGER DEFAULT NULL,
  expires_at INTEGER DEFAULT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  bible TEXT NOT NULL,
  chapter_prompt_profile TEXT DEFAULT 'web_novel_light',
  chapter_prompt_custom TEXT DEFAULT '',
  user_id TEXT REFERENCES users(id),
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  deleted_at INTEGER DEFAULT NULL
);

-- State table (one per project)
CREATE TABLE IF NOT EXISTS states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  book_title TEXT DEFAULT '',
  total_chapters INTEGER DEFAULT 100,
  min_chapter_words INTEGER DEFAULT 2500,
  next_chapter_index INTEGER DEFAULT 1,
  rolling_summary TEXT DEFAULT '',
  open_loops TEXT DEFAULT '[]',
  need_human INTEGER DEFAULT 0,
  need_human_reason TEXT DEFAULT NULL
);

-- Summary memory snapshots (章节级记忆快照)
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

-- Chapters table
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  deleted_at INTEGER DEFAULT NULL,
  UNIQUE(project_id, chapter_index)
);

-- Outlines table (JSON stored as text)
CREATE TABLE IF NOT EXISTS outlines (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  outline_json TEXT NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id);
CREATE INDEX IF NOT EXISTS idx_chapters_project_index ON chapters(project_id, chapter_index);
CREATE INDEX IF NOT EXISTS idx_summary_memories_project_chapter ON summary_memories(project_id, chapter_index DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_summary_memories_created_at ON summary_memories(project_id, created_at DESC);

-- Indexes for soft delete queries
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_chapters_deleted ON chapters(project_id, deleted_at);

-- Characters table (Character Relationship Graph)
CREATE TABLE IF NOT EXISTS characters (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  characters_json TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- =====================================================
-- Phase 1: Character State Tracking System
-- =====================================================

-- Character States table (动态人物状态快照)
CREATE TABLE IF NOT EXISTS character_states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  registry_json TEXT NOT NULL,
  last_updated_chapter INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- =====================================================
-- Phase 2: Plot Graph System
-- =====================================================

-- Plot Graphs table (剧情图谱)
CREATE TABLE IF NOT EXISTS plot_graphs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  graph_json TEXT NOT NULL,
  last_updated_chapter INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- =====================================================
-- Phase 3: Narrative Control System
-- =====================================================

-- Narrative Config table (叙事配置)
CREATE TABLE IF NOT EXISTS narrative_config (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  pacing_curve_json TEXT,
  narrative_arc_json TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- =====================================================
-- Phase 4: Multi-dimensional QC System
-- =====================================================

-- Chapter QC Results table (章节质量检测结果)
CREATE TABLE IF NOT EXISTS chapter_qc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  qc_json TEXT NOT NULL,
  passed INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(project_id, chapter_index)
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_chapter_qc_project ON chapter_qc(project_id);
CREATE INDEX IF NOT EXISTS idx_chapter_qc_score ON chapter_qc(project_id, score);

-- =====================================================
-- AI 自动想象模板快照（番茄热榜 -> LLM 模板）
-- =====================================================

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

CREATE INDEX IF NOT EXISTS idx_ai_imagine_snapshot_created ON ai_imagine_template_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_imagine_snapshot_status_date ON ai_imagine_template_snapshots(status, snapshot_date DESC);

-- =====================================================
-- AI 自动想象模板刷新任务（异步队列）
-- =====================================================

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

CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_created ON ai_imagine_template_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_status ON ai_imagine_template_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_snapshot_status ON ai_imagine_template_jobs(snapshot_date, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_imagine_jobs_user_created ON ai_imagine_template_jobs(requested_by_user_id, created_at DESC);

-- =====================================================
-- Generation Tasks (for persistence and resume)
-- =====================================================

CREATE TABLE IF NOT EXISTS generation_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  start_chapter INTEGER NOT NULL,
  completed_chapters TEXT DEFAULT '[]',
  failed_chapters TEXT DEFAULT '[]',
  current_progress INTEGER DEFAULT 0,
  current_message TEXT DEFAULT NULL,
  cancel_requested INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed')),
  error_message TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON generation_tasks(project_id, status);
