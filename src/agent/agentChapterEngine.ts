/**
 * Agent 模式章节生成引擎
 *
 * 通过 ReAct Agent 循环替代线性 pipeline，
 * 实现多轮推理 + 工具调用的章节生成。
 */

import { ChapterAgentOrchestrator } from './orchestrator.js';
import { ToolExecutor } from './toolExecutor.js';
import type { ToolContext } from './tools.js';
import type { AgentConfig } from './types.js';
import type {
  EnhancedWriteChapterParams,
  EnhancedWriteChapterResult,
  EnhancedGenerationDiagnostics,
} from '../enhancedChapterEngine.js';
import {
  AICallTracer,
  type AIConfig,
  type AICallOptions,
} from '../services/aiClient.js';
import { buildOptimizedContext, getContextStats } from '../contextOptimizer.js';
import { generateNarrativeGuide } from '../narrative/pacingController.js';
import type { NarrativeGuide } from '../types/narrative.js';
import { createEmptyRegistry } from '../types/characterState.js';
import { createEmptyTimelineState } from '../types/timeline.js';
import {
  analyzeChapterForStateChanges,
  updateRegistry as updateCharacterRegistry,
} from '../context/characterStateManager.js';
import {
  analyzeChapterForPlotChanges,
  applyPlotAnalysis,
} from '../context/plotManager.js';
import {
  analyzeChapterForEvents,
  applyEventAnalysis,
  getCharacterNameMap,
  checkEventDuplication,
} from '../context/timelineManager.js';
import { normalizeRollingSummary, parseSummaryUpdateResponse } from '../utils/rollingSummary.js';
import { formatStoryContractForPrompt } from '../utils/storyContract.js';
import { generateTextWithRetry, generateTextWithFallback, type FallbackConfig } from '../services/aiClient.js';
import { getSupportPassMaxTokens } from '../utils/aiModelHelpers.js';

function isSameAiConfig(a: AIConfig, b: AIConfig): boolean {
  return a.provider === b.provider && a.model === b.model;
}

function buildFallbackConfig(primary: AIConfig, fallbackConfigs?: AIConfig[]): FallbackConfig {
  return {
    primary,
    fallback: fallbackConfigs?.filter(c => !isSameAiConfig(c, primary)),
    switchConditions: ['rate_limit', 'server_error', 'timeout', 'unknown'] as FallbackConfig['switchConditions'],
  };
}

