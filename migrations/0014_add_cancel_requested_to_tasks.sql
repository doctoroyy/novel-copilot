-- Migration number: 0014 	 2026-02-20T03:41:59.390Z
ALTER TABLE generation_tasks ADD COLUMN cancel_requested INTEGER DEFAULT 0;
