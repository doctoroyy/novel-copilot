import type { AIConfig } from '../services/aiClient.js';
import { generateMasterOutline, generateVolumeChapters } from '../generateOutline.js';
import { OutlineToolRegistry } from './toolRegistry.js';
import type {
  OutlineAgentCallbacks,
  OutlineAgentState,
  OutlineChapter,
  OutlineDocument,
  OutlineQualityEvaluation,
  OutlineVolume,
} from './types.js';

function clampToScore(value: number): number {
  return Math.max(0, Math.min(10, Number(value.toFixed(1))));
}

function normalizeChapter(ch: any, fallbackIndex: number): OutlineChapter {
  return {
    index: ch.index ?? ch.chapter_id ?? ch.chapter_number ?? fallbackIndex,
    title: ch.title || `第${fallbackIndex}章`,
    goal: ch.goal || ch.outline || ch.description || ch.plot_summary || '',
    hook: ch.hook || '',
  };
}

function normalizeVolume(vol: any, volIndex: number, chapters: any[]): OutlineVolume {
  const startChapter = vol.startChapter ?? vol.start_chapter ?? vol.start ?? (volIndex * 80 + 1);
  const endChapter = vol.endChapter ?? vol.end_chapter ?? vol.end ?? ((volIndex + 1) * 80);

  return {
    title: vol.title || vol.volumeTitle || vol.volume_title || `第${volIndex + 1}卷`,
    startChapter,
    endChapter,
    goal: vol.goal || vol.summary || vol.volume_goal || '',
    conflict: vol.conflict || '',
    climax: vol.climax || '',
    volumeEndState: vol.volumeEndState || vol.volume_end_state,
    chapters: chapters.map((ch, i) => normalizeChapter(ch, startChapter + i)),
  };
}

function normalizeMilestones(milestones: any[]): string[] {
  if (!Array.isArray(milestones)) {
    return [];
  }
  return milestones.map((m) => {
    if (typeof m === 'string') {
      return m;
    }
    return m.milestone || m.description || m.title || JSON.stringify(m);
  });
}

