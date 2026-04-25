/**
 * LLM-as-judge 章节质量评测
 *
 * 用小号 LLM 对生成的章节在多维度评分（0~10），输出结构化 JSON。
 * 用途：
 * - 回归测试 golden metric（baseline vs new prompt 对比）
 * - 生产侧抽样监控
 *
 * 评分维度来自《黄金三章与追读技巧》方法论 + 头部平台编辑公开标准。
 */

import { z } from 'zod';
import {
  generateTextWithFallback,
  generateTextWithRetry,
  type AIConfig,
  type FallbackConfig,
  type AICallOptions,
} from '../services/aiClient.js';
import { evaluateNovelHeuristics, QUALITY_RESEARCH_SOURCES } from '../evaluation/generationQuality.js';

const WritingQualityScoreSchema = z.object({
  dimensions: z.object({
    hook: z.number().min(0).max(10), // 章末钩子强度
    satisfaction: z.number().min(0).max(10), // 爽点/进展密度
    prose: z.number().min(0).max(10), // 文笔（句长控制、对话自然度）
    pacing: z.number().min(0).max(10), // 节奏（张弛有度）
    infoAsymmetry: z.number().min(0).max(10), // 信息差运用
    protagonistAgency: z.number().min(0).max(10), // 主角主动性
    continuity: z.number().min(0).max(10), // 与上下文一致性
    openingPull: z.number().min(0).max(10), // 开头拉力（前300字吸引力）
    characterBelievability: z.number().min(0).max(10), // 角色行为可信度
    sceneCausality: z.number().min(0).max(10), // 场景因果链
    genreFit: z.number().min(0).max(10), // 类型承诺兑现
    voiceDistinctiveness: z.number().min(0).max(10), // 人物声音区分
  }),
  overallScore: z.number().min(0).max(10),
  issues: z.array(z.string()).max(8),
  strengths: z.array(z.string()).max(5),
  recommendation: z.enum(['publish', 'minor_edit', 'rewrite']),
});

export type WritingQualityScore = z.infer<typeof WritingQualityScoreSchema>;

export interface JudgeInput {
  aiConfig: AIConfig;
  fallbackConfigs?: AIConfig[];
  chapterText: string;
  chapterIndex: number;
  totalChapters: number;
  chapterGoal?: string;
  lastChapterTail?: string; // 用于连贯性判断
  protagonistNames?: string[];
  callOptions?: AICallOptions;
}

