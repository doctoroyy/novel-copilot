-- Add task progress columns for generation task status tracking
ALTER TABLE generation_tasks ADD COLUMN current_progress INTEGER DEFAULT 0;
ALTER TABLE generation_tasks ADD COLUMN current_message TEXT DEFAULT NULL;
