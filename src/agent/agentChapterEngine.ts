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
import { buildChapterMemoryDigest } from '../utils/chapterMemoryDigest.js';
import { formatStoryContractForPrompt } from '../utils/storyContract.js';
import { generateTextWithRetry, generateTextWithFallback, type FallbackConfig } from '../services/aiClient.js';
import { getSupportPassMaxTokens, DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS } from '../utils/aiModelHelpers.js';
import { deriveAgentExecutionPlan, shouldUseFastPath } from './adaptivePolicy.js';
import { buildConsistencyGuardrails } from '../context/consistencyGuardrails.js';
import { normalizeGeneratedChapterText, cleanChapterTitle } from '../utils/chapterText.js';
import { buildChapterPromptStyleSection } from '../chapterPromptProfiles.js';

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

  const bridgeMarkers = ['【本卷目标】', '【本卷核心冲突】', '【卷切换桥接上下文】', '【衔接要求】', '【上卷结局】'];
  const hasBridgeGoalHint = bridgeMarkers.some((marker) => params.chapterGoalHint?.includes(marker));
  const previousChapterLength = params.lastChapters.length > 0
    ? params.lastChapters[params.lastChapters.length - 1].replace(/\s/g, '').length
    : 0;

  const executionPlan = deriveAgentExecutionPlan(
    {
      chapterIndex,
      totalChapters,
      openLoopsCount: params.openLoops.length,
      hasNarrativeArc: Boolean(narrativeArc),
      hasEnhancedOutline: Boolean(enhancedOutline),
      timelineEventCount: timeline?.events.length || 0,
      previousChapterLength,
      hasBridgeGoalHint,
    },
    { minChapterWords: params.minChapterWords },
  );
  params.onProgress?.(
    `已应用自适应策略：复杂度 ${executionPlan.complexity.level} (${executionPlan.complexity.score})，上下文 ${executionPlan.context.mode}`,
    'planning',
  );

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
    customSystemPrompt: params.customSystemPrompt,
  };

  // 3. 创建 ToolExecutor 和 Orchestrator
  const toolExecutor = new ToolExecutor(toolContext, aiConfig, { tracer, phase: 'other' });
  const agentConfig: AgentConfig = {
    maxTurns: params.agentMaxTurns ?? executionPlan.agent.maxTurns,
    maxToolCallsPerTurn: executionPlan.agent.maxToolCallsPerTurn,
    enableReaderSimulation: true,
    maxAICalls: params.agentMaxAICalls ?? executionPlan.agent.maxAICalls,
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
    outlineContext: params.outlineContext,
    contextMode: executionPlan.context.mode,
    targetContextTokens: executionPlan.context.targetTokens,
  });
  const contextStats = getContextStats(optimizedContext);
  const contextBuildDurationMs = Date.now() - contextBuildStartedAt;

  // 注入一致性护栏
  const lastChapterEnding = params.lastChapters.length > 0
    ? params.lastChapters[params.lastChapters.length - 1].slice(-300)
    : '';
  const guardrails = buildConsistencyGuardrails({
    characterStates,
    plotGraph,
    timeline,
    lastChapterEnding,
    chapterIndex,
  });

  // 构建目标信息
  const goalSection = buildGoalSection(params);
  const initialContext = [
    optimizedContext,
    guardrails,
    `【本章写作目标】\n${goalSection}`,
  ].filter(Boolean).join('\n\n');

  // 5. 判断是否走 fast-path（单次生成，跳过 ReAct agent 循环）
  const hasCriticalForeshadowing = plotGraph?.pendingForeshadowing.some(
    f => f.urgency === 'critical' && chapterIndex >= f.suggestedResolutionRange[0],
  ) ?? false;
  const useFastPath = shouldUseFastPath({
    complexityLevel: executionPlan.complexity.level,
    hasPlotGraph: Boolean(plotGraph && plotGraph.nodes.length > 0),
    hasPendingCriticalForeshadowing: hasCriticalForeshadowing,
    agentMaxTurnsOverride: params.agentMaxTurns,
  });

  let rawChapterText: string;
  let trace: { turns: any[]; totalTurns: number; totalDurationMs: number; totalToolCalls: number };
  let agentDurationMs: number;

  if (useFastPath) {
    // ============ FAST PATH: 单次 LLM 调用，跳过 ReAct 循环 ============
    params.onProgress?.('Fast-path 直接生成...', 'generating');
    const fastStartedAt = Date.now();
    rawChapterText = await executeFastPathGeneration({
      aiConfig,
      fallbackConfigs,
      initialContext,
      params,
      narrativeGuide,
      tracer,
    });
    agentDurationMs = Date.now() - fastStartedAt;
    trace = { turns: [], totalTurns: 0, totalDurationMs: agentDurationMs, totalToolCalls: 0 };
    console.log(
      `[FastPath] 第${chapterIndex}章完成: 单次生成, 耗时${(agentDurationMs / 1000).toFixed(1)}s`,
    );
  } else {
    // ============ AGENT PATH: 完整 ReAct 循环 ============
    params.onProgress?.('Agent 开始推理...', 'analyzing');
    const agentStartedAt = Date.now();
    const agentResult = await orchestrator.run(initialContext);
    rawChapterText = agentResult.chapterText;
    trace = agentResult.trace;
    agentDurationMs = Date.now() - agentStartedAt;
    console.log(
      `[Agent] 第${chapterIndex}章完成: ${trace.totalTurns}轮推理, ${trace.totalToolCalls}次工具调用, 耗时${(agentDurationMs / 1000).toFixed(1)}s`,
    );
  }

  // 空章节防护：agent 未能生成任何正文内容时直接抛错，触发上层重试
  if (!rawChapterText || rawChapterText.replace(/\s/g, '').length < 50) {
    throw new Error(`第 ${chapterIndex} 章 Agent 未能生成正文内容（输出为空或过短）`);
  }
  const chapterText = rawChapterText;

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

    // Fast-path 模式下跳过高成本 AI 分析（plot graph, timeline）以加速
    const skipExpensiveStateUpdates = useFastPath && skipStateUpdate !== false;

    // Task A: 摘要更新（始终执行）
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

    // Task C: 剧情图谱更新（fast-path 可跳过）
    const plotGraphTask = (async () => {
      if (skipStateUpdate || !plotGraph || skipExpensiveStateUpdates) return;
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

    // Task D: 时间线更新（fast-path 可跳过 AI 分析）
    const timelineTask = (async () => {
      if (skipStateUpdate) return;
      const characterNameMap = getCharacterNameMap(characters, characterStates);
      if (timeline && timeline.events.length > 0) {
        const duplicationCheck = checkEventDuplication(chapterText, timeline, characterNameMap);
        if (duplicationCheck.hasDuplication) {
          eventDuplicationWarnings = duplicationCheck.warnings;
        }
      }
      if (skipExpensiveStateUpdates) return;
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
    chapterText,  // 此处 chapterText 一定非空（上方已抛错拦截）
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

// ========== Fast-path 单次生成 ==========

async function executeFastPathGeneration(opts: {
  aiConfig: AIConfig;
  fallbackConfigs?: AIConfig[];
  initialContext: string;
  params: EnhancedWriteChapterParams;
  narrativeGuide?: NarrativeGuide;
  tracer: AICallTracer;
}): Promise<string> {
  const { aiConfig, fallbackConfigs, initialContext, params, narrativeGuide, tracer } = opts;
  const { chapterIndex, totalChapters, enhancedOutline } = params;
  const isFinal = chapterIndex === totalChapters;
  const minChapterWords = params.minChapterWords || 2500;
  const recommendedMaxWords = Math.max(minChapterWords + 1000, Math.round(minChapterWords * 1.5));

  const chapterTitleRaw = enhancedOutline?.title;
  const chapterTitle = cleanChapterTitle(chapterTitleRaw || '');
  const titleText = chapterTitle
    ? `第${chapterIndex}章 ${chapterTitle}`
    : `第${chapterIndex}章 [你需要起一个创意标题]`;

  let pacingInstructions = '';
  if (narrativeGuide) {
    const pacingDescriptions: Record<string, string> = {
      action: '动作/战斗章节，短句快节奏',
      climax: '高潮章节，冲突到顶，转折有力',
      tension: '紧张铺垫，暗示与伏笔',
      revelation: '揭示章节，有节奏释放关键信息',
      emotional: '情感章节，内心描写和关系发展',
      transition: '过渡章节，调整节奏，埋种子',
    };
    pacingInstructions = `节奏: ${narrativeGuide.pacingType}(${narrativeGuide.pacingTarget}/10) — ${pacingDescriptions[narrativeGuide.pacingType] || ''}`;
  }

  const styleSection = buildChapterPromptStyleSection(
    params.chapterPromptProfile,
    params.chapterPromptCustom,
  );

  const defaultCoreRules = `你是商业网文连载写作助手，核心目标是"好读、顺畅、让人想继续看"。
- 小白文/大白话风格，口语化、接地气
- 正文单句不超25字，对话不超30字
- 对话像真人说话，每段都推进事件
- 完成"目标→阻碍→行动→新问题"推进链
- 开头直入场景，非终章结尾留悬念
- 单章1个主危机+1个副事件，其他只埋钩子`;

  const coreRules = params.customSystemPrompt?.trim() || defaultCoreRules;

  const system = `${coreRules}
${pacingInstructions}
风格: ${styleSection.profileLabel} — ${styleSection.profileDescription}
${styleSection.styleBlock}
═══ 硬性规则 ═══
- is_final_chapter=${isFinal} → ${isFinal ? '可以收束主线' : '严禁完结/终章/尾声'}
- 正文 ${minChapterWords}~${recommendedMaxWords} 字
- 结尾用事件/冲突收尾，不总结
- 第一行: ${titleText}
- 不输出 JSON/代码块/元说明`;

  const prompt = `${initialContext}\n\n本章正文至少 ${minChapterWords} 字，请写出完整内容：`;

  const callOptions: AICallOptions = {
    tracer,
    phase: 'drafting',
    timeoutMs: 5 * 60_000,
  };

  let raw: string;
  if (fallbackConfigs?.length) {
    raw = await generateTextWithFallback(
      buildFallbackConfig(aiConfig, fallbackConfigs),
      { system, prompt, temperature: 0.7 },
      2,
      callOptions,
    );
  } else {
    raw = await generateTextWithRetry(aiConfig, {
      system, prompt, temperature: 0.7,
    }, 3, callOptions);
  }

  return normalizeGeneratedChapterText(raw, chapterIndex);
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
  const summarySource = buildChapterMemoryDigest(chapterText, DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS);

  const system = `你是小说编辑助理。你的任务是更新剧情摘要和未解伏笔列表。
只输出严格的 JSON 格式，不要有任何其他文字。

【三层记忆更新规则 — 必须严格执行】
- longTermMemory（长期记忆）：稳定设定、人物长期目标与核心因果链。每 10 章至少更新一次：将中期记忆中已稳定的内容精华压缩合入。建议 180~320 字。
- midTermMemory（中期记忆）：当前阶段的进展与关键转折。每 3~5 章更新：将近期记忆中已过时的重要内容提升合并，删除不再相关的细节。建议 220~380 字。
- recentMemory（近期记忆）：最近 3~5 章的细节、冲突状态、即时动机。每章必须更新，只保留最近内容。建议 280~520 字，信息最完整。

【重要】你必须对比之前的记忆内容，确认三个层级都有实质变化。如果长期记忆和中期记忆内容与之前完全相同，说明你没有正确执行压缩和提升操作，必须重新调整。

输出格式：
{
  "longTermMemory": "长期记忆内容",
  "midTermMemory": "中期记忆内容",
  "recentMemory": "近期记忆内容",
  "openLoops": ["未解伏笔1", "未解伏笔2", ...] // 3~8 条，每条不超过 30 字
}`.trim();

  const prompt = `【Story Bible】
${bible}

【此前 Rolling Summary】
${normalizedSummary || '（无）'}

【此前 Open Loops】
${openLoops.map((l, i) => `${i + 1}. ${l}`).join('\n') || '（无）'}

【本章压缩摘录（非全文，按开场/中段/结尾抽取）】
${summarySource}

请按"越近越详细、越远越压缩"的原则输出更新后的 JSON。注意：三个层级都必须有内容变化。`.trim();

  const raw = fallbackConfigs?.length
    ? await generateTextWithFallback(
      buildFallbackConfig(aiConfig, fallbackConfigs),
      { system, prompt, temperature: 0.2, maxTokens },
      2, callOptions,
    )
    : await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.2, maxTokens }, 2, callOptions);

  const result = parseSummaryUpdateResponse(raw, normalizedSummary, openLoops);
  return {
    updatedSummary: result.updatedSummary,
    updatedOpenLoops: result.updatedOpenLoops,
  };
}
