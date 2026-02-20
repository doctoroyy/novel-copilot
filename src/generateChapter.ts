import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import { getCharacterContext } from './generateCharacters.js';
import type { CharacterRelationGraph } from './types/characters.js';
import type { CharacterStateRegistry } from './types/characterState.js';
import { buildCharacterStateContext } from './context/characterStateManager.js';
import { quickEndingHeuristic, quickChapterFormatHeuristic, buildRewriteInstruction } from './qc.js';
import { normalizeGeneratedChapterText } from './utils/chapterText.js';
import { normalizeRollingSummary, parseSummaryUpdateResponse } from './utils/rollingSummary.js';

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
  /** 本章写作目标提示 (可选) */
  chapterGoalHint?: string;
  /** 本章标题 (来自大纲) */
  chapterTitle?: string;
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
function buildSystemPrompt(isFinal: boolean, chapterIndex: number, chapterTitle?: string): string {
  const titleText = chapterTitle 
    ? `第${chapterIndex}章 ${chapterTitle}` 
    : `第${chapterIndex}章 [你需要起一个创意标题]`;
    
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

═══════ 硬性规则 ═══════
- 只有当 is_final_chapter=true 才允许收束主线
- 若 is_final_chapter=false：严禁出现任何"完结/终章/尾声/后记/感谢读者/全书完"等收尾表达
- 每章字数 2500~3500 汉字
- 禁止说教式总结（如"他知道这只是开始"/"从此走上了xxx之路"）
- 禁止上帝视角旁白（如"命运的齿轮开始转动"/"历史的车轮滚滚向前"）
- 结尾不要用总结句，直接用钩子场景收尾
- 开头直接进入场景，禁止用概述或旁白开头

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
${chapterGoalHint ?? '承接上一章结尾，推进主线一步，并制造更大的危机；结尾留强钩子。'}

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
 * 生成单章内容
 */
export async function writeOneChapter(params: WriteChapterParams): Promise<WriteChapterResult> {
  const startedAt = Date.now();
  const { aiConfig, summaryAiConfig, chapterIndex, totalChapters, maxRewriteAttempts = 2, skipSummaryUpdate = false, chapterTitle } = params;
  const isFinal = chapterIndex === totalChapters;

  const system = buildSystemPrompt(isFinal, chapterIndex, chapterTitle);
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
    const formatQc = quickChapterFormatHeuristic(chapterText);
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
    });

    const rewritePrompt = `${prompt}\n\n${rewriteInstruction}`;
    const rawRewriteResponse = await generateTextWithRetry(aiConfig, { system, prompt: rewritePrompt, temperature: 0.8 });
    chapterText = parseChapterResponse(rawRewriteResponse, chapterIndex);
    wasRewritten = true;
    rewriteCount++;
  }

  // 最终检查
  const finalFormatQc = quickChapterFormatHeuristic(chapterText);
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

    try {
      // 生成更新后的摘要和伏笔
      const summaryResult = await generateSummaryUpdate(
        summaryAiConfig || aiConfig,
        params.bible,
        params.rollingSummary,
        params.openLoops,
        chapterText
      );
      updatedSummary = summaryResult.updatedSummary;
      updatedOpenLoops = summaryResult.updatedOpenLoops;
      skippedSummary = false;
    } catch (summaryError) {
      // 摘要更新失败不应导致整章失败：保留上一版记忆并继续保存章节正文
      console.warn(
        `[SummaryUpdate] 第 ${chapterIndex} 章摘要更新失败，已保留上一版摘要:`,
        (summaryError as Error).message
      );
      params.onProgress?.('剧情摘要更新失败，已保留上一版摘要', 'updating_summary');
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
    { system, prompt, temperature: 0.2, maxTokens: 1000 },
    2
  );
  return parseSummaryUpdateResponse(raw, previousSummary, previousOpenLoops);
}

/**
 * 解析章节生成响应 (JSON -> Text)
 */
function parseChapterResponse(rawResponse: string, chapterIndex: number): string {
  return normalizeGeneratedChapterText(rawResponse, chapterIndex);
}
