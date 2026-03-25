import path from 'node:path';
import fs from 'node:fs/promises';
import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import { readBible, readState, writeState, type BookState } from './memory.js';
import {
  buildVolumeBridgeContext,
  buildVolumeBridgeNotes,
  buildVolumeContinuationSummary,
  isVolumeBridgeChapter,
  TIMELINE_RESET_PATTERN,
  VOLUME_BRIDGE_CHAPTER_COUNT,
} from './utils/volumeBridge.js';
import type {
  StoryContract,
  StoryContractField,
  StoryContractScalar,
  StoryContractSection,
  VolumeStoryContract,
} from './types/narrative.js';

/**
 * 大纲类型
 */
export type NovelOutline = {
  /** 总章数 */
  totalChapters: number;
  /** 总字数目标 */
  targetWordCount: number;
  /** 分卷大纲 */
  volumes: VolumeOutline[];
  /** 主线目标 */
  mainGoal: string;
  /** 阶段节点 (如第100章、第200章应该完成什么) */
  milestones: string[];
};

export type VolumeOutline = {
  /** 卷名 */
  title: string;
  /** 起始章节 */
  startChapter: number;
  /** 结束章节 */
  endChapter: number;
  /** 本卷目标 */
  goal: string;
  /** 本卷核心冲突 */
  conflict: string;
  /** 本卷高潮 */
  climax: string;
  /** 卷末状态（用于下一卷衔接） */
  volumeEndState?: string;
  /** 本卷剧情合同 */
  storyContract?: VolumeStoryContract;
  /** 章节大纲 */
  chapters: ChapterOutline[];
};

export type ChapterOutline = {
  /** 章节序号 */
  index: number;
  /** 章节标题 */
  title: string;
  /** 本章目标 */
  goal: string;
  /** 章末钩子 */
  hook: string;
  /** 本章剧情合同 */
  storyContract?: StoryContract;
};

function stripJsonCodeFence(raw: string): string {
  return raw.replace(/```json\s*|```\s*/gi, '').trim();
}

function extractBalancedJsonBlock(raw: string, opening: '{' | '['): string | null {
  const closing = opening === '{' ? '}' : ']';
  const start = raw.indexOf(opening);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === opening) {
      depth += 1;
      continue;
    }

    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseLooseJson(raw: string, preferredShape: 'object' | 'array'): unknown {
  const normalized = stripJsonCodeFence(raw);
  const attempts = [
    normalized,
    preferredShape === 'array'
      ? extractBalancedJsonBlock(normalized, '[')
      : extractBalancedJsonBlock(normalized, '{'),
    preferredShape === 'array'
      ? extractBalancedJsonBlock(normalized, '{')
      : extractBalancedJsonBlock(normalized, '['),
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  let lastError: Error | null = null;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError || new Error('Invalid JSON payload');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toShortText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toShortText(item, ''))
    .filter(Boolean);
}

function normalizeContractScalar(value: unknown): StoryContractScalar | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
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

function normalizeStoryContract(value: unknown): StoryContract | undefined {
  const record = asRecord(value);
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

function normalizeVolumeStoryContract(value: unknown): VolumeStoryContract | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const base = normalizeStoryContract(value);
  const chapterDefaults = normalizeStoryContract(record.chapterDefaults);

  if (!base && !chapterDefaults) return undefined;

  return {
    ...(base || {}),
    chapterDefaults,
  };
}

function stripCodeFenceText(raw: string): string {
  return raw.replace(/```[\w-]*\s*/gi, '').replace(/```/g, '').trim();
}

function isChapterOrdinalToken(value: string): boolean {
  const normalized = value.replace(/[：:.\-]/g, '').trim();
  return /^(?:第?\s*\d+\s*章?|\d+)$/.test(normalized);
}