export async function writeChapterWithAgent(
  params: EnhancedWriteChapterParams,
): Promise<EnhancedWriteChapterResult> {
  const startedAt = Date.now();
  const tracer = new AICallTracer();
  const {
    aiConfig,
    fallbackConfigs,
    summaryAiConfig,
    bible,
    chapterIndex,
    totalChapters,
    characterStates,
    plotGraph,
    timeline,
    characters,
    narrativeArc,
    enhancedOutline,
    previousPacing,
    skipSummaryUpdate = false,
    skipStateUpdate = false,
  } = params;

  // 1. 生成叙事指导（复用现有逻辑）
  params.onProgress?.('正在设计叙事节奏...', 'planning');
  let narrativeGuide: NarrativeGuide | undefined;
  if (narrativeArc) {
    narrativeGuide = generateNarrativeGuide(
      narrativeArc,
      chapterIndex,
      totalChapters,
      enhancedOutline ? {
        index: enhancedOutline.index,
        title: enhancedOutline.title,
        goal: enhancedOutline.goal.primary,
        hook: enhancedOutline.hook.content,
      } : undefined,
      previousPacing,
    );
  }

  // 2. 构建 ToolContext
  const toolContext: ToolContext = {
    bible,
    plotGraph,
    characterStates,
    timeline,
    narrativeGuide,
    rollingSummary: params.rollingSummary,
    openLoops: params.openLoops,
    lastChapters: params.lastChapters,
    chapterIndex,
    totalChapters,
    enhancedOutline,
    minChapterWords: params.minChapterWords,
    chapterPromptProfile: params.chapterPromptProfile,
    chapterPromptCustom: params.chapterPromptCustom,
  };

  // 3. 创建 ToolExecutor 和 Orchestrator
  const toolExecutor = new ToolExecutor(toolContext, aiConfig, { tracer, phase: 'other' });
  const agentConfig: AgentConfig = {
    maxTurns: params.agentMaxTurns ?? 8,
    maxToolCallsPerTurn: 3,
    enableReaderSimulation: true,
    maxAICalls: params.agentMaxAICalls ?? 15,
    onProgress: params.onProgress
      ? (phase, detail) => {
          const statusMap: Record<string, 'analyzing' | 'planning' | 'generating' | 'reviewing'> = {
            reasoning: 'analyzing',
            tool_call: 'analyzing',
            generating: 'generating',
            rewriting: 'reviewing',
            budget_exceeded: 'generating',
          };
          params.onProgress!(detail, statusMap[phase] || 'analyzing');
        }
      : undefined,
  };

  const orchestrator = new ChapterAgentOrchestrator(
    aiConfig,
    fallbackConfigs,
    toolExecutor,
    agentConfig,
    tracer,
  );

  // 4. 构建初始上下文（复用现有的 buildOptimizedContext）
  params.onProgress?.('正在构建上下文...', 'analyzing');
  const contextBuildStartedAt = Date.now();
  const optimizedContext = buildOptimizedContext({
    bible,
    characterStates,
    plotGraph,
    timeline,
    characters,
    rollingSummary: params.rollingSummary,
    lastChapters: params.lastChapters,
    narrativeGuide,
    chapterIndex,
    totalChapters,
    chapterOutlineCharacters: enhancedOutline?.scenes.flatMap(s => s.characters),
  });
  const contextStats = getContextStats(optimizedContext);
  const contextBuildDurationMs = Date.now() - contextBuildStartedAt;

  // 构建目标信息
  const goalSection = buildGoalSection(params);
  const initialContext = `${optimizedContext}\n\n【本章写作目标】\n${goalSection}`;

  // 5. 运行 Agent 循环
  params.onProgress?.('Agent 开始推理...', 'analyzing');
  const agentStartedAt = Date.now();
  const { chapterText, trace } = await orchestrator.run(initialContext);
  const agentDurationMs = Date.now() - agentStartedAt;

  console.log(
    `[Agent] 第${chapterIndex}章完成: ${trace.totalTurns}轮推理, ${trace.totalToolCalls}次工具调用, 耗时${(agentDurationMs / 1000).toFixed(1)}s`,
  );

  // 6. 后处理（与现有 pipeline 相同）
  let updatedSummary = params.rollingSummary;
  let updatedOpenLoops = params.openLoops;
  let skippedSummary = true;
  let summaryDurationMs = 0;
  let updatedCharacterStates = characterStates;
  let updatedPlotGraph = plotGraph;
  let updatedTimeline = timeline;
  let eventDuplicationWarnings: string[] = [];
  let characterStateDurationMs = 0;
  let plotGraphDurationMs = 0;
  let timelineDurationMs = 0;

  if (chapterText) {
    params.onProgress?.('正在并行更新摘要和上下文...', 'updating_summary');

    // Task A: 摘要更新
    const summaryTask = (async () => {
      if (skipSummaryUpdate) return;
      const summaryStartedAt = Date.now();
      const effectiveConfig = summaryAiConfig || aiConfig;
      try {
        const summaryResult = await generateSummaryUpdate(
          effectiveConfig,
          isSameAiConfig(effectiveConfig, aiConfig) ? fallbackConfigs : undefined,
          bible,
          params.rollingSummary,
          params.openLoops,
          chapterText,
          { tracer, phase: 'summary' },
        );
        updatedSummary = summaryResult.updatedSummary;
        updatedOpenLoops = summaryResult.updatedOpenLoops;
        skippedSummary = false;
      } catch (error) {
        console.warn(`[Agent] 第${chapterIndex}章摘要更新失败:`, (error as Error).message);
      } finally {
        summaryDurationMs = Date.now() - summaryStartedAt;
      }
    })();

    // Task B: 人物状态更新
    const characterStateTask = (async () => {
      if (skipStateUpdate) return;
      const currentStates = characterStates || createEmptyRegistry();
      try {
        const stateStartedAt = Date.now();
        const stateChanges = await analyzeChapterForStateChanges(
          aiConfig, chapterText, chapterIndex, currentStates,
          { tracer, phase: 'characterState' },
        );
        if (stateChanges.changes.length > 0) {
          updatedCharacterStates = updateCharacterRegistry(currentStates, stateChanges, chapterIndex);
        }
        characterStateDurationMs = Date.now() - stateStartedAt;
      } catch (error) {
        console.warn('State update failed:', error);
      }
    })();

    // Task C: 剧情图谱更新
    const plotGraphTask = (async () => {
      if (skipStateUpdate || !plotGraph) return;
      try {
        const plotStartedAt = Date.now();
        const plotChanges = await analyzeChapterForPlotChanges(
          aiConfig, chapterText, chapterIndex, plotGraph,
          { tracer, phase: 'plotGraph' },
        );
        if (plotChanges.newNodes.length > 0 || plotChanges.statusUpdates.length > 0) {
          updatedPlotGraph = applyPlotAnalysis(plotGraph, plotChanges, chapterIndex, totalChapters);
        }
        plotGraphDurationMs = Date.now() - plotStartedAt;
      } catch (error) {
        console.warn('Plot update failed:', error);
      }
    })();

    // Task D: 时间线更新
    const timelineTask = (async () => {
      if (skipStateUpdate) return;
      const characterNameMap = getCharacterNameMap(characters, characterStates);
      if (timeline && timeline.events.length > 0) {
        const duplicationCheck = checkEventDuplication(chapterText, timeline, characterNameMap);
        if (duplicationCheck.hasDuplication) {
          eventDuplicationWarnings = duplicationCheck.warnings;
        }
      }
      try {
        const timelineStartedAt = Date.now();
        const currentTimeline = timeline || createEmptyTimelineState();
        const eventAnalysis = await analyzeChapterForEvents(
          aiConfig, chapterText, chapterIndex, currentTimeline, characterNameMap,
          { tracer, phase: 'timeline' },
        );
        if (eventAnalysis.newEvents.length > 0) {
          updatedTimeline = applyEventAnalysis(currentTimeline, eventAnalysis, chapterIndex);
        }
        timelineDurationMs = Date.now() - timelineStartedAt;
      } catch (error) {
        console.warn('Timeline update failed:', error);
      }
    })();

    await Promise.all([summaryTask, characterStateTask, plotGraphTask, timelineTask]);
  }

  const totalDurationMs = Date.now() - startedAt;
  const generationDurationMs = agentDurationMs;

  // 7. 构建诊断信息
  const diagnostics: EnhancedGenerationDiagnostics = {
    promptChars: {
      system: 0,
      user: initialContext.length,
      optimizedContext: optimizedContext.length,
      chapterPlan: 0,
      summarySource: 0,
    },
    estimatedTokens: {
      mainInput: Math.ceil(initialContext.length / 2),
      mainOutput: Math.ceil((chapterText?.length || 0) / 2),
    },
    phaseDurationsMs: {
      contextBuild: contextBuildDurationMs,
      planning: 0,
      mainDraft: agentDurationMs,
      selfReview: 0,
      quickQc: 0,
      fullQc: 0,
      summary: summaryDurationMs,
      characterState: characterStateDurationMs,
      plotGraph: plotGraphDurationMs,
      timeline: timelineDurationMs,
    },
    logicalAiCalls: {
      planning: 0,
      drafting: tracer.callCount,
      selfReview: 0,
      summary: skippedSummary ? 0 : 1,
    },
    aiCallTraces: tracer.toJSON(),
    totalAiDurationMs: tracer.totalDurationMs,
    aiCallCount: tracer.callCount,
    // 附加 agent trace 信息
    ...(trace as any).agentTrace ? {} : { agentTrace: trace },
  };

  return {
    chapterText: chapterText || '',
    updatedSummary,
    updatedOpenLoops,
    updatedCharacterStates,
    updatedPlotGraph,
    updatedTimeline,
    narrativeGuide,
    wasRewritten: false,
    rewriteCount: 0,
    contextStats,
    eventDuplicationWarnings,
    skippedSummary,
    generationDurationMs,
    summaryDurationMs,
    totalDurationMs,
    diagnostics,
  };
}

