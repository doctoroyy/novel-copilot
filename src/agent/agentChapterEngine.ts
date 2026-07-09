/**
 * Agent 模式章节生成引擎 (Native Version)
 *
 * 通过纯本地 Agent 循环替代沉重的 LangGraph
 */

import { buildContextPackage, serializeContextPackage } from './contextBuilder.js';
import { runAgentLoop } from './agentLoop.js';
import { importProposal } from './proposalImporter.js';
import { AGENT_SYSTEM_PROMPT } from './systemPrompt.js';
import { AnthropicDirectAdapter } from './adapters/AnthropicDirectAdapter.js';
import { OpenAIDirectAdapter } from './adapters/OpenAIDirectAdapter.js';
import type { AgentRuntimeAdapter } from './adapters/types.js';
import { ToolExecutor } from './toolExecutor.js';
import type { ToolContext } from './tools.js';

import type {
  EnhancedWriteChapterParams,
  EnhancedWriteChapterResult,
  EnhancedGenerationDiagnostics,
} from '../enhancedChapterEngine.js';
import {
  AICallTracer,
  type AIConfig,
} from '../services/aiClient.js';
import { generateNarrativeGuide } from '../narrative/pacingController.js';
import type { NarrativeGuide } from '../types/narrative.js';
import { createEmptyRegistry } from '../types/characterState.js';
import {
  analyzeChapterForStateChanges,
  updateRegistry as updateCharacterRegistry,
} from '../context/characterStateManager.js';
import { normalizeRollingSummary, parseSummaryUpdateResponse } from '../utils/rollingSummary.js';
import { buildChapterMemoryDigest } from '../utils/chapterMemoryDigest.js';
import { DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS, getSupportPassMaxTokens } from '../utils/aiModelHelpers.js';
import { generateTextWithRetry, generateTextWithFallback, type FallbackConfig } from '../services/aiClient.js';