function deriveHookFromGoal(goal: string): string {
  const normalized = goal.trim();
  if (!normalized) return '';
  const parts = normalized
    .split(/[，。！？!?；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const tail = parts[parts.length - 1] || normalized;
  return tail.length > 20 ? tail.slice(0, 20) : tail;
}

function parseStructuredVolumeChapterText(
  raw: string,
  startChapter: number,
  expectedCount: number
): ChapterOutline[] {
  const lines = stripCodeFenceText(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chapters: ChapterOutline[] = [];

  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .trim();
    if (!line) continue;

    const parts = line
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 2) {
      continue;
    }

    let titlePart = '';
    let goalPart = '';
    let hookPart = '';

    if (isChapterOrdinalToken(parts[0])) {
      titlePart = parts[1] || '';
      goalPart = parts[2] || '';
      hookPart = parts.slice(3).join('｜');
    } else {
      titlePart = parts[0] || '';
      goalPart = parts[1] || '';
      hookPart = parts.slice(2).join('｜');
    }

    titlePart = titlePart.replace(/^标题[:：]\s*/i, '').trim();
    goalPart = goalPart.replace(/^(?:描述|剧情|梗概|概要|内容)[:：]\s*/i, '').trim();
    hookPart = hookPart.replace(/^(?:钩子|悬念|章末钩子)[:：]\s*/i, '').trim();

    if (!titlePart || !goalPart) {
      continue;
    }

    const index = startChapter + chapters.length;
    chapters.push({
      index,
      title: titlePart,
      goal: goalPart,
      hook: hookPart || deriveHookFromGoal(goalPart),
    });

    if (chapters.length >= expectedCount) {
      break;
    }
  }

  return chapters;
}

function normalizeVolumeChapterPayload(payload: unknown, startChapter: number): ChapterOutline[] {
  let rawChapters: unknown = payload;
  const wrapped = asRecord(payload);
  if (wrapped) {
    rawChapters = wrapped.chapters ?? wrapped.items ?? wrapped.volumeChapters ?? payload;
  }

  if (!Array.isArray(rawChapters)) {
    throw new Error('Volume chapters payload is not an array');
  }

  return rawChapters.map((chapter, offset) => {
    const record = asRecord(chapter);
    const index = startChapter + offset;
    return {
      index: toNumber(record?.index ?? record?.chapterIndex ?? record?.chapter ?? record?.id, index),
      title: toShortText(record?.title, `第${index}章`),
      goal: toShortText(record?.goal ?? record?.summary ?? record?.description, ''),
      hook: toShortText(record?.hook ?? record?.cliffhanger, ''),
      storyContract: normalizeStoryContract(record?.storyContract ?? record?.contract),
    };
  });
}

function normalizeMasterOutlinePayload(payload: unknown): {
  mainGoal: string;
  milestones: string[];
  volumes: Omit<VolumeOutline, 'chapters'>[];
} {
  const record = asRecord(payload);
  if (!record) {
    throw new Error('Master outline payload is not an object');
  }

  const rawVolumes = Array.isArray(record.volumes) ? record.volumes : [];
  if (rawVolumes.length === 0) {
    throw new Error('Master outline payload has no volumes');
  }

  return {
    mainGoal: toShortText(record.mainGoal ?? record.goal, ''),
    milestones: normalizeTextArray(record.milestones),
    volumes: rawVolumes.map((volume, offset) => {
      const vol = asRecord(volume);
      if (!vol) {
        throw new Error(`Volume ${offset + 1} is invalid`);
      }

      return {
        title: toShortText(vol.title, `第${offset + 1}卷`),
        startChapter: toNumber(vol.startChapter, offset * 80 + 1),
        endChapter: toNumber(vol.endChapter, (offset + 1) * 80),
        goal: toShortText(vol.goal ?? vol.summary, ''),
        conflict: toShortText(vol.conflict ?? vol.coreConflict, ''),
        climax: toShortText(vol.climax ?? vol.peak, ''),
        volumeEndState: toShortText(vol.volumeEndState ?? vol.volume_end_state, '') || undefined,
        storyContract: normalizeVolumeStoryContract(vol.storyContract ?? vol.contract),
      };
    }),
  };
}

function normalizeAdditionalVolumePayload(
  payload: unknown,
  startChapterBase: number,
  chaptersPerVolume: number
): Omit<VolumeOutline, 'chapters'>[] {
  let rawVolumes: unknown = payload;
  const wrapped = asRecord(payload);
  if (wrapped) {
    rawVolumes = wrapped.volumes ?? wrapped.items ?? payload;
  }

  if (!Array.isArray(rawVolumes)) {
    throw new Error('Additional volumes payload is not an array');
  }

  let currentStart = startChapterBase;
  return rawVolumes.map((volume, offset) => {
    const record = asRecord(volume);
    const title = toShortText(record?.title, `第${offset + 1}卷`);
    const normalizedVolume: Omit<VolumeOutline, 'chapters'> = {
      title,
      startChapter: currentStart,
      endChapter: currentStart + chaptersPerVolume - 1,
      goal: toShortText(record?.goal ?? record?.summary, ''),
      conflict: toShortText(record?.conflict ?? record?.coreConflict, ''),
      climax: toShortText(record?.climax ?? record?.peak, ''),
      volumeEndState: typeof record?.volumeEndState === 'string' ? record.volumeEndState.trim() : undefined,
      storyContract: normalizeVolumeStoryContract(record?.storyContract ?? record?.contract),
    };
    currentStart = normalizedVolume.endChapter + 1;
    return normalizedVolume;
  });
}

function normalizeContractListField(value: StoryContractField | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [String(value)];
}

export function applyVolumeOpeningBridgeContracts(
  chapters: ChapterOutline[],
  args: {
    volume: Omit<VolumeOutline, 'chapters'>;
    previousVolumeSummary?: string;
    actualStorySummary?: string;
    bridgeChapterCount?: number;
  }
): ChapterOutline[] {
  const {
    volume,
    previousVolumeSummary,
    actualStorySummary,
    bridgeChapterCount = VOLUME_BRIDGE_CHAPTER_COUNT,
  } = args;

  const bridgeContext = buildVolumeBridgeContext({
    previousVolumeSummary,
    actualStorySummary,
    currentVolume: volume,
    bridgeChapterCount,
  });
  if (!bridgeContext || volume.startChapter <= 1) {
    return chapters;
  }

  const combinedSource = [previousVolumeSummary, actualStorySummary].filter(Boolean).join('\n');
  const isTimelineReset = TIMELINE_RESET_PATTERN.test(combinedSource);
  const postBridgeEntryChapterIndex = volume.startChapter + bridgeChapterCount;

  return chapters.map((chapter) => {
    if (!isVolumeBridgeChapter(chapter.index, volume.startChapter, bridgeChapterCount)
      && chapter.index !== postBridgeEntryChapterIndex) {
      return chapter;
    }

    if (chapter.index === postBridgeEntryChapterIndex) {
      const existingContract = chapter.storyContract;
      const mustAdvance = normalizeContractListField(existingContract?.threads?.mustAdvance);
      const forbiddenIntroductions = normalizeContractListField(existingContract?.threads?.forbiddenIntroductions);
      const stateTargets = normalizeContractListField(existingContract?.stateTransition?.target);
      const notes = Array.from(new Set([
        ...(existingContract?.notes || []),
        `本章是卷切换桥接后的首个主线落点章，必须把主要行动切到「${volume.title}」对应的新舞台，不能只停留在赶路、余波收尾或继续围绕旧残局打转。`,
        `本章的主要爽点和核心冲突必须直接服务于本卷目标「${volume.goal}」。`,
      ]));

      return {
        ...chapter,
        storyContract: {
          ...existingContract,
          threads: {
            ...(existingContract?.threads || {}),
            mustAdvance: Array.from(new Set([
              ...mustAdvance,
              '正式进入本卷主线舞台并让本卷目标成为主驱动',
            ])),
            forbiddenIntroductions: Array.from(new Set([
              ...forbiddenIntroductions,
              '桥接结束后仍由上一卷余波主导主要矛盾',
            ])),
          },
          stateTransition: {
            ...(existingContract?.stateTransition || {}),
            target: Array.from(new Set([
              ...stateTargets,
              '把剧情重心切换到本卷目标对应的新舞台、地点或势力',
            ])),
          },
          notes,
        },
      };
    }

    const chapterOffset = chapter.index - volume.startChapter;
    const existingContract = chapter.storyContract;
    const mustAdvance = normalizeContractListField(existingContract?.threads?.mustAdvance);
    const forbiddenIntroductions = normalizeContractListField(existingContract?.threads?.forbiddenIntroductions);
    const stateTargets = normalizeContractListField(existingContract?.stateTransition?.target);
    const notes = Array.from(new Set([
      ...(existingContract?.notes || []),
      ...buildVolumeBridgeNotes({
        chapterOffset,
        bridgeChapterCount,
        isTimelineReset,
      }),
    ]));

    const bridgeTarget = chapterOffset === 0
      ? '把上一卷卷末状态落到当前场景，明确主角的新处境'
      : '让上一卷余波继续发酵，并完成卷切换过渡后再展开本卷主线';

    return {
      ...chapter,
      storyContract: {
        ...existingContract,
        crisis: {
          ...(existingContract?.crisis || {}),
          requiredBridge: true,
        },
        threads: {
          ...(existingContract?.threads || {}),
          mustAdvance: Array.from(new Set([
            ...mustAdvance,
            chapterOffset === 0
              ? '承接上一卷结局带来的直接后果'
              : '延续上一卷余波并完成卷切换过渡',
          ])),
          forbiddenIntroductions: Array.from(new Set([
            ...forbiddenIntroductions,
            '在卷切换桥接完成前，直接切入与上一卷无关的新主线',
          ])),
        },
        stateTransition: {
          ...(existingContract?.stateTransition || {}),
          target: Array.from(new Set([...stateTargets, bridgeTarget])),
        },
        notes,
      },
    };
  });
}

function buildDefaultVolumeRanges(totalChapters: number, volumeCount: number, startChapterBase = 1): Array<{ startChapter: number; endChapter: number }> {
  if (volumeCount <= 0) return [];

  const safeTotalChapters = Math.max(volumeCount, totalChapters);
  const baseSize = Math.floor(safeTotalChapters / volumeCount);
  const remainder = safeTotalChapters % volumeCount;
  const ranges: Array<{ startChapter: number; endChapter: number }> = [];

  let cursor = startChapterBase;
  for (let index = 0; index < volumeCount; index += 1) {
    const chapterSpan = baseSize + (index < remainder ? 1 : 0);
    const startChapter = cursor;
    const endChapter = startChapter + Math.max(1, chapterSpan) - 1;
    ranges.push({ startChapter, endChapter });
    cursor = endChapter + 1;
  }

  return ranges;
}

function parseChapterRangeToken(value: string): { startChapter: number; endChapter: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const directMatch = trimmed.match(/^(\d+)\D+(\d+)$/);
  if (directMatch) {
    const startChapter = Number(directMatch[1]);
    const endChapter = Number(directMatch[2]);
    if (Number.isFinite(startChapter) && Number.isFinite(endChapter) && endChapter >= startChapter) {
      return { startChapter, endChapter };
    }
  }

  return null;
}

function isOutlineGoalToken(value: string): boolean {
  const normalized = value.replace(/[：:\s]/g, '').toLowerCase();
  return ['主线', '主线目标', '总目标', 'maingoal', 'goal'].includes(normalized);
}

function isMilestoneToken(value: string): boolean {
  const normalized = value.replace(/[：:\s]/g, '').toLowerCase();
  return ['里程碑', 'milestone', 'milestones'].includes(normalized);
}

function isVolumeToken(value: string): boolean {
  const normalized = value.replace(/[：:\s]/g, '').toLowerCase();
  return normalized === '卷'
    || normalized === '分卷'
    || /^第?\d+卷$/.test(normalized)
    || /^volume\d*$/.test(normalized);
}

function parseStructuredMasterOutlineText(
  raw: string,
  targetChapters: number
): {
  mainGoal: string;
  milestones: string[];
  volumes: Omit<VolumeOutline, 'chapters'>[];
} {
  const lines = stripCodeFenceText(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let mainGoal = '';
  const milestones: string[] = [];
  const volumeDrafts: Array<{
    title: string;
    goal: string;
    conflict: string;
    climax: string;
    volumeEndState?: string;
    range?: { startChapter: number; endChapter: number };
  }> = [];

  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .trim();
    if (!line) continue;

    const colonGoal = line.match(/^(主线目标|主线|总目标|main\s*goal)[:：]\s*(.+)$/i);
    if (colonGoal) {
      mainGoal = colonGoal[2].trim();
      continue;
    }

    const colonMilestone = line.match(/^(里程碑|milestone)[:：]\s*(.+)$/i);
    if (colonMilestone) {
      milestones.push(colonMilestone[2].trim());
      continue;
    }

    const parts = line
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 2) continue;

    if (isOutlineGoalToken(parts[0])) {
      mainGoal = parts.slice(1).join('｜').trim();
      continue;
    }

    if (isMilestoneToken(parts[0])) {
      const milestone = parts.slice(1).join('｜').trim();
      if (milestone) milestones.push(milestone);
      continue;
    }

    if (!isVolumeToken(parts[0])) {
      continue;
    }

    let cursor = 1;
    const title = toShortText(parts[cursor], `第${volumeDrafts.length + 1}卷`);
    cursor += 1;

    let range: { startChapter: number; endChapter: number } | undefined;
    if (cursor + 1 < parts.length && /^\d+$/.test(parts[cursor]) && /^\d+$/.test(parts[cursor + 1])) {
      const startChapter = Number(parts[cursor]);
      const endChapter = Number(parts[cursor + 1]);
      if (endChapter >= startChapter) {
        range = { startChapter, endChapter };
        cursor += 2;
      }
    } else if (cursor < parts.length) {
      const parsedRange = parseChapterRangeToken(parts[cursor]);
      if (parsedRange) {
        range = parsedRange;
        cursor += 1;
      }
    }

    const goal = toShortText(parts[cursor], '');
    const conflict = toShortText(parts[cursor + 1], '');
    const climax = toShortText(parts[cursor + 2], '');
    const volumeEndState = toShortText(parts.slice(cursor + 3).join('｜'), '') || undefined;

    if (!title || !goal || !conflict || !climax) {
      continue;
    }

    volumeDrafts.push({
      title,
      goal,
      conflict,
      climax,
      volumeEndState,
      range,
    });
  }

  if (volumeDrafts.length === 0) {
    throw new Error('Master outline text has no volumes');
  }

  let useExplicitRanges = volumeDrafts.every((draft) => draft.range);

  // 验证 AI 返回的章节范围是否合理覆盖目标章节数
  if (useExplicitRanges) {
    const firstStart = Math.min(...volumeDrafts.map((d) => d.range!.startChapter));
    const lastEnd = Math.max(...volumeDrafts.map((d) => d.range!.endChapter));
    const aiTotalChapters = lastEnd - firstStart + 1;
    if (aiTotalChapters < targetChapters * 0.8) {
      console.warn(
        `AI returned chapter range [${firstStart}-${lastEnd}] = ${aiTotalChapters} chapters, ` +
        `but target is ${targetChapters}. Falling back to even distribution.`
      );
      useExplicitRanges = false;
    }
  }

  const fallbackRanges = buildDefaultVolumeRanges(targetChapters, volumeDrafts.length);

  return {
    mainGoal: mainGoal || '主角完成阶段性崛起并推动主线冲突升级',
    milestones,
    volumes: volumeDrafts.map((draft, index) => {
      const range = useExplicitRanges
        ? draft.range!
        : fallbackRanges[index];
      return {
        title: draft.title,
        startChapter: range.startChapter,
        endChapter: range.endChapter,
        goal: draft.goal,
        conflict: draft.conflict,
        climax: draft.climax,
        volumeEndState: draft.volumeEndState,
      };
    }),
  };
}

