import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';

export type PacingCurveAnalysis = {
  score: number;
  deadSpots: { from: number; to: number; reason: string }[];
};

export type CharacterArcAnalysis = {
  score: number;
  characters: { name: string; arcComplete: boolean; notes: string }[];
};

export type PlotThreadAnalysis = {
  score: number;
  unresolvedCount: number;
  threads: { description: string; introducedAt: number }[];
};

export type ConflictDensityAnalysis = {
  score: number;
  distribution: { range: string; density: number }[];
};

export type GlobalAnalysis = {
  pacingCurve: PacingCurveAnalysis;
  characterArcs: CharacterArcAnalysis;
  plotThreads: PlotThreadAnalysis;
  conflictDensity: ConflictDensityAnalysis;
};

function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  return JSON.parse(raw);
}

function condenseSummaries(chapterSummaries: string[], maxLen = 200): string {
  const total = chapterSummaries.length;
  let selected: { idx: number; text: string }[];

  if (total <= 50) {
    selected = chapterSummaries.map((s, i) => ({ idx: i + 1, text: s.slice(0, maxLen) }));
  } else {
    const step = Math.ceil(total / 50);
    selected = chapterSummaries
      .filter((_, i) => i % step === 0)
      .map((s, i) => ({ idx: i * step + 1, text: s.slice(0, maxLen) }));
  }

  return selected.map((s) => `第${s.idx}章: ${s.text}`).join('\n');
}

export async function analyzePacingCurve(
  aiConfig: AIConfig,
  chapterSummaries: string[]
): Promise<PacingCurveAnalysis> {
  const summaries = condenseSummaries(chapterSummaries);
  const system = '你是一位专业的小说节奏分析师。请以JSON格式回复。';
  const prompt = `分析以下小说各章节的节奏与张力变化曲线。识别连续多章张力下降的"死点"区域。

章节概要：
${summaries}

请返回JSON格式：
{
  "score": 0-100的节奏评分,
  "deadSpots": [{ "from": 起始章节号, "to": 结束章节号, "reason": "张力下降原因" }]
}`;

  try {
    const result = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.3 });
    const parsed = extractJSON(result) as PacingCurveAnalysis;
    return {
      score: parsed.score ?? 70,
      deadSpots: Array.isArray(parsed.deadSpots) ? parsed.deadSpots : [],
    };
  } catch {
    return { score: 70, deadSpots: [] };
  }
}

export async function analyzeCharacterArcs(
  aiConfig: AIConfig,
  chapterSummaries: string[],
  characterNames: string[]
): Promise<CharacterArcAnalysis> {
  const summaries = condenseSummaries(chapterSummaries);
  const names = characterNames.join('、');
  const system = '你是一位专业的角色弧光分析师。请以JSON格式回复。';
  const prompt = `分析以下小说中主要角色的成长弧光是否完整。

主要角色：${names}

章节概要：
${summaries}

请评估每个角色是否有完整的性格发展弧光（起点→冲突→转变→成长），返回JSON：
{
  "score": 0-100的整体角色弧光评分,
  "characters": [{ "name": "角色名", "arcComplete": true/false, "notes": "弧光分析说明" }]
}`;

  try {
    const result = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.3 });
    const parsed = extractJSON(result) as CharacterArcAnalysis;
    return {
      score: parsed.score ?? 70,
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
    };
  } catch {
    return {
      score: 70,
      characters: characterNames.map((name) => ({ name, arcComplete: false, notes: '分析失败' })),
    };
  }
}

export async function analyzePlotThreads(
  aiConfig: AIConfig,
  chapterSummaries: string[]
): Promise<PlotThreadAnalysis> {
  const summaries = condenseSummaries(chapterSummaries);
  const system = '你是一位专业的情节线索分析师。请以JSON格式回复。';
  const prompt = `分析以下小说中的情节线索，找出未解决的伏笔和悬而未决的线索。

章节概要：
${summaries}

识别所有被引入但从未得到回应或解决的情节线索，返回JSON：
{
  "score": 0-100的情节线索完整度评分,
  "unresolvedCount": 未解决线索数量,
  "threads": [{ "description": "线索描述", "introducedAt": 引入章节号 }]
}`;

  try {
    const result = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.3 });
    const parsed = extractJSON(result) as PlotThreadAnalysis;
    return {
      score: parsed.score ?? 70,
      unresolvedCount: parsed.unresolvedCount ?? 0,
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
    };
  } catch {
    return { score: 70, unresolvedCount: 0, threads: [] };
  }
}

export async function analyzeConflictDensity(
  aiConfig: AIConfig,
  chapterSummaries: string[]
): Promise<ConflictDensityAnalysis> {
  const total = chapterSummaries.length;
  const rangeSize = Math.max(5, Math.ceil(total / 10));
  const ranges: string[] = [];
  for (let i = 0; i < total; i += rangeSize) {
    const end = Math.min(i + rangeSize, total);
    ranges.push(`第${i + 1}-${end}章`);
  }

  const summaries = condenseSummaries(chapterSummaries);
  const system = '你是一位专业的小说冲突密度分析师。请以JSON格式回复。';
  const prompt = `分析以下小说各章节范围内的冲突密度分布。

章节概要：
${summaries}

请按以下范围评估冲突密度（0-100）：${ranges.join('、')}

返回JSON：
{
  "score": 0-100的整体冲突密度评分,
  "distribution": [{ "range": "第1-10章", "density": 冲突密度分数 }]
}`;

  try {
    const result = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.3 });
    const parsed = extractJSON(result) as ConflictDensityAnalysis;
    return {
      score: parsed.score ?? 70,
      distribution: Array.isArray(parsed.distribution) ? parsed.distribution : [],
    };
  } catch {
    return { score: 70, distribution: [] };
  }
}

export async function runGlobalAnalysis(
  aiConfig: AIConfig,
  chapterSummaries: string[],
  characterNames: string[]
): Promise<GlobalAnalysis> {
  const pacingCurve = await analyzePacingCurve(aiConfig, chapterSummaries);
  const characterArcs = await analyzeCharacterArcs(aiConfig, chapterSummaries, characterNames);
  const plotThreads = await analyzePlotThreads(aiConfig, chapterSummaries);
  const conflictDensity = await analyzeConflictDensity(aiConfig, chapterSummaries);

  return { pacingCurve, characterArcs, plotThreads, conflictDensity };
}
