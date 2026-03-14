/**
 * Chapter task runner — extracted from generation.ts
 *
 * Contains runChapterGenerationTaskInBackground and its chapter-specific helpers:
 * - emitProgressEvent / normalizeRealtimeStatus
 * - getTaskRuntimeControl / handleTaskCancellationIfNeeded
 * - summary-update planning (planSummaryUpdate, getSummaryUpdateInterval, etc.)
 * - startGenerationChain
 * - getContiguousCompletedCount
 */

import type { Env } from '../worker.js';
import type { AIConfig } from '../services/aiClient.js';
import { getFeatureMappedAIConfig } from '../services/aiConfigResolver.js';
import { consumeCredit } from '../services/creditService.js';
import { logGenerationMetrics } from '../services/logger.js';
import { writeEnhancedChapter } from '../enhancedChapterEngine.js';
import { initializeRegistryFromGraph } from '../context/characterStateManager.js';
import { createEmptyPlotGraph } from '../types/plotGraph.js';
import { generateNarrativeArc } from '../narrative/pacingController.js';
import {
  buildEnhancedOutlineFromChapterContext,
  getOutlineChapterContext,
  normalizeNovelOutline,
} from '../utils/outline.js';
import {
  loadSummarySnapshotUpToChapter,
  rebaseProjectStateToContinuity,
} from '../utils/projectContinuity.js';
import { hasStoryContract } from '../utils/storyContract.js';
import {
  updateTaskProgress,
  completeTask,
  updateTaskMessage,
  getTaskById,
} from '../routes/tasks.js';
import {
  buildPreviousVolumeSummary,
  DEFAULT_MIN_CHAPTER_WORDS,
} from '../routes/generation.js';

type RealtimeProgressStatus =
  | 'starting'
  | 'analyzing'
  | 'planning'
  | 'generating'
  | 'reviewing'
  | 'repairing'
  | 'saving'
  | 'updating_summary'
  | 'done'
  | 'error';

let eventBusModulePromise: Promise<typeof import('../eventBus.js')> | null = null;

function normalizeRealtimeStatus(status?: string): RealtimeProgressStatus {
  if (!status) return 'generating';
  if (status === 'preparing') return 'starting';
  const known = new Set<RealtimeProgressStatus>([
    'starting',
    'analyzing',
    'planning',
    'generating',
    'reviewing',
    'repairing',
    'saving',
    'updating_summary',
    'done',
    'error',
  ]);
  return known.has(status as RealtimeProgressStatus)
    ? (status as RealtimeProgressStatus)
    : 'generating';
}

export async function emitProgressEvent(data: {
  userId: string;
  projectName: string;
  current: number;
  total: number;
  chapterIndex: number;
  status?: string;
  message?: string;
}) {
  try {
    if (!eventBusModulePromise) {
      eventBusModulePromise = import('../eventBus.js');
    }
    const { eventBus } = await eventBusModulePromise;
    eventBus.progress({
      userId: data.userId,
      projectName: data.projectName,
      current: data.current,
      total: data.total,
      chapterIndex: data.chapterIndex,
      status: normalizeRealtimeStatus(data.status),
      message: data.message,
    });
  } catch (err) {
    console.warn('Failed to emit progress event:', (err as Error).message);
  }
}

export type TaskRuntimeControl = {
  exists: boolean;
  status: string | null;
  cancelRequested: boolean;
};

export async function getTaskRuntimeControl(db: D1Database, taskId: number): Promise<TaskRuntimeControl> {
  const row = await db.prepare(`
    SELECT status, cancel_requested
    FROM generation_tasks
    WHERE id = ?
  `).bind(taskId).first() as { status: string; cancel_requested: number | null } | null;

  if (!row) {
    return { exists: false, status: null, cancelRequested: false };
  }

  return {
    exists: true,
    status: row.status,
    cancelRequested: Boolean(row.cancel_requested),
  };
}

async function handleTaskCancellationIfNeeded(params: {
  db: D1Database;
  taskId: number;
  userId: string;
  projectName: string;
  total: number;
  chapterIndex: number;
  current: number;
}): Promise<{ shouldStop: boolean; cancelled: boolean }> {
  const runtime = await getTaskRuntimeControl(params.db, params.taskId);

  if (!runtime.exists || runtime.status !== 'running') {
    return { shouldStop: true, cancelled: false };
  }

  if (!runtime.cancelRequested) {
    return { shouldStop: false, cancelled: false };
  }

  await completeTask(params.db, params.taskId, false, '任务已取消');
  await emitProgressEvent({
    userId: params.userId,
    projectName: params.projectName,
    current: params.current,
    total: params.total,
    chapterIndex: params.chapterIndex,
    status: 'error',
    message: '任务已取消',
  });

  return { shouldStop: true, cancelled: true };
}