// ========== 辅助函数 ==========

function buildGoalSection(params: EnhancedWriteChapterParams): string {
  const { enhancedOutline, chapterGoalHint } = params;
  const parts: string[] = [];

  if (enhancedOutline) {
    parts.push(`标题: ${enhancedOutline.title}`);
    parts.push(`主要目标: ${enhancedOutline.goal.primary}`);
    if (enhancedOutline.goal.secondary) {
      parts.push(`次要目标: ${enhancedOutline.goal.secondary}`);
    }
    if (enhancedOutline.scenes.length > 0) {
      parts.push(`场景序列: ${enhancedOutline.scenes.map(s => s.purpose).join(' → ')}`);
    }
    parts.push(`章末钩子: [${enhancedOutline.hook.type}] ${enhancedOutline.hook.content}`);
    if (enhancedOutline.foreshadowingOps.length > 0) {
      parts.push(`伏笔操作: ${enhancedOutline.foreshadowingOps.map(f => `${f.action}:${f.description}`).join('; ')}`);
    }
    parts.push(...formatStoryContractForPrompt(enhancedOutline.storyContract));
  }

  // 如果 chapterGoalHint 包含卷桥接上下文，追加到目标中（不与 enhancedOutline 冲突）
  if (chapterGoalHint) {
    const bridgeMarkers = ['【本卷目标】', '【本卷核心冲突】', '【卷切换桥接上下文】', '【衔接要求】', '【上卷结局】'];
    const hasBridgeContent = bridgeMarkers.some(marker => chapterGoalHint.includes(marker));
    if (hasBridgeContent) {
      // 提取桥接相关部分（跳过与 enhancedOutline 重复的章节大纲部分）
      const bridgeSections = chapterGoalHint
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          // 跳过已在 enhancedOutline 中包含的章节级信息
          if (enhancedOutline && (trimmed.startsWith('- 标题:') || trimmed.startsWith('- 目标:') || trimmed.startsWith('- 章末钩子:') || trimmed === '【章节大纲】')) {
            return false;
          }
          return true;
        })
        .join('\n')
        .trim();
      if (bridgeSections) {
        parts.push(bridgeSections);
      }
    } else if (!enhancedOutline) {
      // 没有 enhancedOutline 且没有桥接内容，直接用 chapterGoalHint
      return chapterGoalHint;
    }
  }

  if (parts.length === 0) {
    return '围绕本章目标推进主线冲突，制造新的障碍，结尾留下下一章必须处理的问题。';
  }
  return parts.join('\n');
}

