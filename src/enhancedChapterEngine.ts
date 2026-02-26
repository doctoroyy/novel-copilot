/**
 * 增强版章节生成引擎
 *
 * 整合所有上下文工程系统：
 * - 人物状态追踪
 * - 剧情图谱管理
 * - 叙事节奏控制
 * - 多维度 QC
 * - 上下文优化
 */

import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import { getCharacterContext } from './generateCharacters.js';
import type { CharacterRelationGraph } from './types/characters.js';
import type { CharacterStateRegistry } from './types/characterState.js';
import type { PlotGraph } from './types/plotGraph.js';
import type { NarrativeGuide, NarrativeArc, EnhancedChapterOutline } from './types/narrative.js';
import type { TimelineState } from './types/timeline.js';
import { createEmptyTimelineState } from './types/timeline.js';
import {
  analyzeChapterForStateChanges,
  updateRegistry as updateCharacterRegistry,
  initializeRegistryFromGraph,
} from './context/characterStateManager.js';
import {
  analyzeChapterForPlotChanges,
  applyPlotAnalysis,
  buildPlotContext,
} from './context/plotManager.js';
import {
  generateNarrativeGuide,
  generateNarrativeArc,
  buildNarrativeContext,
} from './narrative/pacingController.js';
import {
  runMultiDimensionalQC,
  runQuickQC,
  type QCResult,
} from './qc/multiDimensionalQC.js';
import { repairChapter } from './qc/repairLoop.js';
import { buildOptimizedContext, getContextStats } from './contextOptimizer.js';
import { quickEndingHeuristic, quickChapterFormatHeuristic, buildRewriteInstruction } from './qc.js';
import {
  analyzeChapterForEvents,
  applyEventAnalysis,
  getCharacterNameMap,
  checkEventDuplication,
} from './context/timelineManager.js';
import { normalizeGeneratedChapterText } from './utils/chapterText.js';
import { normalizeRollingSummary, parseSummaryUpdateResponse } from './utils/rollingSummary.js';
import { buildChapterPromptStyleSection } from './chapterPromptProfiles.js';

const DEFAULT_MIN_CHAPTER_WORDS = 2500;
const MIN_CHAPTER_WORDS_LIMIT = 500;
const MAX_CHAPTER_WORDS_LIMIT = 20000;

function normalizeMinChapterWords(value: number | undefined): number {
  const parsed = Number.parseInt(String(value ?? DEFAULT_MIN_CHAPTER_WORDS), 10);
  if (!Number.isInteger(parsed)) return DEFAULT_MIN_CHAPTER_WORDS;
  if (parsed < MIN_CHAPTER_WORDS_LIMIT) return MIN_CHAPTER_WORDS_LIMIT;
  if (parsed > MAX_CHAPTER_WORDS_LIMIT) return MAX_CHAPTER_WORDS_LIMIT;
  return parsed;
}

function buildRecommendedMaxChapterWords(minChapterWords: number): number {
  return Math.max(minChapterWords + 1000, Math.round(minChapterWords * 1.5));
}

/**
 * 增强版章节生成参数
 */
export type EnhancedWriteChapterParams = {
  /** AI 配置 */
  aiConfig: AIConfig;
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

  // ========== 新增参数 ==========
  /** 人物状态注册表 */
  characterStates?: CharacterStateRegistry;
  /** 剧情图谱 */
  plotGraph?: PlotGraph;
  /** 时间线状态 (追踪已完成事件) */
  timeline?: TimelineState;
  /** 叙事弧线 */
  narrativeArc?: NarrativeArc;
  /** 增强型章节大纲 */
  enhancedOutline?: EnhancedChapterOutline;
  /** 上一章的节奏值（用于平滑） */
  previousPacing?: number;

  // ========== 配置选项 ==========
  /** 启用上下文优化 */
  enableContextOptimization?: boolean;
  /** 启用多维度 QC */
  enableFullQC?: boolean;
  /** 启用自动修复 */
  enableAutoRepair?: boolean;
  /** 最大重写次数 */
  maxRewriteAttempts?: number;
  /** 跳过摘要更新 */
  skipSummaryUpdate?: boolean;
  /** 跳过状态更新 */
  skipStateUpdate?: boolean;
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
};

/**
 * 增强版章节生成
 */