const DEFAULT_SUMMARY_UPDATE_INTERVAL = 2;
const MIN_SUMMARY_UPDATE_INTERVAL = 1;
const MAX_SUMMARY_UPDATE_INTERVAL = 20;
const SUMMARY_UPDATE_INTERVAL_KEY = 'summary_update_interval';

type SummaryUpdatePlan = {
  shouldUpdate: boolean;
  reason: 'last_batch' | 'volume_end' | 'volume_start' | 'interval' | 'retry_pending' | 'deferred' | 'rewrite';
  nextPlannedChapter: number;
};

type HistoricalGenerationContext = {
  rollingSummary: string;
  openLoops: string[];
  summaryBaseChapterIndex: number;
};

async function hasPendingSummaryRetry(
  db: D1Database,
  projectId: string,
  chapterIndex: number
): Promise<boolean> {
  try {
    const row = await db.prepare(`
      SELECT chapter_index, summary_updated, update_reason
      FROM summary_memories
      WHERE project_id = ?
      ORDER BY chapter_index DESC, id DESC
      LIMIT 1
    `).bind(projectId).first() as {
      chapter_index?: number;
      summary_updated?: number;
      update_reason?: string;
    } | null;

    if (!row) return false;
    if (Number(row.chapter_index) !== chapterIndex - 1) return false;
    if (Number(row.summary_updated) === 1) return false;
    if (String(row.update_reason || '') === 'deferred') return false;
    return true;
  } catch (error) {
    console.warn('Failed to check pending summary retry:', (error as Error).message);
    return false;
  }
}

function normalizeSummaryUpdateInterval(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < MIN_SUMMARY_UPDATE_INTERVAL || parsed > MAX_SUMMARY_UPDATE_INTERVAL) {
    return null;
  }
  return parsed;
}

async function getSummaryUpdateInterval(db: D1Database, env: Env): Promise<number> {
  try {
    const row = await db.prepare(`
      SELECT setting_value
      FROM system_settings
      WHERE setting_key = ?
      LIMIT 1
    `).bind(SUMMARY_UPDATE_INTERVAL_KEY).first() as { setting_value?: string } | null;

    const fromDb = normalizeSummaryUpdateInterval(row?.setting_value);
    if (fromDb !== null) {
      return fromDb;
    }
  } catch (error) {
    console.warn('Failed to read summary update interval from DB:', (error as Error).message);
  }

  const fromEnv = normalizeSummaryUpdateInterval((env as any).SUMMARY_UPDATE_INTERVAL);
  if (fromEnv !== null) {
    return fromEnv;
  }
  return DEFAULT_SUMMARY_UPDATE_INTERVAL;
}

async function loadHistoricalGenerationContext(
  db: D1Database,
  projectId: string,
  chapterIndex: number
): Promise<HistoricalGenerationContext> {
  try {
    const snapshot = await loadSummarySnapshotUpToChapter(db, projectId, chapterIndex - 1);
    return {
      rollingSummary: snapshot.rollingSummary,
      openLoops: snapshot.openLoops,
      summaryBaseChapterIndex: snapshot.summaryBaseChapterIndex,
    };
  } catch (error) {
    console.warn(
      `[HistoricalContext] Failed to load summary snapshot for project=${projectId}, chapter=${chapterIndex}:`,
      (error as Error).message
    );
    return {
      rollingSummary: '',
      openLoops: [],
      summaryBaseChapterIndex: 0,
    };
  }
}