export async function writeChapterWithAgent(
  params: EnhancedWriteChapterParams,
): Promise<EnhancedWriteChapterResult> {
  const startedAt = Date.now();
  const tracer = new AICallTracer();
  
  const {
    aiConfig,
    fallbackConfigs,
    bible,
    chapterIndex,
    totalChapters,
    characterStates,
    plotGraph,
    timeline,
    narrativeArc,
    enhancedOutline,
    previousPacing,
    skipSummaryUpdate = false,
    skipStateUpdate = false,
  } = params;

  // 1. 初始化 Adapter
  let adapter: AgentRuntimeAdapter;
  if (aiConfig.provider === 'anthropic' || aiConfig.provider === 'anthropic_direct') {
    adapter = new AnthropicDirectAdapter({
      model: aiConfig.model,
      apiKey: aiConfig.apiKey,
      baseUrl: aiConfig.baseUrl,
    });
  } else {
    adapter = new OpenAIDirectAdapter({
      model: aiConfig.model,
      apiKey: aiConfig.apiKey,
      baseUrl: aiConfig.baseUrl,
    });
  }

  // 2. 生成叙事指导
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

  // 3. 构建 Context Package
  params.onProgress?.('正在构建精简上下文...', 'analyzing');
  const contextBuildStartedAt = Date.now();
  
  let writingStyleRules = '';
  if (params.chapterPromptProfile) {
    writingStyleRules = `请遵循风格模板: ${params.chapterPromptProfile}\n${params.chapterPromptCustom || ''}`;
  } else if (params.customSystemPrompt) {
    writingStyleRules = params.customSystemPrompt;
  }

  const contextPkg = buildContextPackage({
    taskId: `gen-chapter-${chapterIndex}`,
    projectId: 'current',
    chapterIndex,
    rollingSummary: params.rollingSummary,
    currentBlueprint: enhancedOutline ? JSON.stringify(enhancedOutline) : params.chapterGoalHint,
    writingStyleRules,
    totalChapters,
  });
  
  const serializedContext = serializeContextPackage(contextPkg);
  const fullSystemPrompt = `${AGENT_SYSTEM_PROMPT}\n\n${serializedContext}`;
  const contextBuildDurationMs = Date.now() - contextBuildStartedAt;

  // 4. 构建 Tool Executor
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
  const executor = new ToolExecutor(toolContext, aiConfig, { tracer, phase: 'other' });

  // 5. 启动 Agent Loop
  params.onProgress?.('Agent 开始创作 (Native Loop)...', 'generating');
  const agentStartedAt = Date.now();
  
  const goalBits = [
    params.chapterGoalHint ? `本章目标提示：${params.chapterGoalHint}` : '',
    enhancedOutline?.title ? `章节标题：${enhancedOutline.title}` : '',
    enhancedOutline?.goal?.primary ? `主目标：${enhancedOutline.goal.primary}` : '',
    params.minChapterWords ? `目标字数不少于约 ${params.minChapterWords} 字` : '',
  ].filter(Boolean).join('\n');

  const loopResult = await runAgentLoop({
    adapter,
    systemPrompt: fullSystemPrompt,
    executor: async (name: string, args: any) => {
      return executor.execute({ tool: name, args: args || {} });
    },
    maxIterations: params.agentMaxTurns || 10,
    initialUserMessage: [
      `请创作第 ${chapterIndex} 章（共 ${totalChapters} 章）。`,
      goalBits,
      '按需调用 read_story_vault / read_summary / read_chapter / search_references 获取上下文。',
      '完成后必须调用 submit_proposal，提交 scene_plan、chapter_text、review_notes。',
    ].filter(Boolean).join('\n'),
  });

  const agentDurationMs = Date.now() - agentStartedAt;

  if (loopResult.status === 'error') {
    throw new Error(`Agent execution failed: ${loopResult.error}`);
  }

  if (loopResult.status === 'max_iterations_reached' || !loopResult.proposal) {
    throw new Error(`Agent 未能在规定轮数内调用 submit_proposal 提交草稿。`);
  }

  // 6. 解析提案
  const importRes = importProposal(loopResult.proposal);
  if (!importRes.success || !importRes.data) {
    throw new Error(`提案格式解析失败: ${importRes.error}`);
  }

  const chapterText = importRes.data.chapter_text;
  if (!chapterText || chapterText.length < 50) {
    throw new Error(`Agent 生成的正文过短`);
  }

  console.log(`[NativeAgent] 第${chapterIndex}章生成完成, 耗时${(agentDurationMs / 1000).toFixed(1)}s, ${loopResult.messages.length}轮交互。`);

  // 7. 后处理状态更新 (Summary, Timeline, PlotGraph)
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

  params.onProgress?.('正在并行更新摘要和上下文...', 'updating_summary');

  // Task A: 摘要更新（始终执行）
  const summaryTask = (async () => {
    if (skipSummaryUpdate) return;
    const summaryStartedAt = Date.now();
    try {
      const summaryResult = await generateSummaryUpdate(
        aiConfig,
        fallbackConfigs,
        bible,
        params.rollingSummary,
        params.openLoops,
        chapterText,
        { tracer, phase: 'summary' },
      );
      updatedSummary = summaryResult.updatedSummary;
      updatedOpenLoops = summaryResult.updatedOpenLoops;
      skippedSummary = false;
    } catch (e) {
      console.warn(`[Agent] 第${chapterIndex}章摘要更新失败:`, (e as Error).message);
    }
    summaryDurationMs = Date.now() - summaryStartedAt;
  })();

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

  await Promise.all([summaryTask, characterStateTask]);

  const totalDurationMs = Date.now() - startedAt;

  // 8. 构建诊断信息
  const diagnostics: EnhancedGenerationDiagnostics = {
    promptChars: {
      system: fullSystemPrompt.length,
      user: 0,
      optimizedContext: serializedContext.length,
      chapterPlan: 0,
      summarySource: 0,
    },
    estimatedTokens: {
      mainInput: loopResult.usage.inputTokens,
      mainOutput: loopResult.usage.outputTokens,
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
      drafting: loopResult.messages.length,
      selfReview: 0,
      summary: 0,
    },
    aiCallTraces: tracer.toJSON(),
    totalAiDurationMs: tracer.totalDurationMs,
    aiCallCount: tracer.callCount,
    // @ts-ignore
    agentTrace: loopResult,
  };

  return {
    chapterText,
    updatedSummary,
    updatedOpenLoops,
    updatedCharacterStates,
    updatedPlotGraph,
    updatedTimeline,
    narrativeGuide,
    wasRewritten: false,
    rewriteCount: 0,
    contextStats: { totalChars: serializedContext.length, estimatedTokens: Math.ceil(serializedContext.length / 2) },
    eventDuplicationWarnings,
    skippedSummary,
    generationDurationMs: agentDurationMs,
    summaryDurationMs,
    totalDurationMs,
    diagnostics,
  };
}

const SUMMARY_UPDATE_MAX_TOKENS = 1200;

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

async function generateSummaryUpdate(
  aiConfig: AIConfig,
  fallbackConfigs: AIConfig[] | undefined,
  bible: string,
  currentSummary: string,
  openLoops: string[],
  chapterText: string,
  callOptions: any,
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
