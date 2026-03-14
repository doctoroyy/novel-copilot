import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, getFallbackAIConfigsFromRegistry, type AIConfig } from '../services/aiClient.js';
import {
  getAIConfig,
} from '../services/aiConfigResolver.js';
import { generateMasterOutline, generateVolumeChapters, generateAdditionalVolumes } from '../generateOutline.js';
import {
  rebaseProjectStateToContinuity,
} from '../utils/projectContinuity.js';
import {
  createGenerationTask,
  createBackgroundTask,
  completeTask,
  checkRunningTask,
  updateTaskMessage,
  getTaskById,
} from './tasks.js';

export const generationRoutes = new Hono<{ Bindings: Env }>();

export const DEFAULT_MIN_CHAPTER_WORDS = 2500;
const MIN_CHAPTER_WORDS_LIMIT = 500;
const MAX_CHAPTER_WORDS_LIMIT = 20000;
const CHAPTER_TASK_STALE_THRESHOLD_MS = 12 * 60 * 1000;

function normalizeMinChapterWords(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < MIN_CHAPTER_WORDS_LIMIT || parsed > MAX_CHAPTER_WORDS_LIMIT) {
    return null;
  }
  return parsed;
}


// Normalize chapter data from LLM output to consistent structure
export function normalizeChapter(ch: any, fallbackIndex: number): { index: number; title: string; goal: string; hook: string } {
  return {
    index: ch.index ?? ch.chapter_id ?? ch.chapter_number ?? fallbackIndex,
    title: ch.title || `第${fallbackIndex}章`,
    goal: ch.goal || ch.outline || ch.description || ch.plot_summary || '',
    hook: ch.hook || '',
  };
}

// Normalize volume data from LLM output
export function normalizeVolume(vol: any, volIndex: number, chapters: any[]): any {
  const startChapter = vol.startChapter ?? vol.start_chapter ?? (volIndex * 80 + 1);
  const endChapter = vol.endChapter ?? vol.end_chapter ?? ((volIndex + 1) * 80);

  return {
    title: vol.title || vol.volumeTitle || vol.volume_title || `第${volIndex + 1}卷`,
    startChapter,
    endChapter,
    goal: vol.goal || vol.summary || vol.volume_goal || '',
    conflict: vol.conflict || '',
    climax: vol.climax || '',
    volumeEndState: vol.volumeEndState || vol.volume_end_state || '',
    // Use startChapter + i as the correct fallback index for each chapter
    chapters: chapters.map((ch, i) => normalizeChapter(ch, startChapter + i)),
  };
}

const TIMELINE_RESET_PATTERN = /(重置(?:了)?时间线|时间线(?:被)?重置|新的轮回|重新轮回|轮回重启|回到(?:故事)?开始|回到.*(?:过去|最初|起点|开端)|时光倒流|逆转时间|世界线改写|改写世界线|回档|读档重来|重来一次|从头再来)/;

export function buildPreviousVolumeSummary(volume: any): string | undefined {
  if (!volume) return undefined;

  const parts: string[] = [];
  if (volume.title) parts.push(`卷名: ${volume.title}`);
  if (volume.startChapter && volume.endChapter) {
    parts.push(`章节范围: 第${volume.startChapter}-${volume.endChapter}章`);
  }
  if (volume.goal) parts.push(`本卷目标: ${volume.goal}`);
  if (volume.conflict) parts.push(`核心冲突: ${volume.conflict}`);
  if (volume.climax) parts.push(`卷末高潮: ${volume.climax}`);
  if (volume.volumeEndState) parts.push(`卷末状态: ${volume.volumeEndState}`);

  const tailChapters = Array.isArray(volume.chapters)
    ? volume.chapters
        .slice()
        .sort((left: any, right: any) => Number(left?.index || 0) - Number(right?.index || 0))
        .slice(-3)
        .map((chapter: any) => {
          const chapterNo = chapter?.index ? `第${chapter.index}章` : '章节';
          const chapterParts = [chapter?.title ? `${chapterNo}「${chapter.title}」` : chapterNo];
          if (chapter?.goal) chapterParts.push(String(chapter.goal));
          if (chapter?.hook) chapterParts.push(`钩子: ${chapter.hook}`);
          return chapterParts.join(' | ');
        })
        .filter(Boolean)
    : [];

  if (tailChapters.length > 0) {
    parts.push(`最后关键章节:\n- ${tailChapters.join('\n- ')}`);
  }

  if (TIMELINE_RESET_PATTERN.test(parts.join('\n'))) {
    parts.push('时间线规则: 上一卷已出现时间线重置/轮回重启信号，续写必须以重置后的世界状态为新的基线，不得直接沿用重置前已被覆盖的主冲突。');
  }

  return parts.join('\n') || undefined;
}

// Normalize milestones - ensure it's an array of strings
export function normalizeMilestones(milestones: any[]): string[] {
  if (!Array.isArray(milestones)) return [];
  return milestones.map((m) => {
    if (typeof m === 'string') return m;
    // Handle object format like {milestone: '...', description: '...'}
    return m.milestone || m.description || m.title || JSON.stringify(m);
  });
}

