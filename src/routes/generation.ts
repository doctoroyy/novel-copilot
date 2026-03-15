import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateText, getAIConfigFromRegistry, getFallbackAIConfigsFromRegistry, type AIConfig } from '../services/aiClient.js';
import { consumeCredit } from '../services/creditService.js';
import { logGenerationMetrics } from '../services/logger.js';
import { generateMasterOutline, generateVolumeChapters, generateAdditionalVolumes } from '../generateOutline.js';
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
  buildVolumeBridgeContext,
  buildVolumeContinuationSummary,
  isVolumeBridgeChapter,
  VOLUME_BRIDGE_CHAPTER_COUNT,
} from '../utils/volumeBridge.js';
import {
  createGenerationTask,
  createBackgroundTask,
  updateTaskProgress,
  completeTask,
  checkRunningTask,
  updateTaskMessage,
  getTaskById,
} from './tasks.js';
import {
  getImagineTemplateSnapshot,
  listImagineTemplateSnapshotDates,
  resolveImagineTemplateById,
  type ImagineTemplate,
} from '../services/imagineTemplateService.js';
import {
  createImagineTemplateRefreshJob,
  enqueueImagineTemplateRefreshJob,
  getImagineTemplateRefreshJob,
  listImagineTemplateRefreshJobs,
} from '../services/imagineTemplateJobService.js';

export const generationRoutes = new Hono<{ Bindings: Env }>();

const DEFAULT_MIN_CHAPTER_WORDS = 2500;
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

// Helper to get AI config from Model Registry (server-side)
// Helper to get AI config from Model Registry (server-side) or Custom Headers
// Helper to get AI config from Model Registry (server-side) or Custom Headers
async function getAIConfig(c: any, db: D1Database, featureKey?: string): Promise<AIConfig | null> {
  const userId = c.get('userId');

  // 1. Check if user has permission for custom provider
  if (userId) {
    const user = await db.prepare('SELECT allow_custom_provider FROM users WHERE id = ?').bind(userId).first() as any;
    if (user?.allow_custom_provider) {
      // 2. Try to get config from headers
      const headers = c.req.header();
      const customProvider = headers['x-custom-provider'];
      const customModel = headers['x-custom-model'];
      const customBaseUrl = headers['x-custom-base-url'];
      const customApiKey = headers['x-custom-api-key'];

      if (customProvider && customModel && customApiKey) {
        return {
          provider: customProvider as any,
          model: customModel,
          apiKey: customApiKey,
          baseUrl: customBaseUrl,
        };
      }
    }
  }

  // 3. Fallback to registry
  return getAIConfigFromRegistry(db, featureKey || 'generate_chapter');
}

async function getFeatureMappedAIConfig(db: D1Database, featureKey: string): Promise<AIConfig | null> {
  try {
    const mapping = await db.prepare(`
      SELECT m.model_name, p.api_key_encrypted, p.base_url, p.id as provider_id
      FROM feature_model_mappings fmm
      JOIN model_registry m ON fmm.model_id = m.id
      JOIN provider_registry p ON m.provider_id = p.id
      WHERE fmm.feature_key = ? AND m.is_active = 1
      LIMIT 1
    `).bind(featureKey).first() as {
      model_name: string;
      api_key_encrypted: string | null;
      base_url: string | null;
      provider_id: string;
    } | null;

    if (!mapping || !mapping.api_key_encrypted) {
      return null;
    }

    return {
      provider: mapping.provider_id as any,
      model: mapping.model_name,
      apiKey: mapping.api_key_encrypted,
      baseUrl: mapping.base_url || undefined,
    };
  } catch (error) {
    console.warn(`Failed to load feature-mapped model for ${featureKey}:`, (error as Error).message);
    return null;
  }
}

function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message || '';
  return String(error);
}

function parseNestedErrorMessage(rawMessage: string): string {
  const trimmed = rawMessage.trim();
  if (!trimmed) return '';

  let candidate = trimmed;
  for (let depth = 0; depth < 2; depth++) {
    if (!(candidate.startsWith('{') || candidate.startsWith('['))) {
      break;
    }
    try {
      const parsed = JSON.parse(candidate) as any;
      const nested = parsed?.error?.message ?? parsed?.message;
      if (typeof nested === 'string' && nested.trim()) {
        candidate = nested.trim();
        continue;
      }
      break;
    } catch {
      break;
    }
  }

  return candidate;
}

function isGeminiLikeConfig(config: AIConfig): boolean {
  const provider = String(config.provider || '').toLowerCase();
  if (provider.includes('gemini') || provider === 'google') {
    return true;
  }
  return /generativelanguage\.googleapis\.com/i.test(String(config.baseUrl || ''));
}

function isLocationUnsupportedError(error: unknown): boolean {
  const message = parseNestedErrorMessage(extractErrorMessage(error)).toLowerCase();
  return (
    message.includes('user location is not supported for the api use') ||
    (message.includes('failed_precondition') && message.includes('location'))
  );
}

