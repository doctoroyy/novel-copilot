/**
 * 增强版章节生成引擎
 *
 * Agent 是唯一的生成路径。
 * 通过 ReAct Agent 循环实现多轮推理 + 工具调用的章节生成。
 */

import type { AIConfig, AICallTrace } from './services/aiClient.js';
import type { CharacterRelationGraph } from './types/characters.js';
import type { CharacterStateRegistry } from './types/characterState.js';
import type { PlotGraph } from './types/plotGraph.js';
import type { NarrativeGuide, NarrativeArc, EnhancedChapterOutline } from './types/narrative.js';
import type { TimelineState } from './types/timeline.js';
import { createEmptyTimelineState } from './types/timeline.js';
import { initializeRegistryFromGraph } from './context/characterStateManager.js';
import { generateNarrativeArc } from './narrative/pacingController.js';
import type { QCResult } from './qc/multiDimensionalQC.js';
import { buildEnhancedOutlineFromChapterContext, getOutlineChapterContext } from './utils/outline.js';
import { writeChapterWithAgent } from './agent/agentChapterEngine.js';

export type EnhancedGenerationDiagnostics = {
  promptChars: {
    system: number;
    user: number;
    optimizedContext: number;
    chapterPlan: number;
    summarySource: number;
  };
  estimatedTokens: {
    mainInput: number;
    mainOutput: number;
  };
  phaseDurationsMs: {
    contextBuild: number;
    planning: number;
    mainDraft: number;
    selfReview: number;
    quickQc: number;
    fullQc: number;
    summary: number;
    characterState: number;
    plotGraph: number;
    timeline: number;
  };
  logicalAiCalls: {
    planning: number;
    drafting: number;
    selfReview: number;
    summary: number;
  };
  aiCallTraces: AICallTrace[];
  totalAiDurationMs: number;
  aiCallCount: number;
};

/**
 * 增强版章节生成参数
 */
export type EnhancedWriteChapterParams = {
  /** AI 配置 */
  aiConfig: AIConfig;
  /** 备用 AI 配置列表 */
  fallbackConfigs?: AIConfig[];
  /** 摘要更新专用 AI 配置 */
  summaryAiConfig?: AIConfig;
  /** Story Bible 内容 */
  bible: string;
  /** 滚动剧情摘要 */
  rollingSummary: string;
  /** 未解伏笔列表 */
  openLoops: string[];
  /** 最近 1~2 章原文 */
  lastChapters: string[];
  /** 当前章节索引 */
  chapterIndex: number;
  /** 计划总章数 */
  totalChapters: number;
  /** 每章最少字数（正文，不含标题） */
  minChapterWords?: number;
  /** 本章写作目标提示 */
  chapterGoalHint?: string;
  /** 本章标题 */
  chapterTitle?: string;
  /** 正文模板配置 */
  chapterPromptProfile?: string;
  /** 正文自定义补充提示词 */
  chapterPromptCustom?: string;
  /** 人物关系图谱 */
  characters?: CharacterRelationGraph;

  // ========== 上下文状态 ==========
  /** 人物状态注册表 */
  characterStates?: CharacterStateRegistry;
  /** 剧情图谱 */
  plotGraph?: PlotGraph;
  /** 时间线状态 */
  timeline?: TimelineState;
  /** 叙事弧线 */
  narrativeArc?: NarrativeArc;
  /** 增强型章节大纲 */
  enhancedOutline?: EnhancedChapterOutline;
  /** 上一章的节奏值（用于平滑） */
  previousPacing?: number;

  // ========== 配置选项（部分保留向后兼容，Agent 模式下被忽略） ==========
  /** 启用上下文优化 */
  enableContextOptimization?: boolean;
  /** 启用多维度 QC */
  enableFullQC?: boolean;
  /** 启用自动修复 */
  enableAutoRepair?: boolean;
  /** 启用章节规划 */
  enablePlanning?: boolean;
  /** 启用自检复写 */
  enableSelfReview?: boolean;
  /** 自检最大重写次数 */
  maxSelfReviewAttempts?: number;
  /** 最大重写次数 */
  maxRewriteAttempts?: number;
  /** 自动修复最大尝试次数 */
  maxRepairAttempts?: number;
  /** 跳过摘要更新 */
  skipSummaryUpdate?: boolean;
  /** 跳过状态更新 */
  skipStateUpdate?: boolean;
  /** 启用 Agent 模式（现在始终为 true，保留向后兼容） */
  enableAgentMode?: boolean;
  /** Agent 最大推理轮次（默认 8） */
  agentMaxTurns?: number;
  /** Agent AI 调用预算（默认 15） */
  agentMaxAICalls?: number;
  /** 进度回调 */
  onProgress?: (message: string, status?: 'analyzing' | 'planning' | 'generating' | 'reviewing' | 'repairing' | 'saving' | 'updating_summary') => void;
};


/**
 * 增强版章节生成结果
 */
export type EnhancedWriteChapterResult = {
  /** 生成的章节文本 */
  chapterText: string;
  /** 更新后的滚动摘要 */
  updatedSummary: string;
  /** 更新后的未解伏笔 */
  updatedOpenLoops: string[];
  /** 更新后的人物状态注册表 */
  updatedCharacterStates?: CharacterStateRegistry;
  /** 更新后的剧情图谱 */
  updatedPlotGraph?: PlotGraph;
  /** 更新后的时间线状态 */
  updatedTimeline?: TimelineState;
  /** QC 检测结果 */
  qcResult?: QCResult;
  /** 叙事指导 */
  narrativeGuide?: NarrativeGuide;
  /** 是否触发了重写 */
  wasRewritten: boolean;
  /** 重写次数 */
  rewriteCount: number;
  /** 上下文统计 */
  contextStats?: {
    totalChars: number;
    estimatedTokens: number;
  };
  /** 事件重复警告 */
  eventDuplicationWarnings?: string[];
  /** 是否跳过了摘要更新 */
  skippedSummary: boolean;
  /** 正文生成+QC耗时（毫秒） */
  generationDurationMs: number;
  /** 摘要更新耗时（毫秒） */
  summaryDurationMs: number;
  /** 整体耗时（毫秒） */
  totalDurationMs: number;
  /** 生成链路观测指标 */
  diagnostics: EnhancedGenerationDiagnostics;
};

