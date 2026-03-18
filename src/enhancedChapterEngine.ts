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

import { generateTextWithFallback, generateTextWithRetry, type AIConfig, type FallbackConfig, AICallTracer, type AICallTrace, type AICallOptions } from './services/aiClient.js';
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
} from './context/plotManager.js';
import {
  generateNarrativeGuide,
  generateNarrativeArc,
  buildNarrativeContext,
} from './narrative/pacingController.js';
import {
  runMultiDimensionalQC,
  type QCResult,
} from './qc/multiDimensionalQC.js';
import { repairChapter } from './qc/repairLoop.js';
import { buildOptimizedContext, getContextStats } from './contextOptimizer.js';
import {
  quickEndingHeuristic,
  quickChapterFormatHeuristic,
  buildRewriteInstruction,
  judgeQuickChapterSignals,
} from './qc.js';
import {
  analyzeChapterForEvents,
  applyEventAnalysis,
  getCharacterNameMap,
  checkEventDuplication,
} from './context/timelineManager.js';
import { normalizeGeneratedChapterText } from './utils/chapterText.js';
import { buildChapterMemoryDigest } from './utils/chapterMemoryDigest.js';
import { DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS, getSupportPassMaxTokens } from './utils/aiModelHelpers.js';
import { buildEnhancedOutlineFromChapterContext, getOutlineChapterContext, type OutlineChapterContext } from './utils/outline.js';
import { normalizeRollingSummary, parseSummaryUpdateResponse } from './utils/rollingSummary.js';
import { formatStoryContractForPrompt } from './utils/storyContract.js';
import { buildChapterPromptStyleSection } from './chapterPromptProfiles.js';
import { writeChapterWithAgent } from './agent/agentChapterEngine.js';
import { z } from 'zod';

const DEFAULT_MIN_CHAPTER_WORDS = 2500;
const MIN_CHAPTER_WORDS_LIMIT = 500;
const MAX_CHAPTER_WORDS_LIMIT = 20000;
const PLAN_MAX_TOKENS = 700;
const SELF_REVIEW_MAX_TOKENS = 500;
const SUMMARY_UPDATE_MAX_TOKENS = 1200;
const PLANNING_CALL_TIMEOUT_MS = 90 * 1000;
const PLANNING_CALL_MAX_RETRIES = 2;

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

const PlanSchema = z.object({
  scenePlan: z.array(z.object({
    purpose: z.string().min(2),
    conflict: z.string().min(2),
    newInfo: z.string().min(2),
  })).min(2).max(6),
  continuityChecks: z.array(z.string()).max(8),
  avoidRepeats: z.array(z.string()).max(8),
});

const SelfReviewSchema = z.object({
  action: z.enum(['keep', 'rewrite']),
  issues: z.array(z.string()).max(6),
  guidance: z.string().max(300).optional(),
});

type ChapterPlan = z.infer<typeof PlanSchema>;
type SelfReview = z.infer<typeof SelfReviewSchema>;

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
  /** 自定义系统级核心设定 */
  customSystemPrompt?: string | null;
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
  /** 卷级大纲上下文（用于上下文注入） */
  outlineContext?: OutlineChapterContext | null;
  /** 上一章的节奏值（用于平滑） */
  previousPacing?: number;

  // ========== 配置选项 ==========
  /** 启用上下文优化 */
  enableContextOptimization?: boolean;
  /** 启用多维度 QC */
  enableFullQC?: boolean;
  /** 启用自动修复 */
  enableAutoRepair?: boolean;
  /** 启用章节规划（ReAct 风格） */
  enablePlanning?: boolean;
  /** 启用自检复写（ReAct 风格） */
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
  /** Agent 最大推理轮次（默认 4） */
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