export async function writeEnhancedChapter(
  params: EnhancedWriteChapterParams
): Promise<EnhancedWriteChapterResult> {
  const {
    aiConfig,
    bible,
    chapterIndex,
    totalChapters,
    minChapterWords,
    characterStates,
    plotGraph,
    timeline,
    characters,
    narrativeArc,
    enhancedOutline,
    previousPacing,
    enableContextOptimization = true,
    enableFullQC = false,
    enableAutoRepair = false,
    maxRewriteAttempts = 2,
    skipSummaryUpdate = false,
    skipStateUpdate = false,
    chapterTitle,
    chapterPromptProfile,
    chapterPromptCustom,
  } = params;

  const isFinal = chapterIndex === totalChapters;
  const normalizedMinChapterWords = normalizeMinChapterWords(minChapterWords);

  // 1. 生成叙事指导
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
      previousPacing
    );
  }

  // 2. 构建上下文
  let userPrompt: string;
  let contextStats: { totalChars: number; estimatedTokens: number } | undefined;

  if (enableContextOptimization) {
    params.onProgress?.('正在优化上下文...', 'analyzing');
    // 使用优化后的上下文
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
      chapterOutlineCharacters: enhancedOutline?.scenes.flatMap((s) => s.characters),
    });

    contextStats = getContextStats(optimizedContext);

    userPrompt = `${optimizedContext}

【本章写作目标】
${buildChapterGoalSection(params, enhancedOutline)}

请写出本章内容：`;
  } else {
    // 使用传统上下文构建
    userPrompt = buildTraditionalPrompt(params, narrativeGuide);
  }

  // 3. 构建 System Prompt
  const system = buildEnhancedSystemPrompt(
    isFinal,
    chapterIndex,
    normalizedMinChapterWords,
    chapterTitle,
    narrativeGuide,
    chapterPromptProfile,
    chapterPromptCustom
  );

  // 4. 第一次生成
  params.onProgress?.('正在生成正文...', 'generating');
  let chapterText = normalizeGeneratedChapterText(
    await generateTextWithRetry(aiConfig, {
      system,
      prompt: userPrompt,
      temperature: narrativeGuide ? getTemperatureForPacing(narrativeGuide.pacingTarget) : 0.85,
    }),
    chapterIndex
  );

  let wasRewritten = false;
  let rewriteCount = 0;

  // 5. 快速 QC 检测（结构 + 非最终章提前完结）
  for (let attempt = 0; attempt < maxRewriteAttempts; attempt++) {
    params.onProgress?.(`正在进行 QC 检测 (${attempt + 1}/${maxRewriteAttempts})...`, 'reviewing');
    const formatQc = quickChapterFormatHeuristic(chapterText, { minBodyChars: normalizedMinChapterWords });
    const endingQc = isFinal ? { hit: false, reasons: [] as string[] } : quickEndingHeuristic(chapterText);
    const reasons = [...formatQc.reasons, ...endingQc.reasons];

    if (reasons.length === 0) break;

    console.log(`⚠️ 章节 ${chapterIndex} 检测到 QC 异常信号，尝试重写 (${attempt + 1}/${maxRewriteAttempts})`);
    
    params.onProgress?.(`检测到问题: ${reasons[0]}，正在修复...`, 'repairing');

    const rewriteInstruction = buildRewriteInstruction({
      chapterIndex,
      totalChapters,
      reasons,
      isFinalChapter: isFinal,
      minChapterWords: normalizedMinChapterWords,
    });

    const rewritePrompt = `${userPrompt}\n\n${rewriteInstruction}`;
    chapterText = normalizeGeneratedChapterText(
      await generateTextWithRetry(aiConfig, {
        system,
        prompt: rewritePrompt,
        temperature: 0.8,
      }),
      chapterIndex
    );

    wasRewritten = true;
    rewriteCount++;
  }

  const finalFormatQc = quickChapterFormatHeuristic(chapterText, { minBodyChars: normalizedMinChapterWords });
  const finalEndingQc = isFinal ? { hit: false, reasons: [] as string[] } : quickEndingHeuristic(chapterText);
  const finalReasons = [...finalFormatQc.reasons, ...finalEndingQc.reasons];
  if (finalReasons.length > 0) {
    const reason = finalReasons[0] || '章节内容疑似不完整';
    params.onProgress?.(`QC 未通过: ${reason}`, 'reviewing');
    throw new Error(`第 ${chapterIndex} 章 QC 未通过: ${reason}`);
  }

  // 6. 多维度 QC（可选）
  let qcResult: QCResult | undefined;
  if (enableFullQC) {
    params.onProgress?.('正在进行深度 QC...', 'reviewing');
    qcResult = await runMultiDimensionalQC({
      aiConfig,
      chapterText,
      chapterIndex,
      totalChapters,
      characterStates,
      narrativeGuide,
      chapterOutline: enhancedOutline,
      minChapterWords: normalizedMinChapterWords,
      useAI: true,
    });

    // 自动修复（可选）
    if (enableAutoRepair && !qcResult.passed) {
      params.onProgress?.('正在自动修复问题...', 'repairing');
      const repairResult = await repairChapter(
        aiConfig,
        chapterText,
        qcResult,
        chapterIndex,
        totalChapters,
        1 // 只尝试修复一次
      );

      if (repairResult.success) {
        chapterText = normalizeGeneratedChapterText(repairResult.repairedChapter, chapterIndex);
        qcResult = repairResult.finalQC;
        wasRewritten = true;
        rewriteCount += repairResult.attempts;
      }
    }
  }

  // 7. 更新滚动摘要
  let updatedSummary = params.rollingSummary;
  let updatedOpenLoops = params.openLoops;

  if (!skipSummaryUpdate) {
    params.onProgress?.('正在更新剧情记忆...', 'updating_summary');
    try {
      const summaryResult = await generateSummaryUpdate(
        aiConfig,
        bible,
        params.rollingSummary,
        params.openLoops,
        chapterText
      );
      updatedSummary = summaryResult.updatedSummary;
      updatedOpenLoops = summaryResult.updatedOpenLoops;
    } catch (summaryError) {
      console.warn(
        `[EnhancedSummary] 第 ${chapterIndex} 章摘要更新失败，已保留上一版摘要:`,
        (summaryError as Error).message
      );
      params.onProgress?.('剧情摘要更新失败，已保留上一版摘要', 'updating_summary');
    }
  }

  // 8. 更新人物状态（可选）
  let updatedCharacterStates = characterStates;
  if (!skipStateUpdate && characterStates) {
    try {
      params.onProgress?.('正在分析人物状态...', 'analyzing');
      const stateChanges = await analyzeChapterForStateChanges(
        aiConfig,
        chapterText,
        chapterIndex,
        characterStates
      );

      if (stateChanges.changes.length > 0) {
        updatedCharacterStates = updateCharacterRegistry(
          characterStates,
          stateChanges,
          chapterIndex
        );
      }
    } catch (error) {
      console.warn('State update failed:', error);
    }
  }

  // 9. 更新剧情图谱（可选）
  let updatedPlotGraph = plotGraph;
  if (!skipStateUpdate && plotGraph) {
    try {
      const plotChanges = await analyzeChapterForPlotChanges(
        aiConfig,
        chapterText,
        chapterIndex,
        plotGraph
      );

      if (plotChanges.newNodes.length > 0 || plotChanges.statusUpdates.length > 0) {
        updatedPlotGraph = applyPlotAnalysis(
          plotGraph,
          plotChanges,
          chapterIndex,
          totalChapters
        );
      }
    } catch (error) {
      console.warn('Plot update failed:', error);
    }
  }

  // 10. 更新时间线（追踪已完成事件）
  let updatedTimeline = timeline;
  let eventDuplicationWarnings: string[] = [];

  if (!skipStateUpdate) {

    const characterNameMap = getCharacterNameMap(characters, characterStates);

    // 检查事件重复
    if (timeline && timeline.events.length > 0) {
      const duplicationCheck = checkEventDuplication(chapterText, timeline, characterNameMap);
      if (duplicationCheck.hasDuplication) {
        eventDuplicationWarnings = duplicationCheck.warnings;
        console.warn(`⚠️ 章节 ${chapterIndex} 检测到事件重复:`, duplicationCheck.warnings);
      }
    }

    // 分析并更新时间线
    try {
      const currentTimeline = timeline || createEmptyTimelineState();
      const eventAnalysis = await analyzeChapterForEvents(
        aiConfig,
        chapterText,
        chapterIndex,
        currentTimeline,
        characterNameMap
      );

      if (eventAnalysis.newEvents.length > 0) {
        updatedTimeline = applyEventAnalysis(currentTimeline, eventAnalysis, chapterIndex);
        console.log(`📅 章节 ${chapterIndex} 记录了 ${eventAnalysis.newEvents.length} 个新事件`);
      }
    } catch (error) {
      console.warn('Timeline update failed:', error);
    }
  }

  return {
    chapterText,
    updatedSummary,
    updatedOpenLoops,
    updatedCharacterStates,
    updatedPlotGraph,
    updatedTimeline,
    qcResult,
    narrativeGuide,
    wasRewritten,
    rewriteCount,
    contextStats,
    eventDuplicationWarnings,
  };
}

