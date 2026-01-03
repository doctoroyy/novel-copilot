-- Novel to AI Anime Conversion Schema
-- Phase 1: Core tables for anime project management

-- Anime projects table
CREATE TABLE IF NOT EXISTS anime_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  novel_text TEXT NOT NULL,
  total_episodes INTEGER DEFAULT 60,
  status TEXT DEFAULT 'pending', -- pending/processing/done/error
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Episodes table
CREATE TABLE IF NOT EXISTS anime_episodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES anime_projects(id) ON DELETE CASCADE,
  episode_num INTEGER NOT NULL,
  novel_chunk TEXT, -- 分配给该集的小说片段
  script TEXT, -- 生成的剧本
  storyboard_json TEXT, -- 分镜脚本 JSON
  video_r2_key TEXT, -- R2 存储路径
  audio_r2_key TEXT, -- TTS 音频 R2 存储路径
  duration_seconds INTEGER, -- 视频时长（秒）
  status TEXT DEFAULT 'pending', -- pending/script/storyboard/audio/video/done/error
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, episode_num)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_anime_projects_status ON anime_projects(status);
CREATE INDEX IF NOT EXISTS idx_anime_episodes_project ON anime_episodes(project_id);
CREATE INDEX IF NOT EXISTS idx_anime_episodes_status ON anime_episodes(project_id, status);

-- Phase 2: Series Script and Character Consistency

-- Series Scripts table (Global script for the entire series/season)
CREATE TABLE IF NOT EXISTS anime_series_scripts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES anime_projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL, -- Full global script
  outline TEXT, -- JSON scene breakdown per episode or global structure
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anime_series_scripts_project_unique ON anime_series_scripts(project_id);

-- Anime Characters table (Visual consistency references)
CREATE TABLE IF NOT EXISTS anime_characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES anime_projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT, -- Visual prompt/description
  image_url TEXT, -- Generated image URL (R2 or external)
  voice_id TEXT, -- Voice ID for TTS
  status TEXT DEFAULT 'pending', -- pending/generated/approved
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_anime_characters_project ON anime_characters(project_id);