export async function judgeChapterQuality(input: JudgeInput): Promise<WritingQualityScore> {
  const {
    aiConfig,
    fallbackConfigs,
    chapterText,
    chapterIndex,
    totalChapters,
    chapterGoal,
    lastChapterTail,
    protagonistNames,
    callOptions,
  } = input;

  const isOpening = chapterIndex <= 3;

  const heuristic = evaluateNovelHeuristics({
    chapterText,
    minChapterWords: undefined,
    chapterGoal,
    lastChapterTail,
    protagonistNames,
  });

  const researchNotes = QUALITY_RESEARCH_SOURCES
    .filter((source) => source.label.includes('fiction') || source.label.includes('writing'))
    .map((source) => `- ${source.label}: ${source.takeaway}`)
    .join('\n');

  const system = `你是起点白金/番茄金番级别网文编辑。对章节做严格商业化打分。
只输出严格 JSON，不要任何其他文字。

评分依据：
${researchNotes}

评分标准（0~10，7分=商业可发，8.5+=头部大神水平）：
- hook 章末钩子：最后300字是否有明确未完成事件/悬念/反转
- satisfaction 爽点：主角是否展示能力、获得进展、赢得冲突、揭露信息、推进关系
- prose 文笔：句长是否控制在25字内，对话是否自然、像真人，无文艺腔/话剧腔
- pacing 节奏：是否张弛有度，无注水，无长段心理独白或环境描写
- infoAsymmetry 信息差：是否运用主角/读者/角色间的信息差制造期待感
- protagonistAgency 主角主动性：主角是否是剧情推动者，禁止旁观/被动
- continuity 连贯性：是否与上章钩子、人物状态、设定一致；是否重复已写过的情节
- openingPull 开头拉力：前300字是否让读者想继续读下去
- characterBelievability 角色可信：角色行为、认知和能力边界是否符合已知设定
- sceneCausality 场景因果：每个场景是否有目标、阻碍、行动、结果，而不是散点堆砌
- genreFit 类型契约：是否兑现题材读者期待，同时避免廉价套路
- voiceDistinctiveness 人物声音：主要角色说话方式是否能区分，有真实口语节奏
${isOpening ? '- 【当前是黄金三章】openingPull 权重加倍；禁止长段设定/日常；出场≤5人\n' : ''}

overallScore = 所有维度的加权平均（hook/satisfaction/openingPull/conflict 权重略高）
recommendation:
- publish: overall ≥ 7.5 且无维度 < 6
- minor_edit: overall ≥ 6.5 但有局部瑕疵
- rewrite: overall < 6.5 或任一维度 < 4

输出格式：
{
  "dimensions": {"hook": 7.5, "satisfaction": 7, "prose": 8, "pacing": 7, "infoAsymmetry": 6, "protagonistAgency": 8, "continuity": 8, "openingPull": 7, "characterBelievability": 7, "sceneCausality": 7, "genreFit": 7, "voiceDistinctiveness": 7},
  "overallScore": 7.3,
  "issues": ["具体问题1（引用章节原文片段）", ...],
  "strengths": ["亮点1", ...],
  "recommendation": "minor_edit"
}`;

  const prompt = `【章节信息】
- 当前第 ${chapterIndex}/${totalChapters} 章${isOpening ? '（黄金三章）' : ''}
${chapterGoal ? `- 本章目标: ${chapterGoal}` : ''}
${protagonistNames?.length ? `- 主角: ${protagonistNames.join('/')}` : ''}

${lastChapterTail ? `【上章结尾（用于连贯性判断）】\n${lastChapterTail.slice(-300)}\n` : ''}
【待评章节正文】
${chapterText}

【规则启发式初评（用于提醒，不要机械照抄）】
${JSON.stringify(heuristic, null, 2)}

请输出 JSON 评分：`;

  const effectiveCallOptions: AICallOptions = {
    ...callOptions,
    phase: callOptions?.phase ?? 'qc',
    timeoutMs: callOptions?.timeoutMs ?? 120_000,
  };

  let raw: string;
  if (fallbackConfigs?.length) {
    const fc: FallbackConfig = {
      primary: aiConfig,
      fallback: fallbackConfigs,
      switchConditions: ['rate_limit', 'server_error', 'timeout', 'unknown'],
    };
    raw = await generateTextWithFallback(
      fc,
      { system, prompt, temperature: 0.2, maxTokens: 800 },
      2,
      effectiveCallOptions,
    );
  } else {
    raw = await generateTextWithRetry(
      aiConfig,
      { system, prompt, temperature: 0.2, maxTokens: 800 },
      3,
      effectiveCallOptions,
    );
  }

  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
  const parsed = JSON.parse(jsonText);
  return WritingQualityScoreSchema.parse(parsed);
}

/**
 * 打分对比：baseline vs new，便于快速看改动是否带来提升。
 */
export function diffScores(baseline: WritingQualityScore, next: WritingQualityScore): {
  overallDelta: number;
  dimensionDeltas: Record<string, number>;
  summary: string;
} {
  const dimensionDeltas: Record<string, number> = {};
  for (const [k, v] of Object.entries(baseline.dimensions)) {
    const nv = (next.dimensions as Record<string, number>)[k];
    dimensionDeltas[k] = Number((nv - v).toFixed(2));
  }
  const overallDelta = Number((next.overallScore - baseline.overallScore).toFixed(2));
  const improved = Object.entries(dimensionDeltas)
    .filter(([, d]) => d > 0.3)
    .map(([k, d]) => `${k}+${d.toFixed(1)}`);
  const regressed = Object.entries(dimensionDeltas)
    .filter(([, d]) => d < -0.3)
    .map(([k, d]) => `${k}${d.toFixed(1)}`);
  const summary = [
    `overall ${baseline.overallScore.toFixed(1)} → ${next.overallScore.toFixed(1)} (Δ${overallDelta >= 0 ? '+' : ''}${overallDelta.toFixed(1)})`,
    improved.length ? `提升: ${improved.join(', ')}` : '',
    regressed.length ? `退化: ${regressed.join(', ')}` : '',
  ].filter(Boolean).join(' | ');
  return { overallDelta, dimensionDeltas, summary };
}