/**
 * 增强版章节生成 — Agent 是唯一路径
 *
 * 通过 ReAct Agent 循环实现：
 * 1. buildOptimizedContext()
 * 2. orchestrator.run() — Agent 产出章节草稿
 * 3. normalizeGeneratedChapterText()
 * 4. parallelPostProcessing() — summary/characterState/plotGraph/timeline
 */
export async function writeEnhancedChapter(
  params: EnhancedWriteChapterParams
): Promise<EnhancedWriteChapterResult> {
  return writeChapterWithAgent(params);
}

/**
 * 批量生成章节（带状态管理）
 */
export async function generateChapterBatch(
  aiConfig: AIConfig,
  params: {
    bible: string;
    characters?: CharacterRelationGraph;
    outline?: any;
    startChapter: number;
    endChapter: number;
    totalChapters: number;
    initialState: {
      rollingSummary: string;
      openLoops: string[];
      characterStates?: CharacterStateRegistry;
      plotGraph?: PlotGraph;
      timeline?: TimelineState;
      narrativeArc?: NarrativeArc;
    };
    onChapterComplete?: (result: {
      chapterIndex: number;
      chapterText: string;
      state: any;
    }) => Promise<void>;
    enableContextOptimization?: boolean;
    enableQC?: boolean;
  }
): Promise<{
  chapters: { index: number; text: string; qcResult?: QCResult }[];
  finalState: {
    rollingSummary: string;
    openLoops: string[];
    characterStates?: CharacterStateRegistry;
    plotGraph?: PlotGraph;
    timeline?: TimelineState;
  };
}> {
  const {
    bible,
    characters,
    outline,
    startChapter,
    endChapter,
    totalChapters,
    initialState,
    onChapterComplete,
    enableContextOptimization = true,
    enableQC = false,
  } = params;

  // 初始化状态
  let currentState = {
    rollingSummary: initialState.rollingSummary,
    openLoops: initialState.openLoops,
    characterStates: initialState.characterStates || (
      characters ? initializeRegistryFromGraph(characters) : undefined
    ),
    plotGraph: initialState.plotGraph,
    timeline: initialState.timeline || createEmptyTimelineState(),
    narrativeArc: initialState.narrativeArc || (
      outline ? generateNarrativeArc(outline.volumes || [], totalChapters) : undefined
    ),
  };

  const chapters: { index: number; text: string; qcResult?: QCResult }[] = [];
  let previousPacing: number | undefined;
  let lastChapters: string[] = [];

  for (let chapterIndex = startChapter; chapterIndex <= endChapter; chapterIndex++) {
    // 获取章节大纲
    let chapterGoalHint: string | undefined;
    let chapterTitle: string | undefined;
    const outlineContext = getOutlineChapterContext(outline as any, chapterIndex);
    const enhancedOutline = outlineContext
      ? buildEnhancedOutlineFromChapterContext(outlineContext)
      : undefined;

    if (outlineContext) {
      chapterTitle = outlineContext.chapter.title;
      chapterGoalHint = `【章节大纲】\n- 标题: ${outlineContext.chapter.title}\n- 目标: ${outlineContext.chapter.goal}\n- 章末钩子: ${outlineContext.chapter.hook}`;
    }

    // 生成章节 — 始终使用 Agent 模式
    const result = await writeEnhancedChapter({
      aiConfig,
      bible,
      rollingSummary: currentState.rollingSummary,
      openLoops: currentState.openLoops,
      lastChapters,
      chapterIndex,
      totalChapters,
      chapterGoalHint,
      chapterTitle,
      enhancedOutline,
      characters,
      characterStates: currentState.characterStates,
      plotGraph: currentState.plotGraph,
      timeline: currentState.timeline,
      narrativeArc: currentState.narrativeArc,
      previousPacing,
      enableContextOptimization,
      enableFullQC: enableQC,
      skipStateUpdate: false,
    });

    // 更新状态
    currentState.rollingSummary = result.updatedSummary;
    currentState.openLoops = result.updatedOpenLoops;
    if (result.updatedCharacterStates) {
      currentState.characterStates = result.updatedCharacterStates;
    }
    if (result.updatedPlotGraph) {
      currentState.plotGraph = result.updatedPlotGraph;
    }
    if (result.updatedTimeline) {
      currentState.timeline = result.updatedTimeline;
    }
    previousPacing = result.narrativeGuide?.pacingTarget;

    // 更新近章缓存
    lastChapters.push(result.chapterText);
    if (lastChapters.length > 2) {
      lastChapters.shift();
    }

    chapters.push({
      index: chapterIndex,
      text: result.chapterText,
      qcResult: result.qcResult,
    });

    // 回调
    if (onChapterComplete) {
      await onChapterComplete({
        chapterIndex,
        chapterText: result.chapterText,
        state: currentState,
      });
    }
  }

  return {
    chapters,
    finalState: {
      rollingSummary: currentState.rollingSummary,
      openLoops: currentState.openLoops,
      characterStates: currentState.characterStates,
      plotGraph: currentState.plotGraph,
      timeline: currentState.timeline,
    },
  };
}