function formatGenerationError(error: unknown): string {
  const parsed = parseNestedErrorMessage(extractErrorMessage(error));
  const normalized = parsed || extractErrorMessage(error) || 'AI 生成失败';
  const lower = normalized.toLowerCase();

  if (
    lower.includes('user location is not supported for the api use') ||
    (lower.includes('failed_precondition') && lower.includes('location'))
  ) {
    return '当前模型受地区限制暂不可用，请切换到 OpenAI / DeepSeek / Qwen 等可用模型，或联系管理员调整默认模型。';
  }

  return normalized;
}

function isSameAIConfig(a: AIConfig, b: AIConfig): boolean {
  return (
    String(a.provider || '').toLowerCase() === String(b.provider || '').toLowerCase() &&
    String(a.model || '').toLowerCase() === String(b.model || '').toLowerCase() &&
    String(a.baseUrl || '').toLowerCase() === String(b.baseUrl || '').toLowerCase()
  );
}

async function getNonGeminiFallbackAIConfig(db: D1Database, primary: AIConfig): Promise<AIConfig | null> {
  try {
    const { results } = await db.prepare(`
      SELECT p.id as provider, m.model_name, p.api_key_encrypted, p.base_url, m.is_default, m.updated_at
      FROM model_registry m
      JOIN provider_registry p ON m.provider_id = p.id
      WHERE m.is_active = 1
        AND p.api_key_encrypted IS NOT NULL
        AND TRIM(p.api_key_encrypted) != ''
      ORDER BY m.is_default DESC, m.updated_at DESC
    `).all();

    for (const row of (results || []) as any[]) {
      const candidate: AIConfig = {
        provider: row.provider,
        model: row.model_name,
        apiKey: row.api_key_encrypted,
        baseUrl: row.base_url || undefined,
      };
      if (!candidate.apiKey) continue;
      if (isGeminiLikeConfig(candidate)) continue;
      if (isSameAIConfig(candidate, primary)) continue;
      return candidate;
    }

    return null;
  } catch (error) {
    console.warn('Failed to resolve non-Gemini fallback model:', extractErrorMessage(error));
    return null;
  }
}

// Normalize chapter data from LLM output to consistent structure
function normalizeChapter(ch: any, fallbackIndex: number): { index: number; title: string; goal: string; hook: string } {
  return {
    index: ch.index ?? ch.chapter_id ?? ch.chapter_number ?? fallbackIndex,
    title: ch.title || `第${fallbackIndex}章`,
    goal: ch.goal || ch.outline || ch.description || ch.plot_summary || '',
    hook: ch.hook || '',
  };
}

