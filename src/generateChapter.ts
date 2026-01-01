import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import { getCharacterContext } from './generateCharacters.js';
import type { CharacterRelationGraph } from './types/characters.js';
import type { CharacterStateRegistry } from './types/characterState.js';
import { buildCharacterStateContext } from './context/characterStateManager.js';
import { quickEndingHeuristic, buildRewriteInstruction } from './qc.js';
import { z } from 'zod';

/**
 * 生成后的更新数据 Schema
 */
const UpdateSchema = z.object({
  rollingSummary: z.string().min(10),
  openLoops: z.array(z.string()).max(12),
});

/**
 * 章节生成参数
 */
export type WriteChapterParams = {
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
};

/**
 * 构建 System Prompt
 */
function buildSystemPrompt(isFinal: boolean, chapterIndex: number, chapterTitle?: string): string {
  const titleText = chapterTitle 
    ? `第${chapterIndex}章 ${chapterTitle}` 
    : `第${chapterIndex}章 [你需要起一个创意标题]`;
    
  return `
你是一个"稳定连载"的网文写作引擎。

硬性规则：
- 只有当 is_final_chapter=true 才允许收束主线、写结局、尾声、后记
- 若 is_final_chapter=false：严禁出现任何"完结/终章/尾声/后记/感谢读者/全书完/总结人生"等收尾表达
- 每章必须推进冲突，并以强钩子结尾（引出下一章危机/反转/新线索）
- 每章字数建议 2500~3500 汉字

输出格式：
- 第一行必须是章节标题：${titleText}
- 章节号必须是 ${chapterIndex}，**严禁使用其他数字**
- 其后是正文
- **严禁**写任何解释、元说明、目标完成提示
- **严禁**在正文中出现如下内容：【本章写作目标】、【已完成】、（本章结束）等任何形式的编辑备注

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
${rollingSummary || '（暂无摘要：请根据近章原文自行推断并保持一致）'}

【Open Loops（未解伏笔/悬念，最多12条）】
${openLoops.length ? openLoops.map((x, i) => `${i + 1}. ${x}`).join('\n') : '（暂无）'}

【Last Chapters（近章原文，用于连续性与语气）】
${lastChapters.length ? lastChapters.map((t, i) => `---近章${i + 1}---\n${t}`).join('\n\n') : '（暂无）'}

【本章写作目标提示】
${chapterGoalHint ?? '承接上一章结尾，推进主线一步，并制造更大的危机；结尾留强钩子。'}

${characters ? getCharacterContext(characters, chapterIndex) : ''}

请写出本章内容：
`.trim();
}

/**
 * 生成单章内容
 */
export async function writeOneChapter(params: WriteChapterParams): Promise<WriteChapterResult> {
  const { aiConfig, chapterIndex, totalChapters, maxRewriteAttempts = 2, skipSummaryUpdate = false, chapterTitle } = params;
  const isFinal = chapterIndex === totalChapters;

  const system = buildSystemPrompt(isFinal, chapterIndex, chapterTitle);
  const prompt = buildUserPrompt(params);

  // 第一次生成
  let chapterText = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.85 });
  let wasRewritten = false;
  let rewriteCount = 0;

  // QC 检测：非最终章检测提前完结
  if (!isFinal) {
    for (let attempt = 0; attempt < maxRewriteAttempts; attempt++) {
      const qcResult = quickEndingHeuristic(chapterText);

      if (!qcResult.hit) {
        break; // 通过 QC
      }

      console.log(`⚠️ 章节 ${chapterIndex} 检测到提前完结信号，尝试重写 (${attempt + 1}/${maxRewriteAttempts})`);
      console.log(`   原因: ${qcResult.reasons.join('; ')}`);

      // 构建重写 prompt
      const rewriteInstruction = buildRewriteInstruction({
        chapterIndex,
        totalChapters,
        reasons: qcResult.reasons,
      });

      const rewritePrompt = `${prompt}\n\n${rewriteInstruction}`;
      chapterText = await generateTextWithRetry(aiConfig, { system, prompt: rewritePrompt, temperature: 0.8 });
      wasRewritten = true;
      rewriteCount++;
    }

    // 最终检查
    const finalQc = quickEndingHeuristic(chapterText);
    if (finalQc.hit) {
      console.log(`❌ 章节 ${chapterIndex} 重写后仍检测到提前完结信号，需要人工介入`);
    }
  }

  // 是否跳过摘要更新
  let updatedSummary = params.rollingSummary;
  let updatedOpenLoops = params.openLoops;
  let skippedSummary = true;

  if (!skipSummaryUpdate) {
    // 生成更新后的摘要和伏笔
    const summaryResult = await generateSummaryUpdate(
      aiConfig,
      params.bible,
      params.rollingSummary,
      chapterText
    );
    updatedSummary = summaryResult.updatedSummary;
    updatedOpenLoops = summaryResult.updatedOpenLoops;
    skippedSummary = false;
  }

  return {
    chapterText,
    updatedSummary,
    updatedOpenLoops,
    wasRewritten,
    rewriteCount,
    skippedSummary,
  };
}

/**
 * 生成更新后的滚动摘要和未解伏笔
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

  // 容错：去掉可能的代码块标记
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const parsed = UpdateSchema.parse(JSON.parse(jsonText));
    return {
      updatedSummary: parsed.rollingSummary,
      updatedOpenLoops: parsed.openLoops,
    };
  } catch (error) {
    console.warn('Summary update parsing failed, using fallback');
    return {
      updatedSummary: previousSummary,
      updatedOpenLoops: [],
    };
  }
}