function parseStructuredAdditionalVolumesText(
  raw: string,
  startChapterBase: number,
  chaptersPerVolume: number
): Omit<VolumeOutline, 'chapters'>[] {
  const lines = stripCodeFenceText(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const volumeDrafts: Array<{
    title: string;
    goal: string;
    conflict: string;
    climax: string;
    volumeEndState?: string;
  }> = [];

  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .trim();
    if (!line) continue;

    const parts = line
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 5 || !isVolumeToken(parts[0])) {
      continue;
    }

    const title = toShortText(parts[1], `第${volumeDrafts.length + 1}卷`);
    const goal = toShortText(parts[2], '');
    const conflict = toShortText(parts[3], '');
    const climax = toShortText(parts[4], '');
    const volumeEndState = toShortText(parts.slice(5).join('｜'), '') || undefined;

    if (!title || !goal || !conflict || !climax) {
      continue;
    }

    volumeDrafts.push({
      title,
      goal,
      conflict,
      climax,
      volumeEndState,
    });
  }

  if (volumeDrafts.length === 0) {
    throw new Error('Additional volumes text has no volumes');
  }

  const ranges = buildDefaultVolumeRanges(volumeDrafts.length * chaptersPerVolume, volumeDrafts.length, startChapterBase);
  return volumeDrafts.map((draft, index) => ({
    title: draft.title,
    startChapter: ranges[index].startChapter,
    endChapter: ranges[index].endChapter,
    goal: draft.goal,
    conflict: draft.conflict,
    climax: draft.climax,
    volumeEndState: draft.volumeEndState,
  }));
}

