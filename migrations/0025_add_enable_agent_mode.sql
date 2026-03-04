-- Enable Agent mode (ReAct loop) for chapter generation
ALTER TABLE projects ADD COLUMN enable_agent_mode INTEGER DEFAULT 0;
