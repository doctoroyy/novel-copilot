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
];

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
}): string {
  const { chapterIndex, totalChapters, reasons } = args;

  return `
【重写要求】
你刚才写的第 ${chapterIndex}/${totalChapters} 章出现"提前收尾/完结"倾向。

检测到的问题：
${reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

请重写该章，严格遵守：
1. 这不是最终章，严禁出现：完结/终章/尾声/后记/感谢读者/全书完/总结一生 等任何收尾语气
2. 仍然保持本章推进剧情：有一个明确冲突→解决一小步→引出更大危机
3. 结尾必须是强钩子（读者会想立刻点下一章）
4. 只输出 JSON：{ "title": "...", "content": "..." }
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
