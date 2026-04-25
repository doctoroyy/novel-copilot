import { z } from 'zod';
import { generateTextWithRetry, type AIConfig, type AICallOptions } from '../services/aiClient.js';

export const QUALITY_RESEARCH_SOURCES = [
  {
    label: 'Purdue OWL fiction character guidance',
    url: 'https://owl.purdue.edu/owl/subject_specific_writing/creative_writing/writers/fiction-basics/characters_and_fiction_writing1/writing_compelling_characters.html',
    takeaway: '角色行为必须可信，奇观或设定需要提前铺垫，否则读者会觉得廉价或突兀。',
  },
  {
    label: 'Creative writing rubrics',
    url: 'https://www.womenwritingthewest.org/wp-content/uploads/2021/01/7.-2021-LAURA_rubric-copy.pdf',
    takeaway: '高分故事通常需要强开场、明确目标/问题、可信的因果链、鲜活人物、有效场景和有新鲜感的情节。',
  },
  {
    label: 'VBench video generation benchmark',
    url: 'https://arxiv.org/abs/2311.17982',
    takeaway: '视频生成应评估主体一致性、运动平滑、时间闪烁、画面质量、审美质量和文本一致性。',
  },
  {
    label: 'Netflix VMAF',
    url: 'https://github.com/Netflix/vmaf',
    takeaway: '视频质量需要可量化的技术检查；VMAF适合有参考视频时的感知质量对比。',
  },
  {
    label: 'The twelve basic principles of animation',
    url: 'https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation',
    takeaway: '动画分镜要考虑 staging、timing、anticipation、follow-through、appeal 等可执行原则。',
  },
];

export type QualityRecommendation = 'publish' | 'minor_edit' | 'rewrite';

export interface DimensionScore {
  score: number;
  reason: string;
}

export interface GenerationQualityReport {
  kind: 'novel' | 'anime_storyboard' | 'anime_video';
  overallScore: number;
  recommendation: QualityRecommendation;
  dimensions: Record<string, DimensionScore>;
  issues: string[];
  strengths: string[];
  gateFailures: string[];
}

export interface AnimeStoryboardShot {
  shot_id?: number | string;
  id?: number | string;
  visual_description?: string;
  description?: string;
  visual_prompt?: string;
  action_motion?: string;
  action?: string;
  action_description?: string;
  camera?: string;
  camera_movement?: string;
  composition?: string;
  lighting?: string;
  narration_text?: string;
  narration?: string;
  dialogue?: string;
  speaker?: string;
  duration?: number | string;
  [key: string]: unknown;
}

export interface NormalizedAnimeShot {
  shot_id: number;
  visual_description: string;
  action_motion: string;
  narration_text: string;
  duration: number;
  camera?: string;
  composition?: string;
  lighting?: string;
  speaker?: string;
}