/**
 * 生成总大纲
 */
export async function generateMasterOutline(
  aiConfig: AIConfig,
  args: {
    bible: string;
    targetChapters: number;
    targetWordCount: number;
    minChapterWords?: number;
    characters?: any; // 可选：CharacterRelationGraph，先建人物再写大纲时传入
  }
): Promise<{ volumes: Omit<VolumeOutline, 'chapters'>[]; mainGoal: string; milestones: string[] }> {
  const { bible, targetChapters, targetWordCount, minChapterWords = 2500, characters } = args;

  // 估算分卷数 (通常每 50-100 章一卷)
  const volumeCount = Math.ceil(targetChapters / 80);

  const system = `
你是一个起点白金级网文大纲策划专家。你对网文的节奏、爽点、冲突设计有深刻理解。

大纲设计原则：
1. 冲突递进：每卷的核心冲突必须比上一卷更大、更紧迫
2. 爽点节奏：每 3-5 章安排一个大爽点（升级/反杀/获宝/揭秘），章节间有小爽点
3. 人物弧线：主角在每卷必须有明确的内在成长，而非只是实力提升
4. 悬念管理：每卷结尾必须留大悬念，牵引读者进入下一卷
5. 三幕结构：每卷遵循「铺垫(25%) → 发展(50%) → 高潮收尾(25%)」
6. 禁止水卷：每卷都要有明确的核心矛盾和高潮，不能有"过渡卷"
7. 篇幅规划：章节推进要匹配字数预算，默认每章不少于 ${minChapterWords} 字
${characters ? '8. 人物驱动：大纲必须围绕人物关系冲突展开，每卷的核心冲突应与人物关系变化绑定' : ''}

只输出纯文本，不要输出 JSON，不要输出 Markdown 代码块，不要写解释。
严格按以下格式输出：
主线|整本书主线目标
里程碑|第100章里程碑
里程碑|第200章里程碑
卷|卷名|起始章节|结束章节|本卷目标|本卷冲突|本卷高潮|卷末状态
`.trim();

  // 构建人物关系摘要（如果有）
  let charactersSummary = '';
  if (characters) {
    const protags = (characters.protagonists || []).map((p: any) => 
      `${p.name}: ${p.personality?.traits?.join(', ') || p.role || '未定义'}`
    ).join('\n  ');
    const mainChars = (characters.mainCharacters || []).map((c: any) =>
      `${c.name}: ${c.role || '未定义'}`
    ).join('\n  ');
    const rels = (characters.relationships || []).slice(0, 10).map((r: any) => 
      `${r.from} ←→ ${r.to}: ${r.type} (${r.tension || '无张力说明'})`
    ).join('\n  ');
    
    charactersSummary = `
【核心人物设定（已确定）】
主角：
  ${protags || '未定义'}

重要配角：
  ${mainChars || '未定义'}

核心关系冲突：
  ${rels || '未定义'}

请在大纲规划时充分利用以上人物关系，让每卷的核心冲突与人物关系变化绑定。`;
  }

  const prompt = `
【Story Bible】
${bible}

【目标规模】
- 总章数: ${targetChapters} 章
- 总字数: ${targetWordCount} 万字
- 每章最低字数: ${minChapterWords} 字
- 预计分卷数: ${volumeCount} 卷
${charactersSummary}

输出要求：
- 先输出 1 行主线
- 再输出若干行里程碑
- 最后每卷输出 1 行，必须以 卷| 开头
- 不要输出多余说明
`.trim();

  const parseRetryLimit = 3;
  let lastError = 'Failed to parse master outline response';

  for (let parseAttempt = 0; parseAttempt < parseRetryLimit; parseAttempt += 1) {
    const estimatedTokens = Math.max(2048, volumeCount * 220);
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.6 + parseAttempt * 0.05,
      maxTokens: estimatedTokens,
    });

    try {
      return parseStructuredMasterOutlineText(raw, targetChapters);
    } catch (textError) {
      try {
        return normalizeMasterOutlinePayload(parseLooseJson(raw, 'object'));
      } catch {
        lastError = (textError as Error).message || 'Failed to parse master outline response';
      }
    }

    if (parseAttempt < parseRetryLimit - 1) {
      await sleep(2000);
    }
  }

  throw new Error(lastError);
}

/**
 * 将解析出的章节数组补全到期望数量，缺失章节用占位信息填充
 */
function padChaptersToCount(chapters: ChapterOutline[], startChapter: number, expectedCount: number): ChapterOutline[] {
  if (chapters.length >= expectedCount) return chapters.slice(0, expectedCount);

  const padded = [...chapters];
  const existingIndices = new Set(chapters.map((c) => c.index));

  for (let offset = 0; padded.length < expectedCount; offset++) {
    const index = startChapter + offset;
    if (existingIndices.has(index)) continue;
    padded.push({
      index,
      title: `第${index}章`,
      goal: '（占位章节，待后续细化大纲时补全）',
      hook: '',
    });
  }

  return padded.sort((a, b) => a.index - b.index).slice(0, expectedCount);
}

