type ChapterRow = {
  chapter_index: number | string | null;
};

export type ProjectChapterContinuity = {
  chapterIndices: number[];
  contiguousChapterIndex: number;
  maxChapterIndex: number;
  firstMissingChapter: number | null;
  nextChapterIndex: number;
};

export type SummarySnapshotState = {
  rollingSummary: string;
  openLoops: string[];
  summaryBaseChapterIndex: number;
};

function normalizeChapterIndex(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export async function getProjectChapterContinuity(
  db: D1Database,
  projectId: string,
): Promise<ProjectChapterContinuity> {
  const { results } = await db.prepare(`
    SELECT chapter_index
    FROM chapters
    WHERE project_id = ? AND deleted_at IS NULL
    ORDER BY chapter_index ASC
  `).bind(projectId).all();

  const chapterIndices = Array.from(new Set(
    (results as ChapterRow[])
      .map((row) => normalizeChapterIndex(row.chapter_index))
      .filter((value): value is number => value !== null)
  )).sort((a, b) => a - b);

  let contiguousChapterIndex = 0;
  let firstMissingChapter: number | null = null;

  for (const chapterIndex of chapterIndices) {
    if (firstMissingChapter !== null) {
      break;
    }
    if (chapterIndex === contiguousChapterIndex + 1) {
      contiguousChapterIndex = chapterIndex;
      continue;
    }
    if (chapterIndex > contiguousChapterIndex + 1) {
      firstMissingChapter = contiguousChapterIndex + 1;
    }
  }

  const maxChapterIndex = chapterIndices.length > 0
    ? chapterIndices[chapterIndices.length - 1]
    : 0;

  return {
    chapterIndices,
    contiguousChapterIndex,
    maxChapterIndex,
    firstMissingChapter,
    nextChapterIndex: contiguousChapterIndex + 1,
  };
}

export async function loadSummarySnapshotUpToChapter(
  db: D1Database,
  projectId: string,
  chapterIndex: number,
): Promise<SummarySnapshotState> {
  if (chapterIndex <= 0) {
    return {
      rollingSummary: '',
      openLoops: [],
      summaryBaseChapterIndex: 0,
    };
  }

  const row = await db.prepare(`
    SELECT rolling_summary, open_loops, summary_base_chapter_index
    FROM summary_memories
    WHERE project_id = ?
      AND chapter_index <= ?
      AND COALESCE(summary_base_chapter_index, 0) <= ?
    ORDER BY chapter_index DESC, id DESC
    LIMIT 1
  `).bind(projectId, chapterIndex, chapterIndex).first() as {
    rolling_summary?: string;
    open_loops?: string;
    summary_base_chapter_index?: number | string | null;
  } | null;

  if (!row) {
    return {
      rollingSummary: '',
      openLoops: [],
      summaryBaseChapterIndex: 0,
    };
  }

  let openLoops: string[] = [];
  try {
    openLoops = row.open_loops ? JSON.parse(row.open_loops) : [];
  } catch {
    openLoops = [];
  }

  const summaryBaseChapterIndex = Math.max(
    0,
    Number.parseInt(String(row.summary_base_chapter_index ?? '0'), 10) || 0,
  );

  return {
    rollingSummary: String(row.rolling_summary || ''),
    openLoops,
    summaryBaseChapterIndex,
  };
}

export async function rebaseProjectStateToContinuity(
  db: D1Database,
  projectId: string,
): Promise<ProjectChapterContinuity & SummarySnapshotState> {
  const continuity = await getProjectChapterContinuity(db, projectId);
  const snapshot = await loadSummarySnapshotUpToChapter(
    db,
    projectId,
    continuity.contiguousChapterIndex,
  );

  await db.prepare(`
    UPDATE states
    SET
      next_chapter_index = ?,
      rolling_summary = ?,
      summary_base_chapter_index = ?,
      open_loops = ?
    WHERE project_id = ?
  `).bind(
    continuity.nextChapterIndex,
    snapshot.rollingSummary,
    snapshot.summaryBaseChapterIndex,
    JSON.stringify(snapshot.openLoops),
    projectId,
  ).run();

  await db.prepare(`
    DELETE FROM character_states
    WHERE project_id = ?
      AND last_updated_chapter > ?
  `).bind(projectId, continuity.contiguousChapterIndex).run();

  await db.prepare(`
    DELETE FROM plot_graphs
    WHERE project_id = ?
      AND last_updated_chapter > ?
  `).bind(projectId, continuity.contiguousChapterIndex).run();

  return {
    ...continuity,
    ...snapshot,
  };
}

export async function pruneProjectArtifactsBeyondChapter(
  db: D1Database,
  projectId: string,
  chapterIndex: number,
): Promise<void> {
  await db.prepare(`
    UPDATE chapters
    SET deleted_at = (unixepoch() * 1000)
    WHERE project_id = ?
      AND chapter_index > ?
      AND deleted_at IS NULL
  `).bind(projectId, chapterIndex).run();

  await db.prepare(`
    DELETE FROM summary_memories
    WHERE project_id = ?
      AND chapter_index > ?
  `).bind(projectId, chapterIndex).run();

  await db.prepare(`
    DELETE FROM chapter_qc
    WHERE project_id = ?
      AND chapter_index > ?
  `).bind(projectId, chapterIndex).run();

  await db.prepare(`
    DELETE FROM generation_perf_logs
    WHERE project_id = ?
      AND chapter_index > ?
  `).bind(projectId, chapterIndex).run();
}

export async function trimProjectToContinuity(
  db: D1Database,
  projectId: string,
): Promise<ProjectChapterContinuity & SummarySnapshotState> {
  const continuity = await getProjectChapterContinuity(db, projectId);
  await pruneProjectArtifactsBeyondChapter(db, projectId, continuity.contiguousChapterIndex);
  return rebaseProjectStateToContinuity(db, projectId);
}