function buildFallbackConfig(primary: AIConfig, fallbackConfigs?: AIConfig[]): FallbackConfig {
  return {
    primary,
    fallback: fallbackConfigs?.filter((candidate) => !isSameAiConfig(candidate, primary)),
    switchConditions: ['rate_limit', 'server_error', 'timeout', 'unknown'] as FallbackConfig['switchConditions'],
  };
}

function estimateTokens(text: string | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 2);
}

function getEnhancedSupportPassMaxTokens(
  aiConfig: AIConfig,
  kind: 'planning' | 'selfReview' | 'summary'
): number {
  if (kind === 'planning') return getSupportPassMaxTokens(aiConfig, PLAN_MAX_TOKENS, 1800);
  if (kind === 'selfReview') return getSupportPassMaxTokens(aiConfig, SELF_REVIEW_MAX_TOKENS, 1200);
  return getSupportPassMaxTokens(aiConfig, SUMMARY_UPDATE_MAX_TOKENS, 1800);
}

async function generateChapterDraft(
  aiConfig: AIConfig,
  fallbackConfigs: AIConfig[] | undefined,
  args: {
    system: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  },
  callOptions?: AICallOptions
): Promise<string> {
  if (fallbackConfigs?.length) {
    return generateTextWithFallback(buildFallbackConfig(aiConfig, fallbackConfigs), args, 2, callOptions);
  }
  return generateTextWithRetry(aiConfig, args, 3, callOptions);
}

/**
 * 增强版章节生成（始终使用 Agent 模式）
 */
export async function writeEnhancedChapter(
  params: EnhancedWriteChapterParams
): Promise<EnhancedWriteChapterResult> {
  return writeChapterWithAgent(params);
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
- 严格控制句长：正文单句不超过 30 字，对话单句不超过 40 字。超出必须断句。禁止连续堆砌形容词、比喻和排比
- 对话要像真实人物说话，信息有效，减少空话和口号
- 每个段落都应承担功能：推进事件、制造冲突或揭示信息

【章节推进规则】
- 本章必须完成“目标 -> 阻碍 -> 行动 -> 新结果/新问题”的推进链
- 章节衔接必须自然，不要机械复述上一章最后一句或最后一幕
- 开头直接进入当前场景，不写“上一章回顾式”开场
- 非最终章结尾必须留下悬念、压力或抉择其一
- 先在心里做一个简短计划，再动笔；计划与自检不要输出
- 主动核对上下文与时间线，避免重复已发生的情节或改写复述
- 如发现自相矛盾或节奏失衡，自行修正后再输出正文
- 单章只保留 1 个主危机，可附带 1 个副事件；其他冲突只埋钩子，不并发展开
- 若上一章刚经历大战、异象、绑架或世界观升级，本章必须先处理余波、代价与角色反应，再切入新线
- 除非大纲明确要求，禁止突然引入比当前主线更高一级的敌人、世界观或能力展示

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
  const parts: string[] = [];

  if (enhancedOutline) {
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

    parts.push(...formatStoryContractForPrompt(enhancedOutline.storyContract));
  }

  // 如果 chapterGoalHint 包含卷桥接上下文，追加到目标中
  if (params.chapterGoalHint) {
    const bridgeMarkers = ['【本卷目标】', '【本卷核心冲突】', '【卷切换桥接上下文】', '【衔接要求】', '【上卷结局】'];
    const hasBridgeContent = bridgeMarkers.some(marker => params.chapterGoalHint!.includes(marker));
    if (hasBridgeContent) {
      const bridgeSections = params.chapterGoalHint
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
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
      return params.chapterGoalHint;
    }
  }

  if (parts.length === 0) {
    return '围绕本章目标推进主线冲突，制造新的障碍，结尾留下下一章必须处理的问题。';
  }
  return parts.join('\n');
}

/**
 * 构建传统 Prompt（兼容模式）
 */