const VOLUME_CHAPTER_BATCH_SIZE = 15;
const MIN_BATCHED_VOLUME_CHAPTERS = 24;

type VolumeChapterBatchProgress = {
  batchIndex: number;
  totalBatches: number;
  startChapter: number;
  endChapter: number;
  generatedCount: number;
};

function buildChapterBatchRanges(
  startChapter: number,
  endChapter: number,
): Array<{ startChapter: number; endChapter: number }> {
  const chapterCount = endChapter - startChapter + 1;
  if (chapterCount <= 0) return [];

  const batchSize = chapterCount > MIN_BATCHED_VOLUME_CHAPTERS
    ? Math.min(VOLUME_CHAPTER_BATCH_SIZE, chapterCount)
    : chapterCount;
  const ranges: Array<{ startChapter: number; endChapter: number }> = [];
  for (let batchStartChapter = startChapter; batchStartChapter <= endChapter; batchStartChapter += batchSize) {
    ranges.push({
      startChapter: batchStartChapter,
      endChapter: Math.min(batchStartChapter + batchSize - 1, endChapter),
    });
  }

  return ranges;
}

export function getVolumeChapterBatchRanges(
  volume: Omit<VolumeOutline, 'chapters'>,
  args: {
    hasOpeningBridgeContext?: boolean;
    bridgeChapterCount?: number;
  } = {},
): Array<{ startChapter: number; endChapter: number }> {
  const {
    hasOpeningBridgeContext = false,
    bridgeChapterCount = VOLUME_BRIDGE_CHAPTER_COUNT,
  } = args;

  const chapterCount = volume.endChapter - volume.startChapter + 1;
  if (chapterCount <= 0) return [];

  const normalizedBridgeChapterCount = Math.max(0, Math.min(bridgeChapterCount, chapterCount));
  if (!hasOpeningBridgeContext || volume.startChapter <= 1 || normalizedBridgeChapterCount === 0) {
    return buildChapterBatchRanges(volume.startChapter, volume.endChapter);
  }

  if (chapterCount <= normalizedBridgeChapterCount) {
    return [{
      startChapter: volume.startChapter,
      endChapter: volume.endChapter,
    }];
  }

  return [
    {
      startChapter: volume.startChapter,
      endChapter: volume.startChapter + normalizedBridgeChapterCount - 1,
    },
    ...buildChapterBatchRanges(
      volume.startChapter + normalizedBridgeChapterCount,
      volume.endChapter,
    ),
  ];
}

function buildVolumeBatchSummary(args: {
  volume: Omit<VolumeOutline, 'chapters'>;
  generatedChapters: ChapterOutline[];
  previousVolumeSummary?: string;
  actualStorySummary?: string;
}): string {
  const { volume, generatedChapters, previousVolumeSummary, actualStorySummary } = args;

  if (generatedChapters.length > 0) {
    const lastGeneratedChapter = generatedChapters[generatedChapters.length - 1];
    return `【本卷已生成章节进展】\n${buildVolumeContinuationSummary({
      ...volume,
      endChapter: lastGeneratedChapter.index,
      chapters: generatedChapters,
    })}`;
  }

  const bridgeContext = buildVolumeBridgeContext({
    previousVolumeSummary,
    actualStorySummary,
    currentVolume: volume,
    bridgeChapterCount: VOLUME_BRIDGE_CHAPTER_COUNT,
  });
  if (bridgeContext) {
    return `【卷切换桥接上下文】\n${bridgeContext}`;
  }

  return '【这是第一卷】';
}

/**
 * 构建包含章节级别信息的已有卷大纲上下文
 * 用于在生成新卷大纲时，把之前所有卷的大纲作为 AI 上下文
 */
function buildExistingVolumesDetailedContext(
  volumes: Array<Omit<VolumeOutline, 'chapters'> & { chapters?: ChapterOutline[] }>,
): string {
  if (volumes.length === 0) return '';

  const RECENT_VOLUMES_COUNT = 3;

  return volumes.map((vol, i) => {
    const header = [
      `第${i + 1}卷「${vol.title}」（第${vol.startChapter}-${vol.endChapter}章）`,
      vol.goal ? `  目标: ${vol.goal}` : '',
      vol.conflict ? `  冲突: ${vol.conflict}` : '',
      vol.climax ? `  高潮: ${vol.climax}` : '',
      vol.volumeEndState ? `  结束状态: ${vol.volumeEndState}` : '',
    ].filter(Boolean).join('\n');

    const chapters = vol.chapters;
    // 如果没有章节数据，或者是较早的远期卷（保留最近3卷），只保留卷级摘要以节省 token
    if (!Array.isArray(chapters) || chapters.length === 0 || i < volumes.length - RECENT_VOLUMES_COUNT) {
      if (Array.isArray(chapters) && chapters.length > 0) {
        return `${header}\n  （本卷包含 ${chapters.length} 章，章节详情已折叠）`;
      }
      return header;
    }

    // 构建近期卷的完整章节概要
    const chapterLines = chapters.map((ch) => {
      return `    第${ch.index}章 ${ch.title}${ch.goal ? ' | ' + ch.goal : ''}`;
    }).join('\n');

    return `${header}\n  章节概要:\n${chapterLines}`;
  }).join('\n\n');
}