/**
 * 构建增强版 System Prompt
 */
function buildEnhancedSystemPrompt(
  isFinal: boolean,
  chapterIndex: number,
  minChapterWords: number,
  chapterTitle?: string,
  guide?: NarrativeGuide,
  chapterPromptProfile?: string,
  chapterPromptCustom?: string
): string {
  const recommendedMaxWords = buildRecommendedMaxChapterWords(minChapterWords);
  const titleText = chapterTitle
    ? `第${chapterIndex}章 ${chapterTitle}`
    : `第${chapterIndex}章 [你需要起一个创意标题]`;
  const styleSection = buildChapterPromptStyleSection(chapterPromptProfile, chapterPromptCustom);

  let pacingInstructions = '';
  if (guide) {
    const pacingDescriptions: Record<string, string> = {
      action: '这是动作/战斗章节，使用短句、快节奏、动作描写为主，对话简短有力',
      climax: '这是高潮章节，情感和冲突达到峰值，使用强烈对比和出人意料的转折',
      tension: '这是紧张铺垫章节，营造压迫感和危机感，使用暗示和伏笔',
      revelation: '这是揭示/发现章节，有节奏地释放关键信息，角色反应要真实',
      emotional: '这是情感章节，注重内心描写和关系发展，对话可以更细腻',
      transition: '这是过渡章节，调整节奏、补充设定，但要埋下后续剧情的种子',
    };

    pacingInstructions = `
节奏要求（重要）：
- 本章节奏类型: ${guide.pacingType}
- 紧张度目标: ${guide.pacingTarget}/10
- ${pacingDescriptions[guide.pacingType] || ''}`;
  }

  return `
你是商业网文连载写作助手，核心目标是“好读、顺畅、让人想继续看”。

【阅读体验优先】
- 以剧情推进为第一优先，文采服务于阅读速度，不要为了辞藻牺牲清晰度
- 句子以短句和中句为主，避免连续堆砌形容词、比喻和排比
- 对话要像真实人物说话，信息有效，减少空话和口号
- 每个段落都应承担功能：推进事件、制造冲突或揭示信息

【章节推进规则】
- 本章必须完成“目标 -> 阻碍 -> 行动 -> 新结果/新问题”的推进链
- 章节衔接必须自然，不要机械复述上一章最后一句或最后一幕
- 开头直接进入当前场景，不写“上一章回顾式”开场
- 非最终章结尾必须留下悬念、压力或抉择其一
${pacingInstructions}

【当前风格模板】
- 模板: ${styleSection.profileLabel}
- 说明: ${styleSection.profileDescription}
${styleSection.styleBlock}

═══════ 硬性规则 ═══════
- 只有当 is_final_chapter=true 才允许收束主线
- 若 is_final_chapter=false：严禁出现任何"完结/终章/尾声/后记/感谢读者"等收尾表达
- 每章正文字数不少于 ${minChapterWords} 字，建议控制在 ${minChapterWords}~${recommendedMaxWords} 字
- 禁止说教式总结、口号式感悟、作者视角旁白
- 结尾不要“总结陈词”，用事件/冲突/抉择直接收尾

输出格式：
- 第一行必须是章节标题：${titleText}
- 章节号必须是 ${chapterIndex}，严禁使用其他数字
- 其后是正文
- 严禁写任何解释、元说明、目标完成提示

当前是否为最终章：${isFinal ? 'true - 可以写结局' : 'false - 禁止收尾'}
`.trim();
}

