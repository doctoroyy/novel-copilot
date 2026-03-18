-- Add task_id to qc_reports for cancellation support
ALTER TABLE qc_reports ADD COLUMN task_id INTEGER;
