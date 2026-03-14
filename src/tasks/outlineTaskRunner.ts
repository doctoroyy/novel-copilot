/**
 * Outline task runner — extracted from generation.ts
 *
 * Contains runOutlineGenerationTaskInBackground and its outline-specific helpers:
 * - runAppendVolumesMode
 * - runRefineOutlineMode
 */

import type { Env } from '../worker.js';
import type { AIConfig } from '../services/aiClient.js';
import { consumeCredit } from '../services/creditService.js';
import { generateMasterOutline, generateVolumeChapters, generateAdditionalVolumes } from '../generateOutline.js';
import {
  updateTaskProgress,
  completeTask,
  updateTaskMessage,
} from '../routes/tasks.js';
import {
  normalizeChapter,
  normalizeVolume,
  normalizeMilestones,
  buildPreviousVolumeSummary,
  computeOutlineProgress,
  validateOutline,
  getRefineVolumeIndices,
  DEFAULT_MIN_CHAPTER_WORDS,
  OUTLINE_TASK_PROGRESS_TOTAL,
} from '../routes/generation.js';
import { getTaskRuntimeControl } from './chapterTaskRunner.js';

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
    const volumes: any[] = [];

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
  const filledVolumes: any[] = [];
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