async function generateVolumeChapterBatch(
  aiConfig: AIConfig,
  args: {
    bible: string;
    masterOutline: { mainGoal: string; milestones: string[] };
    volume: Omit<VolumeOutline, 'chapters'>;
    batchStartChapter: number;
    batchEndChapter: number;
    batchIndex: number;
    totalBatches: number;
    previousVolumeSummary?: string;
    minChapterWords?: number;
    actualStorySummary?: string;
    generatedChapters?: ChapterOutline[];
    /** 之前所有已完成的卷（含章节），用于构建全局大纲上下文 */
    previousVolumes?: Array<Omit<VolumeOutline, 'chapters'> & { chapters?: ChapterOutline[] }>;
  }
): Promise<ChapterOutline[]> {
  const {
    bible,
    masterOutline,
    volume,
    batchStartChapter,
    batchEndChapter,
    batchIndex,
    totalBatches,
    previousVolumeSummary,
    minChapterWords = 2500,
    actualStorySummary,
    generatedChapters = [],
    previousVolumes = [],
  } = args;

  const chapterCount = volume.endChapter - volume.startChapter + 1;
  const batchChapterCount = batchEndChapter - batchStartChapter + 1;
  const continuationSummary = buildVolumeBatchSummary({
    volume,
    generatedChapters,
    previousVolumeSummary,
    actualStorySummary,
  });
  const hasOpeningBridgeContext = volume.startChapter > 1
    && Boolean(previousVolumeSummary?.trim() || actualStorySummary?.trim());
  const bridgeEndChapter = Math.min(
    volume.startChapter + VOLUME_BRIDGE_CHAPTER_COUNT - 1,
    volume.endChapter,
  );
  const isOpeningBridgeBatch = hasOpeningBridgeContext
    && batchStartChapter === volume.startChapter
    && batchEndChapter <= bridgeEndChapter;
  const isPostBridgeBatch = hasOpeningBridgeContext
    && batchStartChapter === bridgeEndChapter + 1
    && batchStartChapter <= volume.endChapter;
  const batchSpecificConstraints = [
    isOpeningBridgeBatch
      ? `- 当前批次是卷切换桥接专用批次，只允许完成前 ${VOLUME_BRIDGE_CHAPTER_COUNT} 章的连续承接，不能把上一卷残局扩写成整批旧主线
- 第 ${bridgeEndChapter} 章章末必须把人物、地点、目标或情报推进到“${volume.title}”的主线入口，保证下一批次能直接进入新卷主线`
      : '',
    isPostBridgeBatch
      ? `- 当前批次紧接桥接段之后，默认卷切换已经完成；从第 ${batchStartChapter} 章开始，必须由本卷目标“${volume.goal}”和冲突“${volume.conflict}”主导
- 第 ${batchStartChapter} 章必须让主角正式踏入本卷主舞台，或至少已经开始在本卷核心地点、核心势力或核心规则内行动，不能只写“准备前往”“决定加速”“路上再遇旧事”
- 第 ${batchStartChapter} 章的主要爽点必须来自本卷主线推进，不能仍由上一卷遗留支线抢占主驱动
- 上一卷余波只能作为代价、追兵、旧伤、旧债或情报压力存在，不能继续占据主要舞台、主要谜团或主要行动目标
- 除非本卷合同明确要求，否则不得继续围绕上一卷遗迹、残境、旧据点或残局反复打转`
      : '',
  ].filter(Boolean).join('\n');

  const system = `
你是一个起点白金级网文章节大纲策划专家。请为一卷中的当前批次生成章节大纲。

章节大纲设计原则：
1. 每章必须有明确的“本章爽点”（主角展现能力/获得收获/化解危机/揭露真相）
2. 每章结尾必须有钩子（悬念/反转/危机/揭示），让读者想看下一章
3. 节奏波浪：高潮章后要有 1-2 章缓冲，缓冲章仍需有小悬念
4. 冲突升级：核心冲突要逐步升级，不能一下子解决
5. 人物登场：新角色要安排合理的登场方式和动机
6. 禁止水章：每章都要推动剧情，不能有纯日常的章节
7. 篇幅意识：章节设计要支撑单章不少于 ${minChapterWords} 字，避免目标过散导致注水或空章

只输出纯文本，不要输出 JSON，不要输出 Markdown 代码块，不要写解释。
每行一章，严格使用这个格式：
章节序号|章节标题|章节描述|章末钩子
`.trim();

  // 构建已有卷大纲上下文
  const existingVolumesContext = previousVolumes.length > 0
    ? `\n【已有卷大纲概要（共${previousVolumes.length}卷）】\n${buildExistingVolumesDetailedContext(previousVolumes)}\n`
    : '';

  const prompt = `
【Story Bible】
${bible.slice(0, 4000)}

【总目标】${masterOutline.mainGoal}
${existingVolumesContext}

【本卷信息】
- ${volume.title}
- 本卷总范围: 第${volume.startChapter}章 ~ 第${volume.endChapter}章 (共${chapterCount}章)
- 本卷目标: ${volume.goal}
- 本卷冲突: ${volume.conflict}
- 本卷高潮: ${volume.climax}
- 本卷结束状态: ${volume.volumeEndState || '请围绕本卷目标收束出清晰的卷末状态'}
- 每章最低字数: ${minChapterWords} 字
${volume.storyContract ? `- 本卷合同:\n${JSON.stringify(volume.storyContract, null, 2)}` : ''}

【当前批次】
- 当前仅生成第 ${batchStartChapter} 章 ~ 第 ${batchEndChapter} 章
- 当前批次: ${batchIndex + 1}/${totalBatches}
- 本次必须只输出这 ${batchChapterCount} 章，不能重复前文，也不能提前生成后续批次章节
- index 必须从 ${batchStartChapter} 递增到 ${batchEndChapter}

${continuationSummary}

【续写硬约束】
- 如果不是本卷第一批，必须严格承接“本卷已生成章节进展”，不能重新从卷头写起
- 如果是本卷第一批，则新卷前 ${VOLUME_BRIDGE_CHAPTER_COUNT} 章必须连续处理上一卷最后一幕造成的局面变化，不能像没发生过一样切回旧冲突
- 第 1 章必须先落地上一卷卷末状态，至少兑现一个直接后果
- 第 2 章必须继续消化这个后果，完成卷切换过渡后，再打开本卷主线
- 如果上一卷信息中出现“时间线重置/轮回重启/回到开端/世界线改写”，则本卷前段必须按重置后的身份、关系、情报、敌我格局重新展开
- 除非上一卷明确保留，否则不要把旧时间线已经终结或被覆盖的势力冲突继续当成本卷主线
${batchSpecificConstraints}

输出要求：
- 只输出 ${batchChapterCount} 行正文，不要加标题、编号说明、前后缀解释
- 每行必须是：章节序号|章节标题|章节描述|章末钩子
- 章节序号必须从 ${batchStartChapter} 递增到 ${batchEndChapter}
- 章节描述写清楚本章推进、爽点和冲突变化
- 章末钩子必须具体，不能只写“敬请期待”
`.trim();

  const parseRetryLimit = 3;
  let lastParseError = '';
  let lastRawText = '';

  for (let parseAttempt = 0; parseAttempt < parseRetryLimit; parseAttempt++) {
    const estimatedTokens = Math.max(2048, batchChapterCount * 120);
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.6 + parseAttempt * 0.05,
      maxTokens: estimatedTokens,
    });

    const textChapters = parseStructuredVolumeChapterText(raw, batchStartChapter, batchChapterCount);
    if (textChapters.length === batchChapterCount) {
      return textChapters;
    }
    if (textChapters.length > 0 && textChapters.length >= Math.max(1, Math.ceil(batchChapterCount * 0.5))) {
      console.warn(
        `[generateVolumeChapters] 批次 ${batchIndex + 1}/${totalBatches} 文本解析章节数不匹配：期望 ${batchChapterCount}，实际 ${textChapters.length}，使用占位补全`
      );
      return padChaptersToCount(textChapters, batchStartChapter, batchChapterCount);
    }

    try {
      const normalized = normalizeVolumeChapterPayload(
        parseLooseJson(raw, 'array'),
        batchStartChapter
      );
      if (normalized.length === batchChapterCount) {
        return normalized;
      }
      if (normalized.length > 0 && normalized.length >= Math.max(1, Math.ceil(batchChapterCount * 0.5))) {
        console.warn(
          `[generateVolumeChapters] 批次 ${batchIndex + 1}/${totalBatches} JSON 解析章节数不匹配：期望 ${batchChapterCount}，实际 ${normalized.length}，使用占位补全`
        );
        return padChaptersToCount(normalized, batchStartChapter, batchChapterCount);
      }
    } catch {
      // JSON is only a compatibility fallback now.
    }

    lastParseError = `expected ${batchChapterCount}, got 0`;
    lastRawText = raw;
    console.warn(
      `[generateVolumeChapters] 批次 ${batchIndex + 1}/${totalBatches} 解析尝试 ${parseAttempt + 1}/${parseRetryLimit} 失败 (${lastParseError})，AI 原始返回前500字：${raw.slice(0, 500)}`
    );

    if (parseAttempt < parseRetryLimit - 1) {
      await sleep(2000);
    }
  }

  const debugInfo = lastRawText ? `\n\n[DEBUG OUTPUT]:\n${lastRawText.slice(0, 1500)}` : '';
  throw new Error(`Failed to parse volume chapter batch ${batchIndex + 1}/${totalBatches} after ${parseRetryLimit} attempts: ${lastParseError}${debugInfo}`);
}

