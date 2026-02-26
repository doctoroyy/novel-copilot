import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import { getCharacterContext } from './generateCharacters.js';
import type { CharacterRelationGraph } from './types/characters.js';
import type { CharacterStateRegistry } from './types/characterState.js';
import { buildCharacterStateContext } from './context/characterStateManager.js';
import { quickEndingHeuristic, quickChapterFormatHeuristic, buildRewriteInstruction } from './qc.js';
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
 * 章节生成参数
 */
export type WriteChapterParams = {
  /** AI 配置 */
  aiConfig: AIConfig;
  /** 摘要更新专用 AI 配置（可选，不传则复用 aiConfig） */
  summaryAiConfig?: AIConfig;
  /** Story Bible 内容 */
  bible: string;
  /** 滚动剧情摘要 */
  rollingSummary: string;
  /** 未解伏笔列表 */
  openLoops: string[];
  /** 最近 1~2 章原文 */
  lastChapters: string[];
  /** 当前章节索引 (从 1 开始) */
  chapterIndex: number;
  /** 计划总章数 */
  totalChapters: number;
  /** 每章最少字数（正文，不含标题） */
  minChapterWords?: number;
  /** 本章写作目标提示 (可选) */
  chapterGoalHint?: string;
  /** 本章标题 (来自大纲) */
  chapterTitle?: string;
  /** 正文模板配置 */
  chapterPromptProfile?: string;
  /** 正文自定义补充提示词 */
  chapterPromptCustom?: string;
  /** 最大重写次数 */
  maxRewriteAttempts?: number;
  /** 跳过摘要更新以节省 token */
  skipSummaryUpdate?: boolean;
  /** 人物关系图谱 (可选) */
  characters?: CharacterRelationGraph;
  /** 人物状态注册表 (可选, Phase 1 新增) */
  characterStates?: CharacterStateRegistry;
  /** 进度回调 */
  onProgress?: (message: string, status?: 'analyzing' | 'planning' | 'generating' | 'reviewing' | 'repairing' | 'saving' | 'updating_summary') => void;
};


/**
 * 章节生成结果
 */
export type WriteChapterResult = {
  /** 生成的章节文本 */
  chapterText: string;
  /** 更新后的滚动摘要 (可能与输入相同) */
  updatedSummary: string;
  /** 更新后的未解伏笔 (可能与输入相同) */
  updatedOpenLoops: string[];
  /** 是否触发了重写 */
  wasRewritten: boolean;
  /** 重写次数 */
  rewriteCount: number;
  /** 是否跳过了摘要更新 */
  skippedSummary: boolean;
  /** 正文生成+QC耗时（毫秒） */
  generationDurationMs: number;
  /** 摘要更新耗时（毫秒） */
  summaryDurationMs: number;
  /** 整体耗时（毫秒） */
  totalDurationMs: number;
};

/**
 * 构建 System Prompt
 */
