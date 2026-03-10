import type { ChapterOutline, NovelOutline, VolumeOutline } from '../generateOutline.js';
import {
  type ChapterHook,
  type EnhancedChapterOutline,
  type StoryContractField,
  type StoryContract,
  type StoryContractScalar,
  type StoryContractSection,
  type VolumeStoryContract,
} from '../types/narrative.js';

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

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => pickText(item))
    .filter(Boolean);
}

function normalizeContractScalar(value: unknown): StoryContractScalar | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeContractField(value: unknown): StoryContractField | undefined {
  const scalar = normalizeContractScalar(value);
  if (scalar !== undefined) return scalar;

  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => normalizeContractScalar(item))
    .filter((item): item is StoryContractScalar => item !== undefined);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeContractSection(value: unknown): StoryContractSection | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const normalizedEntries = Object.entries(record)
    .map(([key, rawValue]) => [key.trim(), normalizeContractField(rawValue)] as const)
    .filter(([key, rawValue]) => key && rawValue !== undefined);

  if (normalizedEntries.length === 0) return undefined;
  return Object.fromEntries(normalizedEntries);
}

function normalizeStoryContract(raw: unknown): StoryContract | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;

  const scope = normalizeContractSection(record.scope);
  const crisis = normalizeContractSection(record.crisis);
  const threads = normalizeContractSection(record.threads);
  const stateTransition = normalizeContractSection(record.stateTransition);
  const notes = normalizeTextArray(record.notes);

  if (!scope && !crisis && !threads && !stateTransition && notes.length === 0) {
    return undefined;
  }

  return {
    scope,
    crisis,
    threads,
    stateTransition,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function normalizeVolumeStoryContract(raw: unknown): VolumeStoryContract | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;

  const base = normalizeStoryContract(raw);
  const chapterDefaults = normalizeStoryContract(record.chapterDefaults);

  if (!base && !chapterDefaults) {
    return undefined;
  }

  return {
    ...(base || {}),
    chapterDefaults,
  };
}

function normalizeChapter(raw: unknown, fallbackIndex: number): ChapterOutline {
  const record = asRecord(raw);
  const index = toPositiveInteger(record?.index ?? record?.chapterIndex, fallbackIndex);

  return {
    index,
    title: pickText(record?.title) || `第${index}章`,
    goal: pickText(record?.goal, record?.summary, record?.description, record?.objective),
    hook: pickText(record?.hook, record?.hooks, record?.cliffhanger, record?.summary),
    storyContract: normalizeStoryContract(record?.storyContract ?? record?.contract),
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
    volumeEndState: pickText(record.volumeEndState, record.volume_end_state),
    storyContract: normalizeVolumeStoryContract(record.storyContract ?? record.contract),
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
    .map((volume, index): VolumeOutline | null => {
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
        volumeEndState: pickText((volume as any).volumeEndState, (volume as any).volume_end_state),
        storyContract: normalizeVolumeStoryContract((volume as any).storyContract ?? (volume as any).contract),
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

export type OutlineChapterContext = {
  chapter: ChapterOutline;
  volume: VolumeOutline;
  volumeIndex: number;
  previousVolume?: VolumeOutline;
};

export function getOutlineChapterContext(
  outline: NovelOutline | null | undefined,
  chapterIndex: number
): OutlineChapterContext | null {
  if (!outline?.volumes) return null;

  for (let volumeIndex = 0; volumeIndex < outline.volumes.length; volumeIndex += 1) {
    const volume = outline.volumes[volumeIndex];
    const chapter = volume.chapters?.find((item) => Number(item.index) === chapterIndex);
    if (chapter) {
      return {
        chapter,
        volume,
        volumeIndex,
        previousVolume: volumeIndex > 0 ? outline.volumes[volumeIndex - 1] : undefined,
      };
    }
  }

  return null;
}

export function mergeStoryContract(
  chapterContract?: StoryContract,
  volumeContract?: VolumeStoryContract
): StoryContract | undefined {
  if (!chapterContract && !volumeContract) return undefined;

  const mergeSection = (
    base?: StoryContractSection,
    next?: StoryContractSection,
  ): StoryContractSection | undefined => {
    const merged = {
      ...(base || {}),
      ...(next || {}),
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
  };

  const defaultContract = volumeContract?.chapterDefaults;
  const merged: StoryContract = {
    scope: mergeSection(volumeContract?.scope, mergeSection(defaultContract?.scope, chapterContract?.scope)),
    crisis: mergeSection(volumeContract?.crisis, mergeSection(defaultContract?.crisis, chapterContract?.crisis)),
    threads: mergeSection(volumeContract?.threads, mergeSection(defaultContract?.threads, chapterContract?.threads)),
    stateTransition: mergeSection(
      volumeContract?.stateTransition,
      mergeSection(defaultContract?.stateTransition, chapterContract?.stateTransition),
    ),
    notes: Array.from(new Set([
      ...(volumeContract?.notes || []),
      ...(defaultContract?.notes || []),
      ...(chapterContract?.notes || []),
    ])),
  };
  const mergedNotes = merged.notes || [];

  if (!merged.scope && !merged.crisis && !merged.threads && !merged.stateTransition && mergedNotes.length === 0) {
    return undefined;
  }

  return {
    ...merged,
    notes: mergedNotes.length > 0 ? mergedNotes : undefined,
  };
}

function inferHookType(hook: string): ChapterHook['type'] {
  if (!hook) return 'mystery';
  if (/[？?]$/.test(hook)) return 'question';
  return 'mystery';
}

export function buildEnhancedOutlineFromChapterContext(
  context: OutlineChapterContext
): EnhancedChapterOutline {
  const mergedContract = mergeStoryContract(
    context.chapter.storyContract,
    context.volume.storyContract,
  );
  const successCriteria = [
    context.chapter.goal,
    context.chapter.hook ? `章末形成钩子：${context.chapter.hook}` : '',
  ].filter(Boolean);

  return {
    index: context.chapter.index,
    title: context.chapter.title,
    goal: {
      primary: context.chapter.goal || `推进第 ${context.chapter.index} 章主线`,
      successCriteria,
    },
    hook: {
      type: inferHookType(context.chapter.hook),
      content: context.chapter.hook || '章末抛出下一章必须回应的问题',
      strength: 6,
    },
    scenes: [],
    povCharacter: '主角',
    pacingType: 'tension',
    foreshadowingOps: [],
    characterArcProgress: [],
    storyContract: mergedContract,
  };
}
