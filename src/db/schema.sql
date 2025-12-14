-- Novel Copilot D1 Database Schema

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  bible TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