function buildSystemPrompt(
  isFinal: boolean,
  chapterIndex: number,
  minChapterWords: number,
  chapterTitle?: string,
  chapterPromptProfile?: string,
  chapterPromptCustom?: string
): string {
  const recommendedMaxWords = buildRecommendedMaxChapterWords(minChapterWords);
  const titleText = chapterTitle
    ? `第${chapterIndex}章 ${chapterTitle}`
    : `第${chapterIndex}章 [你需要起一个创意标题]`;
  const styleSection = buildChapterPromptStyleSection(chapterPromptProfile, chapterPromptCustom);

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

【当前风格模板】
- 模板: ${styleSection.profileLabel}
- 说明: ${styleSection.profileDescription}
${styleSection.styleBlock}

═══════ 硬性规则 ═══════
- 只有当 is_final_chapter=true 才允许收束主线
- 若 is_final_chapter=false：严禁出现任何"完结/终章/尾声/后记/感谢读者/全书完"等收尾表达
- 每章正文字数不少于 ${minChapterWords} 字，建议控制在 ${minChapterWords}~${recommendedMaxWords} 字
- 禁止说教式总结、口号式感悟、作者视角旁白
- 结尾不要“总结陈词”，用事件/冲突/抉择直接收尾

输出格式：
- 第一行必须是章节标题：${titleText}
- 从第二行开始输出正文内容
- 不要输出 JSON，不要代码块，不要“以下是正文”等解释说明

当前是否为最终章：${isFinal ? 'true - 可以写结局' : 'false - 禁止收尾'}
`.trim();
}

/**
 * 构建 User Prompt
 */
function buildUserPrompt(params: Omit<WriteChapterParams, 'aiConfig'>): string {
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
    characterStates,
  } = params;

  const isFinal = chapterIndex === totalChapters;
  const normalizedSummary = normalizeRollingSummary(rollingSummary || '');

  // 构建人物状态上下文 (Phase 1 新增)
  const characterStateContext = characterStates
    ? buildCharacterStateContext(characterStates, chapterIndex, 5)
    : '';

  return `
【章节信息】
- chapter_index: ${chapterIndex}
- total_chapters: ${totalChapters}
- is_final_chapter: ${isFinal}

【Story Bible（长期设定）】
${bible}

${characterStateContext ? characterStateContext + '\n' : ''}【Rolling Summary（到目前为止剧情摘要）】
${normalizedSummary || '（暂无摘要：请根据近章原文自行推断并保持一致）'}

【Open Loops（未解伏笔/悬念，最多12条）】
${openLoops.length ? openLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（暂无）'}

【Last Chapters（近章原文，用于连续性与语气）】
${lastChapters.length ? lastChapters.map((t, i) => `---近章${i + 1}---\n${t}`).join('\n\n') : '（暂无）'}

【本章写作目标提示】
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
8. 本章正文字数必须至少 ${normalizeMinChapterWords(minChapterWords)} 字
9. 与上一章衔接时自然进入当前场景，不要机械复述上一章末尾

请写出本章内容：
`.trim();
}

function isSameAiConfig(a: AIConfig, b: AIConfig): boolean {
  return a.provider === b.provider
    && a.model === b.model
    && String(a.baseUrl || '') === String(b.baseUrl || '')
    && a.apiKey === b.apiKey;
}

/**
 * 生成单章内容
 */
export async function writeOneChapter(params: WriteChapterParams): Promise<WriteChapterResult> {
  const startedAt = Date.now();
  const {
    aiConfig,
    summaryAiConfig,
    chapterIndex,
    totalChapters,
    minChapterWords,
    maxRewriteAttempts = 2,
    skipSummaryUpdate = false,
    chapterTitle,
  } = params;
  const isFinal = chapterIndex === totalChapters;
  const normalizedMinChapterWords = normalizeMinChapterWords(minChapterWords);

  const system = buildSystemPrompt(
    isFinal,
    chapterIndex,
    normalizedMinChapterWords,
    chapterTitle,
    params.chapterPromptProfile,
    params.chapterPromptCustom
  );
  const prompt = buildUserPrompt(params);
  const generationStartedAt = Date.now();

  // 第一次生成
  params.onProgress?.('正在生成正文...', 'generating');
  const rawResponse = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.85 });
  
  let chapterText = parseChapterResponse(rawResponse, chapterIndex);

  let wasRewritten = false;
  let rewriteCount = 0;

  // QC 检测：结构（标题+正文）+ 非最终章提前完结检测
  for (let attempt = 0; attempt < maxRewriteAttempts; attempt++) {
    params.onProgress?.(`正在进行 QC 检测 (${attempt + 1}/${maxRewriteAttempts})...`, 'reviewing');
    const formatQc = quickChapterFormatHeuristic(chapterText, { minBodyChars: normalizedMinChapterWords });
    const endingQc = isFinal ? { hit: false, reasons: [] as string[] } : quickEndingHeuristic(chapterText);
    const reasons = [...formatQc.reasons, ...endingQc.reasons];

    if (reasons.length === 0) {
      break; // 通过 QC
    }

    console.log(`⚠️ 章节 ${chapterIndex} 检测到 QC 异常信号，尝试重写 (${attempt + 1}/${maxRewriteAttempts})`);
    console.log(`   原因: ${reasons.join('; ')}`);
    
    params.onProgress?.(`检测到问题: ${reasons[0]}，正在修复...`, 'repairing');

    // 构建重写 prompt
    const rewriteInstruction = buildRewriteInstruction({
      chapterIndex,
      totalChapters,
      reasons,
      isFinalChapter: isFinal,
      minChapterWords: normalizedMinChapterWords,
    });

    const rewritePrompt = `${prompt}\n\n${rewriteInstruction}`;
    const rawRewriteResponse = await generateTextWithRetry(aiConfig, { system, prompt: rewritePrompt, temperature: 0.8 });
    chapterText = parseChapterResponse(rawRewriteResponse, chapterIndex);
    wasRewritten = true;
    rewriteCount++;
  }

  // 最终检查
  const finalFormatQc = quickChapterFormatHeuristic(chapterText, { minBodyChars: normalizedMinChapterWords });
  const finalEndingQc = isFinal ? { hit: false, reasons: [] as string[] } : quickEndingHeuristic(chapterText);
  const finalReasons = [...finalFormatQc.reasons, ...finalEndingQc.reasons];
  if (finalReasons.length > 0) {
    const reason = finalReasons[0] || '章节内容疑似不完整';
    console.log(`❌ 章节 ${chapterIndex} 重写后仍存在 QC 问题，需要人工介入`);
    params.onProgress?.(`QC 未通过: ${reason}`, 'reviewing');
    throw new Error(`第 ${chapterIndex} 章 QC 未通过: ${reason}`);
  }
  const generationDurationMs = Date.now() - generationStartedAt;

  // 是否跳过摘要更新
  let updatedSummary = params.rollingSummary;
  let updatedOpenLoops = params.openLoops;
  let skippedSummary = true;
  let summaryDurationMs = 0;

  if (!skipSummaryUpdate) {
    // Phase 4: 更新摘要 (Add status update to UI)
    params.onProgress?.('正在更新剧情摘要...', 'updating_summary');
    const summaryStartedAt = Date.now();
    const summaryCandidates: AIConfig[] = [summaryAiConfig || aiConfig];
    if (summaryAiConfig && !isSameAiConfig(summaryAiConfig, aiConfig)) {
      summaryCandidates.push(aiConfig);
    }

    try {
      let summaryResult: { updatedSummary: string; updatedOpenLoops: string[] } | null = null;
      let lastSummaryError: Error | null = null;

      for (let i = 0; i < summaryCandidates.length; i++) {
        const candidate = summaryCandidates[i];
        try {
          summaryResult = await generateSummaryUpdate(
            candidate,
            params.bible,
            params.rollingSummary,
            params.openLoops,
            chapterText
          );
          break;
        } catch (err) {
          lastSummaryError = err as Error;
          console.warn(
            `[SummaryUpdate] 第 ${chapterIndex} 章摘要更新候选模型失败 (${candidate.provider}/${candidate.model}):`,
            lastSummaryError.message
          );
        }
      }

      if (!summaryResult) {
        throw lastSummaryError || new Error('摘要更新失败');
      }

      updatedSummary = summaryResult.updatedSummary;
      updatedOpenLoops = summaryResult.updatedOpenLoops;
      skippedSummary = false;
    } catch (summaryError) {
      // 摘要更新失败不应导致整章失败：保留上一版记忆并继续保存章节正文
      console.warn(
        `[SummaryUpdate] 第 ${chapterIndex} 章摘要更新最终失败，已保留上一版摘要:`,
        (summaryError as Error).message
      );
      params.onProgress?.('剧情摘要更新失败，已保留上一版摘要（下一章将优先重试）', 'updating_summary');
      skippedSummary = true;
    } finally {
      summaryDurationMs = Date.now() - summaryStartedAt;
    }
  }

  const totalDurationMs = Date.now() - startedAt;

  return {
    chapterText,
    updatedSummary,
    updatedOpenLoops,
    wasRewritten,
    rewriteCount,
    skippedSummary,
    generationDurationMs,
    summaryDurationMs,
    totalDurationMs,
  };
}

/**
 * 生成更新后的滚动摘要和未解伏笔
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

  const raw = await generateTextWithRetry(
    aiConfig,
    { system, prompt, temperature: 0.2, maxTokens: 1800 },
    3
  );
  return parseSummaryUpdateResponse(raw, previousSummary, previousOpenLoops);
}

/**
 * 解析章节生成响应 (JSON -> Text)
 */
function parseChapterResponse(rawResponse: string, chapterIndex: number): string {
  return normalizeGeneratedChapterText(rawResponse, chapterIndex);
}