/**
 * 构建章节目标部分
 */
function buildChapterGoalSection(
  params: EnhancedWriteChapterParams,
  enhancedOutline?: EnhancedChapterOutline
): string {
  if (enhancedOutline) {
    const parts: string[] = [];
    parts.push(`标题: ${enhancedOutline.title}`);
    parts.push(`主要目标: ${enhancedOutline.goal.primary}`);

    if (enhancedOutline.goal.secondary) {
      parts.push(`次要目标: ${enhancedOutline.goal.secondary}`);
    }

    if (enhancedOutline.scenes.length > 0) {
      parts.push(`场景序列: ${enhancedOutline.scenes.map((s) => s.purpose).join(' → ')}`);
    }

    parts.push(`章末钩子: [${enhancedOutline.hook.type}] ${enhancedOutline.hook.content}`);

    if (enhancedOutline.foreshadowingOps.length > 0) {
      parts.push(`伏笔操作: ${enhancedOutline.foreshadowingOps.map((f) => `${f.action}:${f.description}`).join('; ')}`);
    }

    return parts.join('\n');
  }

  return params.chapterGoalHint || '围绕本章目标推进主线冲突，制造新的障碍，结尾留下下一章必须处理的问题。';
}

/**
 * 构建传统 Prompt（兼容模式）
 */
