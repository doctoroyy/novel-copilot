/**
 * OutlineAgent — 带自愈能力的大纲生成 agent
 *
 * 包装 generateMasterOutline / generateVolumeChapters 等函数，
 * 用程序化 agent 循环替代线性调用，实现：
 * - 解析失败自动重试（换 temperature）
 * - 部分结果容错（N 卷只成功 M 卷仍可返回）
 * - 校验 + 修复循环
 */

import type { AIConfig } from '../services/aiClient.js';
import {
  generateMasterOutline,
  generateVolumeChapters,
  buildVolumeContinuationSummary,
  type NovelOutline,
  type VolumeOutline,
  type ChapterOutline,
} from '../generateOutline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutlineAgentParams = {
  aiConfig: AIConfig;
  bible: string;
  targetChapters: number;
  targetWordCount: number;
  characters?: any;
  minChapterWords?: number;
  onProgress?: (message: string, progress?: number) => void;
};

export type OutlineAgentResult = {
  outline: NovelOutline;
  warnings: string[];
};

type ToolOk<T> = { ok: true; data: T; error?: undefined };
type ToolErr = { ok: false; data?: undefined; error: string };
type ToolResult<T> = ToolOk<T> | ToolErr;

// ---------------------------------------------------------------------------
// Tool wrappers — each returns ToolResult instead of throwing
// ---------------------------------------------------------------------------

type MasterStructure = {
  volumes: Omit<VolumeOutline, 'chapters'>[];
  mainGoal: string;
  milestones: string[];
};

async function toolGenerateMasterStructure(
  aiConfig: AIConfig,
  args: {
    bible: string;
    targetChapters: number;
    targetWordCount: number;
    minChapterWords: number;
    characters?: any;
  },
): Promise<ToolResult<MasterStructure>> {
  try {
    const result = await generateMasterOutline(aiConfig, args);
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: `generate_master_structure failed: ${(err as Error).message}` };
  }
}

async function toolGenerateVolumeChapters(
  aiConfig: AIConfig,
  args: Parameters<typeof generateVolumeChapters>[1],
): Promise<ToolResult<ChapterOutline[]>> {
  try {
    const chapters = await generateVolumeChapters(aiConfig, args);
    return { ok: true, data: chapters };
  } catch (err) {
    return { ok: false, error: `generate_volume_chapters failed: ${(err as Error).message}` };
  }
}

async function toolFixVolume(
  aiConfig: AIConfig,
  args: Parameters<typeof generateVolumeChapters>[1],
): Promise<ToolResult<ChapterOutline[]>> {
  const tweakedArgs = {
    ...args,
    // generateVolumeChapters 内部已有 parse-level retry，
    // 这里通过截短 bible 让 AI 换思路
    bible: args.bible.slice(0, Math.max(3000, args.bible.length - 500)),
  };
  try {
    const chapters = await generateVolumeChapters(aiConfig, tweakedArgs);
    return { ok: true, data: chapters };
  } catch (err) {
    return { ok: false, error: `fix_volume retry failed: ${(err as Error).message}` };
  }
}