// Normalize volume data from LLM output
function normalizeVolume(vol: any, volIndex: number, chapters: any[]): any {
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

function buildPreviousVolumeSummary(volume: any): string | undefined {
  const summary = buildVolumeContinuationSummary(volume);
  return summary || undefined;
}

// Normalize milestones - ensure it's an array of strings
function normalizeMilestones(milestones: any[]): string[] {
  if (!Array.isArray(milestones)) return [];
  return milestones.map((m) => {
    if (typeof m === 'string') return m;
    // Handle object format like {milestone: '...', description: '...'}
    return m.milestone || m.description || m.title || JSON.stringify(m);
  });
}

// Validate outline for coverage and quality
function validateOutline(outline: any, targetChapters: number): { valid: boolean; issues: string[] } {
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

type OutlineQueuePayload = {
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

const OUTLINE_TASK_PROGRESS_TOTAL = 100;

function computeOutlineProgress(volumeIndex: number, totalVolumes: number): number {
  if (totalVolumes <= 0) {
    return 70;
  }
  const ratio = (volumeIndex + 1) / totalVolumes;
  const scaled = 20 + Math.round(ratio * 60);
  return Math.max(20, Math.min(80, scaled));
}

function detectVolumesToRefine(volumes: any[]): number[] {
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

function getRefineVolumeIndices(volumes: any[], requestedIndices?: number[]): number[] {
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

export async function runOutlineGenerationTaskInBackground(params: {
  env: Env;
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
}) {
  const {
    env,
    taskId,
    userId,
    projectId,
    targetChapters,
    targetWordCount,
    customPrompt,
    minChapterWords,
    aiConfig,
    appendMode,
    newVolumeCount,
    chaptersPerVolume,
    refineMode,
    refineVolumeIndices,
  } = params;

  try {
    const runtime = await getTaskRuntimeControl(env.DB, taskId);
    if (!runtime.exists || runtime.status !== 'running') {
      return;
    }
    if (runtime.cancelRequested) {
      await completeTask(env.DB, taskId, false, '任务已取消');
      return;
    }

    const project = await env.DB.prepare(`
      SELECT p.id, p.bible, p.name, s.min_chapter_words
      FROM projects p
      LEFT JOIN states s ON p.id = s.project_id
      WHERE p.id = ? AND p.user_id = ? AND p.deleted_at IS NULL
      LIMIT 1
    `).bind(projectId, userId).first() as {
      id: string;
      bible: string;
      name: string;
      min_chapter_words?: number;
    } | null;

    if (!project) {
      await completeTask(env.DB, taskId, false, 'Project not found');
      return;
    }

    const effectiveMinChapterWords =
      minChapterWords
      ?? (Number.isFinite(Number(project.min_chapter_words))
        ? Number(project.min_chapter_words)
        : DEFAULT_MIN_CHAPTER_WORDS);

    await updateTaskMessage(
      env.DB,
      taskId,
      refineMode ? '正在准备大纲完善...' : (appendMode ? '正在准备追加卷...' : '正在准备大纲生成...'),
      refineMode ? 0 : 5
    );

    if (refineMode) {
      await runRefineOutlineMode({
        env,
        taskId,
        project,
        bible: project.bible,
        aiConfig,
        effectiveMinChapterWords,
        refineVolumeIndices,
      });
      return;
    }

    try {
      await consumeCredit(env.DB, userId, 'generate_outline', appendMode ? `追加卷: ${project.name}` : `生成大纲: ${project.name}`);
    } catch (creditError) {
      await completeTask(env.DB, taskId, false, (creditError as Error).message);
      return;
    }

    let bible = project.bible;
    if (customPrompt) {
      bible = `${bible}\n\n## 用户自定义要求\n${customPrompt}`;
    }

    const charRecord = await env.DB.prepare(`
      SELECT characters_json FROM characters WHERE project_id = ?
    `).bind(project.id).first() as { characters_json?: string } | null;
    const characters = charRecord?.characters_json ? JSON.parse(charRecord.characters_json) : undefined;

    // ---- 追加卷模式 ----
    if (appendMode && newVolumeCount && chaptersPerVolume) {
      await runAppendVolumesMode({
        env, taskId, project, bible, aiConfig,
        effectiveMinChapterWords, newVolumeCount, chaptersPerVolume,
      });
      return;
    }

    // ---- 全量生成模式（原有逻辑）----
    await updateTaskMessage(
      env.DB,
      taskId,
      characters ? '正在基于人物关系生成总体大纲...' : '正在生成总体大纲...',
      12
    );

    const masterOutline = await generateMasterOutline(aiConfig, {
      bible,
      targetChapters,
      targetWordCount,
      characters,
      minChapterWords: effectiveMinChapterWords,
    });

    const totalVolumes = masterOutline.volumes?.length || 0;
    const volumes = [];

    const buildOutlineSnapshot = (currentVolumes: any[]) => ({
      totalChapters: targetChapters,
      targetWordCount,
      volumes: currentVolumes,
      mainGoal: masterOutline.mainGoal || '',
      milestones: normalizeMilestones(masterOutline.milestones || []),
    });

    for (let i = 0; i < masterOutline.volumes.length; i++) {
      const currentRuntime = await getTaskRuntimeControl(env.DB, taskId);
      if (!currentRuntime.exists || currentRuntime.status !== 'running') {
        return;
      }
      if (currentRuntime.cancelRequested) {
        await completeTask(env.DB, taskId, false, '任务已取消');
        return;
      }

      const vol = masterOutline.volumes[i];
      const previousVolumeEndState = i > 0
        ? buildPreviousVolumeSummary(masterOutline.volumes[i - 1])
        : null;

      await updateTaskMessage(
        env.DB,
        taskId,
        `正在生成第 ${i + 1}/${totalVolumes} 卷「${vol.title}」的章节...`,
        computeOutlineProgress(i, totalVolumes)
      );

      const chapters = await generateVolumeChapters(aiConfig, {
        bible,
        masterOutline,
        volume: vol,
        previousVolumeSummary: previousVolumeEndState || undefined,
        minChapterWords: effectiveMinChapterWords,
        onBatchStart: async ({ batchIndex, totalBatches, startChapter, endChapter }) => {
          const suffix = totalBatches > 1
            ? ` (批次 ${batchIndex + 1}/${totalBatches}，第 ${startChapter}-${endChapter} 章)`
            : '';
          await updateTaskMessage(
            env.DB,
            taskId,
            `正在生成第 ${i + 1}/${totalVolumes} 卷「${vol.title}」的章节...${suffix}`,
            computeOutlineProgress(i, totalVolumes)
          );
        },
      });

      const normalizedVolume = normalizeVolume(vol, i, chapters);
      volumes.push(normalizedVolume);

      const snapshotOutline = buildOutlineSnapshot(volumes);
      await env.DB.prepare(`
        INSERT OR REPLACE INTO outlines (project_id, outline_json) VALUES (?, ?)
      `).bind(project.id, JSON.stringify(snapshotOutline)).run();

      await updateTaskMessage(
        env.DB,
        taskId,
        `第 ${i + 1}/${totalVolumes} 卷已生成并保存，可在「大纲/章节」页预览并开写`,
        computeOutlineProgress(i, totalVolumes)
      );
    }

    const outline = buildOutlineSnapshot(volumes);

    await updateTaskMessage(env.DB, taskId, '正在验证并保存大纲...', 90);

    const validation = validateOutline(outline, targetChapters);
    if (!validation.valid) {
      console.warn('Outline validation issues:', validation.issues);
    }

    await env.DB.prepare(`
      INSERT OR REPLACE INTO outlines (project_id, outline_json) VALUES (?, ?)
    `).bind(project.id, JSON.stringify(outline)).run();

    await env.DB.prepare(`
      UPDATE states SET total_chapters = ?, min_chapter_words = ? WHERE project_id = ?
    `).bind(targetChapters, effectiveMinChapterWords, project.id).run();

    await updateTaskMessage(env.DB, taskId, '大纲生成完成', OUTLINE_TASK_PROGRESS_TOTAL);
    await completeTask(env.DB, taskId, true, undefined);
  } catch (error) {
    console.error(`Outline task ${taskId} failed:`, error);
    await completeTask(env.DB, taskId, false, (error as Error).message || '大纲生成失败');
  }
}

/**
 * 追加卷模式：基于已有大纲追加新卷
 */
async function runAppendVolumesMode(params: {
  env: Env;
  taskId: number;
  project: { id: string; bible: string; name: string };
  bible: string;
  aiConfig: AIConfig;
  effectiveMinChapterWords: number;
  newVolumeCount: number;
  chaptersPerVolume: number;
}) {
  const { env, taskId, project, bible, aiConfig, effectiveMinChapterWords, newVolumeCount, chaptersPerVolume } = params;

  // 读取现有大纲
  const outlineRecord = await env.DB.prepare(`
    SELECT outline_json FROM outlines WHERE project_id = ?
  `).bind(project.id).first() as { outline_json?: string } | null;

  if (!outlineRecord?.outline_json) {
    await completeTask(env.DB, taskId, false, '当前项目没有大纲，无法追加卷。请先生成大纲。');
    return;
  }

  const existingOutline = JSON.parse(outlineRecord.outline_json);
  const existingVolumes = existingOutline.volumes || [];

  // 获取实际剧情摘要（rolling_summary），用于确保新卷与实际内容对齐
  const stateRecord = await env.DB.prepare(`
    SELECT rolling_summary FROM states WHERE project_id = ?
  `).bind(project.id).first() as { rolling_summary?: string } | null;
  const actualStorySummary = stateRecord?.rolling_summary || undefined;

  await updateTaskMessage(env.DB, taskId, `正在基于已有 ${existingVolumes.length} 卷生成 ${newVolumeCount} 个新卷的骨架...`, 10);

  // 生成新卷骨架
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
    await completeTask(env.DB, taskId, false, 'AI 未能生成新卷骨架');
    return;
  }

  // 逐卷填充章节
  const filledVolumes = [];
  for (let i = 0; i < newVolumeSkeletons.length; i++) {
    const currentRuntime = await getTaskRuntimeControl(env.DB, taskId);
    if (!currentRuntime.exists || currentRuntime.status !== 'running') return;
    if (currentRuntime.cancelRequested) {
      await completeTask(env.DB, taskId, false, '任务已取消');
      return;
    }

    const vol = newVolumeSkeletons[i];
    const globalVolIndex = existingVolumes.length + i;

    await updateTaskMessage(
      env.DB, taskId,
      `正在生成第 ${globalVolIndex + 1} 卷「${vol.title}」的章节... (新增 ${i + 1}/${newVolumeSkeletons.length})`,
      computeOutlineProgress(i, newVolumeSkeletons.length)
    );

    // 构建上一卷摘要（可能是已有卷的最后一卷或新生成的上一卷）
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
      // 第一个新卷使用实际剧情摘要，确保与已生成内容对齐
      actualStorySummary: i === 0 ? actualStorySummary : undefined,
      onBatchStart: async ({ batchIndex, totalBatches, startChapter, endChapter }) => {
        const suffix = totalBatches > 1
          ? `，批次 ${batchIndex + 1}/${totalBatches}（第 ${startChapter}-${endChapter} 章）`
          : '';
        await updateTaskMessage(
          env.DB,
          taskId,
          `正在生成第 ${globalVolIndex + 1} 卷「${vol.title}」的章节... (新增 ${i + 1}/${newVolumeSkeletons.length}${suffix})`,
          computeOutlineProgress(i, newVolumeSkeletons.length)
        );
      },
    });

    const normalizedVolume = normalizeVolume(vol, globalVolIndex, chapters);
    filledVolumes.push(normalizedVolume);

    // 增量保存：将新卷追加到大纲中
    const updatedOutline = {
      ...existingOutline,
      totalChapters: existingOutline.totalChapters + filledVolumes.reduce((sum: number, v: any) => sum + (v.chapters?.length || 0), 0),
      volumes: [...existingVolumes, ...filledVolumes],
    };
    await env.DB.prepare(`
      UPDATE outlines SET outline_json = ? WHERE project_id = ?
    `).bind(JSON.stringify(updatedOutline), project.id).run();

    await updateTaskMessage(
      env.DB, taskId,
      `第 ${globalVolIndex + 1} 卷已生成并保存，可在「大纲/章节」页预览`,
      computeOutlineProgress(i, newVolumeSkeletons.length)
    );
  }

  // 最终更新大纲和 states
  const addedChapters = filledVolumes.reduce((sum: number, v: any) => sum + (v.chapters?.length || 0), 0);
  const newTotalChapters = (existingOutline.totalChapters || 0) + addedChapters;

  const finalOutline = {
    ...existingOutline,
    totalChapters: newTotalChapters,
    volumes: [...existingVolumes, ...filledVolumes],
  };

  await env.DB.prepare(`
    UPDATE outlines SET outline_json = ? WHERE project_id = ?
  `).bind(JSON.stringify(finalOutline), project.id).run();

  await env.DB.prepare(`
    UPDATE states SET total_chapters = ? WHERE project_id = ?
  `).bind(newTotalChapters, project.id).run();

  await updateTaskMessage(env.DB, taskId, `追加 ${filledVolumes.length} 卷完成，共新增 ${addedChapters} 章`, OUTLINE_TASK_PROGRESS_TOTAL);
  await completeTask(env.DB, taskId, true, undefined);
}

async function runRefineOutlineMode(params: {
  env: Env;
  taskId: number;
  project: { id: string; bible: string; name: string };
  bible: string;
  aiConfig: AIConfig;
  effectiveMinChapterWords: number;
  refineVolumeIndices?: number[];
}) {
  const { env, taskId, project, bible, aiConfig, effectiveMinChapterWords, refineVolumeIndices } = params;

  const outlineRecord = await env.DB.prepare(`
    SELECT outline_json FROM outlines WHERE project_id = ?
  `).bind(project.id).first() as { outline_json?: string } | null;

  if (!outlineRecord?.outline_json) {
    await completeTask(env.DB, taskId, false, 'Outline not found');
    return;
  }

  let outline = JSON.parse(outlineRecord.outline_json);
  const volumes = Array.isArray(outline?.volumes) ? [...outline.volumes] : [];
  const targetIndices = getRefineVolumeIndices(volumes, refineVolumeIndices);

  if (targetIndices.length === 0) {
    await updateTaskMessage(env.DB, taskId, '当前大纲已完整，无需完善', 0);
    await completeTask(env.DB, taskId, true, undefined);
    return;
  }

  await updateTaskMessage(env.DB, taskId, `发现 ${targetIndices.length} 卷需要完善，开始生成...`, 0);

  for (let i = 0; i < targetIndices.length; i++) {
    const runtime = await getTaskRuntimeControl(env.DB, taskId);
    if (!runtime.exists || runtime.status !== 'running') {
      return;
    }
    if (runtime.cancelRequested) {
      await completeTask(env.DB, taskId, false, '任务已取消');
      return;
    }

    const volumeIndex = targetIndices[i];
    const volume = volumes[volumeIndex];
    if (!volume) {
      continue;
    }
    const previousVolumeEndChapter = Math.max(0, Number(volume.startChapter || 1) - 1);
    const actualStorySnapshot = previousVolumeEndChapter > 0
      ? await loadSummarySnapshotUpToChapter(env.DB, project.id, previousVolumeEndChapter)
      : null;
    const actualStorySummary = actualStorySnapshot?.rollingSummary || undefined;

    await updateTaskMessage(
      env.DB,
      taskId,
      `正在生成第 ${volumeIndex + 1} 卷「${volume.title}」的章节大纲... (${i + 1}/${targetIndices.length})`,
      i
    );

    const chapters = await generateVolumeChapters(aiConfig, {
      bible,
      masterOutline: outline,
      volume,
      previousVolumeSummary: volumeIndex > 0 ? buildPreviousVolumeSummary(volumes[volumeIndex - 1]) : undefined,
      minChapterWords: effectiveMinChapterWords,
      actualStorySummary,
      onBatchStart: async ({ batchIndex, totalBatches, startChapter, endChapter }) => {
        const suffix = totalBatches > 1
          ? `，批次 ${batchIndex + 1}/${totalBatches}（第 ${startChapter}-${endChapter} 章）`
          : '';
        await updateTaskMessage(
          env.DB,
          taskId,
          `正在生成第 ${volumeIndex + 1} 卷「${volume.title}」的章节大纲... (${i + 1}/${targetIndices.length}${suffix})`,
          i
        );
      },
    });

    volumes[volumeIndex] = normalizeVolume({ ...volume, chapters }, volumeIndex, chapters);
    outline = {
      ...outline,
      volumes: [...volumes],
    };

    await env.DB.prepare(`
      UPDATE outlines SET outline_json = ? WHERE project_id = ?
    `).bind(JSON.stringify(outline), project.id).run();

    await updateTaskMessage(
      env.DB,
      taskId,
      `第 ${volumeIndex + 1} 卷「${volume.title}」已完善并保存`,
      i + 1
    );
  }

  await updateTaskMessage(env.DB, taskId, '大纲完善完成', targetIndices.length);
  await completeTask(env.DB, taskId, true, undefined);
}

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

async function emitProgressEvent(data: {
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

type TaskRuntimeControl = {
  exists: boolean;
  status: string | null;
  cancelRequested: boolean;
};

async function getTaskRuntimeControl(db: D1Database, taskId: number): Promise<TaskRuntimeControl> {
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

function formatDurationMs(ms: number): string {
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
async function startGenerationChain(
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

function getContiguousCompletedCount(startChapter: number, completedChapters: number[]): number {
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
        const isVolumeStartChapter = chapterIndex === Number(volume.startChapter);
        const isVolumeOpeningBridge = Boolean(previousVolume)
          && isVolumeBridgeChapter(chapterIndex, Number(volume.startChapter), VOLUME_BRIDGE_CHAPTER_COUNT);

        const parts = [
          `【章节大纲】`,
          `- 标题: ${chapter.title}`,
          `- 目标: ${chapter.goal}`,
          `- 章末钩子: ${chapter.hook}`,
        ];

        if (isVolumeStartChapter || isVolumeOpeningBridge) {
          parts.push(`\n【本卷目标】${volume.goal}`);
          parts.push(`【本卷核心冲突】${volume.conflict}`);

          if (isVolumeOpeningBridge && previousVolume) {
            const bridgeContext = buildVolumeBridgeContext({
              previousVolume,
              actualStorySummary: project.rolling_summary || '',
              currentVolume: volume,
              bridgeChapterCount: VOLUME_BRIDGE_CHAPTER_COUNT,
            });
            if (bridgeContext) {
              parts.push(`\n【卷切换桥接上下文】\n${bridgeContext}`);
            }
            parts.push(`【衔接要求】${
              isVolumeStartChapter
                ? '本章是新卷开场第 1 章，必须直接承接上卷最后一幕的直接后果，不得跳过余波直接开新主线。'
                : '本章仍是新卷开场第 2 章，必须延续上卷余波和上一章已落地的新处境，完成过渡后再放大本卷主线。'
            }`);
          } else if (isVolumeStartChapter && previousVolume) {
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
      let lastChapterError: unknown;

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
        lastChapterError = err;
        console.warn(`Chapter ${chapterIndex} generation failed:`, err);
        const reason = (err as Error)?.message || String(err) || '未知错误';
        
        const retryMessage = `第 ${chapterIndex} 章生成抛错：${reason}。将由队列接管重试...`;
        await updateTaskMessage(env.DB, taskId, retryMessage, chapterIndex);
        await emitProgressEvent({
          userId,
          projectName: project.name,
          current: completedCount,
          total: task.targetCount,
          chapterIndex,
          status: 'reviewing',
          message: retryMessage,
        });
        
        throw err;
      }

      if (!result) throw lastChapterError || new Error("Generated failed");

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

    } catch (chapterError) {
      console.error(`Chapter ${chapterIndex} failed:`, chapterError);
      const chapterErrorMessage = (chapterError as Error).message || '未知错误';
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
      await completeTask(env.DB, taskId, false, `第 ${chapterIndex} 章生成失败: ${chapterErrorMessage}`);
      return;
    }

    // 7. Check Completion & Relay to Next Step
    const freshTask = await getTaskById(env.DB, taskId, userId);
    const newCompletedCount = freshTask
      ? getContiguousCompletedCount(freshTask.startChapter, freshTask.completedChapters)
      : 0;
    const newFailedCount = freshTask?.failedChapters.length || 0;

    if (newCompletedCount >= task.targetCount || (chaptersToGenerate !== undefined && newCompletedCount >= chaptersToGenerate)) {
      // Done
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

function mergeKeywordInput(rawKeywords: string, template?: ImagineTemplate): string {
  const list = [
    ...rawKeywords.split(/[、,，;；|]/).map((entry) => entry.trim()).filter(Boolean),
    ...(template?.keywords || []),
  ];
  return [...new Set(list)].slice(0, 12).join('、');
}

function formatTemplateHint(template: ImagineTemplate | null, snapshotDate?: string): string {
  if (!template) return '';

  return `【热点模板参考${snapshotDate ? ` (${snapshotDate})` : ''}】
- 模板名: ${template.name}
- 类型: ${template.genre}
- 核心主题: ${template.coreTheme}
- 一句话卖点: ${template.oneLineSellingPoint}
- 关键词: ${(template.keywords || []).join('、')}
- 主角设定: ${template.protagonistSetup}
- 开篇钩子: ${template.hookDesign}
- 冲突设计: ${template.conflictDesign}
- 成长路线: ${template.growthRoute}
- 平台信号: ${(template.fanqieSignals || []).join('、')}
- 开篇建议: ${template.recommendedOpening}
- 参考热点书名: ${(template.sourceBooks || []).join('、')}`;
}

generationRoutes.get('/bible-templates', async (c) => {
  const snapshotDate = c.req.query('snapshotDate') || c.req.query('date');
  const selectedSnapshot = await getImagineTemplateSnapshot(c.env.DB, snapshotDate || undefined);
  const dates = await listImagineTemplateSnapshotDates(c.env.DB, 60);

  return c.json({
    success: true,
    snapshotDate: selectedSnapshot?.snapshotDate || null,
    templates: selectedSnapshot?.templates || [],
    ranking: selectedSnapshot?.ranking || [],
    status: selectedSnapshot?.status || null,
    errorMessage: selectedSnapshot?.errorMessage || null,
    availableSnapshots: dates,
  });
});

generationRoutes.post('/bible-templates/refresh', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const snapshotDate = typeof body.snapshotDate === 'string' ? body.snapshotDate : undefined;
  const force = body.force === undefined ? true : Boolean(body.force);
  const userId = c.get('userId');

  const { job, created } = await createImagineTemplateRefreshJob(c.env.DB, {
    snapshotDate,
    force,
    requestedByUserId: userId || null,
    requestedByRole: 'user',
    source: 'manual',
  });

  await enqueueImagineTemplateRefreshJob({
    env: c.env,
    jobId: job.id,
    executionCtx: c.executionCtx,
  });

  return c.json({
    success: true,
    queued: true,
    created,
    job,
  });
});

generationRoutes.get('/bible-templates/refresh-jobs/:id', async (c) => {
  const jobId = c.req.param('id');
  const job = await getImagineTemplateRefreshJob(c.env.DB, jobId);

  if (!job) {
    return c.json({ success: false, error: 'Template refresh job not found' }, 404);
  }

  return c.json({
    success: true,
    job,
  });
});

generationRoutes.get('/bible-templates/refresh-jobs', async (c) => {
  const userId = c.get('userId');
  const limitRaw = Number.parseInt(c.req.query('limit') || '10', 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

  const jobs = await listImagineTemplateRefreshJobs(c.env.DB, {
    requestedByUserId: userId || undefined,
    limit,
  });

  return c.json({
    success: true,
    jobs,
  });
});

// Generate bible
generationRoutes.post('/generate-bible', async (c) => {
  const aiConfig = await getAIConfig(c, c.env.DB, 'generate_outline');

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const body = await c.req.json().catch(() => ({} as any));
    const genreInput = typeof body.genre === 'string' ? body.genre.trim() : '';
    const themeInput = typeof body.theme === 'string' ? body.theme.trim() : '';
    const keywordsInput = typeof body.keywords === 'string' ? body.keywords.trim() : '';
    const templateId = typeof body.templateId === 'string' ? body.templateId.trim() : '';
    const templateSnapshotDate = typeof body.templateSnapshotDate === 'string' ? body.templateSnapshotDate.trim() : '';

    const bodyTemplate = body.template && typeof body.template === 'object'
      ? body.template as ImagineTemplate
      : null;

    let resolvedTemplate: ImagineTemplate | null = bodyTemplate;
    let resolvedTemplateDate: string | undefined;

    if (!resolvedTemplate && templateId) {
      const resolved = await resolveImagineTemplateById(
        c.env.DB,
        templateId,
        templateSnapshotDate || undefined
      );
      if (resolved) {
        resolvedTemplate = resolved.template;
        resolvedTemplateDate = resolved.snapshotDate;
      }
    }

    const genre = genreInput || resolvedTemplate?.genre || '';
    const theme = themeInput || resolvedTemplate?.coreTheme || '';
    const keywords = mergeKeywordInput(keywordsInput, resolvedTemplate || undefined);

    // Genre-specific templates for better quality
    const genreTemplates: Record<string, string> = {
      '都市重生': `
【类型特点】都市重生文，主角带着前世记忆重生，利用信息差和先知优势逆袭。
【核心爽点】打脸装逼、商战逆袭、弥补遗憾、复仇雪恨、把握机遇。
【金手指建议】重生记忆、系统辅助、空间储物、前世技能传承。
【注意事项】时代背景要有年代感（如90年代），要有大量可利用的历史机遇（房产、股票、互联网）。`,
      '玄幻修仙': `
【类型特点】东方玄幻修仙文，主角在修仙世界从废材崛起，踏上巅峰之路。
【核心爽点】逆天改命、越级挑战、获得机缘、实力碾压、悟道突破。
【金手指建议】特殊体质、神秘传承、系统面板、时间加速修炼、因果反馈。
【注意事项】力量体系要清晰（如练气-筑基-金丹-元婴），要有宗门势力等级划分。`,
      '系统流': `
【类型特点】系统流文，主角获得特殊系统，通过完成任务获得奖励升级。
【核心爽点】任务奖励、签到福利、抽奖开箱、属性加点、技能解锁。
【金手指建议】任务系统、商城系统、抽奖系统、签到系统、成就系统。
【注意事项】系统规则要明确，奖励要有吸引力但不能太超模，要有成长曲线。`,
      '都市异能': `
【类型特点】都市异能文，主角在现代都市获得超凡能力，游走于普通人与异能世界之间。
【核心爽点】实力碾压、身份反转、拯救美人、惩恶扬善、逐步揭秘。
【金手指建议】异能觉醒、血脉传承、神器认主、空间能力、时间能力。
【注意事项】要平衡日常与战斗，异能世界设定要有层次感。`,
      '无敌流': `
【类型特点】无敌流爽文，主角从一开始就拥有绝对实力，横扫一切障碍。
【核心爽点】一拳秒杀、装弱扮猪吃虎、震惊全场、身份曝光、实力展示。
【金手指建议】无限复活、绝对防御、一击必杀、时间静止、规则掌控。
【注意事项】不能只靠战力，要有情感线、成长线（心境成长）、谜团揭示。`,
    };

    const genreTemplate = genre && genreTemplates[genre] ? genreTemplates[genre] : '';
    const templateHint = formatTemplateHint(resolvedTemplate, resolvedTemplateDate || templateSnapshotDate || undefined);

    const system = `你是一个**番茄/起点爆款网文策划专家**，精通读者心理和平台推荐算法。

你的任务是生成一个**极具吸引力**的 Story Bible，它将直接决定这本书能否获得流量。

【硬性要求】
1. 必须设计至少 3 个明确的"读者爽点"（打脸、逆袭、升级、复仇、装逼等）
2. 必须有独特且有成长空间的金手指/系统设计
3. 必须有能在前 100 字抓住读者的"开篇钩子"设计
4. 主角必须有强烈的行动动机（复仇、保护、证明自己等）
5. 要有清晰的力量体系/社会阶层，让读者能感受到主角的攀升

【输出格式 - Markdown】

# 《书名》

## 一句话卖点
（30字内，能让读者立刻想点进去的核心吸引力）

## 核心爽点设计
1. 爽点一：（描述 + 预计出现时机）
2. 爽点二：（描述 + 预计出现时机）
3. 爽点三：（描述 + 预计出现时机）

## 主角设定
- 姓名：
- 身份/职业：
- 前世/背景：
- 性格特点：
- 核心动机：（什么驱动他不断前进？）
- 金手指/系统：（详细描述能力、限制、成长空间）

## 配角矩阵
### 助力型配角
1. 配角A：（身份、与主角关系、作用）
### 反派/竞争者
1. 反派A：（身份、与主角的冲突、结局预期）

## 力量体系/社会阶层
（从最底层到最顶层的"天梯"设计，让读者能感受到主角的攀升路径）

## 世界观设定
（简洁但完整的世界背景）

## 主线剧情节点
1. 开篇危机：（第1-5章，主角遭遇什么困境？如何激发读者同情/好奇？）
2. 金手指觉醒：（主角如何获得能力？第一次使用的震撼感）
3. 第一次打脸：（谁看不起主角？主角如何证明自己？）
4. 中期高潮：（更大的挑战和更强的敌人）
5. 低谷转折：（主角遭遇挫折，如何逆转？）
6. 终极对决：（最终boss和主线冲突的解决）

## 开篇钩子设计
（第一章前100字应该怎么写？用什么场景/冲突/悬念抓住读者？给出具体的开篇思路）`;

    const prompt = `请为以下网文生成 Story Bible：

【用户需求】
${genre ? `- 类型: ${genre}` : '- 类型: 未指定，请根据主题推断最适合的类型'}
${theme ? `- 主题/核心创意: ${theme}` : ''}
${keywords ? `- 关键词/元素: ${keywords}` : ''}

${genreTemplate ? `【类型参考模板】\n${genreTemplate}` : ''}
${templateHint ? `${templateHint}\n` : ''}

请基于以上信息，生成一个**能在番茄获得流量**的完整 Story Bible：`;

    let bible: string;
    let fallbackModelUsed: { provider: string; model: string } | null = null;

    try {
      bible = await generateText(aiConfig, { system, prompt, temperature: 0.9 });
    } catch (primaryError) {
      if (isGeminiLikeConfig(aiConfig) && isLocationUnsupportedError(primaryError)) {
        const fallbackConfig = await getNonGeminiFallbackAIConfig(c.env.DB, aiConfig);
        if (!fallbackConfig) {
          throw new Error(
            '当前默认模型受地区限制，且未找到可用的非 Gemini 备用模型。请在管理员后台配置可用模型。'
          );
        }

        console.warn(
          `[generate-bible] primary model blocked by location, fallback to ${fallbackConfig.provider}/${fallbackConfig.model}`
        );
        bible = await generateText(fallbackConfig, { system, prompt, temperature: 0.9 });
        fallbackModelUsed = {
          provider: String(fallbackConfig.provider || ''),
          model: String(fallbackConfig.model || ''),
        };
      } else {
        throw primaryError;
      }
    }

    return c.json({
      success: true,
      bible,
      fallbackModelUsed,
      templateApplied: resolvedTemplate ? {
        templateId: resolvedTemplate.id,
        templateName: resolvedTemplate.name,
        snapshotDate: resolvedTemplateDate || templateSnapshotDate || null,
      } : null,
    });
  } catch (error) {
    return c.json({ success: false, error: formatGenerationError(error) }, 500);
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
            onBatchStart: async ({ batchIndex, totalBatches, startChapter, endChapter }) => {
              const suffix = totalBatches > 1
                ? `，批次 ${batchIndex + 1}/${totalBatches}（第 ${startChapter}-${endChapter} 章）`
                : '';
              const batchMsg = `正在生成第 ${globalVolIndex + 1} 卷「${vol.title}」的章节... (${i + 1}/${newVolumeSkeletons.length}${suffix})`;
              await updateTaskMessage(c.env.DB, taskId!, batchMsg, i + 1);
              sendEvent('progress', {
                current: i + 1,
                total: newVolumeSkeletons.length,
                volumeIndex: globalVolIndex,
                volumeTitle: vol.title,
                message: batchMsg,
              });
            },
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