function buildTraditionalPrompt(
  params: EnhancedWriteChapterParams,
  guide?: NarrativeGuide,
  chapterPlanText?: string
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

${chapterPlanText ? `【章节计划（内部参考，勿复述）】\n${chapterPlanText}\n\n` : ''}【本章写作目标】
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
10. 本章只展开 1 个主危机，可附带 1 个副事件；其余线索只埋伏笔不并发推进
11. 若上一章刚经历大战、异象、绑架或世界观升级，本章必须先写余波、代价或人物反应，再切入新事件

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

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function isSameAiConfig(a: AIConfig, b: AIConfig): boolean {
  return a.provider === b.provider
    && a.model === b.model
    && String(a.baseUrl || '') === String(b.baseUrl || '')
    && a.apiKey === b.apiKey;
}

function buildPlanningContext(
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
  } = params;

  const lastChapterSnippet = lastChapters.length
    ? clipText(lastChapters[lastChapters.length - 1], 1200)
    : '（暂无）';

  return `
【章节信息】
- chapter_index: ${chapterIndex}
- total_chapters: ${totalChapters}

【核心设定】
${clipText(bible, 2000)}

${guide ? buildNarrativeContext(guide) : ''}

【剧情摘要】
${clipText(rollingSummary || '（暂无摘要）', 1800)}

【未解伏笔】
${openLoops.length ? openLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（暂无）'}

【上一章片段】
${lastChapterSnippet}
`.trim();
}

function formatChapterPlan(plan: ChapterPlan): string {
  const sceneLines = plan.scenePlan.map((scene, index) =>
    `场景${index + 1}: 目的=${scene.purpose}｜冲突=${scene.conflict}｜新信息=${scene.newInfo}`
  );

  const continuity = plan.continuityChecks.length
    ? plan.continuityChecks.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '（无）';

  const avoidRepeats = plan.avoidRepeats.length
    ? plan.avoidRepeats.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : '（无）';

  return `${sceneLines.join('\n')}\n连贯性核对:\n${continuity}\n避免重复:\n${avoidRepeats}`;
}

async function generateChapterPlan(
  aiConfig: AIConfig,
  fallbackConfigs: AIConfig[] | undefined,
  context: string,
  chapterGoal: string,
  callOptions?: AICallOptions
): Promise<string | undefined> {
  const planningCallOptions: AICallOptions = {
    ...callOptions,
    timeoutMs: callOptions?.timeoutMs ?? PLANNING_CALL_TIMEOUT_MS,
    maxRetries: callOptions?.maxRetries ?? PLANNING_CALL_MAX_RETRIES,
  };
  const system = `
你是小说策划助手。请基于上下文给出本章写作计划。
只输出严格的 JSON，不要输出任何其他文字。

输出格式：
{
  "scenePlan": [
    {"purpose": "场景目的", "conflict": "主要冲突", "newInfo": "本场景引入的新信息"},
    ...
  ],
  "continuityChecks": ["需要核对的连续性点1", "点2", ...],
  "avoidRepeats": ["需要避免重复的情节/信息1", "2", ...]
}
`.trim();

  const prompt = `
【上下文】
${context}

【本章写作目标】
${chapterGoal}

请输出 JSON：`.trim();

  const raw = await generateChapterDraft(aiConfig, fallbackConfigs, {
    system,
    prompt,
    temperature: 0.4,
    maxTokens: getEnhancedSupportPassMaxTokens(aiConfig, 'planning'),
  }, planningCallOptions);
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const plan = PlanSchema.parse(JSON.parse(jsonText));
    return formatChapterPlan(plan);
  } catch (error) {
    console.warn('Failed to parse chapter plan JSON:', (error as Error).message, jsonText.slice(0, 200));
    return undefined;
  }
}

function getEventDuplicationWarnings(
  chapterText: string,
  timeline?: TimelineState,
  characters?: CharacterRelationGraph,
  characterStates?: CharacterStateRegistry
): string[] {
  if (!timeline || timeline.events.length === 0) return [];
  const characterNameMap = getCharacterNameMap(characters, characterStates);
  const duplicationCheck = checkEventDuplication(chapterText, timeline, characterNameMap);
  return duplicationCheck.hasDuplication ? duplicationCheck.warnings : [];
}