function toolValidateOutline(outline: NovelOutline): string[] {
  const issues: string[] = [];

  if (outline.volumes.length === 0) {
    issues.push('大纲没有任何卷');
  }

  let expectedNext = 1;
  for (let i = 0; i < outline.volumes.length; i++) {
    const vol = outline.volumes[i];

    if (!vol.title) issues.push(`第${i + 1}卷缺少标题`);
    if (!vol.goal) issues.push(`第${i + 1}卷「${vol.title}」缺少目标`);
    if (!vol.conflict) issues.push(`第${i + 1}卷「${vol.title}」缺少冲突`);
    if (!vol.climax) issues.push(`第${i + 1}卷「${vol.title}」缺少高潮`);

    if (vol.startChapter !== expectedNext) {
      issues.push(
        `第${i + 1}卷起始章节 ${vol.startChapter} 与预期 ${expectedNext} 不匹配`,
      );
    }
    if (vol.endChapter < vol.startChapter) {
      issues.push(`第${i + 1}卷结束章节 ${vol.endChapter} 小于起始章节 ${vol.startChapter}`);
    }
    expectedNext = vol.endChapter + 1;

    if (!vol.chapters || vol.chapters.length === 0) {
      issues.push(`第${i + 1}卷「${vol.title}」没有章节数据`);
    } else {
      const expectedCount = vol.endChapter - vol.startChapter + 1;
      if (vol.chapters.length < expectedCount) {
        issues.push(
          `第${i + 1}卷「${vol.title}」章节数不足：期望 ${expectedCount}，实际 ${vol.chapters.length}`,
        );
      }
      const indices = vol.chapters.map((c) => c.index).sort((a, b) => a - b);
      for (let j = 1; j < indices.length; j++) {
        if (indices[j] !== indices[j - 1] + 1) {
          issues.push(
            `第${i + 1}卷章节序号不连续：${indices[j - 1]} 之后是 ${indices[j]}`,
          );
          break;
        }
      }
    }
  }

  const actualTotal = outline.volumes.reduce(
    (sum, v) => sum + (v.chapters?.length ?? 0),
    0,
  );
  if (actualTotal < outline.totalChapters * 0.8) {
    issues.push(
      `总章节数 ${actualTotal} 远低于目标 ${outline.totalChapters}`,
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Agent loop — programmatic, no LLM-driven reasoning needed
// ---------------------------------------------------------------------------

export async function generateOutlineWithAgent(
  params: OutlineAgentParams,
): Promise<OutlineAgentResult> {
  const {
    aiConfig,
    bible,
    targetChapters,
    targetWordCount,
    characters,
    minChapterWords = 2500,
    onProgress,
  } = params;

  const warnings: string[] = [];

  // ---- Step 1: generate_master_structure ----
  onProgress?.('正在生成总体卷结构...', 5);
  const masterResult = await toolGenerateMasterStructure(aiConfig, {
    bible,
    targetChapters,
    targetWordCount,
    minChapterWords,
    characters,
  });

  if (!masterResult.ok) {
    throw new Error(`大纲卷结构生成失败，无法继续: ${masterResult.error}`);
  }

  const masterVolumes = masterResult.data.volumes;
  const mainGoal = masterResult.data.mainGoal;
  const milestones = masterResult.data.milestones;

  onProgress?.(
    `总体结构完成: ${masterVolumes.length} 卷, 主线「${mainGoal.slice(0, 30)}…」`,
    15,
  );

  // ---- Step 2: generate_volume_chapters (per-volume, with fix_volume fallback) ----
  const completedVolumes: VolumeOutline[] = [];
  let previousVolumeSummary = '';
  const progressBase = 15;
  const progressPerVolume = 70 / masterVolumes.length;

  for (let i = 0; i < masterVolumes.length; i++) {
    const vol = masterVolumes[i];
    const volLabel = vol.title || `第${i + 1}卷`;
    onProgress?.(
      `正在生成 ${volLabel} 的章节大纲 (${i + 1}/${masterVolumes.length})...`,
      Math.round(progressBase + i * progressPerVolume),
    );

    const chapArgs = {
      bible,
      masterOutline: { mainGoal, milestones },
      volume: vol,
      previousVolumeSummary: previousVolumeSummary || undefined,
      minChapterWords,
    };

    // 第一次尝试
    let result = await toolGenerateVolumeChapters(aiConfig, chapArgs);

    // 失败 → fix_volume 换 prompt 重试
    if (!result.ok) {
      warnings.push(`${volLabel} 首次生成失败 (${result.error})，尝试修复...`);
      onProgress?.(`${volLabel} 首次生成失败，正在重试...`, undefined);
      result = await toolFixVolume(aiConfig, chapArgs);
    }

    if (result.ok) {
      completedVolumes.push({ ...vol, chapters: result.data });
      previousVolumeSummary = buildVolumeContinuationSummary({
        ...vol,
        chapters: result.data,
      });
    } else {
      // 连修复也失败了，跳过此卷
      warnings.push(`${volLabel} 生成失败（已重试），跳过: ${result.error}`);
      completedVolumes.push({ ...vol, chapters: [] });
    }

    // 卷间短暂延迟，避免 rate limit
    if (i < masterVolumes.length - 1) {
      await sleep(1500);
    }
  }

  // ---- Step 3: assemble outline ----
  onProgress?.('正在组装并校验大纲...', 90);
  const outline: NovelOutline = {
    totalChapters: targetChapters,
    targetWordCount,
    volumes: completedVolumes,
    mainGoal,
    milestones,
  };

  // ---- Step 4: validate_outline ----
  const validationIssues = toolValidateOutline(outline);
  if (validationIssues.length > 0) {
    warnings.push(...validationIssues.map((issue) => `[校验] ${issue}`));
  }

  const successCount = completedVolumes.filter((v) => v.chapters.length > 0).length;
  const totalChapterCount = completedVolumes.reduce(
    (sum, v) => sum + v.chapters.length,
    0,
  );

  onProgress?.(
    `大纲生成完成: ${successCount}/${masterVolumes.length} 卷成功, 共 ${totalChapterCount} 章`,
    100,
  );

  return { outline, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