function removeReadableTextInstruction(text: string): string {
  if (!text) return text;
  let next = text
    .replace(/\bN-\d+\b/gi, 'three corroded geometric notches')
    .replace(/["“”][^"“”]{1,80}["“”]\s*(?:in\s+\w+\s+)?(?:text|letters|characters)?/gi, 'flickering red light')
    .replace(/'[A-Z0-9][A-Z0-9\s:_-]{1,40}'\s*(?:in\s+\w+\s+)?(?:text|letters|characters)?/g, 'flickering red light')
    .replace(/\b(?:showing|displaying|with|contains?)\s+(?:red\s+)?(?:text|letters|characters|caption|subtitle|logo|UI)\b[^.。；;]*/gi, 'showing pulsing red light patterns')
    .replace(/\b(?:abstract unreadable warning glow|unreadable warning glow|unreadable light signal|soft red warning glow|no readable glyphs)\b/gi, 'flickering red light')
    .replace(/\b(?:error message|warning message|red text|screen text|readable text|subtitle|caption|speech bubble|logo|UI|error)\b/gi, 'flickering red light')
    .replace(/字幕|文字|气泡|标语|徽标|界面|错误信息/g, '红色警示光效');
  next = next.replace(/\s{2,}/g, ' ').replace(/\s+([,.。；;])/g, '$1');
  next = next
    .replace(/\bthe\s+number\s+'three corroded geometric notches'/gi, 'three corroded geometric notches')
    .replace(/'three corroded geometric notches'/gi, 'three corroded geometric notches')
    .replace(/\b(?:engraved\s+)?numbers?\s+three corroded geometric notches(?:\s+in\s+corroded\s+geometric\s+notches)?/gi, 'corroded geometric notches')
    .replace(/\bthree corroded geometric notches\s+in\s+corroded\s+geometric\s+notches\b/gi, 'corroded geometric notches')
    .replace(/\b(?:etched|engraved)?\s*characters?\s+(?:forming|as|like)?\s*corroded geometric notches\b/gi, 'corroded geometric marks')
    .replace(/\b(?:blank|empty)\s+(?:archive\s+)?file\b/gi, 'empty archive slot with a dust outline')
    .replace(/\ba empty\b/gi, 'an empty');
  return next;
}

function normalizeCameraInstruction(text: string | undefined): string | undefined {
  if (!text) return text;
  return text
    .replace(/top-down\s+low\s+angle/gi, 'top-down overhead angle')
    .replace(/\borbit shot\b/gi, 'tight tracking push-in')
    .replace(/\bdynamic orbit\b/gi, 'tight tracking movement')
    .trim();
}

function rebalanceStoryboardDurations(shots: NormalizedAnimeShot[]): NormalizedAnimeShot[] {
  const next = shots.map((shot) => ({
    ...shot,
    duration: Math.max(3, Math.min(8, Math.round(shot.duration || 5))),
  }));
  let total = next.reduce((sum, shot) => sum + shot.duration, 0);
  for (let i = 0; total < 90 && next.length > 0; i = (i + 1) % next.length) {
    if (next[i].duration < 8) {
      next[i].duration += 1;
      total += 1;
    } else if (next.every((shot) => shot.duration >= 8)) {
      break;
    }
  }
  for (let i = next.length - 1; total > 120 && next.length > 0; i = (i - 1 + next.length) % next.length) {
    if (next[i].duration > 3) {
      next[i].duration -= 1;
      total -= 1;
    } else if (next.every((shot) => shot.duration <= 3)) {
      break;
    }
  }
  return next;
}

function hasReadableTextRisk(text: string): boolean {
  const normalized = text
    .replace(/\bno\s+(?:readable\s+)?(?:text|subtitles?|captions?|logo|UI)\b/gi, '')
    .replace(/\bwithout\s+(?:readable\s+)?(?:text|subtitles?|captions?|logo|UI)\b/gi, '')
    .replace(/\bno\s+readable\s+glyphs\b/gi, '');
  return /字幕|文字|气泡|\blogo\b|\bUI\b|\bcaption\b|\bsubtitle\b|\btext\b|readable\s+letters|speech\s+bubble/i.test(normalized);
}

const NovelJudgeSchema = z.object({
  dimensions: z.record(z.number().min(0).max(10)),
  overallScore: z.number().min(0).max(10),
  issues: z.array(z.string()).max(10),
  strengths: z.array(z.string()).max(8),
  recommendation: z.enum(['publish', 'minor_edit', 'rewrite']),
});

const AnimeJudgeSchema = z.object({
  dimensions: z.record(z.number().min(0).max(10)),
  overallScore: z.number().min(0).max(10),
  issues: z.array(z.string()).max(10),
  strengths: z.array(z.string()).max(8),
  recommendation: z.enum(['publish', 'minor_edit', 'rewrite']),
});

export function extractJsonArray(text: string): unknown[] {
  const cleaned = text.replace(/```json\s*|```\s*/g, '').trim();
  const direct = tryParseJson(cleaned);
  if (Array.isArray(direct)) return direct;
  if (direct && typeof direct === 'object') {
    const obj = direct as Record<string, unknown>;
    for (const key of ['shots', 'scenes', 'storyboard', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  const parsed = tryParseJson(match[0]);
  return Array.isArray(parsed) ? parsed : [];
}

export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreFromPenalty(base: number, penalties: number[]): number {
  return clampScore(base - penalties.reduce((sum, p) => sum + p, 0));
}

function score10To100(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return clampScore(value * 10);
}

function makeDimension(score: number, reason: string): DimensionScore {
  return { score: clampScore(score), reason };
}

function recommendationFromScore(score: number, gateFailures: string[]): QualityRecommendation {
  if (gateFailures.length || score < 65) return 'rewrite';
  if (score < 78) return 'minor_edit';
  return 'publish';
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function textLength(text: string): number {
  return text.replace(/\s/g, '').length;
}

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, re) => sum + (text.match(re)?.length || 0), 0);
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function isMostlyEnglish(text: string): boolean {
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  return letters > 20 && letters >= cjk;
}

export function evaluateNovelHeuristics(input: {
  chapterText: string;
  minChapterWords?: number;
  chapterGoal?: string;
  lastChapterTail?: string;
  protagonistNames?: string[];
}): GenerationQualityReport {
  const body = input.chapterText;
  const paragraphs = splitParagraphs(body);
  const chars = textLength(body);
  const tail = body.slice(-500);
  const head = body.slice(0, 500);
  const dialogueLines = paragraphs.filter((p) => /^\s*["“”『』「」—\-]/.test(p)).length;
  const longParagraphs = paragraphs.filter((p) => textLength(p) > 280).length;
  const conflictHits = countMatches(body, [/冲突|威胁|危险|追|杀|挡|逼|怒|冷|痛|血|破|逃|赌|罚|死/g]);
  const hookHits = countMatches(tail, [/[？?！!]/g, /突然|猛地|下一刻|身后|门外|黑影|倒计时|秘密|真相|代价/g]);
  const agencyHits = input.protagonistNames?.length
    ? countMatches(body, input.protagonistNames.map((name) => new RegExp(`${escapeRegExp(name)}.{0,18}(?:说|问|走|冲|抓|推|看|想|决定|抬|挡|砸)`, 'g')))
    : 3;
  const aiToneHits = countMatches(body, [/不禁/g, /宛如|犹如|恍若/g, /淡淡地|微微|缓缓/g, /涌上心头/g, /令人叹为观止/g]);

  const minWords = input.minChapterWords || 1200;
  const lengthScore = scoreFromPenalty(100, [
    chars < minWords ? Math.min(40, (minWords - chars) / Math.max(minWords, 1) * 70) : 0,
    chars > minWords * 1.8 ? 8 : 0,
  ]);
  const hookScore = scoreFromPenalty(100, [hookHits === 0 ? 35 : 0, tail.includes('本章完') ? 35 : 0]);
  const pacingScore = scoreFromPenalty(94, [longParagraphs * 8, dialogueLines === 0 && chars > 1000 ? 14 : 0]);
  const conflictScore = scoreFromPenalty(92, [conflictHits < 6 ? 18 : 0, head.length > 200 && conflictHits === 0 ? 12 : 0]);
  const agencyScore = scoreFromPenalty(90, [agencyHits < 2 ? 18 : 0]);
  const proseScore = scoreFromPenalty(92, [aiToneHits * 4, longParagraphs * 4]);
  const continuityScore = scoreFromPenalty(88, [
    input.lastChapterTail && input.lastChapterTail.slice(-80) === head.slice(0, 80) ? 18 : 0,
  ]);
  const goalScore = scoreFromPenalty(88, [
    input.chapterGoal && input.chapterGoal.length > 12 && !body.includes(input.chapterGoal.slice(0, 4)) ? 8 : 0,
  ]);

  const dimensions = {
    hook: makeDimension(hookScore, '章末是否有未完成事件、疑问、压力或反转。'),
    conflictAndStakes: makeDimension(conflictScore, '是否存在明确阻碍、代价和角色选择。'),
    protagonistAgency: makeDimension(agencyScore, '主角是否推动事件，而不是旁观承受。'),
    pacing: makeDimension(pacingScore, '段落长度、对话占比和事件推进密度。'),
    proseClarity: makeDimension(proseScore, '是否口语化、清楚、少空泛辞藻和模板化情绪。'),
    continuity: makeDimension(continuityScore, '是否自然承接上下文，避免复制或跳跃。'),
    chapterGoal: makeDimension(goalScore, '是否服务本章目标和阶段性结果。'),
    lengthAndFormat: makeDimension(lengthScore, '字数和标题/正文基本格式是否可发布。'),
  };

  const gateFailures = [
    chars < minWords * 0.8 ? `正文长度 ${chars} 字，低于最低要求 ${minWords} 字的80%。` : '',
    hookScore < 65 ? '章末钩子不足。' : '',
    conflictScore < 65 ? '冲突和代价不足。' : '',
  ].filter(Boolean);

  const issues = [
    longParagraphs > 0 ? `存在 ${longParagraphs} 个超长段落，阅读速度会下降。` : '',
    aiToneHits >= 3 ? `AI腔/空泛修饰命中 ${aiToneHits} 次。` : '',
    dialogueLines === 0 && chars > 1000 ? '缺少对白，章节可能显得单调。' : '',
    agencyHits < 2 ? '主角主动行为信号偏弱。' : '',
  ].filter(Boolean);

  const overallScore = clampScore(avg(Object.values(dimensions).map((d) => d.score)));
  return {
    kind: 'novel',
    overallScore,
    recommendation: recommendationFromScore(overallScore, gateFailures),
    dimensions,
    issues,
    strengths: [
      hookHits > 0 ? '结尾存在追读信号。' : '',
      conflictHits >= 6 ? '冲突词和压力信号充足。' : '',
      dialogueLines > 0 ? '有对白参与推进。' : '',
    ].filter(Boolean),
    gateFailures,
  };
}

export async function judgeNovelWithResearchRubric(input: {
  aiConfig: AIConfig;
  chapterText: string;
  chapterIndex: number;
  totalChapters: number;
  chapterGoal?: string;
  lastChapterTail?: string;
  protagonistNames?: string[];
  fallbackHeuristic?: GenerationQualityReport;
  callOptions?: AICallOptions;
}): Promise<GenerationQualityReport> {
  const heuristic = input.fallbackHeuristic ?? evaluateNovelHeuristics(input);
  const system = `你是严格的商业小说主编和叙事评测员。只输出 JSON。

评测依据：
- 创意写作通用标准：人物可信、目标清楚、情节因果成立、场景有效、声音稳定、结尾有余味。
- 网文连载标准：开头拉力、冲突/代价、主角主动性、爽点或信息进展、章末追读钩子。
- 质量红线：设定倾倒、主角旁观、上下文断裂、模板化情绪、无冲突日常、非最终章收束。

维度 0-10：
openingPull, conflictAndStakes, sceneCausality, characterBelievability, protagonistAgency, proseVoice, pacing, continuity, genreFit, endingHook。

recommendation:
publish = overallScore >= 7.8 且无维度 < 6.5
minor_edit = overallScore >= 6.5
rewrite = overallScore < 6.5 或出现硬伤`;

  const prompt = `【章节】
第 ${input.chapterIndex}/${input.totalChapters} 章
${input.chapterGoal ? `目标：${input.chapterGoal}` : ''}
${input.protagonistNames?.length ? `主角：${input.protagonistNames.join('、')}` : ''}

${input.lastChapterTail ? `【上章结尾】\n${input.lastChapterTail.slice(-500)}\n` : ''}
【待评正文】
${input.chapterText}

【规则启发式初评】
${JSON.stringify(heuristic, null, 2)}

请输出：
{
  "dimensions": {"openingPull": 8, "conflictAndStakes": 8, ...},
  "overallScore": 7.6,
  "issues": ["具体问题，引用短片段"],
  "strengths": ["具体优点"],
  "recommendation": "publish" | "minor_edit" | "rewrite"
}`;

  try {
    const raw = await generateTextWithRetry(input.aiConfig, {
      system,
      prompt,
      temperature: 0.15,
      maxTokens: 1200,
    }, 2, { ...input.callOptions, phase: input.callOptions?.phase ?? 'qc', timeoutMs: input.callOptions?.timeoutMs ?? 120_000 });
    const parsed = NovelJudgeSchema.parse(JSON.parse(String(raw).replace(/```json\s*|```\s*/g, '').trim()));
    const aiDimensions = Object.fromEntries(
      Object.entries(parsed.dimensions).map(([key, score]) => [key, makeDimension(score10To100(score), 'LLM judge rubric score')]),
    );
    const overallScore = score10To100(parsed.overallScore);
    const gateFailures = [
      ...heuristic.gateFailures,
      ...Object.entries(parsed.dimensions)
        .filter(([, score]) => score < 4.5)
        .map(([key]) => `${key} 维度低于4.5。`),
    ];
    return {
      kind: 'novel',
      overallScore,
      recommendation: gateFailures.length ? 'rewrite' : parsed.recommendation,
      dimensions: { ...heuristic.dimensions, ...aiDimensions },
      issues: [...heuristic.issues, ...parsed.issues].slice(0, 12),
      strengths: [...heuristic.strengths, ...parsed.strengths].slice(0, 10),
      gateFailures,
    };
  } catch (error) {
    return {
      ...heuristic,
      issues: [...heuristic.issues, `AI judge failed, using heuristics only: ${(error as Error).message}`].slice(0, 12),
    };
  }
}

export function normalizeAnimeStoryboard(input: unknown): NormalizedAnimeShot[] {
  const array = Array.isArray(input) ? input : typeof input === 'string' ? extractJsonArray(input) : [];
  const shots = array.map((item, index) => {
    const shot = (item || {}) as AnimeStoryboardShot;
    const duration = Number(shot.duration);
    return {
      shot_id: Number(shot.shot_id ?? shot.id ?? index + 1) || index + 1,
      visual_description: removeReadableTextInstruction(String(shot.visual_description ?? shot.description ?? shot.visual_prompt ?? '').trim()),
      action_motion: removeReadableTextInstruction(String(shot.action_motion ?? shot.action ?? shot.action_description ?? '').trim()),
      narration_text: String(shot.narration_text ?? shot.narration ?? shot.dialogue ?? '').trim(),
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      camera: normalizeCameraInstruction(typeof shot.camera === 'string' ? shot.camera : typeof shot.camera_movement === 'string' ? shot.camera_movement : undefined),
      composition: typeof shot.composition === 'string' ? shot.composition : undefined,
      lighting: typeof shot.lighting === 'string' ? shot.lighting : undefined,
      speaker: typeof shot.speaker === 'string' ? shot.speaker : undefined,
    };
  });
  return rebalanceStoryboardDurations(shots);
}

export function evaluateAnimeStoryboard(storyboard: unknown): GenerationQualityReport & { normalizedShots: NormalizedAnimeShot[] } {
  const shots = normalizeAnimeStoryboard(storyboard);
  const totalDuration = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const hasCamera = shots.filter((shot) => /push|pull|track|pan|tilt|dolly|zoom|close|wide|特写|推|拉|摇|移|跟|环绕/i.test(`${shot.camera || ''} ${shot.action_motion}`)).length;
  const hasMotion = shots.filter((shot) => shot.action_motion.length >= 18).length;
  const hasVisual = shots.filter((shot) => shot.visual_description.length >= 35).length;
  const hasNarration = shots.filter((shot) => shot.narration_text.length >= 4 && shot.narration_text.length <= 80).length;
  const englishVisual = shots.filter((shot) => isMostlyEnglish(`${shot.visual_description} ${shot.action_motion}`)).length;
  const noTextViolations = shots.filter((shot) => hasReadableTextRisk(`${shot.visual_description} ${shot.action_motion}`)).length;
  const visualSet = new Set(shots.map((shot) => shot.visual_description.slice(0, 36)));
  const uniqueRatio = shots.length ? visualSet.size / shots.length : 0;
  const durationOk = shots.filter((shot) => shot.duration >= 3 && shot.duration <= 8).length;

  const countScore = scoreFromPenalty(100, [
    shots.length < 10 ? (10 - shots.length) * 9 : 0,
    shots.length > 20 ? (shots.length - 20) * 8 : 0,
  ]);
  const durationScore = scoreFromPenalty(100, [
    totalDuration < 90 ? (90 - totalDuration) * 1.2 : 0,
    totalDuration > 120 ? (totalDuration - 120) * 1.2 : 0,
    shots.length ? (shots.length - durationOk) * 4 : 20,
  ]);
  const visualScore = scoreFromPenalty(100, [shots.length ? (shots.length - hasVisual) * 5 : 40, uniqueRatio < 0.75 ? 16 : 0]);
  const motionScore = scoreFromPenalty(96, [shots.length ? (shots.length - hasMotion) * 5 : 40, shots.length ? (shots.length - hasCamera) * 3 : 10]);
  const narrationScore = scoreFromPenalty(92, [shots.length ? (shots.length - hasNarration) * 3 : 20]);
  const promptScore = scoreFromPenalty(96, [noTextViolations * 12, englishVisual < Math.ceil(shots.length * 0.6) ? 10 : 0]);
  const continuityScore = scoreFromPenalty(90, [uniqueRatio < 0.65 ? 20 : 0, shots.some((shot, idx) => shot.shot_id !== idx + 1) ? 6 : 0]);
  const productionScore = scoreFromPenalty(88, [
    shots.filter((shot) => `${shot.visual_description} ${shot.action_motion}`.length < 80).length * 2,
  ]);

  const dimensions = {
    shotStructure: makeDimension(countScore, `镜头数 ${shots.length}，目标10-20。`),
    durationControl: makeDimension(durationScore, `总时长 ${totalDuration}s，目标90-120s；单镜头3-8s。`),
    visualSpecificity: makeDimension(visualScore, '画面是否具体、可生成、镜头之间是否避免重复。'),
    motionAndCamera: makeDimension(motionScore, '动作、运镜、timing、anticipation 是否明确。'),
    narrationFit: makeDimension(narrationScore, '旁白/对白是否短、可配音、服务节奏。'),
    promptExecutability: makeDimension(promptScore, '是否避免字幕/UI，并优先给视频模型英文视觉指令。'),
    temporalContinuity: makeDimension(continuityScore, '镜头编号、主体和场景是否连续。'),
    productionReadiness: makeDimension(productionScore, '是否足够给图像、TTS、视频生成链路直接消费。'),
  };

  const gateFailures = [
    shots.length < 10 || shots.length > 20 ? `镜头数 ${shots.length} 不在10-20范围。` : '',
    totalDuration < 90 || totalDuration > 120 ? `总时长 ${totalDuration}s 不在90-120s范围。` : '',
    noTextViolations > 0 ? `有 ${noTextViolations} 个镜头含字幕/文字/UI风险。` : '',
    hasVisual < shots.length ? '部分镜头画面描述不足。' : '',
    hasMotion < Math.ceil(shots.length * 0.8) ? '动作/运镜描述不足。' : '',
  ].filter(Boolean);

  const issues = [
    englishVisual < Math.ceil(shots.length * 0.6) ? '英文视觉提示比例不足，Veo/视频模型执行稳定性会下降。' : '',
    uniqueRatio < 0.75 ? '镜头视觉描述重复度偏高。' : '',
    hasCamera < Math.ceil(shots.length * 0.6) ? '运镜词不足，动态漫容易变成静态图平移。' : '',
  ].filter(Boolean);

  const overallScore = clampScore(avg(Object.values(dimensions).map((d) => d.score)));
  return {
    kind: 'anime_storyboard',
    overallScore,
    recommendation: recommendationFromScore(overallScore, gateFailures),
    dimensions,
    issues,
    strengths: [
      shots.length >= 10 && shots.length <= 20 ? '镜头数量可控。' : '',
      totalDuration >= 90 && totalDuration <= 120 ? '总时长符合生产目标。' : '',
      hasMotion >= Math.ceil(shots.length * 0.8) ? '动作描述覆盖较完整。' : '',
    ].filter(Boolean),
    gateFailures,
    normalizedShots: shots,
  };
}

export async function judgeAnimeStoryboardWithResearchRubric(input: {
  aiConfig: AIConfig;
  storyboard: unknown;
  novelChunk?: string;
  heuristic?: GenerationQualityReport & { normalizedShots: NormalizedAnimeShot[] };
  callOptions?: AICallOptions;
}): Promise<GenerationQualityReport & { normalizedShots: NormalizedAnimeShot[] }> {
  const heuristic = input.heuristic ?? evaluateAnimeStoryboard(input.storyboard);
  const system = `你是动漫导演、分镜监督和AI视频生成质检员。只输出 JSON。

评分依据：
- VBench 类维度：主体一致性、运动平滑、时间连贯、画面审美、文本一致性。
- 动画原则：staging、timing、anticipation、follow-through、appeal。
- 生产可执行性：每个镜头必须能直接变成图像/视频 prompt，禁止字幕/UI/文字气泡。

维度 0-10：
storyAdaptation, shotComposition, cameraAndMotion, subjectConsistency, temporalContinuity, visualAppeal, promptExecutability, audioNarrationFit, pacing, platformReadiness。`;

  const prompt = `【小说片段】
${input.novelChunk?.slice(0, 2500) || '（未提供）'}

【分镜 JSON】
${JSON.stringify(heuristic.normalizedShots, null, 2)}

【规则启发式初评】
${JSON.stringify(heuristic, null, 2)}

请输出：
{
  "dimensions": {"storyAdaptation": 8, "shotComposition": 8, ...},
  "overallScore": 7.8,
  "issues": ["具体问题"],
  "strengths": ["具体优点"],
  "recommendation": "publish" | "minor_edit" | "rewrite"
}`;

  try {
    const raw = await generateTextWithRetry(input.aiConfig, {
      system,
      prompt,
      temperature: 0.15,
      maxTokens: 1200,
    }, 2, { ...input.callOptions, phase: input.callOptions?.phase ?? 'qc', timeoutMs: input.callOptions?.timeoutMs ?? 120_000 });
    const parsed = AnimeJudgeSchema.parse(JSON.parse(String(raw).replace(/```json\s*|```\s*/g, '').trim()));
    const aiDimensions = Object.fromEntries(
      Object.entries(parsed.dimensions).map(([key, score]) => [key, makeDimension(score10To100(score), 'LLM judge rubric score')]),
    );
    const overallScore = Math.round((heuristic.overallScore * 0.45) + (score10To100(parsed.overallScore) * 0.55));
    return {
      ...heuristic,
      overallScore,
      recommendation: heuristic.gateFailures.length ? 'rewrite' : parsed.recommendation,
      dimensions: { ...heuristic.dimensions, ...aiDimensions },
      issues: [...heuristic.issues, ...parsed.issues].slice(0, 12),
      strengths: [...heuristic.strengths, ...parsed.strengths].slice(0, 10),
    };
  } catch (error) {
    return {
      ...heuristic,
      issues: [...heuristic.issues, `AI storyboard judge failed, using heuristics only: ${(error as Error).message}`].slice(0, 12),
    };
  }
}

export function buildAnimeStoryboardRepairPrompt(input: {
  novelChunk?: string;
  storyboard: NormalizedAnimeShot[];
  report: GenerationQualityReport;
}): string {
  return `请修复以下动态漫分镜 JSON，并只输出 JSON 数组。

硬性目标：
- 10-20 个镜头，总时长 90-120 秒，每镜头 3-8 秒。
- visual_description 和 action_motion 优先英文，具体到主体、环境、构图、光影、动作、运镜。
- narration_text 使用中文，短句，适合 TTS，单条不超过 80 字。
- 禁止任何字幕、文字、logo、UI、气泡。
- 每个镜头都必须有可执行动作：表情、肢体、镜头、环境动态至少两类。
- 保持角色、服装、场景连续，镜头编号从1递增。
- 不新增原文没有的对白/内心独白；旁白只改写原文信息。
- 不突然切到档案室、抽象界面、声波可视化；如果必须离开当前场景，要明确写成主观记忆/闪回转场。
- 关键道具状态必须连续；如果掉落、转手、收起，镜头必须表现原因和结果。

当前问题：
${[...input.report.gateFailures, ...input.report.issues].map((issue, index) => `${index + 1}. ${issue}`).join('\n') || '需要提升整体质量。'}

小说片段：
${input.novelChunk?.slice(0, 3000) || '（未提供）'}

原分镜：
${JSON.stringify(input.storyboard, null, 2)}

请输出修复后的 JSON 数组：`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
