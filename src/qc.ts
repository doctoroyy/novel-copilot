/**
 * 提前完结检测 - 质量控制模块
 */

import { z } from 'zod';
import {
  generateTextWithFallback,
  generateTextWithRetry,
  type AIConfig,
  type AICallOptions,
} from './services/aiClient.js';
import { analyzeWritingStyle } from './qc/writingStyleHeuristics.js';

/**
 * 提前完结关键词模式
 * 命中这些信号直接判"疑似提前完结"
 */
const HARD_ENDING_PATTERNS: RegExp[] = [
  // 明示完结词
  /感谢(大家|读者|各位|支持)/,
  /（完）|\(完\)|（全文完）|\(全文完\)/,
  /the\s*end/i,
];

const REVIEW_ENDING_PATTERNS: RegExp[] = [
  /全书完|完结|大结局|终章|尾声|后记|番外/,

  // 结构信号：突然总结人生、回顾全程
  /回顾(一路|过往|这些年|这一切)/,
  /从此(以后|之后).{0,10}(幸福|安稳|平静)/,
  /故事(就|也|便)(到此|到这|至此|结束)/,
  /至此.{0,5}(落幕|结束|告一段落)/,

  // 交代所有伏笔、所有反派一次性清算
  /所有的(谜团|伏笔|悬念).{0,10}(揭开|解开|真相大白)/,
  /一切(都|终于|终究)(尘埃落定|水落石出)/,

  // 说教/总结式结尾（拉低文学水准的典型模式）
  /他(知道|明白|清楚|意识到).{0,20}(只是|仅仅是|才是).{0,10}(开始|起点)/,
  /从此.{0,10}(踏上|走上|开启).{0,10}(之路|旅程|征途)/,
  /命运的.{0,10}(齿轮|车轮|画卷).{0,10}(开始|已然|正在)/,
  /历史的.{0,5}(车轮|洪流|画卷)/,
];

