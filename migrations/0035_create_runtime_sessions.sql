-- Migration: Create runtime_sessions table

CREATE TABLE IF NOT EXISTS runtime_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    runtime TEXT NOT NULL, -- 'anthropic_direct', 'openai_direct', 'claude_code', 'gemini', 'local_model'
    model TEXT NOT NULL,
    system_prompt_hash TEXT,
    cache_hit_rate REAL,
    status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed', 'cancelled'
    last_error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_sessions_project_id ON runtime_sessions(project_id);