function buildTraditionalPrompt(
  params: EnhancedWriteChapterParams,
  guide?: NarrativeGuide
): string {
  const {
    bible,
    rollingSummary,
    openLoops,
    lastChapters,
    chapterIndex,
    totalChapters,
    minChapterWords,
    chapterGoalHint,
    characters,
  } = params;

  const isFinal = chapterIndex === totalChapters;
  const normalizedSummary = normalizeRollingSummary(rollingSummary || '');

  return `
【章节信息】
- chapter_index: ${chapterIndex}
- total_chapters: ${totalChapters}
- is_final_chapter: ${isFinal}

【Story Bible（长期设定）】
${bible}

${guide ? buildNarrativeContext(guide) : ''}

【Rolling Summary（到目前为止剧情摘要）】
${normalizedSummary || '（暂无摘要）'}

【Open Loops（未解伏笔/悬念）】
${openLoops.length ? openLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（暂无）'}

【Last Chapters（近章原文）】
${lastChapters.length ? lastChapters.map((t, i) => `---近章${i + 1}---\n${t}`).join('\n\n') : '（暂无）'}

【本章写作目标】
${chapterGoalHint ?? '围绕本章目标推进主线冲突，制造新的障碍，结尾留下下一章必须处理的问题。'}

${characters ? getCharacterContext(characters, chapterIndex) : ''}

【写作注意事项】
1. 开头直接进入场景，禁止用旁白或概述开头
2. 重要对话前后要有动作/表情/心理描写，不能干巴巴地对话
3. 主角的每个行动都要有动机铺垫，不能突然做出决定
4. 配角出场时要有快速的辨识特征（外貌/语气/标志性动作）
5. 如果本章有战斗/冲突，必须有具体的招式/策略描写，不能概述
6. 章节结尾的最后一段必须是钩子场景，不能是总结或感悟
7. 展开具体场景而非概述，让读者"看到"而非"被告知"
8. 本章正文字数至少 ${normalizeMinChapterWords(minChapterWords)} 字
9. 与上一章衔接时自然进入当前场景，不要机械复述上一章末尾

请写出本章内容：
`.trim();
}

/**
 * 根据节奏获取生成温度
 */
function getTemperatureForPacing(pacingTarget: number): number {
  // 高节奏章节需要更多创意变化
  // 低节奏章节需要更稳定的输出
  if (pacingTarget >= 8) return 0.9;
  if (pacingTarget >= 6) return 0.85;
  if (pacingTarget >= 4) return 0.8;
  return 0.75;
}

/**
 * 生成摘要更新
 */
async function generateSummaryUpdate(
  aiConfig: AIConfig,
  bible: string,
  previousSummary: string,
  previousOpenLoops: string[],
  chapterText: string
): Promise<{ updatedSummary: string; updatedOpenLoops: string[] }> {
  const system = `
你是小说编辑助理。你的任务是更新剧情摘要和未解伏笔列表。
只输出严格的 JSON 格式，不要有任何其他文字。

输出格式：
{
  "longTermMemory": "长期记忆：压缩较早章节，只保留稳定设定、人物长期目标与核心因果（建议 180~320 字）",
  "midTermMemory": "中期记忆：承上启下的阶段进展与关键转折（建议 220~380 字）",
  "recentMemory": "近期记忆：最近 3~5 章的细节、冲突状态、即时动机（建议 280~520 字，信息最完整）",
  "openLoops": ["未解伏笔1", "未解伏笔2", ...] // 3~8 条，每条不超过 30 字
}
`.trim();

  const prompt = `
【Story Bible】
${bible.slice(0, 1200)}...

【此前 Rolling Summary】
${normalizeRollingSummary(previousSummary || '') || '（无）'}

【此前 Open Loops】
${previousOpenLoops.length ? previousOpenLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（无）'}

【本章原文】
${chapterText}

请按“越近越详细、越远越压缩”的原则输出更新后的 JSON。
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.2, maxTokens: 1800 }, 3);
  return parseSummaryUpdateResponse(raw, previousSummary, previousOpenLoops);
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

    if (outline) {
      for (const vol of outline.volumes || []) {
        const ch = vol.chapters?.find((c: any) => c.index === chapterIndex);
        if (ch) {
          chapterTitle = ch.title;
          chapterGoalHint = `【章节大纲】\n- 标题: ${ch.title}\n- 目标: ${ch.goal}\n- 章末钩子: ${ch.hook}`;
          break;
        }
      }
    }

    // 生成章节
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
