/**
 * 文风启发式校验
 *
 * 零 AI 调用。覆盖方法论中最容易机械检出的"弃书红线"：
 * - 连续形容词堆砌 / 话剧腔
 * - 大段设定倾泻（长段落 + 无对话 + 无动词密度）
 * - 章末钩子缺失（结尾段落没有问号/未完成事件/未揭谜）
 * - 主角被动比（段落首字是主角名的比例）
 * - 长句比（超长句占比）
 *
 * 输出与 quickChapterFormatHeuristic 同构的 reason 列表，
 * 由调用方决定作为 blocking 还是 review。
 */

export interface StyleHeuristicOptions {
  protagonistAliases?: string[];
  isOpeningChapter?: boolean;
}

export interface StyleHeuristicResult {
  blockingReasons: string[];
  reviewReasons: string[];
  metrics: {
    bodyChars: number;
    paragraphCount: number;
    longSentenceRatio: number;
    maxSettingRunChars: number;
    dialoguePercent: number;
    adjectivePileupHits: number;
    endingHookScore: number; // 0~3
    protagonistAgencyScore: number; // 0~1
  };
}

const ADJECTIVE_PILEUP_RE = /(?:[\u4e00-\u9fa5]{1,3}的){4,}/g;
const TRIPLE_PARALLEL_RE = /([\u4e00-\u9fa5]{2,8}[，,])\1{2,}/g;

const HOOK_INDICATORS = [
  /[？?！!]\s*$/,
  /未完|戛然|突然|陡然|猛地|骤然|瞬间/,
  /(?:身影|视线|目光).{0,12}(?:消失|不见|模糊|逼近)/,
  /倒计时|还有[一二三四五六七八九十百千万\d]+[分秒时日天]/,
  /(?:他|她|它|那人|对方)(?:笑了|冷笑|淡淡|开口|看着).{0,15}$/,
  /(?:这是|这就是|原来|竟然|果然|没想到)/,
];

const DRAMA_TONE_RE = /(?:哼|哈哈哈{2,}|吾|尔等|岂非|休得|焉能|莫非|然也)/g;

function isDialogueLine(line: string): boolean {
  // 对白行的典型特征：行开头是引号/破折号，而非段落中偶然出现带引号的词
  return /^\s*["“”『』「」—\-]/.test(line);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, '')
    .split(/[。！？!?…；;]/)
    .filter((s) => s.length > 0);
}

function countAdjectivePileup(text: string): number {
  const m = text.match(ADJECTIVE_PILEUP_RE);
  const p = text.match(TRIPLE_PARALLEL_RE);
  return (m?.length || 0) + (p?.length || 0);
}

function measureSettingRuns(paragraphs: string[]): number {
  // 两种度量：连续长段 / 单段超长。取较大者。
  let maxRun = 0;
  let run = 0;
  let maxSingle = 0;
  for (const p of paragraphs) {
    const content = p.replace(/\s/g, '');
    if (content.length > maxSingle && !isDialogueLine(p)) {
      maxSingle = content.length;
    }
    const dense = !isDialogueLine(p) && content.length >= 120;
    if (dense) {
      run += content.length;
      if (run > maxRun) maxRun = run;
    } else {
      run = 0;
    }
  }
  return Math.max(maxRun, maxSingle);
}

function measureEndingHook(body: string): number {
  const tail = body.slice(-400);
  let score = 0;
  for (const re of HOOK_INDICATORS) {
    if (re.test(tail)) score++;
    if (score >= 3) break;
  }
  return score;
}

function measureProtagonistAgency(
  paragraphs: string[],
  aliases: string[] | undefined,
): number {
  if (!aliases || aliases.length === 0) return 1; // 无法判断，按满分不拦截
  const actionParagraphs = paragraphs.filter((p) => p.length >= 20);
  if (actionParagraphs.length < 5) return 1;
  const hitRe = new RegExp(aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
  const hits = actionParagraphs.filter((p) => hitRe.test(p.slice(0, 30))).length;
  return hits / actionParagraphs.length;
}

function measureDialoguePercent(body: string, paragraphs: string[]): number {
  const bodyLen = body.replace(/\s/g, '').length || 1;
  const dialogueLen = paragraphs
    .filter(isDialogueLine)
    .reduce((sum, p) => sum + p.replace(/\s/g, '').length, 0);
  return dialogueLen / bodyLen;
}

function measureLongSentenceRatio(body: string): number {
  const sents = splitSentences(body);
  if (sents.length === 0) return 0;
  const long = sents.filter((s) => s.length > 40).length;
  return long / sents.length;
}

export function analyzeWritingStyle(
  body: string,
  options?: StyleHeuristicOptions,
): StyleHeuristicResult {
  const blockingReasons: string[] = [];
  const reviewReasons: string[] = [];
  const paragraphs = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const bodyChars = body.replace(/\s/g, '').length;

  const longSentenceRatio = measureLongSentenceRatio(body);
  const maxSettingRunChars = measureSettingRuns(paragraphs);
  const dialoguePercent = measureDialoguePercent(body, paragraphs);
  const adjectivePileupHits = countAdjectivePileup(body);
  const endingHookScore = measureEndingHook(body);
  const protagonistAgencyScore = measureProtagonistAgency(paragraphs, options?.protagonistAliases);

  // Blocking:
  if (maxSettingRunChars > 500) {
    blockingReasons.push(`存在 ${maxSettingRunChars} 字的无对白长段（设定/世界观倾泻）`);
  } else if (maxSettingRunChars > 300) {
    reviewReasons.push(`出现 ${maxSettingRunChars} 字长段，建议穿插动作/对白切碎`);
  }
  if (endingHookScore === 0 && bodyChars > 1500) {
    blockingReasons.push('章末缺少悬念/钩子：最后 400 字无明显未完成事件或疑问');
  }
  if ((body.match(DRAMA_TONE_RE) || []).length >= 3) {
    blockingReasons.push('出现多处话剧腔/译制片腔（吾/尔等/岂非/莫非 等）');
  }

  // Review:
  if (longSentenceRatio > 0.25) {
    reviewReasons.push(`长句占比 ${(longSentenceRatio * 100).toFixed(0)}% 偏高（>25%），违反"正文≤25字"小白文规则`);
  }
  if (adjectivePileupHits >= 3) {
    reviewReasons.push(`连续形容词/排比命中 ${adjectivePileupHits} 处（"xx的xx的xx的..."）`);
  }
  if (dialoguePercent < 0.15 && bodyChars > 1500) {
    reviewReasons.push(`对话占比仅 ${(dialoguePercent * 100).toFixed(0)}%（<15%），章节过于"单口相声"`);
  }
  if (options?.protagonistAliases?.length && protagonistAgencyScore < 0.2) {
    reviewReasons.push(`主角主动性偏低：主角在段首出现比例仅 ${(protagonistAgencyScore * 100).toFixed(0)}%`);
  }
  if (options?.isOpeningChapter && maxSettingRunChars > 300) {
    reviewReasons.push(`开篇章出现 ${maxSettingRunChars} 字的长段，违反黄金三章"设定融入行动"`);
  }

  return {
    blockingReasons,
    reviewReasons,
    metrics: {
      bodyChars,
      paragraphCount: paragraphs.length,
      longSentenceRatio,
      maxSettingRunChars,
      dialoguePercent,
      adjectivePileupHits,
      endingHookScore,
      protagonistAgencyScore,
    },
  };
}
