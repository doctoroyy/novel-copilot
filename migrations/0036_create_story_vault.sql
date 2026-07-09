-- Story Vault / Story Bible 2.0 structured assets

CREATE TABLE IF NOT EXISTS story_entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'premise', 'style', 'world', 'character', 'location', 'item', 'faction', 'rule', 'thread', 'market', 'note'
  )),
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL DEFAULT '',
  status_json TEXT NOT NULL DEFAULT '{}',
  trigger_terms_json TEXT NOT NULL DEFAULT '[]',
  importance INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  last_referenced_chapter INTEGER,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS story_threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'main' CHECK(kind IN ('main', 'sub', 'foreshadow', 'romance', 'mystery', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'active', 'paused', 'resolved', 'abandoned')),
  summary TEXT NOT NULL DEFAULT '',
  stakes TEXT NOT NULL DEFAULT '',
  related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
  first_chapter INTEGER,
  last_chapter INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS story_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'extract', 'import', 'agent')),
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS story_extract_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'chapter' CHECK(source_type IN ('chapter', 'bible', 'chat', 'manual')),
  source_ref TEXT,
  summary TEXT NOT NULL DEFAULT '',
  entities_json TEXT NOT NULL DEFAULT '[]',
  threads_json TEXT NOT NULL DEFAULT '[]',
  notes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'partial')),
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_story_entities_project_type ON story_entities(project_id, type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_entities_project_name ON story_entities(project_id, name);
CREATE INDEX IF NOT EXISTS idx_story_threads_project_status ON story_threads(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_notes_project ON story_notes(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_extract_proposals_project ON story_extract_proposals(project_id, status, created_at DESC);
