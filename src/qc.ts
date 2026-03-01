/**
 * 提前完结检测 - 质量控制模块
 */

/**
 * 提前完结关键词模式
 * 命中这些信号直接判"疑似提前完结"
 */
const ENDING_PATTERNS: RegExp[] = [
  // 明示完结词
  /全书完|完结|大结局|终章|尾声|后记|番外/,
  /感谢(大家|读者|各位|支持)/,
  /（完）|\(完\)|（全文完）|\(全文完\)/,
  /the\s*end/i,

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

const VALID_ENDING_PATTERN = /(?:[。！？!?…】）》」』”’]|——|—)\s*$/;
const BAD_ENDING_PATTERNS: RegExp[] = [
  /[，、：；]\s*$/,
  /[（【《「『]\s*$/,
  /(?:并且|但是|而且|以及|如果|当|因为|所以|于是|然后|同时|而|但|却)\s*$/,
];

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
  reasons.push(`章节结尾疑似被截断（尾部: "${tail}"）`);

  for (const pattern of BAD_ENDING_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
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
} {
  const reasons: string[] = [];

  for (const pattern of ENDING_PATTERNS) {
    const match = chapterText.match(pattern);
    if (match) {
      reasons.push(`匹配到: "${match[0]}"`);
    }
  }
  reasons.push(...detectLikelyTruncation(chapterText));

  return {
    hit: reasons.length > 0,
    reasons,
  };
}

/**
 * 章节基础结构检测
 * 仅要求：有标题 + 有正文
 */
export function quickChapterFormatHeuristic(
  chapterText: string,
  options?: { minBodyChars?: number }
): {
  hit: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const trimmed = chapterText.trim();

  if (!trimmed) {
    return { hit: true, reasons: ['章节内容为空'] };
  }

  const lines = trimmed.split(/\r?\n/);
  const firstNonEmptyIdx = lines.findIndex((line) => line.trim().length > 0);
  if (firstNonEmptyIdx < 0) {
    return { hit: true, reasons: ['章节内容为空'] };
  }

  // Allow markdown bold (**TITLE**) and headers (# TITLE)
  const titleLine = lines[firstNonEmptyIdx].replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim();
  if (!titleLine) {
    reasons.push('缺少章节标题');
  } else if (!/第[一二三四五六七八九十百千万零两\d]+[章节回]/.test(titleLine)) {
    reasons.push(`标题格式不规范（当前标题: "${titleLine}"）`);
  }

  const body = lines.slice(firstNonEmptyIdx + 1).join('\n').trim();
  const minBodyChars = Math.max(200, Number(options?.minBodyChars) || 200);

  if (!body) {
    reasons.push('缺少章节正文');
  } else if (body.length < minBodyChars) {
    reasons.push(`正文过短（仅 ${body.length} 字，至少 ${minBodyChars} 字）`);
  }

  return {
    hit: reasons.length > 0,
    reasons,
  };
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
}): string {
  const { chapterIndex, totalChapters, reasons, isFinalChapter = false, minChapterWords = 200 } = args;

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
`.trim();
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