// Validate outline for coverage and quality
export function validateOutline(outline: any, targetChapters: number): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check total chapter coverage
  let totalChaptersInOutline = 0;
  const allIndices = new Set<number>();

  for (const vol of outline.volumes || []) {
    for (const ch of vol.chapters || []) {
      totalChaptersInOutline++;
      allIndices.add(ch.index);

      // Check for placeholder titles
      if (!ch.title || ch.title.match(/^第?\d+章?$/) || ch.title.includes('待补充')) {
        issues.push(`第${ch.index}章标题缺失或为占位符`);
      }

      // Check for missing goals
      if (!ch.goal || ch.goal === '待补充' || ch.goal.length < 10) {
        issues.push(`第${ch.index}章目标缺失或过短`);
      }
    }
  }

  // Check for missing indices
  for (let i = 1; i <= targetChapters; i++) {
    if (!allIndices.has(i)) {
      issues.push(`缺失第${i}章`);
    }
  }

  // Check total count
  if (totalChaptersInOutline !== targetChapters) {
    issues.push(`章节总数不匹配: 实际${totalChaptersInOutline}章 vs 目标${targetChapters}章`);
  }


  return {
    valid: issues.length === 0,
    issues: issues.slice(0, 20), // Limit to first 20 issues
  };
}

export type OutlineQueuePayload = {
  taskType: 'outline';
  taskId: number;
  userId: string;
  projectId: string;
  targetChapters: number;
  targetWordCount: number;
  customPrompt?: string;
  minChapterWords?: number;
  aiConfig: AIConfig;
  // 追加卷模式
  appendMode?: boolean;
  newVolumeCount?: number;
  chaptersPerVolume?: number;
  // 大纲完善模式
  refineMode?: boolean;
  refineVolumeIndices?: number[];
};

export const OUTLINE_TASK_PROGRESS_TOTAL = 100;

export function computeOutlineProgress(volumeIndex: number, totalVolumes: number): number {
  if (totalVolumes <= 0) {
    return 70;
  }
  const ratio = (volumeIndex + 1) / totalVolumes;
  const scaled = 20 + Math.round(ratio * 60);
  return Math.max(20, Math.min(80, scaled));
}

export function detectVolumesToRefine(volumes: any[]): number[] {
  const indices: number[] = [];

  for (let i = 0; i < volumes.length; i++) {
    const volume = volumes[i];
    const chapters = Array.isArray(volume?.chapters) ? volume.chapters : [];
    const expectedCount = Math.max(0, Number(volume?.endChapter) - Number(volume?.startChapter) + 1);
    const hasContentCount = chapters.filter((chapter: any) => chapter?.goal && String(chapter.goal).length > 5).length;
    const isPlaceholder = chapters.length <= 1;
    const isEmpty = hasContentCount < Math.max(5, expectedCount * 0.1);

    if (isPlaceholder || isEmpty) {
      indices.push(i);
    }
  }

  return indices;
}

export function getRefineVolumeIndices(volumes: any[], requestedIndices?: number[]): number[] {
  if (Array.isArray(requestedIndices) && requestedIndices.length > 0) {
    return Array.from(new Set(
      requestedIndices
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value < volumes.length)
    )).sort((a, b) => a - b);
  }

  return detectVolumesToRefine(volumes);
}

async function enqueueOutlineTask(c: any, payload: OutlineQueuePayload): Promise<void> {
  if (c.env.GENERATION_QUEUE) {
    await c.env.GENERATION_QUEUE.send(payload);
    return;
  }

  console.warn('GENERATION_QUEUE not bound, falling back to waitUntil for outline task');
  c.executionCtx.waitUntil(
    runOutlineGenerationTaskInBackground({
      env: c.env,
      taskId: payload.taskId,
      userId: payload.userId,
      projectId: payload.projectId,
      targetChapters: payload.targetChapters,
      targetWordCount: payload.targetWordCount,
      customPrompt: payload.customPrompt,
      minChapterWords: payload.minChapterWords,
      aiConfig: payload.aiConfig,
      appendMode: payload.appendMode,
      newVolumeCount: payload.newVolumeCount,
      chaptersPerVolume: payload.chaptersPerVolume,
      refineMode: payload.refineMode,
      refineVolumeIndices: payload.refineVolumeIndices,
    })
  );
}

// Imported from extracted module; re-exported for worker.ts and other consumers
import { runOutlineGenerationTaskInBackground } from '../tasks/outlineTaskRunner.js';
export { runOutlineGenerationTaskInBackground };