/**
 * 生成单卷的章节大纲
 */
export async function generateVolumeChapters(
  aiConfig: AIConfig,
  args: {
    bible: string;
    masterOutline: { mainGoal: string; milestones: string[] };
    volume: Omit<VolumeOutline, 'chapters'>;
    previousVolumeSummary?: string;
    minChapterWords?: number;
    /** 实际已生成章节的滚动摘要（用于校准，不覆盖上一卷精确结尾） */
    actualStorySummary?: string;
    /** 之前所有已完成的卷（含章节），用于构建全局大纲上下文 */
    previousVolumes?: Array<Omit<VolumeOutline, 'chapters'> & { chapters?: ChapterOutline[] }>;
    onBatchStart?: (progress: VolumeChapterBatchProgress) => Promise<void> | void;
  }
): Promise<ChapterOutline[]> {
  const {
    bible,
    masterOutline,
    volume,
    previousVolumeSummary,
    minChapterWords = 2500,
    actualStorySummary,
    previousVolumes,
    onBatchStart,
  } = args;

  const chapterCount = volume.endChapter - volume.startChapter + 1;
  const hasOpeningBridgeContext = volume.startChapter > 1
    && Boolean(previousVolumeSummary?.trim() || actualStorySummary?.trim());
  const batchRanges = getVolumeChapterBatchRanges(volume, {
    hasOpeningBridgeContext,
    bridgeChapterCount: VOLUME_BRIDGE_CHAPTER_COUNT,
  });
  const generatedChapters: ChapterOutline[] = [];

  for (let batchIndex = 0; batchIndex < batchRanges.length; batchIndex += 1) {
    const batchRange = batchRanges[batchIndex];

    await onBatchStart?.({
      batchIndex,
      totalBatches: batchRanges.length,
      startChapter: batchRange.startChapter,
      endChapter: batchRange.endChapter,
      generatedCount: generatedChapters.length,
    });

    const batchChapters = await generateVolumeChapterBatch(aiConfig, {
      bible,
      masterOutline,
      volume,
      batchStartChapter: batchRange.startChapter,
      batchEndChapter: batchRange.endChapter,
      batchIndex,
      totalBatches: batchRanges.length,
      previousVolumeSummary,
      minChapterWords,
      actualStorySummary: generatedChapters.length === 0 ? actualStorySummary : undefined,
      generatedChapters,
      previousVolumes,
    });

    generatedChapters.push(...batchChapters);

    if (batchIndex < batchRanges.length - 1) {
      await sleep(1000);
    }
  }

  return applyVolumeOpeningBridgeContracts(
    padChaptersToCount(generatedChapters, volume.startChapter, chapterCount),
    {
      volume,
      previousVolumeSummary,
      actualStorySummary,
      bridgeChapterCount: VOLUME_BRIDGE_CHAPTER_COUNT,
    },
  );
}

/**
 * 基于已有大纲生成额外的卷骨架（不含章节细节）
 * 章节需要后续调用 generateVolumeChapters 逐卷填充
 */