async function runSelfReview(
  aiConfig: AIConfig,
  fallbackConfigs: AIConfig[] | undefined,
  context: string,
  chapterText: string,
  duplicationWarnings: string[],
  callOptions?: AICallOptions
): Promise<SelfReview> {
  const system = `
你是小说编辑审阅助手。请检查章节是否存在**严重**的质量问题。
只输出严格的 JSON，不要输出任何其他文字。

判断标准：
- 选择 "rewrite" 仅限于以下严重问题：情节与上下文**明确矛盾**、大段落**逐字重复**、角色行为严重失控
- 以下问题**不应触发重写**：轻微节奏不均、措辞可优化、细节略有瑕疵、对话风格偏差
- 如果问题只是"可以更好"而非"必须修复"，请选择 "keep"
- 重写代价很高（需要重新生成全文），请谨慎判断

输出格式：
{
  "action": "keep" | "rewrite",
  "issues": ["问题1", "问题2", ...],
  "guidance": "如果需要重写，给出简短可执行的修订指引"
}
`.trim();

  const prompt = `
【上下文】
${context}

【事件重复提示】
${duplicationWarnings.length ? duplicationWarnings.map((w, i) => `${i + 1}. ${w}`).join('\n') : '（无）'}

【章节正文】
${chapterText}

请输出 JSON：`.trim();

  const raw = await generateChapterDraft(aiConfig, fallbackConfigs, {
    system,
    prompt,
    temperature: 0.2,
    maxTokens: getEnhancedSupportPassMaxTokens(aiConfig, 'selfReview'),
  }, callOptions);
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const result = SelfReviewSchema.parse(JSON.parse(jsonText));
    console.log(`[SelfReview] action=${result.action}, issues=${result.issues.length}: ${result.issues.join('; ').slice(0, 200)}`);
    return result;
  } catch (error) {
    console.warn('Failed to parse self-review JSON:', (error as Error).message, jsonText.slice(0, 200));
    return { action: 'keep', issues: [], guidance: '' };
  }
}

/**
 * 生成摘要更新
 */
async function generateSummaryUpdate(
  aiConfig: AIConfig,
  fallbackConfigs: AIConfig[] | undefined,
  bible: string,
  previousSummary: string,
  previousOpenLoops: string[],
  chapterText: string,
  callOptions?: AICallOptions
): Promise<{ updatedSummary: string; updatedOpenLoops: string[]; sourceChars: number }> {
  const summarySource = buildChapterMemoryDigest(chapterText, DEFAULT_CHAPTER_MEMORY_DIGEST_MAX_CHARS);
  const system = `
你是小说编辑助理。你的任务是更新剧情摘要和未解伏笔列表。
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
}
`.trim();

  const prompt = `
【Story Bible】
${bible}

【此前 Rolling Summary】
${normalizeRollingSummary(previousSummary || '') || '（无）'}

【此前 Open Loops】
${previousOpenLoops.length ? previousOpenLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（无）'}

【本章压缩摘录（非全文，按开场/中段/结尾抽取）】
${summarySource}

请按”越近越详细、越远越压缩”的原则输出更新后的 JSON。注意：三个层级都必须有内容变化。
`.trim();

  const raw = await generateChapterDraft(aiConfig, fallbackConfigs, {
    system,
    prompt,
    temperature: 0.2,
    maxTokens: getEnhancedSupportPassMaxTokens(aiConfig, 'summary'),
  }, callOptions);
  return {
    ...parseSummaryUpdateResponse(raw, previousSummary, previousOpenLoops),
    sourceChars: summarySource.length,
  };
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
      enhancedOutline,
      outlineContext: outlineContext ?? undefined,
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
