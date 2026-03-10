-- Track which chapter the current rolling summary actually reflects.
ALTER TABLE states ADD COLUMN summary_base_chapter_index INTEGER DEFAULT 0;
ALTER TABLE summary_memories ADD COLUMN summary_base_chapter_index INTEGER DEFAULT 0;

-- Backfill current state conservatively from existing next_chapter_index.
UPDATE states
SET summary_base_chapter_index = CASE
  WHEN COALESCE(next_chapter_index, 1) > 1 THEN COALESCE(next_chapter_index, 1) - 1
  ELSE 0
END
WHERE summary_base_chapter_index IS NULL OR summary_base_chapter_index = 0;

-- Backfill memory snapshots to the latest chapter that actually refreshed the summary.
UPDATE summary_memories
SET summary_base_chapter_index = CASE
  WHEN COALESCE(summary_updated, 0) = 1 THEN chapter_index
  ELSE COALESCE((
    SELECT MAX(prev.chapter_index)
    FROM summary_memories AS prev
    WHERE prev.project_id = summary_memories.project_id
      AND COALESCE(prev.summary_updated, 0) = 1
      AND prev.chapter_index < summary_memories.chapter_index
  ), 0)
END
WHERE summary_base_chapter_index IS NULL OR summary_base_chapter_index = 0;