export async function generateAdditionalVolumes(
  aiConfig: AIConfig,
  args: {
    bible: string;
    existingOutline: {
      mainGoal: string;
      milestones: string[];
      volumes: Array<Omit<VolumeOutline, 'chapters'> & { chapters?: ChapterOutline[] }>;
      totalChapters: number;
      targetWordCount: number;
    };
    newVolumeCount: number;
    chaptersPerVolume: number;
    minChapterWords?: number;
    /** 实际已生成章节的滚动摘要（用于校准，不覆盖上一卷精确结尾） */
    actualStorySummary?: string;
  }
): Promise<{ volumes: Omit<VolumeOutline, 'chapters'>[] }> {
  const { bible, existingOutline, newVolumeCount, chaptersPerVolume, minChapterWords = 2500, actualStorySummary } = args;

  // 计算新卷的起始章节号
  const lastVolume = existingOutline.volumes[existingOutline.volumes.length - 1];
  const startChapterBase = lastVolume ? lastVolume.endChapter + 1 : 1;
  const openingBridgeContext = buildVolumeBridgeContext({
    previousVolume: lastVolume,
    actualStorySummary,
    bridgeChapterCount: VOLUME_BRIDGE_CHAPTER_COUNT,
  });

  // 构建已有卷的详细摘要（包含章节级大纲信息）
  const existingVolumesSummary = buildExistingVolumesDetailedContext(existingOutline.volumes);

  const system = `
你是一个起点白金级网文大纲策划专家。你需要为一部已有大纲的小说追加新卷。

已有大纲的信息会提供给你，你必须确保新卷与已有内容自然衔接，冲突递进。

大纲设计原则：
1. 冲突递进：新卷的核心冲突必须比已有卷更大、更紧迫
2. 衔接连贯：新卷的开头必须自然承接上一卷的结局
3. 爽点节奏：每 3-5 章安排一个大爽点
4. 人物弧线：主角在每卷必须有明确的内在成长
5. 悬念管理：每卷结尾必须留大悬念
6. 禁止水卷：每卷都要有明确的核心矛盾和高潮
7. 篇幅规划：每章不少于 ${minChapterWords} 字
8. 时间线一致：如果上一卷出现“时间线重置/轮回重启/回到开端”等设定，新卷必须以重置后的状态为新的起点，不能无理由回到旧时间线已经结束或被覆盖的冲突

只输出纯文本，不要输出 JSON，不要输出 Markdown 代码块，不要写解释。
每个新卷一行，严格按以下格式输出：
卷|卷名|本卷目标|本卷冲突|本卷高潮|卷末状态
`.trim();

  const prompt = `
【Story Bible】
${bible}

【主线目标】${existingOutline.mainGoal}

【已有卷目（${existingOutline.volumes.length}卷，共${existingOutline.totalChapters}章）】
${existingVolumesSummary}

${openingBridgeContext
    ? `【卷切换桥接上下文】\n${openingBridgeContext}`
    : '【这是第一卷】'}

【续写硬约束】
- 新卷必须从“上一卷结尾状态/最后关键章节”自然接续，先处理卷末遗留的直接后果，再展开新矛盾
- 第一个新卷的前 ${VOLUME_BRIDGE_CHAPTER_COUNT} 章必须明确属于“卷切换桥接段”，先消化上一卷余波，再允许放大新矛盾
- 如果上一卷已经发生时间线重置、回到开端、轮回重启，新卷第一阶段必须围绕“重置后的新处境”展开
- 已经被重置覆盖、已经解决、或明显属于旧时间线的冲突，不得直接拿来当新卷主线；除非你先写明它如何在新时间线中重新成立

【追加要求】
- 新增 ${newVolumeCount} 卷
- 每卷 ${chaptersPerVolume} 章
- 起始章节号: 第${startChapterBase}章
- 每章最低字数: ${minChapterWords} 字

输出要求：
- 只输出 ${newVolumeCount} 行
- 每行必须以 卷| 开头
- 不要输出多余说明
`.trim();

  const parseRetryLimit = 3;
  let lastError = 'Failed to parse additional volumes response';

  for (let parseAttempt = 0; parseAttempt < parseRetryLimit; parseAttempt += 1) {
    const estimatedTokens = Math.max(1024, newVolumeCount * 180);
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.6 + parseAttempt * 0.05,
      maxTokens: estimatedTokens,
    });

    try {
      return {
        volumes: parseStructuredAdditionalVolumesText(raw, startChapterBase, chaptersPerVolume),
      };
    } catch (textError) {
      try {
        return {
          volumes: normalizeAdditionalVolumePayload(
            parseLooseJson(raw, 'object'),
            startChapterBase,
            chaptersPerVolume
          ),
        };
      } catch {
        lastError = (textError as Error).message || 'Failed to parse additional volumes response';
      }
    }

    if (parseAttempt < parseRetryLimit - 1) {
      await sleep(2000);
    }
  }

  throw new Error(lastError);
}

/**
 * 一键生成完整大纲
 */
export async function generateFullOutline(args: {
  aiConfig: AIConfig;
  projectDir: string;
  targetChapters?: number;
  targetWordCount?: number;
}): Promise<NovelOutline> {
  const { aiConfig, projectDir, targetChapters = 400, targetWordCount = 100 } = args;

  console.log('\n📋 开始生成大纲...');
  console.log(`   目标: ${targetChapters} 章 / ${targetWordCount} 万字\n`);

  const bible = await readBible(projectDir);

  // 1. 生成总大纲
  console.log('1️⃣ 生成总大纲...');
  const master = await generateMasterOutline(aiConfig, { bible, targetChapters, targetWordCount });
  console.log(`   ✅ 主线: ${master.mainGoal}`);
  console.log(`   ✅ 分卷数: ${master.volumes.length}`);

  // 2. 逐卷生成章节大纲
  const volumes: VolumeOutline[] = [];
  let previousVolumeSummary = '';

  for (let i = 0; i < master.volumes.length; i++) {
    const vol = master.volumes[i];
    console.log(`\n2️⃣ 生成 ${vol.title} 的章节大纲 (第${vol.startChapter}-${vol.endChapter}章)...`);

    const chapters = await generateVolumeChapters(aiConfig, {
      bible,
      masterOutline: master,
      volume: vol,
      previousVolumeSummary,
    });

    volumes.push({ ...vol, chapters });
    console.log(`   ✅ 生成了 ${chapters.length} 章大纲`);

    // 为下一卷准备摘要
    previousVolumeSummary = buildVolumeContinuationSummary({ ...vol, chapters });

    // 卷间延迟
    if (i < master.volumes.length - 1) {
      await sleep(2000);
    }
  }

  const outline: NovelOutline = {
    totalChapters: targetChapters,
    targetWordCount,
    volumes,
    mainGoal: master.mainGoal,
    milestones: master.milestones,
  };

  // 3. 保存大纲
  const outlinePath = path.join(projectDir, 'outline.json');
  await fs.writeFile(outlinePath, JSON.stringify(outline, null, 2), 'utf-8');
  console.log(`\n✅ 大纲已保存: ${outlinePath}`);

  // 4. 更新 state.json 的总章数
  const state = await readState(projectDir);
  state.totalChapters = targetChapters;
  await writeState(projectDir, state);

  return outline;
}

/**
 * 读取已保存的大纲
 */
export async function readOutline(projectDir: string): Promise<NovelOutline | null> {
  const outlinePath = path.join(projectDir, 'outline.json');
  try {
    const raw = await fs.readFile(outlinePath, 'utf-8');
    return JSON.parse(raw) as NovelOutline;
  } catch {
    return null;
  }
}

/**
 * 获取指定章节的大纲
 */
export function getChapterOutline(outline: NovelOutline, chapterIndex: number): ChapterOutline | null {
  for (const vol of outline.volumes) {
    const chapter = vol.chapters?.find((c) => c.index === chapterIndex);
    if (chapter) return chapter;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CLI 入口
const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  console.log('CLI mode not supported without AI config. Use the web interface.');
}
