-- Novel Copilot D1 Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME DEFAULT NULL
);

-- Invitation codes table
CREATE TABLE IF NOT EXISTS invitation_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used_by TEXT REFERENCES users(id) DEFAULT NULL,
  used_at DATETIME DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  bible TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL
);

-- State table (one per project)
CREATE TABLE IF NOT EXISTS states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  book_title TEXT DEFAULT '',
  total_chapters INTEGER DEFAULT 100,
  next_chapter_index INTEGER DEFAULT 1,
  rolling_summary TEXT DEFAULT '',
  open_loops TEXT DEFAULT '[]',
  need_human INTEGER DEFAULT 0,
  need_human_reason TEXT DEFAULT NULL
);

-- Chapters table
CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME DEFAULT NULL,
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

-- Indexes for soft delete queries
CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at);
CREATE INDEX IF NOT EXISTS idx_chapters_deleted ON chapters(project_id, deleted_at);

-- Characters table (Character Relationship Graph)
CREATE TABLE IF NOT EXISTS characters (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  characters_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- Phase 1: Character State Tracking System
-- =====================================================

-- Character States table (动态人物状态快照)
CREATE TABLE IF NOT EXISTS character_states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  registry_json TEXT NOT NULL,
  last_updated_chapter INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- Phase 2: Plot Graph System
-- =====================================================

-- Plot Graphs table (剧情图谱)
CREATE TABLE IF NOT EXISTS plot_graphs (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  graph_json TEXT NOT NULL,
  last_updated_chapter INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- Phase 3: Narrative Control System
-- =====================================================

-- Narrative Config table (叙事配置)
CREATE TABLE IF NOT EXISTS narrative_config (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  pacing_curve_json TEXT,
  narrative_arc_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, chapter_index)
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_chapter_qc_project ON chapter_qc(project_id);
CREATE INDEX IF NOT EXISTS idx_chapter_qc_score ON chapter_qc(project_id, score);

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
  status TEXT DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed')),
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON generation_tasks(project_id, status);
