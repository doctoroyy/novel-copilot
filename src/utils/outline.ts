import type { ChapterOutline, NovelOutline, VolumeOutline } from '../generateOutline.js';

type NormalizeOutlineOptions = {
  fallbackMinChapterWords?: number;
  fallbackTargetWordCount?: number;
  fallbackTotalChapters?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function pickText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function toPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMilestones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => pickText(item))
    .filter(Boolean);
}

function normalizeChapter(raw: unknown, fallbackIndex: number): ChapterOutline {
  const record = asRecord(raw);
  const index = toPositiveInteger(record?.index ?? record?.chapterIndex, fallbackIndex);

  return {
    index,
    title: pickText(record?.title) || `第${index}章`,
    goal: pickText(record?.goal, record?.summary, record?.description, record?.objective),
    hook: pickText(record?.hook, record?.hooks, record?.cliffhanger, record?.summary),
  };
}

function normalizeVolume(raw: unknown, fallbackIndex: number): VolumeOutline | null {
  const record = asRecord(raw);
  if (!record) return null;

  const rawChapters = Array.isArray(record.chapters) ? record.chapters : [];
  if (rawChapters.length === 0) return null;

  const normalizedChapters = rawChapters
    .map((chapter, chapterIndex) => normalizeChapter(
      chapter,
      toPositiveInteger(record.startChapter, chapterIndex + 1),
    ))
    .sort((left, right) => left.index - right.index);

  const firstChapter = normalizedChapters[0];
  const lastChapter = normalizedChapters[normalizedChapters.length - 1];

  return {
    title: pickText(record.title) || `第${fallbackIndex}卷`,
    startChapter: toPositiveInteger(record.startChapter, firstChapter.index),
    endChapter: toPositiveInteger(record.endChapter, lastChapter.index),
    goal: pickText(record.goal, firstChapter.goal),
    conflict: pickText(record.conflict),
    climax: pickText(record.climax, lastChapter.hook, lastChapter.title),
    chapters: normalizedChapters,
  };
}

function buildFallbackVolumes(chapters: ChapterOutline[]): VolumeOutline[] {
  if (chapters.length === 0) return [];

  const volumeCount = chapters.length >= 24 ? 3 : chapters.length >= 12 ? 2 : 1;
  const chunkSize = Math.ceil(chapters.length / volumeCount);
  const volumes: VolumeOutline[] = [];

  for (let volumeIndex = 0; volumeIndex < volumeCount; volumeIndex += 1) {
    const start = volumeIndex * chunkSize;
    const chunk = chapters.slice(start, start + chunkSize);
    if (chunk.length === 0) continue;

    const firstChapter = chunk[0];
    const lastChapter = chunk[chunk.length - 1];

    volumes.push({
      title: volumeCount === 1 ? '全书主线' : `第${volumeIndex + 1}卷`,
      startChapter: firstChapter.index,
      endChapter: lastChapter.index,
      goal: firstChapter.goal || `推进第 ${firstChapter.index}-${lastChapter.index} 章主线`,
      conflict: chunk.find((chapter) => chapter.hook)?.hook || '',
      climax: lastChapter.hook || lastChapter.title,
      chapters: chunk,
    });
  }

  return volumes;
}

function deriveTargetWordCount(totalChapters: number, options?: NormalizeOutlineOptions): number {
  const minChapterWords = toPositiveInteger(options?.fallbackMinChapterWords, 2500);
  const fallback = options?.fallbackTargetWordCount && options.fallbackTargetWordCount > 0
    ? options.fallbackTargetWordCount
    : Math.max(1, Math.ceil((totalChapters * minChapterWords) / 10000));
  return fallback;
}

export function normalizeNovelOutline(
  raw: unknown,
  options?: NormalizeOutlineOptions
): NovelOutline | null {
  if (!raw) return null;

  let volumes: VolumeOutline[] = [];
  let mainGoal = '';
  let milestones: string[] = [];
  let rawTotalChapters: unknown;
  let rawTargetWordCount: unknown;

  if (Array.isArray(raw)) {
    const chapters = raw
      .map((chapter, index) => normalizeChapter(chapter, index + 1))
      .sort((left, right) => left.index - right.index);
    volumes = buildFallbackVolumes(chapters);
    mainGoal = chapters[chapters.length - 1]?.goal || chapters[0]?.goal || '';
  } else {
    const record = asRecord(raw);
    if (!record) return null;

    rawTotalChapters = record.totalChapters;
    rawTargetWordCount = record.targetWordCount;
    mainGoal = pickText(record.mainGoal, record.goal, record.summary);
    milestones = normalizeMilestones(record.milestones);

    if (Array.isArray(record.volumes) && record.volumes.length > 0) {
      volumes = record.volumes
        .map((volume, index) => normalizeVolume(volume, index + 1))
        .filter((volume): volume is VolumeOutline => Boolean(volume));
    } else if (Array.isArray(record.chapters) && record.chapters.length > 0) {
      const chapters = record.chapters
        .map((chapter, index) => normalizeChapter(chapter, index + 1))
        .sort((left, right) => left.index - right.index);
      volumes = buildFallbackVolumes(chapters);
    }
  }

  if (volumes.length === 0) return null;

  const normalizedVolumes = volumes
    .map((volume, index) => {
      const chapters = volume.chapters
        .map((chapter, chapterIndex) => normalizeChapter(chapter, chapterIndex + 1))
        .sort((left, right) => left.index - right.index);
      if (chapters.length === 0) return null;

      const firstChapter = chapters[0];
      const lastChapter = chapters[chapters.length - 1];

      return {
        title: volume.title || `第${index + 1}卷`,
        startChapter: toPositiveInteger(volume.startChapter, firstChapter.index),
        endChapter: toPositiveInteger(volume.endChapter, lastChapter.index),
        goal: volume.goal || firstChapter.goal || `推进第 ${firstChapter.index}-${lastChapter.index} 章主线`,
        conflict: volume.conflict || '',
        climax: volume.climax || lastChapter.hook || lastChapter.title,
        chapters,
      };
    })
    .filter((volume): volume is VolumeOutline => Boolean(volume));

  if (normalizedVolumes.length === 0) return null;

  const allChapters = normalizedVolumes
    .flatMap((volume) => volume.chapters)
    .sort((left, right) => left.index - right.index);
  const highestChapterIndex = allChapters[allChapters.length - 1]?.index || 0;

  const totalChapters = toPositiveInteger(
    rawTotalChapters,
    options?.fallbackTotalChapters && options.fallbackTotalChapters > 0
      ? options.fallbackTotalChapters
      : highestChapterIndex || allChapters.length,
  );
  const targetWordCount = toPositiveInteger(
    rawTargetWordCount,
    deriveTargetWordCount(totalChapters, options),
  );

  if (!mainGoal) {
    mainGoal = allChapters[allChapters.length - 1]?.goal || allChapters[0]?.goal || `推进全书主线，共 ${totalChapters} 章`;
  }

  if (milestones.length === 0) {
    milestones = normalizedVolumes.map((volume) => volume.goal
      ? `${volume.title}：${volume.goal}`
      : `${volume.title}：完成第 ${volume.startChapter}-${volume.endChapter} 章`);
  }

  return {
    totalChapters,
    targetWordCount,
    volumes: normalizedVolumes,
    mainGoal,
    milestones,
  };
}