function readRevisionNotes(input: Record<string, unknown>): string | undefined {
  const value = input.revisionNotes;
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isPlaceholderTitle(title: string): boolean {
  return !title || /^第?\d+章?$/.test(title) || title.includes('待补充');
}

function formatIndices(indices: number[], limit = 12): string {
  if (indices.length <= limit) {
    return indices.join('、');
  }
  return `${indices.slice(0, limit).join('、')} ... (共${indices.length}个)`;
}

export function evaluateOutlineQuality(args: {
  outline: OutlineDocument;
  targetChapters: number;
  targetScore: number;
}): OutlineQualityEvaluation {
  const { outline, targetChapters, targetScore } = args;
  const issues: string[] = [];
  const chapterIndices = new Set<number>();
  const duplicateIndices = new Set<number>();

  let totalChaptersInOutline = 0;
  let placeholderTitleCount = 0;
  let weakGoalCount = 0;
  let invalidVolumeRangeCount = 0;
  let disconnectedVolumeCount = 0;
  let previousEnd: number | null = null;

  for (const vol of outline.volumes || []) {
    if (vol.endChapter < vol.startChapter) {
      invalidVolumeRangeCount++;
    }
    if (previousEnd !== null && vol.startChapter !== previousEnd + 1) {
      disconnectedVolumeCount++;
    }
    previousEnd = vol.endChapter;

    for (const ch of vol.chapters || []) {
      totalChaptersInOutline++;
      if (chapterIndices.has(ch.index)) {
        duplicateIndices.add(ch.index);
      } else {
        chapterIndices.add(ch.index);
      }
      if (isPlaceholderTitle(ch.title)) {
        placeholderTitleCount++;
      }
      if (!ch.goal || ch.goal.trim().length < 4) {
        weakGoalCount++;
      }
    }
  }

  const missingIndices: number[] = [];
  for (let i = 1; i <= targetChapters; i++) {
    if (!chapterIndices.has(i)) {
      missingIndices.push(i);
    }
  }

  if (missingIndices.length > 0) {
    issues.push(`缺失章节索引：${formatIndices(missingIndices)}`);
  }
  if (duplicateIndices.size > 0) {
    issues.push(`重复章节索引：${formatIndices([...duplicateIndices].sort((a, b) => a - b), 8)}`);
  }
  if (totalChaptersInOutline !== targetChapters) {
    issues.push(`章节总数不匹配：当前 ${totalChaptersInOutline} / 目标 ${targetChapters}`);
  }
  if (placeholderTitleCount > 0) {
    issues.push(`占位标题过多：${placeholderTitleCount} 章仍是占位标题`);
  }
  if (weakGoalCount > 0) {
    issues.push(`章节目标过弱：${weakGoalCount} 章目标缺失或过短`);
  }
  if (invalidVolumeRangeCount > 0) {
    issues.push(`分卷范围非法：${invalidVolumeRangeCount} 卷的章节范围有误`);
  }
  if (disconnectedVolumeCount > 0) {
    issues.push(`分卷衔接断裂：${disconnectedVolumeCount} 处分卷编号不连续`);
  }

  const total = Math.max(1, totalChaptersInOutline);
  const expected = Math.max(1, targetChapters);
  const coverage =
    10 -
    (missingIndices.length / expected) * 8 -
    (Math.abs(totalChaptersInOutline - targetChapters) / expected) * 3 -
    duplicateIndices.size * 0.2;
  const titleQuality = 10 - (placeholderTitleCount / total) * 10;
  const goalQuality = 10 - (weakGoalCount / total) * 10;
  const structure = 10 - invalidVolumeRangeCount * 2 - disconnectedVolumeCount * 1.5;
  const milestoneQuality =
    outline.milestones.length > 0 ? Math.min(10, 6 + Math.min(4, outline.milestones.length)) : 4;

  const metrics = {
    coverage: clampToScore(coverage),
    titleQuality: clampToScore(titleQuality),
    goalQuality: clampToScore(goalQuality),
    structure: clampToScore(structure),
    milestoneQuality: clampToScore(milestoneQuality),
  };

  const weightedScore =
    metrics.coverage * 0.4 +
    metrics.titleQuality * 0.2 +
    metrics.goalQuality * 0.25 +
    metrics.structure * 0.1 +
    metrics.milestoneQuality * 0.05;
  const score = clampToScore(weightedScore);
  const strictPlaceholderLimit = Math.ceil(targetChapters * 0.03);
  const strictWeakGoalLimit = Math.ceil(targetChapters * 0.05);

  const passed =
    score >= targetScore &&
    missingIndices.length === 0 &&
    duplicateIndices.size === 0 &&
    placeholderTitleCount <= strictPlaceholderLimit &&
    weakGoalCount <= strictWeakGoalLimit &&
    invalidVolumeRangeCount === 0;

  return {
    score,
    passed,
    issues,
    metrics,
  };
}

export function createOutlineToolRegistry(args: {
  aiConfig: AIConfig;
  bible: string;
  targetChapters: number;
  targetWordCount: number;
  targetScore: number;
  callbacks?: OutlineAgentCallbacks;
}): OutlineToolRegistry {
  const { aiConfig, bible, targetChapters, targetWordCount, targetScore, callbacks } = args;
  const registry = new OutlineToolRegistry();

  registry.register({
    name: 'generate_outline',
    description: '生成或重写整本书的大纲（总纲 + 分卷章节）',
    execute: async (_state: OutlineAgentState, input: Record<string, unknown>) => {
      const revisionNotes = readRevisionNotes(input);
      const masterOutline = await generateMasterOutline(aiConfig, {
        bible,
        targetChapters,
        targetWordCount,
        revisionNotes,
      });

      const totalVolumes = masterOutline.volumes?.length || 0;
      callbacks?.onMasterOutline?.({
        attempt: _state.outlineVersion + 1,
        totalVolumes,
        mainGoal: masterOutline.mainGoal || '',
      });

      const volumes: OutlineVolume[] = [];
      for (let i = 0; i < masterOutline.volumes.length; i++) {
        const vol = masterOutline.volumes[i];
        callbacks?.onVolumeStart?.({
          attempt: _state.outlineVersion + 1,
          volumeIndex: i + 1,
          totalVolumes,
          volumeTitle: vol.title,
        });

        const previousVolumeEndState =
          i > 0
            ? masterOutline.volumes[i - 1].volumeEndState ||
              `${masterOutline.volumes[i - 1].climax}（主角已达成：${masterOutline.volumes[i - 1].goal}）`
            : undefined;

        const chapters = await generateVolumeChapters(aiConfig, {
          bible,
          masterOutline,
          volume: vol,
          previousVolumeSummary: previousVolumeEndState,
          revisionNotes,
        });
        const normalizedVolume = normalizeVolume(vol, i, chapters);
        volumes.push(normalizedVolume);

        callbacks?.onVolumeComplete?.({
          attempt: _state.outlineVersion + 1,
          volumeIndex: i + 1,
          totalVolumes,
          volumeTitle: normalizedVolume.title,
          chapterCount: normalizedVolume.chapters.length,
        });
      }

      const outline: OutlineDocument = {
        totalChapters: targetChapters,
        targetWordCount,
        volumes,
        mainGoal: masterOutline.mainGoal || '',
        milestones: normalizeMilestones(masterOutline.milestones || []),
      };

      return {
        kind: 'generated_outline',
        outline,
        summary: `生成第 ${_state.outlineVersion + 1} 版大纲，含 ${volumes.length} 卷`,
      };
    },
  });

  registry.register({
    name: 'critic_outline',
    description: '对当前大纲进行质量评估并给出改写信号',
    execute: async (state: OutlineAgentState) => {
      if (!state.latestOutline) {
        throw new Error('No outline available for critic');
      }

      const evaluation = evaluateOutlineQuality({
        outline: state.latestOutline,
        targetChapters,
        targetScore,
      });

      callbacks?.onCritic?.({
        attempt: state.outlineVersion,
        score: evaluation.score,
        passed: evaluation.passed,
        issues: evaluation.issues,
      });

      return {
        kind: 'outline_critique',
        evaluation,
        summary: `大纲评分 ${evaluation.score} / 10${evaluation.passed ? '（通过）' : '（未通过）'}`,
      };
    },
  });

  return registry;
}