// Generate outline (queue-backed, returns immediately)
generationRoutes.post('/projects/:name/outline', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_outline');
  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { targetChapters = 400, targetWordCount = 100, customPrompt, minChapterWords, appendMode, newVolumeCount, chaptersPerVolume } = await c.req.json();
    const hasMinChapterWords = minChapterWords !== undefined && minChapterWords !== null && minChapterWords !== '';
    const parsedMinChapterWords = normalizeMinChapterWords(minChapterWords);
    if (hasMinChapterWords && parsedMinChapterWords === null) {
      return c.json({
        success: false,
        error: `minChapterWords must be an integer between ${MIN_CHAPTER_WORDS_LIMIT} and ${MAX_CHAPTER_WORDS_LIMIT}`,
      }, 400);
    }

    const project = await c.env.DB.prepare(`
      SELECT p.id
      FROM projects p
      WHERE (p.id = ? OR p.name = ?) AND p.deleted_at IS NULL AND p.user_id = ?
      ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first() as { id: string } | null;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const { taskId, created } = await createBackgroundTask(
      c.env.DB,
      project.id,
      userId,
      'outline',
      OUTLINE_TASK_PROGRESS_TOTAL,
      0,
      '任务已创建，等待队列执行...'
    );

    if (created) {
      await enqueueOutlineTask(c, {
        taskType: 'outline',
        taskId,
        userId,
        projectId: project.id,
        targetChapters,
        targetWordCount,
        customPrompt,
        minChapterWords: parsedMinChapterWords ?? undefined,
        aiConfig,
        appendMode: appendMode || false,
        newVolumeCount: newVolumeCount || undefined,
        chaptersPerVolume: chaptersPerVolume || undefined,
      });
    }

    return c.json({
      success: true,
      message: created
        ? 'Outline generation task has been enqueued in the background.'
        : 'An outline generation task is already running in the background.',
      taskId,
    }, 202);
  } catch (error) {
    console.error('Outline generation enqueue failed:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});


// Generate chapters
generationRoutes.post('/projects/:name/generate', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_chapter');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { chaptersToGenerate = 1, minChapterWords } = await c.req.json();
    const hasMinChapterWords = minChapterWords !== undefined && minChapterWords !== null && minChapterWords !== '';
    const parsedMinChapterWords = normalizeMinChapterWords(minChapterWords);
    if (hasMinChapterWords && parsedMinChapterWords === null) {
      return c.json({
        success: false,
        error: `minChapterWords must be an integer between ${MIN_CHAPTER_WORDS_LIMIT} and ${MAX_CHAPTER_WORDS_LIMIT}`,
      }, 400);
    }

    // Get project with state and outline
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.name, p.bible, s.*, o.outline_json, c.characters_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      LEFT JOIN characters c ON p.id = c.project_id
      WHERE (p.id = ? OR p.name = ?) AND p.user_id = ?
      ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    if (hasMinChapterWords && parsedMinChapterWords !== null) {
      await c.env.DB.prepare(`
        UPDATE states
        SET min_chapter_words = ?
        WHERE project_id = ?
      `).bind(parsedMinChapterWords, project.id).run();
      project.min_chapter_words = parsedMinChapterWords;
    }

    const rebasedState = await rebaseProjectStateToContinuity(c.env.DB, project.id);
    project.next_chapter_index = rebasedState.nextChapterIndex;
    project.rolling_summary = rebasedState.rollingSummary;
    project.summary_base_chapter_index = rebasedState.summaryBaseChapterIndex;
    project.open_loops = JSON.stringify(rebasedState.openLoops);

    const outline = project.outline_json ? JSON.parse(project.outline_json) : null;
    const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;

    // Store the starting index
    const startingChapterIndex = project.next_chapter_index;

    // 1. Create a Generation Task in D1
    // (This signals to active-task API that a task is now 'running')
    const taskId = await createGenerationTask(
      c.env.DB,
      project.id,
      userId,
      project.total_chapters, // MUST be the total chapters (e.g., 10), not the batch size (e.g., 2), or UI resets
      startingChapterIndex
    );

    // 2. Enqueue the task into Cloudflare Queues
    await startGenerationChain(c, taskId, userId, aiConfig,
      chaptersToGenerate
    );

    // 3. Respond with 202 immediately to free up the client
    return c.json({
      success: true,
      message: 'Generation task has been enqueued in the background.',
      taskId
    }, 202);

  } catch (error) {
    console.error('Generation Failed with 500:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Imported from extracted module; re-exported for worker.ts and other consumers
import {
  type TaskRuntimeControl,
  getTaskRuntimeControl,
  runChapterGenerationTaskInBackground,
  startGenerationChain,
  getContiguousCompletedCount,
  emitProgressEvent,
  formatDurationMs,
} from '../tasks/chapterTaskRunner.js';
export {
  type TaskRuntimeControl,
  getTaskRuntimeControl,
  runChapterGenerationTaskInBackground,
  startGenerationChain,
  getContiguousCompletedCount,
  emitProgressEvent,
  formatDurationMs,
};


// Streaming chapter generation monitor (task runs in background)
generationRoutes.post('/projects/:name/generate-stream', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  const authHeader = c.req.header('Authorization');
  const origin = new URL(c.req.url).origin;

  if (!userId || !authHeader) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_chapter');
  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  const body = await c.req.json().catch(() => ({} as any));
  const requestedCountRaw = Number.parseInt(String(body.chaptersToGenerate ?? '1'), 10);
  const requestedCount = Number.isInteger(requestedCountRaw) && requestedCountRaw > 0 ? requestedCountRaw : 1;
  const targetIndex = body.index ? parseInt(body.index, 10) : undefined;
  const regenerate = Boolean(body.regenerate);
  const hasMinChapterWords = body.minChapterWords !== undefined && body.minChapterWords !== null && body.minChapterWords !== '';
  const parsedMinChapterWords = normalizeMinChapterWords(body.minChapterWords);

  if (hasMinChapterWords && parsedMinChapterWords === null) {
    return c.json({
      success: false,
      error: `minChapterWords must be an integer between ${MIN_CHAPTER_WORDS_LIMIT} and ${MAX_CHAPTER_WORDS_LIMIT}`,
    }, 400);
  }

  const project = await c.env.DB.prepare(`
    SELECT p.id, p.name, s.next_chapter_index, s.total_chapters
    FROM projects p
    JOIN states s ON p.id = s.project_id
    WHERE (p.id = ? OR p.name = ?) AND p.user_id = ? AND p.deleted_at IS NULL
    ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
    LIMIT 1
  `).bind(name, name, userId, name).first() as {
    id: string;
    name: string;
    next_chapter_index: number;
    total_chapters: number;
  } | null;

  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404);
  }

  if (hasMinChapterWords && parsedMinChapterWords !== null) {
    await c.env.DB.prepare(`
      UPDATE states
      SET min_chapter_words = ?
      WHERE project_id = ?
    `).bind(parsedMinChapterWords, project.id).run();
    (project as any).min_chapter_words = parsedMinChapterWords;
  }

  const continuity = await rebaseProjectStateToContinuity(c.env.DB, project.id);
  project.next_chapter_index = continuity.nextChapterIndex;
  const actualMaxChapter = continuity.maxChapterIndex;
  const firstMissingChapter = continuity.firstMissingChapter;

  let startingIndex = project.next_chapter_index;
  let chaptersToGenerate = requestedCount;

  if (targetIndex !== undefined) {
    if (firstMissingChapter !== null && targetIndex > firstMissingChapter) {
      return c.json({
        success: false,
        error: `当前存在断档，必须先处理第 ${firstMissingChapter} 章，再继续操作第 ${targetIndex} 章。`,
      }, 400);
    }
    if (targetIndex > actualMaxChapter + 1) {
      return c.json({ success: false, error: `无法跳过生成。当前最大章节为第 ${actualMaxChapter} 章，必须先生成第 ${actualMaxChapter + 1} 章。` }, 400);
    }
    const existingTargetChapter = await c.env.DB.prepare(`
      SELECT id
      FROM chapters
      WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(project.id, targetIndex).first();
    if (existingTargetChapter && !regenerate) {
      return c.json({ success: false, error: `第 ${targetIndex} 章已存在。如需重写，请使用重新生成功能。` }, 409);
    }
    startingIndex = targetIndex;
    chaptersToGenerate = 1; // When targeting a specific index, just generate 1
  } else {
    if (!regenerate && firstMissingChapter !== null) {
      startingIndex = firstMissingChapter;
      chaptersToGenerate = 1;
      await c.env.DB.prepare(`
        UPDATE states SET next_chapter_index = ? WHERE project_id = ?
      `).bind(firstMissingChapter, project.id).run();
      project.next_chapter_index = firstMissingChapter;
      console.warn(
        `[Gap Repair] project=${project.id} detected missing chapter ${firstMissingChapter}, forcing single-chapter repair`
      );
    }

    if (firstMissingChapter === null) {
      const expectedNextIndex = actualMaxChapter + 1;
      if (project.next_chapter_index !== expectedNextIndex) {
        project.next_chapter_index = expectedNextIndex;
        startingIndex = expectedNextIndex;
        await c.env.DB.prepare(`
          UPDATE states SET next_chapter_index = ? WHERE project_id = ?
        `).bind(expectedNextIndex, project.id).run();
      }

      const remaining = Math.max(0, project.total_chapters - actualMaxChapter);
      if (remaining <= 0) {
        return c.json({ success: false, error: '已达到目标章节数，无需继续生成' }, 400);
      }
      chaptersToGenerate = Math.min(requestedCount, remaining);
    }
  }

  let runningTaskCheck = await checkRunningTask(c.env.DB, project.id, userId);

  // Check for stale task (no progress for 30 minutes)
  // We need to calculate this BEFORE deciding whether to kill the task,
  // but also ensure it's available for the isResumed check later.
  let isRunningTaskFresh = false;
  let runningTaskUpdatedAt = 0;

  if (runningTaskCheck.isRunning && runningTaskCheck.task) {
    const rawUpdatedAt = runningTaskCheck.task.updated_at;
    runningTaskUpdatedAt = (() => {
      if (typeof rawUpdatedAt === 'number' && Number.isFinite(rawUpdatedAt)) {
        return rawUpdatedAt;
      }
      if (typeof rawUpdatedAt === 'string') {
        const trimmed = rawUpdatedAt.trim();
        if (/^\d+$/.test(trimmed)) {
          const numeric = Number(trimmed);
          if (Number.isFinite(numeric)) return numeric;
        }
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed)) return parsed;
        const parsedUtc = Date.parse(`${trimmed}Z`);
        if (Number.isFinite(parsedUtc)) return parsedUtc;
      }
      return 0;
    })();

    const runningTaskFreshThresholdMs = CHAPTER_TASK_STALE_THRESHOLD_MS;
    isRunningTaskFresh = runningTaskUpdatedAt > 0 && (Date.now() - runningTaskUpdatedAt) < runningTaskFreshThresholdMs;

    if (!isRunningTaskFresh) {
      const staleMinutes = Math.round(runningTaskFreshThresholdMs / 60000);
      await completeTask(
        c.env.DB,
        runningTaskCheck.taskId!,
        false,
        `任务超过 ${staleMinutes} 分钟无进展，已自动标记失败，请重新发起`
      );
      // Update local check so we can fall through to "Smart Resume" logic
      // Note: isRunningTaskFresh remains FALSE, which correctly prevents isResumed=true later.
      runningTaskCheck = { isRunning: false };
    }
  }

  // Smart Resume Logic: If no running task, check if we should resume a recently failed one
  if (!runningTaskCheck.isRunning) {
    const latestTask = await c.env.DB.prepare(`
          SELECT * FROM generation_tasks 
          WHERE project_id = ? AND user_id = ? 
          ORDER BY created_at DESC LIMIT 1
      `).bind(project.id, userId).first() as any;

    if (latestTask && (latestTask.status === 'failed' || latestTask.status === 'error')) {
      const completed = Array.from(new Set(JSON.parse(latestTask.completed_chapters || '[]') as number[])).length;
      const target = latestTask.target_count;

      // Heuristic:
      // 1. The failed task had the SAME target count as the current request (e.g. 20)
      // 2. The project's next_chapter_index aligns with where the failed task left off
      //    (next_chapter_index should be start_chapter + completed)
      const expectedNext = latestTask.start_chapter + completed;

      if (target === requestedCount && project.next_chapter_index === expectedNext && completed < target) {
        const adjustedCount = target - completed;
        if (adjustedCount > 0) {
          console.log(`[Smart Resume] Detected failed task ${latestTask.id}. Resuming with adjusted count: ${chaptersToGenerate} -> ${adjustedCount}`);
          chaptersToGenerate = adjustedCount;
        }
      }
    }
  }

  const isResumed = Boolean(runningTaskCheck.isRunning && runningTaskCheck.taskId && isRunningTaskFresh);

  const taskId = isResumed
    ? (runningTaskCheck.taskId as number)
    : await createGenerationTask(
      c.env.DB,
      project.id,
      userId,
      chaptersToGenerate,
      startingIndex
    );

  // A resumed task is already running in the queue. Re-enqueueing it from a reconnect
  // can start duplicate workers for the same chapter and stall the pipeline.
  if (!isResumed) {
    const fallbackConfigs = await getFallbackAIConfigsFromRegistry(c.env.DB, aiConfig.model);
    await startGenerationChain(c, taskId, userId, aiConfig, chaptersToGenerate, fallbackConfigs);
  }

  const initialTask = await getTaskById(c.env.DB, taskId, userId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let pollInFlight = false;
      let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
      let pollInterval: ReturnType<typeof setInterval> | undefined;
      let lastMessage = initialTask?.currentMessage || null;
      let lastProgress = initialTask?.currentProgress || 0;

      const seenCompleted = new Set<number>(initialTask?.completedChapters || []);
      const seenFailed = new Set<number>(initialTask?.failedChapters || []);

      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        if (pollInterval) clearInterval(pollInterval);
        try {
          controller.close();
        } catch {
          // no-op
        }
      };

      const sendEvent = (type: string, data: Record<string, unknown> = {}) => {
        if (closed) return;
        try {
          const payload = JSON.stringify({ type, ...data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          close();
        }
      };

      const emitTaskSnapshot = async () => {
        if (pollInFlight || closed) return;
        pollInFlight = true;
        try {
          const task = await getTaskById(c.env.DB, taskId, userId);
          if (!task) {
            sendEvent('error', { error: '任务已取消或不存在', taskId });
            close();
            return;
          }

          const newlyCompleted = task.completedChapters
            .filter((chapterIndex) => !seenCompleted.has(chapterIndex))
            .sort((a, b) => a - b);
          for (const chapterIndex of newlyCompleted) {
            seenCompleted.add(chapterIndex);
            sendEvent('chapter_complete', {
              chapterIndex,
              title: `第 ${chapterIndex} 章`,
              preview: '',
              wordCount: 0,
            });
          }

          const newlyFailed = task.failedChapters
            .filter((chapterIndex) => !seenFailed.has(chapterIndex))
            .sort((a, b) => a - b);
          for (const chapterIndex of newlyFailed) {
            seenFailed.add(chapterIndex);
            sendEvent('chapter_error', {
              chapterIndex,
              error: `第 ${chapterIndex} 章生成失败`,
            });
          }

          if (task.currentMessage !== lastMessage || task.currentProgress !== lastProgress) {
            lastMessage = task.currentMessage;
            lastProgress = task.currentProgress;
            sendEvent('progress', {
              current: task.completedChapters.length,
              total: task.targetCount,
              chapterIndex: task.currentProgress || undefined,
              status: 'generating',
              message: task.currentMessage || '任务执行中...',
            });
          }

          if (task.status === 'completed') {
            const generated = [...task.completedChapters]
              .sort((a, b) => a - b)
              .map((chapter) => ({ chapter, title: `第 ${chapter} 章` }));
            const failedChapters = [...task.failedChapters].sort((a, b) => a - b);
            sendEvent('done', {
              success: true,
              taskId: task.id,
              generated,
              failedChapters,
              totalGenerated: generated.length,
              totalFailed: failedChapters.length,
            });
            close();
            return;
          }

          if (task.status === 'failed') {
            const cancelled = Boolean(
              (task.errorMessage && task.errorMessage.includes('取消'))
              || (task.currentMessage && task.currentMessage.includes('取消'))
              || task.cancelRequested
            );
            sendEvent('error', {
              error: task.errorMessage || '任务执行失败',
              cancelled,
              taskId: task.id,
            });
            close();
            return;
          }

          if (task.status === 'paused') {
            sendEvent('error', {
              error: task.currentMessage || '任务已暂停，请重新发起',
              cancelled: Boolean(task.cancelRequested),
              taskId: task.id,
            });
            close();
            return;
          }
        } catch (err) {
          sendEvent('error', { error: (err as Error).message, taskId });
          close();
        } finally {
          pollInFlight = false;
        }
      };

      sendEvent('start', {
        total: initialTask?.targetCount || chaptersToGenerate,
      });

      if (isResumed && initialTask) {
        sendEvent('task_resumed', {
          taskId: initialTask.id,
          completedChapters: initialTask.completedChapters,
          targetCount: initialTask.targetCount,
          currentProgress: initialTask.currentProgress,
          currentMessage: initialTask.currentMessage,
        });
      } else {
        sendEvent('task_created', { taskId });
      }

      heartbeatInterval = setInterval(() => {
        sendEvent('heartbeat');
      }, 5000);

      pollInterval = setInterval(() => {
        void emitTaskSnapshot();
      }, 1200);

      void emitTaskSnapshot();

      c.req.raw.signal.addEventListener('abort', () => {
        close();
      });
    },
    cancel() {
      // no-op
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

// Enhanced chapter generation with full context engineering
generationRoutes.post('/projects/:name/generate-enhanced', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_chapter');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const {
      chaptersToGenerate = 1,
      enableContextOptimization = true,
      enableFullQC = false,
      enableAutoRepair = false,
    } = await c.req.json();

    // Get project with state and outline (user-scoped)
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.name, p.bible, s.*, o.outline_json, c.characters_json,
             cs.registry_json as character_states_json, cs.last_updated_chapter as states_chapter,
             pg.graph_json as plot_graph_json, pg.last_updated_chapter as plot_chapter,
             nc.narrative_arc_json
      FROM projects p
      JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      LEFT JOIN characters c ON p.id = c.project_id
      LEFT JOIN character_states cs ON p.id = cs.project_id
      LEFT JOIN plot_graphs pg ON p.id = pg.project_id
      LEFT JOIN narrative_config nc ON p.id = nc.project_id
      WHERE (p.id = ? OR p.name = ?) AND p.user_id = ?
      ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const runningTask = await checkRunningTask(c.env.DB, project.id, userId);
    if (runningTask.isRunning) {
      return c.json(
        { success: false, error: '当前有后台章节任务正在运行，请先等待完成或取消任务后再发起此请求。' },
        409
      );
    }

    const taskId = await createGenerationTask(
      c.env.DB,
      project.id,
      userId,
      chaptersToGenerate,
      project.next_chapter_index
    );

    // Start Chain
    const authHeader = c.req.header('Authorization') || '';
    const origin = new URL(c.req.url).origin;

    const fallbackConfigs = await getFallbackAIConfigsFromRegistry(c.env.DB, aiConfig.model);
    await startGenerationChain(c, taskId, userId, aiConfig, chaptersToGenerate, fallbackConfigs);

    // We return immediately, the task runs in background (via startGenerationChain -> waitUntil)
    // Client can poll task status or listen to SSE
    return c.json({
      success: true,
      message: 'Task started',
      taskId,
      contextStats: {
        characterStatesActive: project.character_states_json ? JSON.parse(project.character_states_json).length : 0,
        // simplified stats as we return early
      }
    });

    /* 
       Optimized/Refactored: The previous logic ran `writeEnhancedChapter` in a loop IN THE REQUEST HANDLER 
       and awaited the result. This would timeout for multiple chapters.
       We now offload to the background task (Chain of Workers).
       The previous synchronous return of content is no longer possible for multi-chapter requests.
       Frontend needs to adapt to async task flow.
    */
  } catch (error) {
    console.error('Enhanced generation error:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }

});

// Helper: Generate master outline





// Add volumes to existing outline - SSE streaming
generationRoutes.post('/projects/:name/outline/add-volumes', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'refine_outline');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  let bodyParsed: { newVolumeCount?: number; chaptersPerVolume?: number; minChapterWords?: number } = {};
  try {
    bodyParsed = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid request body' }, 400);
  }

  const { newVolumeCount = 1, chaptersPerVolume = 80, minChapterWords } = bodyParsed;

  if (!Number.isInteger(newVolumeCount) || newVolumeCount <= 0 || newVolumeCount > 20) {
    return c.json({ success: false, error: 'newVolumeCount must be 1-20' }, 400);
  }
  if (!Number.isInteger(chaptersPerVolume) || chaptersPerVolume <= 0 || chaptersPerVolume > 200) {
    return c.json({ success: false, error: 'chaptersPerVolume must be 1-200' }, 400);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: any) => {
        try {
          const payload = JSON.stringify({ type, ...data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch (e) {
          console.error('Error sending SSE event', e);
        }
      };

      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: {"type":"heartbeat"}\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 5000);

      let taskId: number | undefined;
      try {
        // 获取项目
        const project = await c.env.DB.prepare(`
          SELECT p.id, p.bible, p.name, s.min_chapter_words
          FROM projects p
          LEFT JOIN states s ON p.id = s.project_id
          WHERE (p.id = ? OR p.name = ?) AND p.user_id = ? AND p.deleted_at IS NULL
          ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
          LIMIT 1
        `).bind(name, name, userId, name).first();

        if (!project) {
          sendEvent('error', { error: 'Project not found' });
          clearInterval(heartbeatInterval);
          controller.close();
          return;
        }

        const projectId = (project as any).id;
        const bible = (project as any).bible;
        const effectiveMinChapterWords = minChapterWords
          ?? (Number.isFinite(Number((project as any).min_chapter_words))
            ? Number((project as any).min_chapter_words)
            : DEFAULT_MIN_CHAPTER_WORDS);

        // 读取现有大纲
        const outlineRecord = await c.env.DB.prepare(`
          SELECT outline_json FROM outlines WHERE project_id = ?
        `).bind(projectId).first();

        if (!outlineRecord) {
          sendEvent('error', { error: '当前项目没有大纲，无法追加卷。请先生成大纲。' });
          clearInterval(heartbeatInterval);
          controller.close();
          return;
        }

        const existingOutline = JSON.parse((outlineRecord as any).outline_json);
        const existingVolumes = existingOutline.volumes || [];

        // 获取实际剧情摘要
        const sseStateRecord = await c.env.DB.prepare(`
          SELECT rolling_summary FROM states WHERE project_id = ?
        `).bind(projectId).first() as { rolling_summary?: string } | null;
        const actualStorySummary = sseStateRecord?.rolling_summary || undefined;

        // 注册到任务中心
        const bgResult = await createBackgroundTask(
          c.env.DB,
          projectId,
          userId!,
          'outline',
          newVolumeCount,
          0,
          `正在基于已有 ${existingVolumes.length} 卷生成 ${newVolumeCount} 个新卷...`
        );
        taskId = bgResult.taskId;

        sendEvent('start', {
          totalVolumes: newVolumeCount,
          existingVolumeCount: existingVolumes.length,
          message: `正在基于已有 ${existingVolumes.length} 卷生成 ${newVolumeCount} 个新卷...`,
          taskId,
        });

        // 生成新卷骨架
        await updateTaskMessage(c.env.DB, taskId!, '正在生成新卷骨架...', 0);
        sendEvent('progress', {
          current: 0,
          total: newVolumeCount,
          message: '正在生成新卷骨架...',
        });

        const newVolumesResult = await generateAdditionalVolumes(aiConfig, {
          bible,
          existingOutline: {
            mainGoal: existingOutline.mainGoal || '',
            milestones: existingOutline.milestones || [],
            volumes: existingVolumes,
            totalChapters: existingOutline.totalChapters || 0,
            targetWordCount: existingOutline.targetWordCount || 0,
          },
          newVolumeCount,
          chaptersPerVolume,
          minChapterWords: effectiveMinChapterWords,
          actualStorySummary,
        });

        const newVolumeSkeletons = newVolumesResult.volumes || [];
        if (newVolumeSkeletons.length === 0) {
          await completeTask(c.env.DB, taskId!, false, 'AI 未能生成新卷骨架');
          sendEvent('error', { error: 'AI 未能生成新卷骨架' });
          clearInterval(heartbeatInterval);
          controller.close();
          return;
        }

        // 逐卷填充章节
        const filledVolumes = [];
        for (let i = 0; i < newVolumeSkeletons.length; i++) {
          const vol = newVolumeSkeletons[i];
          const globalVolIndex = existingVolumes.length + i;

          const progressMsg = `正在生成第 ${globalVolIndex + 1} 卷「${vol.title}」的章节... (${i + 1}/${newVolumeSkeletons.length})`;
          await updateTaskMessage(c.env.DB, taskId!, progressMsg, i + 1);
          sendEvent('progress', {
            current: i + 1,
            total: newVolumeSkeletons.length,
            volumeIndex: globalVolIndex,
            volumeTitle: vol.title,
            message: progressMsg,
          });

          // 构建上一卷摘要
          let previousVolumeSummary: string | undefined;
          if (i === 0 && existingVolumes.length > 0) {
            const lastExisting = existingVolumes[existingVolumes.length - 1];
            previousVolumeSummary = buildPreviousVolumeSummary(lastExisting);
          } else if (i > 0) {
            const prevNew = newVolumeSkeletons[i - 1];
            previousVolumeSummary = buildPreviousVolumeSummary(prevNew);
          }

          const chapters = await generateVolumeChapters(aiConfig, {
            bible,
            masterOutline: { mainGoal: existingOutline.mainGoal || '', milestones: existingOutline.milestones || [] },
            volume: vol,
            previousVolumeSummary,
            minChapterWords: effectiveMinChapterWords,
            actualStorySummary: i === 0 ? actualStorySummary : undefined,
          });

          const normalizedVolume = normalizeVolume(vol, globalVolIndex, chapters);
          filledVolumes.push(normalizedVolume);

          sendEvent('volume_complete', {
            current: i + 1,
            total: newVolumeSkeletons.length,
            volumeIndex: globalVolIndex,
            volumeTitle: vol.title,
            chapterCount: chapters.length,
            message: `第 ${globalVolIndex + 1} 卷「${vol.title}」完成 (${chapters.length} 章)`,
          });
        }

        // 更新大纲和 states
        const addedChapters = filledVolumes.reduce((sum: number, v: any) => sum + (v.chapters?.length || 0), 0);
        const newTotalChapters = (existingOutline.totalChapters || 0) + addedChapters;

        const finalOutline = {
          ...existingOutline,
          totalChapters: newTotalChapters,
          volumes: [...existingVolumes, ...filledVolumes],
        };

        await c.env.DB.prepare(`
          UPDATE outlines SET outline_json = ? WHERE project_id = ?
        `).bind(JSON.stringify(finalOutline), projectId).run();

        await c.env.DB.prepare(`
          UPDATE states SET total_chapters = ? WHERE project_id = ?
        `).bind(newTotalChapters, projectId).run();

        const doneMsg = `追加 ${filledVolumes.length} 卷完成，共新增 ${addedChapters} 章`;
        await updateTaskMessage(c.env.DB, taskId!, doneMsg, newVolumeCount);
        await completeTask(c.env.DB, taskId!, true, undefined);
        sendEvent('done', {
          success: true,
          message: doneMsg,
          outline: finalOutline,
        });

        clearInterval(heartbeatInterval);
        controller.close();
      } catch (error) {
        console.error('Add volumes error:', error);
        // taskId 可能在 catch 之前还没创建，需要安全检查
        if (typeof taskId === 'number') {
          await completeTask(c.env.DB, taskId, false, (error as Error).message).catch(console.warn);
        }
        sendEvent('error', { error: (error as Error).message });
        clearInterval(heartbeatInterval);
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// Refine outline (regenerate missing/incomplete volumes) - queue-backed
generationRoutes.post('/projects/:name/outline/refine', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const aiConfig = await getAIConfig(c, c.env.DB, 'refine_outline');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    let volumeIndex: number | undefined;
    try {
      const body = await c.req.json();
      volumeIndex = body.volumeIndex;
    } catch {
      volumeIndex = undefined;
    }

    const project = await c.env.DB.prepare(`
      SELECT p.id
      FROM projects p
      WHERE (p.id = ? OR p.name = ?) AND p.user_id = ? AND p.deleted_at IS NULL
      ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first() as { id: string } | null;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const outlineRecord = await c.env.DB.prepare(`
      SELECT outline_json FROM outlines WHERE project_id = ?
    `).bind(project.id).first() as { outline_json?: string } | null;

    if (!outlineRecord?.outline_json) {
      return c.json({ success: false, error: 'Outline not found' }, 404);
    }

    const outline = JSON.parse(outlineRecord.outline_json);
    const refineVolumeIndices = getRefineVolumeIndices(
      Array.isArray(outline?.volumes) ? outline.volumes : [],
      Number.isInteger(volumeIndex) ? [Number(volumeIndex)] : undefined,
    );

    if (refineVolumeIndices.length === 0) {
      return c.json({
        success: true,
        completed: true,
        message: 'Outline is already complete',
      });
    }

    const { taskId, created } = await createBackgroundTask(
      c.env.DB,
      project.id,
      userId,
      'outline',
      refineVolumeIndices.length,
      0,
      `正在准备完善 ${refineVolumeIndices.length} 卷大纲...`
    );

    if (created) {
      await enqueueOutlineTask(c, {
        taskType: 'outline',
        taskId,
        userId,
        projectId: project.id,
        targetChapters: Number(outline?.totalChapters) || 0,
        targetWordCount: Number(outline?.targetWordCount) || 0,
        aiConfig,
        refineMode: true,
        refineVolumeIndices,
      });
    }

    return c.json({
      success: true,
      taskId,
      totalVolumes: refineVolumeIndices.length,
      message: created
        ? 'Outline refine task has been enqueued in the background.'
        : 'An outline task is already running in the background.',
    }, 202);
  } catch (error) {
    console.error('Outline refine enqueue failed:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Migration endpoint to normalize existing outline data
generationRoutes.post('/migrate-outlines', async (c) => {
  try {
    // Get all outlines from database
    const { results } = await c.env.DB.prepare(`
      SELECT o.project_id, o.outline_json, p.name as project_name
      FROM outlines o
      JOIN projects p ON o.project_id = p.id
    `).all();

    const migrated: string[] = [];
    const errors: string[] = [];

    for (const row of results) {
      try {
        const outline = JSON.parse((row as any).outline_json);

        // Normalize the outline
        const normalizedOutline = {
          totalChapters: outline.totalChapters,
          targetWordCount: outline.targetWordCount,
          mainGoal: outline.mainGoal || '',
          milestones: normalizeMilestones(outline.milestones || []),
          volumes: (outline.volumes || []).map((vol: any, volIndex: number) => ({
            title: vol.title || vol.volumeTitle || vol.volume_title || `第${volIndex + 1}卷`,
            startChapter: vol.startChapter ?? vol.start_chapter ?? (volIndex * 80 + 1),
            endChapter: vol.endChapter ?? vol.end_chapter ?? ((volIndex + 1) * 80),
            goal: vol.goal || vol.summary || vol.volume_goal || '',
            conflict: vol.conflict || '',
            climax: vol.climax || '',
            volumeEndState: vol.volumeEndState || vol.volume_end_state || '',
            chapters: (vol.chapters || []).map((ch: any, chIndex: number) => normalizeChapter(ch, chIndex + 1)),
          })),
        };

        // Update the database
        await c.env.DB.prepare(`
          UPDATE outlines SET outline_json = ? WHERE project_id = ?
        `).bind(JSON.stringify(normalizedOutline), (row as any).project_id).run();

        migrated.push((row as any).project_name);
      } catch (err) {
        errors.push(`${(row as any).project_name}: ${(err as Error).message}`);
      }
    }

    return c.json({
      success: true,
      message: `Migrated ${migrated.length} outlines`,
      migrated,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