const VALID_ENDING_PATTERN = /(?:(?:[。！？!?…]|\.{3,}|——|—)[】）》」』”’"]*|[】）》」』”’])\s*$/;
const BAD_ENDING_PATTERNS: RegExp[] = [
  /[，、：；]\s*$/,
  /[（【《「『]\s*$/,
  /(?:并且|但是|而且|以及|如果|当|因为|所以|于是|然后|同时|而|但|却)\s*$/,
];

const MIN_WORD_COUNT_TOLERANCE_RATIO = 0.05;
const MIN_WORD_COUNT_TOLERANCE_CHARS = 120;
const SEVERE_WORD_COUNT_SHORTFALL_RATIO = 0.6;
const QUICK_QC_JUDGE_MAX_TOKENS = 400;

const QuickQCJudgeSchema = z.object({
  action: z.enum(['keep', 'rewrite']),
  reasons: z.array(z.string()).max(4).optional(),
  guidance: z.string().max(200).optional(),
});

export type QuickQCHeuristicResult = {
  hit: boolean;
  reasons: string[];
  blockingReasons: string[];
  reviewReasons: string[];
};

export type QuickQCJudgeDecision = z.infer<typeof QuickQCJudgeSchema>;

export function getChapterLengthTolerance(targetChars: number): number {
  const normalized = Math.max(200, Number.isFinite(targetChars) ? Math.floor(targetChars) : 200);
  return Math.max(
    MIN_WORD_COUNT_TOLERANCE_CHARS,
    Math.floor(normalized * MIN_WORD_COUNT_TOLERANCE_RATIO)
  );
}

function getSevereShortBodyThreshold(targetChars: number): number {
  const normalized = Math.max(200, Number.isFinite(targetChars) ? Math.floor(targetChars) : 200);
  return Math.max(400, Math.floor(normalized * SEVERE_WORD_COUNT_SHORTFALL_RATIO));
}

function buildQuickQCResult(
  blockingReasons: string[],
  reviewReasons: string[]
): QuickQCHeuristicResult {
  const reasons = [...blockingReasons, ...reviewReasons];
  return {
    hit: reasons.length > 0,
    reasons,
    blockingReasons,
    reviewReasons,
  };
}

function detectLikelyTruncation(chapterText: string): string[] {
  const trimmed = chapterText.trim();
  if (!trimmed) {
    return ['章节内容为空'];
  }

  if (VALID_ENDING_PATTERN.test(trimmed)) {
    return [];
  }

  const reasons: string[] = [];
  const tail = trimmed.slice(-40);

  for (const pattern of BAD_ENDING_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      if (reasons.length === 0) {
        reasons.push(`章节结尾疑似被截断（尾部: "${tail}"）`);
      }
      reasons.push(`结尾停在不完整位置: "${match[0]}"`);
    }
  }

  return reasons;
}

/**
 * 快速规则检测
 * @returns 是否命中 + 命中原因
 */
export function quickEndingHeuristic(chapterText: string): {
  hit: boolean;
  reasons: string[];
  blockingReasons: string[];
  reviewReasons: string[];
} {
  const blockingReasons: string[] = [];
  const reviewReasons: string[] = [];

  for (const pattern of HARD_ENDING_PATTERNS) {
    const match = chapterText.match(pattern);
    if (match) {
      blockingReasons.push(`匹配到强完结信号: "${match[0]}"`);
    }
  }

  for (const pattern of REVIEW_ENDING_PATTERNS) {
    const match = chapterText.match(pattern);
    if (match) {
      reviewReasons.push(`匹配到收尾信号: "${match[0]}"`);
    }
  }

  blockingReasons.push(...detectLikelyTruncation(chapterText));

  return buildQuickQCResult(blockingReasons, reviewReasons);
}

/**
 * 章节基础结构检测
 * 仅要求：有标题 + 有正文
 */
export function quickChapterFormatHeuristic(
  chapterText: string,
  options?: { minBodyChars?: number; isOpeningChapter?: boolean; protagonistAliases?: string[] }
): {
  hit: boolean;
  reasons: string[];
  blockingReasons: string[];
  reviewReasons: string[];
} {
  const blockingReasons: string[] = [];
  const reviewReasons: string[] = [];
  const trimmed = chapterText.trim();

  if (!trimmed) {
    return buildQuickQCResult(['章节内容为空'], []);
  }

  const lines = trimmed.split(/\r?\n/);
  const firstNonEmptyIdx = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIdx < 0) {
    return buildQuickQCResult(['章节内容为空'], []);
  }

  // Allow markdown bold (**TITLE**) and headers (# TITLE)
  const titleLine = lines[firstNonEmptyIdx].replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
  if (!titleLine) {
    blockingReasons.push('缺少章节标题');
  } else if (!/第[一二三四五六七八九十百千万零两\d]+[章节回]/.test(titleLine)) {
    reviewReasons.push(`标题格式不规范（当前标题: "${titleLine}"）`);
  }

  const body = lines.slice(firstNonEmptyIdx + 1).join('\n').trim();
  const minBodyChars = Math.max(200, Number(options?.minBodyChars) || 200);
  const tolerance = getChapterLengthTolerance(minBodyChars);
  const severeShortThreshold = getSevereShortBodyThreshold(minBodyChars);

  if (!body) {
    blockingReasons.push('缺少章节正文');
  } else if (body.length < severeShortThreshold) {
    blockingReasons.push(`正文明显过短（仅 ${body.length} 字，目标至少 ${minBodyChars} 字）`);
  } else if (body.length + tolerance < minBodyChars) {
    reviewReasons.push(`正文偏短（仅 ${body.length} 字，目标至少 ${minBodyChars} 字）`);
  }

  // 文风启发式：设定倾泻 / 话剧腔 / 无钩子结尾 / 长句比
  if (body && body.length >= 500) {
    const styleResult = analyzeWritingStyle(body, {
      isOpeningChapter: options?.isOpeningChapter,
      protagonistAliases: options?.protagonistAliases,
    });
    blockingReasons.push(...styleResult.blockingReasons);
    reviewReasons.push(...styleResult.reviewReasons);
  }

  return buildQuickQCResult(blockingReasons, reviewReasons);
}

/**
 * 构建重写指令
 */
export function buildRewriteInstruction(args: {
  chapterIndex: number;
  totalChapters: number;
  reasons: string[];
  isFinalChapter?: boolean;
  minChapterWords?: number;
  extraGuidance?: string;
}): string {
  const {
    chapterIndex,
    totalChapters,
    reasons,
    isFinalChapter = false,
    minChapterWords = 200,
    extraGuidance,
  } = args;

  return `
【重写要求】
你刚才写的第 ${chapterIndex}/${totalChapters} 章出现质量问题（结构不合规/提前收尾/内容疑似被截断）。

检测到的问题：
${reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

请重写该章，严格遵守：
1. 第一行必须是章节标题，格式为「第${chapterIndex}章 XXX」。
2. 标题下面必须是正文，正文必须完整且可读，不能只有几句摘要。
3. ${isFinalChapter ? '这是最终章，可以收束主线，但正文仍需完整。' : '这不是最终章，严禁出现：完结/终章/尾声/后记/感谢读者/全书完/总结一生 等收尾语气。'}
4. 结尾必须是完整句，不能输出到一半戛然而止。
5. 只输出章节文本：标题 + 正文；不要 JSON、不要代码块、不要解释说明。
6. 正文字数不少于 ${minChapterWords} 字。
${extraGuidance ? `\n补充修订重点：${extraGuidance}` : ''}
`.trim();
}