const SUMMARY_UPDATE_MAX_TOKENS = 1200;

async function generateSummaryUpdate(
  aiConfig: AIConfig,
  fallbackConfigs: AIConfig[] | undefined,
  bible: string,
  currentSummary: string,
  openLoops: string[],
  chapterText: string,
  callOptions: AICallOptions,
): Promise<{ updatedSummary: string; updatedOpenLoops: string[] }> {
  const normalizedSummary = normalizeRollingSummary(currentSummary || '');
  const maxTokens = getSupportPassMaxTokens(aiConfig, SUMMARY_UPDATE_MAX_TOKENS, 1800);

  const system = '你是故事摘要维护助手。根据新章节内容更新滚动摘要和伏笔列表。只输出 JSON。';
  const prompt = `【当前摘要】
${normalizedSummary.slice(0, 3000)}

【未解伏笔】
${openLoops.map((l, i) => `${i + 1}. ${l}`).join('\n') || '(无)'}

【新章节内容】
${chapterText.slice(0, 5000)}

请输出 JSON:
{
  "rollingSummary": "更新后的剧情摘要（保留关键事件，删除过旧细节，加入本章新进展）",
  "openLoops": ["更新后的未解伏笔列表（已解决的删除，新增的加入）"]
}`;

  const raw = fallbackConfigs?.length
    ? await generateTextWithFallback(
      buildFallbackConfig(aiConfig, fallbackConfigs),
      { system, prompt, temperature: 0.3, maxTokens },
      2, callOptions,
    )
    : await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.3, maxTokens }, 2, callOptions);

  const result = parseSummaryUpdateResponse(raw, normalizedSummary, openLoops);
  return {
    updatedSummary: result.updatedSummary,
    updatedOpenLoops: result.updatedOpenLoops,
  };
}
