-- Add cancel request marker for graceful task cancellation
ALTER TABLE generation_tasks ADD COLUMN cancel_requested INTEGER DEFAULT 0;

-- Backfill for old records
UPDATE generation_tasks
SET cancel_requested = 0
WHERE cancel_requested IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_cancel_requested ON generation_tasks(cancel_requested);