function stripJsonFence(text: string): string {
  return text.replace(/```json\s*|```\s*/gi, '').trim();
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = stripJsonFence(raw);
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }

  return null;
}

function getChapterBodyChars(chapterText: string): number {
  const trimmed = chapterText.trim();
  if (!trimmed) return 0;

  const lines = trimmed.split(/\r?\n/);
  const firstNonEmptyIdx = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIdx < 0) return 0;

  return lines.slice(firstNonEmptyIdx + 1).join('\n').trim().length;
}

export async function judgeQuickChapterSignals(params: {
  aiConfig: AIConfig;
  fallbackConfigs?: AIConfig[];
  chapterText: string;
  chapterIndex: number;
  totalChapters: number;
  minChapterWords?: number;
  reasons: string[];
  callOptions?: AICallOptions;
}): Promise<QuickQCJudgeDecision> {
  const {
    aiConfig,
    fallbackConfigs,
    chapterText,
    chapterIndex,
    totalChapters,
    minChapterWords,
    reasons,
    callOptions,
  } = params;

  if (reasons.length === 0) {
    return { action: 'keep', reasons: [], guidance: '' };
  }

  const bodyChars = getChapterBodyChars(chapterText);
  const targetChars = Math.max(200, Number(minChapterWords) || 200);
  const tolerance = getChapterLengthTolerance(targetChars);

  const system = `
你是小说章节快速质检裁判。你的任务是判断这些规则信号是否真的需要整章重写。
只输出严格 JSON，不要输出任何其他文字。

判断原则：
- 只有在章节明显损坏、明显写成大结局、明显停在半句/半段、或正文短到场景无法成立时，才返回 "rewrite"
- 以下情况通常返回 "keep"：悬念式省略号结尾、破折号/被打断式收尾、字数只比目标略少、轻微标题格式问题、只是还能更好但不影响阅读
- 如果你不确定，优先返回 "keep"，因为重写成本很高

输出格式：
{
  "action": "keep" | "rewrite",
  "reasons": ["简短原因1", "简短原因2"],
  "guidance": "如果需要重写，给出一句可执行修订重点"
}
`.trim();

  const prompt = `
【章节信息】
- 当前章节: 第 ${chapterIndex}/${totalChapters} 章
- 是否最终章: ${chapterIndex === totalChapters}
- 目标最少字数: ${targetChars}
- 正文实际字数: ${bodyChars}
- 容差参考: ${tolerance}

【规则信号】
${reasons.map((reason, index) => `${index + 1}. ${reason}`).join('\n')}

【章节正文】
${chapterText}

请判断这些信号是否真的需要重写，并输出 JSON：
`.trim();

  try {
    const raw = fallbackConfigs?.length
      ? await generateTextWithFallback(
        {
          primary: aiConfig,
          fallback: fallbackConfigs,
          switchConditions: ['rate_limit', 'server_error', 'timeout', 'unknown'],
        },
        {
          system,
          prompt,
          temperature: 0.1,
          maxTokens: QUICK_QC_JUDGE_MAX_TOKENS,
        },
        2,
        callOptions
      )
      : await generateTextWithRetry(
        aiConfig,
        {
          system,
          prompt,
          temperature: 0.1,
          maxTokens: QUICK_QC_JUDGE_MAX_TOKENS,
        },
        2,
        callOptions
      );

    const parsed = extractJsonObject(raw);
    if (!parsed) {
      return { action: 'keep', reasons: [], guidance: '' };
    }

    return QuickQCJudgeSchema.parse(parsed);
  } catch (error) {
    console.warn('[QuickQCJudge] failed, fallback to keep:', (error as Error).message);
    return { action: 'keep', reasons: [], guidance: '' };
  }
}

/**
 * 模型裁判复核（可选，更稳但更慢）
 * 让另一个模型判断是否提前完结
 */
export function buildJudgePrompt(chapterText: string, chapterIndex: number, totalChapters: number): {
  system: string;
  prompt: string;
} {
  const system = `
你是一个小说质检裁判。你的任务是判断一章内容是否存在"提前完结"的问题。
只输出严格的 JSON 格式，不要有任何其他文字。

判断标准：
- 如果章节像是"结局/尾声/后记/大结局"的语气，判为 true
- 如果出现"全书完/完结/感谢读者"等词，判为 true
- 如果是正常的连载章节（有冲突、有悬念、有钩子），判为 false

输出格式：
{
  "is_premature_ending": true/false,
  "reason": "判断原因（简短）",
  "suggest_fix": "如果需要修改，给出建议（简短）"
}
`.trim();

  const prompt = `
【当前章节】第 ${chapterIndex}/${totalChapters} 章
【is_final_chapter】${chapterIndex === totalChapters}

【章节内容】
${chapterText}

请判断这章是否存在"提前完结"的问题：
`.trim();

  return { system, prompt };
}
