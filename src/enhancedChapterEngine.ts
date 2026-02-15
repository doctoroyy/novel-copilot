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
import { quickEndingHeuristic, buildRewriteInstruction } from './qc.js';
import {
  analyzeChapterForEvents,
  applyEventAnalysis,
  getCharacterNameMap,
  checkEventDuplication,
} from './context/timelineManager.js';
import { normalizeGeneratedChapterText } from './utils/chapterText.js';
import { z } from 'zod';

/**
 * 生成后的更新数据 Schema
 */
const UpdateSchema = z.object({
  rollingSummary: z.string().min(10),
  openLoops: z.array(z.string()).max(12),
});

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
  /** 本章写作目标提示 */
  chapterGoalHint?: string;
  /** 本章标题 */
  chapterTitle?: string;
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
  } = params;

  const isFinal = chapterIndex === totalChapters;

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
  const system = buildEnhancedSystemPrompt(isFinal, chapterIndex, chapterTitle, narrativeGuide);

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

  // 5. 快速 QC 检测（提前完结）
  if (!isFinal) {
    for (let attempt = 0; attempt < maxRewriteAttempts; attempt++) {
      params.onProgress?.(`正在进行 QC 检测 (${attempt + 1}/${maxRewriteAttempts})...`, 'reviewing');
      const qcResult = quickEndingHeuristic(chapterText);

      if (!qcResult.hit) break;

      console.log(`⚠️ 章节 ${chapterIndex} 检测到提前完结信号，尝试重写 (${attempt + 1}/${maxRewriteAttempts})`);
      
      params.onProgress?.(`检测到问题: ${qcResult.reasons[0]}，正在修复...`, 'repairing');

      const rewriteInstruction = buildRewriteInstruction({
        chapterIndex,
        totalChapters,
        reasons: qcResult.reasons,
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
    const summaryResult = await generateSummaryUpdate(
      aiConfig,
      bible,
      params.rollingSummary,
      chapterText
    );
    updatedSummary = summaryResult.updatedSummary;
    updatedOpenLoops = summaryResult.updatedOpenLoops;
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
  chapterTitle?: string,
  guide?: NarrativeGuide
): string {
  const titleText = chapterTitle
    ? `第${chapterIndex}章 ${chapterTitle}`
    : `第${chapterIndex}章 [你需要起一个创意标题]`;

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
你是一个起点白金级网文写作引擎，输出的文字必须达到商业连载的头部水准。

═══════ 核心写作方法论 ═══════

【场景化叙事 - 禁止概述式写作】
- 每个情节点必须展开为具体场景：有时间、地点、人物动作、对话
- 禁止"他花了三天修炼，实力大进"这种概述句，必须展开关键场景用细节体现
- 描写比例：场景描写 > 60%，叙述概括 < 20%，心理活动 < 20%

【感官沉浸 - 五感写作法】
- 每个重要场景至少调动 3 种感官（视觉/听觉/触觉/嗅觉/味觉）
- 战斗：金属碰撞的震鸣→骨骼断裂的脆响→血腥味→剧烈疼痛
- 修炼：灵气如针刺入经脉→丹田灼热翻涌→周身骨骼噼啪作响
- 日常：食物香气→微风触感→环境音效→光影变化

【对话设计 - 声线分化】
- 每个角色必须有辨识度极高的说话方式（用词习惯、语气、口头禅）
- 对话必须推动剧情或揭示性格，禁止废话对白
- 潜台词运用：角色真实想法 ≠ 说出口的话，制造张力
- 冲突对话要有攻防节奏，不能一方碾压式说教
- 重要对话前后加动作/表情/心理描写，不能干巴巴对话

【爽点工程 - 期待→满足→超预期】
- 建立期待：先铺垫困难/危机/压力，让读者为主角担心
- 延迟满足：不要让主角太快解决问题，拉扯出紧张感
- 超预期爆发：解决方式要出人意料，比读者想象的更精彩
- 每章至少 1 个小爽点，每 3-5 章安排 1 个大爽点

【微观节奏控制】
- 紧张段落：短句、短段落、动作密集、对话急促
- 舒缓段落：长句、环境描写、内心独白、情感流动
- 高潮段落：极短句 + 感叹号 + 断句，制造紧迫感
- 章节内必须有 2-3 次节奏变化，避免一平到底

【章末钩子（必须使用其中一种）】
- 反转钩：推翻读者预期（"然而他不知道，那个人其实是..."）
- 悬念钩：抛出新谜团（"门外传来了不该出现在这里的声音"）
- 危机钩：新的更大危险出现（"整座城，开始颤抖"）
- 揭示钩：关键信息半遮半露（"那卷轴上的名字，他认识"）
- 选择钩：主角面临艰难抉择（"左边是她，右边是天下"）
${pacingInstructions}

═══════ 硬性规则 ═══════
- 只有当 is_final_chapter=true 才允许收束主线
- 若 is_final_chapter=false：严禁出现任何"完结/终章/尾声/后记/感谢读者"等收尾表达
- 每章字数 ${guide?.wordCountRange?.[0] || 2500}~${guide?.wordCountRange?.[1] || 3500} 汉字
- 禁止说教式总结（如"他知道这只是开始"/"从此走上了xxx之路"）
- 禁止上帝视角旁白（如"命运的齿轮开始转动"/"历史的车轮滚滚向前"）
- 结尾不要用总结句，直接用钩子场景收尾
- 开头直接进入场景，禁止用概述或旁白开头

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

  return params.chapterGoalHint || '承接上一章结尾，推进主线，制造危机，结尾留强钩子。';
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
    chapterGoalHint,
    characters,
  } = params;

  const isFinal = chapterIndex === totalChapters;

  return `
【章节信息】
- chapter_index: ${chapterIndex}
- total_chapters: ${totalChapters}
- is_final_chapter: ${isFinal}

【Story Bible（长期设定）】
${bible}

${guide ? buildNarrativeContext(guide) : ''}

【Rolling Summary（到目前为止剧情摘要）】
${rollingSummary || '（暂无摘要）'}

【Open Loops（未解伏笔/悬念）】
${openLoops.length ? openLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（暂无）'}

【Last Chapters（近章原文）】
${lastChapters.length ? lastChapters.map((t, i) => `---近章${i + 1}---\n${t}`).join('\n\n') : '（暂无）'}

【本章写作目标】
${chapterGoalHint ?? '承接上一章，推进主线，制造危机，结尾留强钩子。'}

${characters ? getCharacterContext(characters, chapterIndex) : ''}

【写作注意事项】
1. 开头直接进入场景，禁止用旁白或概述开头
2. 重要对话前后要有动作/表情/心理描写，不能干巴巴地对话
3. 主角的每个行动都要有动机铺垫，不能突然做出决定
4. 配角出场时要有快速的辨识特征（外貌/语气/标志性动作）
5. 如果本章有战斗/冲突，必须有具体的招式/策略描写，不能概述
6. 章节结尾的最后一段必须是钩子场景，不能是总结或感悟
7. 展开具体场景而非概述，让读者"看到"而非"被告知"

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
  chapterText: string
): Promise<{ updatedSummary: string; updatedOpenLoops: string[] }> {
  const system = `
你是小说编辑助理。你的任务是更新剧情摘要和未解伏笔列表。
只输出严格的 JSON 格式，不要有任何其他文字。

输出格式：
{
  "rollingSummary": "用 800~1500 字总结到本章为止的剧情（强调人物状态变化、关键因果、目前局势）",
  "openLoops": ["未解伏笔1", "未解伏笔2", ...] // 5~12 条，每条不超过 30 字
}
`.trim();

  const prompt = `
【Story Bible】
${bible.slice(0, 2000)}...

【此前 Rolling Summary】
${previousSummary || '（无）'}

【本章原文】
${chapterText}

请输出更新后的 JSON：
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.2 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const parsed = UpdateSchema.parse(JSON.parse(jsonText));
    return {
      updatedSummary: parsed.rollingSummary,
      updatedOpenLoops: parsed.openLoops,
    };
  } catch {
    return {
      updatedSummary: previousSummary,
      updatedOpenLoops: [],
    };
  }
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