function planSummaryUpdate(params: {
  chapterIndex: number;
  currentStepIndex: number;
  targetCount: number;
  summaryUpdateInterval: number;
  forceRetry?: boolean;
  outline?: any;
}): SummaryUpdatePlan {
  const {
    chapterIndex,
    currentStepIndex,
    targetCount,
    summaryUpdateInterval,
    forceRetry,
    outline,
  } = params;

  if (forceRetry) {
    return {
      shouldUpdate: true,
      reason: 'retry_pending',
      nextPlannedChapter: chapterIndex,
    };
  }

  // For single-chapter tasks, do not force summary update by "last batch";
  // otherwise interval-based strategy (e.g. every 2 chapters) is bypassed.
  const isLastOfBatch = targetCount > 1 && currentStepIndex >= targetCount - 1;
  if (isLastOfBatch) {
    return {
      shouldUpdate: true,
      reason: 'last_batch',
      nextPlannedChapter: chapterIndex,
    };
  }

  const isVolumeEnd = Boolean(
    outline?.volumes?.some((vol: any) => Number(vol?.endChapter) === chapterIndex)
  );
  if (isVolumeEnd) {
    return {
      shouldUpdate: true,
      reason: 'volume_end',
      nextPlannedChapter: chapterIndex,
    };
  }

  // Force summary update at volume START (skip volume 0 = first volume)
  const isVolumeStart = Boolean(
    outline?.volumes?.some(
      (vol: any, idx: number) => idx > 0 && Number(vol?.startChapter) === chapterIndex
    )
  );
  if (isVolumeStart) {
    return {
      shouldUpdate: true,
      reason: 'volume_start',
      nextPlannedChapter: chapterIndex,
    };
  }

  if (summaryUpdateInterval > 0 && chapterIndex % summaryUpdateInterval === 0) {
    return {
      shouldUpdate: true,
      reason: 'interval',
      nextPlannedChapter: chapterIndex,
    };
  }

  const nextPlannedChapter = chapterIndex + (summaryUpdateInterval - (chapterIndex % summaryUpdateInterval));
  return {
    shouldUpdate: false,
    reason: 'deferred',
    nextPlannedChapter,
  };
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0.0s';
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

async function appendSummaryMemorySnapshot(params: {
  db: D1Database;
  projectId: string;
  chapterIndex: number;
  rollingSummary: string;
  summaryBaseChapterIndex: number;
  openLoops: string[];
  summaryUpdated: boolean;
  updateReason: SummaryUpdatePlan['reason'];
  modelProvider?: string;
  modelName?: string;
}) {
  try {
    await params.db.prepare(`
      INSERT INTO summary_memories (
        project_id,
        chapter_index,
        rolling_summary,
        summary_base_chapter_index,
        open_loops,
        summary_updated,
        update_reason,
        model_provider,
        model_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      params.projectId,
      params.chapterIndex,
      params.rollingSummary,
      params.summaryBaseChapterIndex,
      JSON.stringify(params.openLoops || []),
      params.summaryUpdated ? 1 : 0,
      params.updateReason,
      params.modelProvider || null,
      params.modelName || null
    ).run();
  } catch (error) {
    console.warn(
      `[SummaryMemory] Failed to persist snapshot for project=${params.projectId}, chapter=${params.chapterIndex}:`,
      (error as Error).message
    );
  }
}

// Helper to trigger background generation (now uses Cloudflare Queue)
export async function startGenerationChain(
  c: any,
  taskId: number,
  userId: string,
  aiConfig: AIConfig,
  chaptersToGenerate?: number,
  fallbackConfigs?: AIConfig[]
) {
  if (c.env.GENERATION_QUEUE) {
    // Queue implementation
    await c.env.GENERATION_QUEUE.send({
      taskType: 'chapters',
      taskId,
      userId,
      aiConfig,
      fallbackConfigs,
      chaptersToGenerate,
      enqueuedAt: Date.now()
    });
    console.log(`Task ${taskId} enqueued successfully.`);
  } else {
    // Fallback for local dev if queue is not bound
    console.warn('GENERATION_QUEUE not bound, falling back to waitUntil');
    c.executionCtx.waitUntil(
      runChapterGenerationTaskInBackground({
        env: c.env,
        aiConfig,
        fallbackConfigs,
        userId,
        taskId,
        chaptersToGenerate
      })
    );
  }
}

export function getContiguousCompletedCount(startChapter: number, completedChapters: number[]): number {
  if (!Array.isArray(completedChapters) || completedChapters.length === 0) {
    return 0;
  }
  const completedSet = new Set(
    completedChapters
      .map((chapter) => Number(chapter))
      .filter((chapter) => Number.isFinite(chapter))
  );
  let count = 0;
  while (completedSet.has(startChapter + count)) {
    count += 1;
  }
  return count;
}

export async function runChapterGenerationTaskInBackground(params: {
  env: Env;
  aiConfig: AIConfig;
  fallbackConfigs?: AIConfig[];
  userId: string;
  taskId: number;
  chaptersToGenerate?: number;
  enqueuedAt?: number;
}) {
  const {
    env,
    aiConfig,
    fallbackConfigs,
    userId,
    taskId,
    chaptersToGenerate,
    enqueuedAt,
  } = params;
  const queueLatencyMs = enqueuedAt ? Date.now() - enqueuedAt : 0;
  if (queueLatencyMs > 0) {
    console.log(`[Perf][Task ${taskId}] 队列延迟: ${(queueLatencyMs / 1000).toFixed(1)}s`);
  }

  try {
    // 1. Load Task State (fresh each iteration)
    const task = await getTaskById(env.DB, taskId, userId);
    if (!task) {
      console.warn(`Task ${taskId} not found or access denied`);
      return;
    }

    // 2. Load Project (fresh each iteration for updated rolling_summary)
    const project = await env.DB.prepare(`
        SELECT
          p.id,
          p.name,
          p.bible,
          p.chapter_prompt_profile,
          p.chapter_prompt_custom,
          s.*,
          o.outline_json,
          c.characters_json,
          cs.registry_json as character_states_json,
          pg.graph_json as plot_graph_json,
          nc.narrative_arc_json
        FROM projects p
        JOIN states s ON p.id = s.project_id
        LEFT JOIN outlines o ON p.id = o.project_id
        LEFT JOIN characters c ON p.id = c.project_id
        LEFT JOIN character_states cs ON p.id = cs.project_id
        LEFT JOIN plot_graphs pg ON p.id = pg.project_id
        LEFT JOIN narrative_config nc ON p.id = nc.project_id
        WHERE p.id = ? AND p.user_id = ?
      `).bind(task.projectId, userId).first() as any;

    if (!project) {
      await completeTask(env.DB, taskId, false, 'Project not found');
      return;
    }

    const rebasedState = await rebaseProjectStateToContinuity(env.DB, project.id);
    project.next_chapter_index = rebasedState.nextChapterIndex;
    project.rolling_summary = rebasedState.rollingSummary;
    project.summary_base_chapter_index = rebasedState.summaryBaseChapterIndex;
    project.open_loops = JSON.stringify(rebasedState.openLoops);

    // 3. Check Task Status
    const completedCount = getContiguousCompletedCount(task.startChapter, task.completedChapters);
    const failedCount = task.failedChapters.length;

    const runtime = await handleTaskCancellationIfNeeded({
      db: env.DB,
      taskId,
      userId,
      projectName: project.name,
      total: task.targetCount,
      chapterIndex: 0, // Placeholder
      current: completedCount
    });

    if (runtime.shouldStop) return;

    // 4. Determine Scope
    if (completedCount >= task.targetCount || (chaptersToGenerate !== undefined && completedCount >= chaptersToGenerate)) {
      // Task Complete!
      await completeTask(env.DB, taskId, true, undefined);
      await emitProgressEvent({
        userId,
        projectName: project.name,
        current: completedCount,
        total: task.targetCount,
        chapterIndex: task.startChapter + completedCount - 1,
        status: 'done',
        message: `生成完成：成功 ${completedCount} 章，失败 ${failedCount} 章`,
      });
      return;
    }

    // 5. Identify Next Chapter
    const currentStepIndex = completedCount;
    const chapterIndex = task.startChapter + currentStepIndex;

    if (chapterIndex > rebasedState.nextChapterIndex) {
      const message = `检测到章节断档，当前必须先处理第 ${rebasedState.nextChapterIndex} 章，不能直接生成第 ${chapterIndex} 章。`;
      await updateTaskMessage(env.DB, taskId, message, rebasedState.nextChapterIndex);
      await completeTask(env.DB, taskId, false, message);
      await emitProgressEvent({
        userId,
        projectName: project.name,
        current: completedCount,
        total: task.targetCount,
        chapterIndex,
        status: 'error',
        message,
      });
      return;
    }

    if (chapterIndex > project.total_chapters) {
      await completeTask(env.DB, taskId, true, '已达到项目总章节数');
      await emitProgressEvent({
        userId,
        projectName: project.name,
        current: completedCount,
        total: task.targetCount,
        chapterIndex: chapterIndex - 1,
        status: 'done',
        message: `生成结束：已达到项目总章节数`,
      });
      return;
    }

    await updateTaskMessage(env.DB, taskId, `正在生成第 ${chapterIndex} 章...`, chapterIndex);
    await emitProgressEvent({
      userId,
      projectName: project.name,
      current: completedCount,
      total: task.targetCount,
      chapterIndex,
      status: 'starting',
      message: `准备生成第 ${chapterIndex} 章...`,
    });

    // 6. Generate ONE Chapter
    try {
      // 6.0 Consume Credit
      try {
        await consumeCredit(env.DB, userId, 'generate_chapter', `生成章节: ${project.name} 第 ${chapterIndex} 章`);
      } catch (creditError) {
        await updateTaskMessage(env.DB, taskId, `能量不足: ${(creditError as Error).message}`, chapterIndex);
        await completeTask(env.DB, taskId, false, (creditError as Error).message);
        void emitProgressEvent({
          userId,
          projectName: project.name,
          current: completedCount,
          total: task.targetCount,
          chapterIndex,
          status: 'error',
          message: `创作能量不足: ${(creditError as Error).message}`,
        });
        return;
      }

      // 6.1 Prepare Context
      const { results: lastChapters } = await env.DB.prepare(`
            SELECT content FROM chapters
            WHERE project_id = ? AND chapter_index >= ? AND deleted_at IS NULL
              AND chapter_index < ?
            ORDER BY chapter_index DESC LIMIT 2
          `).bind(project.id, Math.max(1, chapterIndex - 2), chapterIndex).all();

      const existingChapterRecord = await env.DB.prepare(`
            SELECT id
            FROM chapters
            WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
            LIMIT 1
          `).bind(project.id, chapterIndex).first() as {
            id?: string | null;
          } | null;
      const isHistoricalRewrite = Boolean(existingChapterRecord?.id);

      let chapterGoalHint: string | undefined;
      let outlineTitle: string | undefined;
      let enhancedOutline: ReturnType<typeof buildEnhancedOutlineFromChapterContext> | undefined;
      const outline = project.outline_json
        ? normalizeNovelOutline(JSON.parse(project.outline_json), {
            fallbackMinChapterWords: Number(project.min_chapter_words) || DEFAULT_MIN_CHAPTER_WORDS,
            fallbackTotalChapters: project.total_chapters,
          })
        : null;
      const outlineContext = getOutlineChapterContext(outline, chapterIndex);
      if (outlineContext) {
        const { chapter, volume, previousVolume } = outlineContext;
        outlineTitle = chapter.title;
        enhancedOutline = buildEnhancedOutlineFromChapterContext(outlineContext);

        const parts = [
          `【章节大纲】`,
          `- 标题: ${chapter.title}`,
          `- 目标: ${chapter.goal}`,
          `- 章末钩子: ${chapter.hook}`,
        ];

        if (chapterIndex === Number(volume.startChapter)) {
          parts.push(`\n【本卷目标】${volume.goal}`);
          parts.push(`【本卷核心冲突】${volume.conflict}`);

          if (previousVolume) {
            parts.push(`\n【上卷结局】${buildPreviousVolumeSummary(previousVolume) || previousVolume.volumeEndState || previousVolume.climax}`);
            parts.push(`【衔接要求】本章开头需自然承接上卷结局，不要重复叙述已发生的事件`);
          }
        }

        chapterGoalHint = parts.join('\n');
      }
      const shouldEnforceStoryContract = hasStoryContract(enhancedOutline?.storyContract);

      const summaryUpdateInterval = await getSummaryUpdateInterval(env.DB, env);
      const forceSummaryRetry = await hasPendingSummaryRetry(env.DB, project.id, chapterIndex);
      const summaryUpdatePlan = isHistoricalRewrite
        ? {
            shouldUpdate: true,
            reason: 'rewrite' as const,
            nextPlannedChapter: chapterIndex,
          }
        : planSummaryUpdate({
            chapterIndex,
            currentStepIndex,
            targetCount: task.targetCount,
            summaryUpdateInterval,
            forceRetry: forceSummaryRetry,
            outline,
          });
      const summaryModelConfig = summaryUpdatePlan.shouldUpdate
        ? await getFeatureMappedAIConfig(env.DB, 'generate_summary_update')
        : null;
      const effectiveSummaryAiConfig = summaryModelConfig || aiConfig;

      if (summaryUpdatePlan.shouldUpdate && summaryModelConfig) {
        console.log(
          `[SummaryModel] 第 ${chapterIndex} 章使用 ${summaryModelConfig.provider}/${summaryModelConfig.model} 更新剧情摘要`
        );
      }

      const runtimeContext = isHistoricalRewrite
        ? await loadHistoricalGenerationContext(env.DB, project.id, chapterIndex)
        : {
            rollingSummary: project.rolling_summary || '',
            openLoops: JSON.parse(project.open_loops || '[]'),
            summaryBaseChapterIndex: Number(project.summary_base_chapter_index || 0),
          };

      const characters = project.characters_json ? JSON.parse(project.characters_json) : undefined;
      const characterStates = isHistoricalRewrite
        ? undefined
        : (project.character_states_json
            ? JSON.parse(project.character_states_json)
            : (characters ? initializeRegistryFromGraph(characters) : undefined));
      const plotGraph = isHistoricalRewrite
        ? createEmptyPlotGraph()
        : (project.plot_graph_json
            ? JSON.parse(project.plot_graph_json)
            : createEmptyPlotGraph());
      const narrativeArc = project.narrative_arc_json
        ? JSON.parse(project.narrative_arc_json)
        : (outline ? generateNarrativeArc(outline.volumes || [], project.total_chapters) : undefined);
      const shouldEnablePlanning = !String(chapterGoalHint || '').trim();

      let result: Awaited<ReturnType<typeof writeEnhancedChapter>> | undefined;

      try {
        // Check cancel again before heavy work
        const retryControl = await handleTaskCancellationIfNeeded({
          db: env.DB,
          taskId,
          userId,
          projectName: project.name,
          total: task.targetCount,
          chapterIndex,
          current: completedCount,
        });
        if (retryControl.shouldStop) return;

        await updateTaskMessage(env.DB, taskId, `正在AI生成（章节初始化）...`, chapterIndex);
        await emitProgressEvent({
          userId,
          projectName: project.name,
          current: completedCount,
          total: task.targetCount,
          chapterIndex,
          status: 'generating',
          message: `正在AI生成（章节初始化）...`,
        });

        result = await writeEnhancedChapter({
          aiConfig,
          fallbackConfigs,
          summaryAiConfig: effectiveSummaryAiConfig,
          bible: project.bible,
          rollingSummary: runtimeContext.rollingSummary,
          openLoops: runtimeContext.openLoops,
          lastChapters: lastChapters.map((chapter: any) => chapter.content).reverse(),
          chapterIndex,
          totalChapters: project.total_chapters,
          minChapterWords: Number(project.min_chapter_words) || DEFAULT_MIN_CHAPTER_WORDS,
          chapterGoalHint,
          chapterTitle: outlineTitle,
          characters,
          characterStates,
          plotGraph,
          narrativeArc,
          enhancedOutline,
          chapterPromptProfile: project.chapter_prompt_profile,
          chapterPromptCustom: project.chapter_prompt_custom,
          enableContextOptimization: true,
          // Outline-derived title/goal/hook already provide structured guidance.
          enablePlanning: shouldEnablePlanning,
          enableSelfReview: false,
          enableFullQC: shouldEnforceStoryContract,
          enableAutoRepair: shouldEnforceStoryContract,
          enableAgentMode: Boolean(project.enable_agent_mode),
          skipSummaryUpdate: !summaryUpdatePlan.shouldUpdate,
          onProgress: (message, status) => {
            updateTaskMessage(env.DB, taskId, message, chapterIndex).catch(console.warn);
            void emitProgressEvent({
              userId,
              projectName: project.name,
              current: completedCount,
              total: task.targetCount,
              chapterIndex,
              status,
              message,
            });
          },
        });
      } catch (err) {
        console.warn(`Chapter ${chapterIndex} generation failed:`, err);
        const reason = (err as Error)?.message || String(err) || '未知错误';

        // 记录失败章节，继续下一章而不是终止整个任务
        const failMessage = `第 ${chapterIndex} 章生成失败：${reason}。跳过继续下一章。`;
        await updateTaskProgress(env.DB, taskId, chapterIndex, true, reason);
        await updateTaskMessage(env.DB, taskId, failMessage, chapterIndex);
        await emitProgressEvent({
          userId,
          projectName: project.name,
          current: completedCount,
          total: task.targetCount,
          chapterIndex,
          status: 'error',
          message: failMessage,
        });
      }

      if (!result) {
        // writeEnhancedChapter failed — skip saving, jump to relay next chapter
      } else {

      // 6.2 Save Result
      const chapterText = result.chapterText;
      const summaryStatusText = !result.skippedSummary
        ? '已更新'
        : summaryUpdatePlan.shouldUpdate
          ? '更新失败，下一章优先重试'
          : `延后到第 ${summaryUpdatePlan.nextPlannedChapter} 章`;
      console.log(
        `[Perf][Task ${taskId}] 第 ${chapterIndex} 章:\n` +
        `  总计 ${formatDurationMs(result.totalDurationMs)} | 正文 ${formatDurationMs(result.generationDurationMs)} | 摘要 ${formatDurationMs(result.summaryDurationMs)} | 队列等待 ${formatDurationMs(queueLatencyMs)}\n` +
        `  AI调用: ${result.diagnostics.aiCallCount}次 | 累计AI耗时 ${formatDurationMs(result.diagnostics.totalAiDurationMs)} | 非AI耗时 ${formatDurationMs(result.totalDurationMs - result.diagnostics.totalAiDurationMs)}\n` +
        `  阶段: ctx=${formatDurationMs(result.diagnostics.phaseDurationsMs.contextBuild)}, plan=${formatDurationMs(result.diagnostics.phaseDurationsMs.planning)}, draft=${formatDurationMs(result.diagnostics.phaseDurationsMs.mainDraft)}, review=${formatDurationMs(result.diagnostics.phaseDurationsMs.selfReview)}, qc=${formatDurationMs(result.diagnostics.phaseDurationsMs.quickQc)}, summary=${formatDurationMs(result.diagnostics.phaseDurationsMs.summary)}, charState=${formatDurationMs(result.diagnostics.phaseDurationsMs.characterState)}, plot=${formatDurationMs(result.diagnostics.phaseDurationsMs.plotGraph)}, timeline=${formatDurationMs(result.diagnostics.phaseDurationsMs.timeline)}\n` +
        `  Provider: ${aiConfig.provider}/${aiConfig.model} | 摘要${summaryStatusText}`
      );
      logGenerationMetrics({
        projectId: project.id,
        chapterIndex,
        promptTokens: result.diagnostics.estimatedTokens.mainInput,
        outputTokens: result.diagnostics.estimatedTokens.mainOutput,
        generationTime: result.totalDurationMs,
        phaseTimes: {
          context_build: result.diagnostics.phaseDurationsMs.contextBuild,
          model_call: result.generationDurationMs,
          qc_check: result.diagnostics.phaseDurationsMs.quickQc + result.diagnostics.phaseDurationsMs.fullQc,
          summary_update: result.summaryDurationMs,
        },
        qcAttempts: result.rewriteCount,
        qcFinalScore: result.qcResult?.score,
        wasRewritten: result.wasRewritten,
        model: aiConfig.model,
        provider: aiConfig.provider,
        timestamp: new Date(),
      });
      // AI 调用明细日志
      if (result.diagnostics.aiCallTraces.length > 0) {
        const traceLines = result.diagnostics.aiCallTraces.map((t, i) =>
          `    #${i + 1} [${t.phase}] ${t.provider}/${t.model} ${formatDurationMs(t.durationMs)} in=${t.estimatedPromptTokens}tok out=${t.estimatedOutputTokens}tok${t.error ? ` ERR=${t.error.slice(0, 80)}` : ''}`
        );
        console.log(`[PerfTrace][Task ${taskId}] 第 ${chapterIndex} 章 AI调用链:\n${traceLines.join('\n')}`);
      }

      // 持久化到 generation_perf_logs
      const dbSaveStartedAt = Date.now();
      await env.DB.prepare(`
            INSERT OR REPLACE INTO chapters (project_id, chapter_index, content) VALUES (?, ?, ?)
          `).bind(project.id, chapterIndex, chapterText).run();

      const nextSummaryBaseChapterIndex = !result.skippedSummary
        ? chapterIndex
        : runtimeContext.summaryBaseChapterIndex;

      if (!isHistoricalRewrite) {
        await env.DB.prepare(`
              UPDATE states SET
                next_chapter_index = ?,
                rolling_summary = ?,
                summary_base_chapter_index = ?,
                open_loops = ?
              WHERE project_id = ?
            `).bind(
          chapterIndex + 1,
          result.updatedSummary,
          nextSummaryBaseChapterIndex,
          JSON.stringify(result.updatedOpenLoops),
          project.id
        ).run();

        if (result.updatedCharacterStates) {
          await env.DB.prepare(`
            INSERT INTO character_states (project_id, registry_json, last_updated_chapter)
            VALUES (?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
              registry_json = excluded.registry_json,
              last_updated_chapter = excluded.last_updated_chapter,
              updated_at = (unixepoch() * 1000)
          `).bind(
            project.id,
            JSON.stringify(result.updatedCharacterStates),
            chapterIndex
          ).run();
        }

        if (result.updatedPlotGraph) {
          await env.DB.prepare(`
            INSERT INTO plot_graphs (project_id, graph_json, last_updated_chapter)
            VALUES (?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
              graph_json = excluded.graph_json,
              last_updated_chapter = excluded.last_updated_chapter,
              updated_at = (unixepoch() * 1000)
          `).bind(
            project.id,
            JSON.stringify(result.updatedPlotGraph),
            chapterIndex
          ).run();
        }
      }

      if (result.qcResult) {
        await env.DB.prepare(`
          INSERT INTO chapter_qc (project_id, chapter_index, qc_json, passed, score)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(project_id, chapter_index) DO UPDATE SET
            qc_json = excluded.qc_json,
            passed = excluded.passed,
            score = excluded.score,
            created_at = (unixepoch() * 1000)
        `).bind(
          project.id,
          chapterIndex,
          JSON.stringify(result.qcResult),
          result.qcResult.passed ? 1 : 0,
          result.qcResult.score
        ).run();
      }

      await appendSummaryMemorySnapshot({
        db: env.DB,
        projectId: project.id,
        chapterIndex,
        rollingSummary: result.updatedSummary,
        summaryBaseChapterIndex: nextSummaryBaseChapterIndex,
        openLoops: result.updatedOpenLoops,
        summaryUpdated: !result.skippedSummary,
        updateReason: isHistoricalRewrite ? 'rewrite' : summaryUpdatePlan.reason,
        modelProvider: result.skippedSummary ? undefined : effectiveSummaryAiConfig.provider,
        modelName: result.skippedSummary ? undefined : effectiveSummaryAiConfig.model,
      });

      const dbSaveDurationMs = Date.now() - dbSaveStartedAt;

      // 持久化性能日志
      try {
        await env.DB.prepare(`
          INSERT INTO generation_perf_logs (
            task_id, project_id, chapter_index, provider, model,
            total_duration_ms, context_build_ms, planning_ms, main_draft_ms,
            self_review_ms, quick_qc_ms, full_qc_ms, summary_ms,
            character_state_ms, plot_graph_ms, timeline_ms, db_save_ms,
            ai_call_count, total_ai_duration_ms,
            estimated_prompt_tokens, estimated_output_tokens,
            was_rewritten, rewrite_count, summary_skipped,
            ai_call_traces, queue_latency_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          taskId, project.id, chapterIndex, aiConfig.provider, aiConfig.model,
          result.totalDurationMs,
          result.diagnostics.phaseDurationsMs.contextBuild,
          result.diagnostics.phaseDurationsMs.planning,
          result.diagnostics.phaseDurationsMs.mainDraft,
          result.diagnostics.phaseDurationsMs.selfReview,
          result.diagnostics.phaseDurationsMs.quickQc,
          result.diagnostics.phaseDurationsMs.fullQc,
          result.diagnostics.phaseDurationsMs.summary,
          result.diagnostics.phaseDurationsMs.characterState,
          result.diagnostics.phaseDurationsMs.plotGraph,
          result.diagnostics.phaseDurationsMs.timeline,
          dbSaveDurationMs,
          result.diagnostics.aiCallCount,
          result.diagnostics.totalAiDurationMs,
          result.diagnostics.estimatedTokens.mainInput,
          result.diagnostics.estimatedTokens.mainOutput,
          result.wasRewritten ? 1 : 0,
          result.rewriteCount,
          result.skippedSummary ? 1 : 0,
          JSON.stringify(result.diagnostics.aiCallTraces),
          queueLatencyMs
        ).run();
      } catch (perfLogError) {
        console.warn(`[PerfLog] Failed to persist perf log for chapter ${chapterIndex}:`, (perfLogError as Error).message);
      }

      await updateTaskProgress(env.DB, taskId, chapterIndex, false);

      await emitProgressEvent({
        userId,
        projectName: project.name,
        current: completedCount + 1,
        total: task.targetCount,
        chapterIndex,
        status: 'saving',
        message: `第 ${chapterIndex} 章已完成（正文 ${formatDurationMs(result.generationDurationMs)}，摘要 ${formatDurationMs(result.summaryDurationMs)}）`,
      });
      } // end of if (result) else block

    } catch (chapterError) {
      // 基础设施级错误（DB访问失败等），记录失败但不终止整个任务
      console.error(`Chapter ${chapterIndex} infrastructure error:`, chapterError);
      const chapterErrorMessage = (chapterError as Error).message || '未知错误';
      try {
        await updateTaskProgress(env.DB, taskId, chapterIndex, true, chapterErrorMessage);
        await emitProgressEvent({
          userId,
          projectName: project.name,
          current: completedCount,
          total: task.targetCount,
          chapterIndex,
          status: 'error',
          message: `第 ${chapterIndex} 章失败: ${chapterErrorMessage}`,
        });
      } catch (reportError) {
        console.warn(`Failed to report chapter ${chapterIndex} failure:`, reportError);
      }
    }

    // 7. Check Completion & Relay to Next Step
    const freshTask = await getTaskById(env.DB, taskId, userId);
    const newCompletedCount = freshTask
      ? getContiguousCompletedCount(freshTask.startChapter, freshTask.completedChapters)
      : 0;
    const newFailedCount = freshTask?.failedChapters.length || 0;
    const totalProcessed = newCompletedCount + newFailedCount;

    if (newCompletedCount >= task.targetCount || (chaptersToGenerate !== undefined && newCompletedCount >= chaptersToGenerate)) {
      // All chapters succeeded
      await completeTask(env.DB, taskId, true, undefined);
      await emitProgressEvent({
        userId,
        projectName: project.name,
        current: newCompletedCount,
        total: task.targetCount,
        chapterIndex,
        status: 'done',
        message: `生成完成：成功 ${newCompletedCount} 章，失败 ${newFailedCount} 章`,
      });
      return;
    }

    if (totalProcessed >= task.targetCount || (chaptersToGenerate !== undefined && totalProcessed >= chaptersToGenerate)) {
      // All chapters attempted but some failed
      const success = newFailedCount === 0;
      const failMsg = newFailedCount > 0 ? `（${newFailedCount} 章失败）` : '';
      await completeTask(env.DB, taskId, success, success ? undefined : `${newFailedCount} 章生成失败`);
      await emitProgressEvent({
        userId,
        projectName: project.name,
        current: newCompletedCount,
        total: task.targetCount,
        chapterIndex,
        status: success ? 'done' : 'error',
        message: `生成结束：成功 ${newCompletedCount} 章${failMsg}`,
      });
      return;
    }

    // RELAY: Trigger next step via Queue (more robust than fetch)
    if (env.GENERATION_QUEUE && !task.cancelRequested) {
      console.log(`[Queue] Enqueuing next step for task: ${taskId}`);

      try {
        await env.GENERATION_QUEUE.send({
          taskType: 'chapters',
          taskId,
          userId,
          aiConfig,
          fallbackConfigs,
          chaptersToGenerate,
          enqueuedAt: Date.now(),
        });
      } catch (queueError) {
        console.error('[Queue] Failed to enqueue next step:', queueError);
        // If enqueuing next step fails, we might want to mark the task as failed or just rely on manual resume
      }
    }

  } catch (error) {
    console.error(`Background task ${taskId} fatal error:`, error);
    try {
      await completeTask(env.DB, taskId, false, (error as Error).message);
    } catch (dbError) {
      console.warn('Failed to mark task as failed:', dbError);
    }
  }
}
