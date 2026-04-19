/**
 * 写作质量回归脚本
 *
 * 从生产 D1 库拉取真实项目的完整上下文（bible/outline/state/characters/lastChapters），
 * 分别用 legacy prompt 和 new prompt 生成同一章，然后交给 LLM-as-judge 打分对比。
 *
 * 用法：
 *   # 单个项目单章
 *   tsx src/qualityBenchmark.ts <projectId> [chapterIndex]
 *   # 多项目批量（默认跑 5 个最近活跃项目的各 1 章）
 *   tsx src/qualityBenchmark.ts --batch [--limit=5]
 *
 * 环境变量：
 *   AI_PROVIDER / AI_MODEL / AI_API_KEY / AI_BASE_URL —— 主生成模型（默认读 config.json）
 *   JUDGE_MODEL / JUDGE_PROVIDER —— judge 模型（默认与主模型相同）
 *   BENCH_LIMIT —— 批量时最多跑几个项目
 *   BENCH_SKIP_NEW=1 —— 只跑 legacy 不跑 new（用于建立 baseline 档案）
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { writeEnhancedChapter } from './enhancedChapterEngine.js';
import { judgeChapterQuality, diffScores, type WritingQualityScore } from './qc/writingQualityJudge.js';
import { buildEnhancedOutlineFromChapterContext, getOutlineChapterContext } from './utils/outline.js';
import type { AIConfig } from './services/aiClient.js';
import type { NovelOutline } from './generateOutline.js';
import type { CharacterRelationGraph } from './types/characters.js';
import type { CharacterStateRegistry } from './types/characterState.js';
import type { PlotGraph } from './types/plotGraph.js';
import type { NarrativeArc } from './types/narrative.js';
import type { TimelineState } from './types/timeline.js';

interface ProjectContext {
  id: string;
  name: string;
  bible: string;
  chapterPromptProfile: string;
  chapterPromptCustom: string;
  customSystemPrompt: string | null;
  state: {
    totalChapters: number;
    nextChapterIndex: number;
    rollingSummary: string;
    openLoops: string[];
    minChapterWords: number;
  };
  outline: NovelOutline | null;
  characters: CharacterRelationGraph | undefined;
  characterStates: CharacterStateRegistry | undefined;
  plotGraph: PlotGraph | undefined;
  narrativeArc: NarrativeArc | undefined;
  timeline: TimelineState | undefined;
  lastChapters: string[];
}

function d1(sql: string): any {
  const escaped = sql.replace(/'/g, "'\\''");
  const raw = execSync(
    `wrangler d1 execute novel-copilot-db --remote --json --command '${escaped}'`,
    { maxBuffer: 64 * 1024 * 1024 },
  ).toString();
  const parsed = JSON.parse(raw);
  return parsed[0]?.results || [];
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function parseJsonSafe<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function fetchProjectContext(projectId: string, chapterIndex?: number): Promise<ProjectContext> {
  const projectRow = d1(`SELECT * FROM projects WHERE id='${sqlEscape(projectId)}' AND deleted_at IS NULL`)[0];
  if (!projectRow) throw new Error(`Project ${projectId} not found`);
  const stateRow = d1(`SELECT * FROM states WHERE project_id='${sqlEscape(projectId)}'`)[0] || {};
  const outlineRow = d1(`SELECT outline_json FROM outlines WHERE project_id='${sqlEscape(projectId)}'`)[0];
  const charactersRow = d1(`SELECT characters_json AS data FROM characters WHERE project_id='${sqlEscape(projectId)}'`)[0];
  const charStateRow = d1(`SELECT registry_json AS data FROM character_states WHERE project_id='${sqlEscape(projectId)}'`)[0];
  const plotRow = d1(`SELECT graph_json AS data FROM plot_graphs WHERE project_id='${sqlEscape(projectId)}'`)[0];
  const narrativeRow = d1(`SELECT narrative_arc_json AS data FROM narrative_config WHERE project_id='${sqlEscape(projectId)}'`)[0];

  const targetChapterIndex = chapterIndex ?? Number(stateRow.next_chapter_index || 1);
  const lastRows = d1(
    `SELECT chapter_index, content FROM chapters WHERE project_id='${sqlEscape(projectId)}' AND deleted_at IS NULL AND chapter_index < ${targetChapterIndex} ORDER BY chapter_index DESC LIMIT 2`,
  );
  const lastChapters = lastRows
    .sort((a: any, b: any) => a.chapter_index - b.chapter_index)
    .map((r: any) => String(r.content || ''));

  return {
    id: projectId,
    name: String(projectRow.name || ''),
    bible: String(projectRow.bible || ''),
    chapterPromptProfile: String(projectRow.chapter_prompt_profile || 'web_novel_light'),
    chapterPromptCustom: String(projectRow.chapter_prompt_custom || ''),
    customSystemPrompt: projectRow.custom_system_prompt ? String(projectRow.custom_system_prompt) : null,
    state: {
      totalChapters: Number(stateRow.total_chapters || 400),
      nextChapterIndex: targetChapterIndex,
      rollingSummary: String(stateRow.rolling_summary || ''),
      openLoops: parseJsonSafe<string[]>(stateRow.open_loops, []),
      minChapterWords: Number(stateRow.min_chapter_words || 2500),
    },
    outline: outlineRow ? parseJsonSafe<NovelOutline | null>(outlineRow.outline_json, null) : null,
    characters: charactersRow ? parseJsonSafe<CharacterRelationGraph | undefined>(charactersRow.data, undefined) : undefined,
    characterStates: charStateRow ? parseJsonSafe<CharacterStateRegistry | undefined>(charStateRow.data, undefined) : undefined,
    plotGraph: plotRow ? parseJsonSafe<PlotGraph | undefined>(plotRow.data, undefined) : undefined,
    narrativeArc: narrativeRow ? parseJsonSafe<NarrativeArc | undefined>(narrativeRow.data, undefined) : undefined,
    timeline: undefined,
    lastChapters,
  };
}

function loadAiConfig(): AIConfig {
  if (process.env.AI_API_KEY) {
    return {
      provider: (process.env.AI_PROVIDER || 'openai') as AIConfig['provider'],
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      apiKey: process.env.AI_API_KEY,
      baseUrl: process.env.AI_BASE_URL,
    };
  }
  const cfgPath = path.join(process.cwd(), 'config.json');
  try {
    const cfg = JSON.parse(fsSync.readFileSync(cfgPath, 'utf-8'));
    return {
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
    };
  } catch {
    throw new Error('请设置 AI_API_KEY 或提供 config.json');
  }
}

function loadJudgeConfig(primary: AIConfig): AIConfig {
  if (process.env.JUDGE_MODEL) {
    return {
      provider: (process.env.JUDGE_PROVIDER || primary.provider) as AIConfig['provider'],
      model: process.env.JUDGE_MODEL,
      apiKey: process.env.JUDGE_API_KEY || primary.apiKey,
      baseUrl: process.env.JUDGE_BASE_URL || primary.baseUrl,
    };
  }
  return primary;
}

async function generateWithMode(
  ctx: ProjectContext,
  aiConfig: AIConfig,
  mode: 'legacy' | 'new',
): Promise<{ chapterText: string; durationMs: number }> {
  // 通过修改 env 切换 legacy/new
  const prevFlag = process.env.WRITING_RULES_LEGACY;
  process.env.WRITING_RULES_LEGACY = mode === 'legacy' ? '1' : '';
  try {
    const chapterIndex = ctx.state.nextChapterIndex;
    const outlineContext = ctx.outline
      ? getOutlineChapterContext(ctx.outline, chapterIndex)
      : null;
    const enhancedOutline = outlineContext
      ? buildEnhancedOutlineFromChapterContext(outlineContext)
      : undefined;
    const chapterTitle = outlineContext?.chapter.title;
    const chapterGoalHint = outlineContext
      ? [
        '【章节大纲】',
        `- 标题: ${outlineContext.chapter.title}`,
        `- 目标: ${outlineContext.chapter.goal}`,
        `- 章末钩子: ${outlineContext.chapter.hook}`,
      ].join('\n')
      : undefined;

    const startedAt = Date.now();
    const result = await writeEnhancedChapter({
      aiConfig,
      bible: ctx.bible,
      rollingSummary: ctx.state.rollingSummary,
      openLoops: ctx.state.openLoops,
      lastChapters: ctx.lastChapters,
      chapterIndex,
      totalChapters: ctx.state.totalChapters,
      minChapterWords: ctx.state.minChapterWords,
      chapterGoalHint,
      chapterTitle,
      enhancedOutline,
      outlineContext: outlineContext ?? undefined,
      chapterPromptProfile: ctx.chapterPromptProfile,
      chapterPromptCustom: ctx.chapterPromptCustom,
      // 注意：对比 prompt 生效，这里故意不把 customSystemPrompt 传入 —— 否则新旧规则都会被覆盖
      customSystemPrompt: null,
      characters: ctx.characters,
      characterStates: ctx.characterStates,
      plotGraph: ctx.plotGraph,
      narrativeArc: ctx.narrativeArc,
      skipSummaryUpdate: true,
      skipStateUpdate: true,
    });
    return { chapterText: result.chapterText, durationMs: Date.now() - startedAt };
  } finally {
    if (prevFlag === undefined) delete process.env.WRITING_RULES_LEGACY;
    else process.env.WRITING_RULES_LEGACY = prevFlag;
  }
}

interface ProjectBenchResult {
  projectId: string;
  projectName: string;
  chapterIndex: number;
  legacy: { text: string; durationMs: number; score: WritingQualityScore };
  next: { text: string; durationMs: number; score: WritingQualityScore };
  diff: ReturnType<typeof diffScores>;
}

async function benchmarkOne(
  projectId: string,
  chapterIndex: number | undefined,
  aiConfig: AIConfig,
  judgeConfig: AIConfig,
  outDir: string,
): Promise<ProjectBenchResult> {
  console.log(`\n═══ 项目 ${projectId} ═══`);
  const ctx = await fetchProjectContext(projectId, chapterIndex);
  const targetIdx = ctx.state.nextChapterIndex;
  console.log(`《${ctx.name}》第 ${targetIdx}/${ctx.state.totalChapters} 章`);

  console.log('[1/4] 生成 legacy 章节...');
  const legacy = await generateWithMode(ctx, aiConfig, 'legacy');
  console.log(`  耗时 ${(legacy.durationMs / 1000).toFixed(1)}s，${legacy.chapterText.length} 字`);

  console.log('[2/4] 生成 new 章节...');
  const next = await generateWithMode(ctx, aiConfig, 'new');
  console.log(`  耗时 ${(next.durationMs / 1000).toFixed(1)}s，${next.chapterText.length} 字`);

  const outlineContext = ctx.outline
    ? getOutlineChapterContext(ctx.outline, targetIdx)
    : null;
  const chapterGoal = outlineContext?.chapter.goal;
  const lastTail = ctx.lastChapters[ctx.lastChapters.length - 1];
  const protagonistNames = ctx.characters?.protagonists?.map((p) => p.name).filter(Boolean);

  console.log('[3/4] Judge 打分 legacy...');
  const legacyScore = await judgeChapterQuality({
    aiConfig: judgeConfig,
    chapterText: legacy.chapterText,
    chapterIndex: targetIdx,
    totalChapters: ctx.state.totalChapters,
    chapterGoal,
    lastChapterTail: lastTail,
    protagonistNames,
  });
  console.log(`  overall ${legacyScore.overallScore.toFixed(1)} / rec=${legacyScore.recommendation}`);

  console.log('[4/4] Judge 打分 new...');
  const nextScore = await judgeChapterQuality({
    aiConfig: judgeConfig,
    chapterText: next.chapterText,
    chapterIndex: targetIdx,
    totalChapters: ctx.state.totalChapters,
    chapterGoal,
    lastChapterTail: lastTail,
    protagonistNames,
  });
  console.log(`  overall ${nextScore.overallScore.toFixed(1)} / rec=${nextScore.recommendation}`);

  const diff = diffScores(legacyScore, nextScore);
  console.log(`  ${diff.summary}`);

  const result: ProjectBenchResult = {
    projectId,
    projectName: ctx.name,
    chapterIndex: targetIdx,
    legacy: { text: legacy.chapterText, durationMs: legacy.durationMs, score: legacyScore },
    next: { text: next.chapterText, durationMs: next.durationMs, score: nextScore },
    diff,
  };

  // 落盘
  const safe = `${projectId.slice(0, 8)}_ch${targetIdx}`;
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${safe}_legacy.txt`), legacy.chapterText);
  await fs.writeFile(path.join(outDir, `${safe}_new.txt`), next.chapterText);
  await fs.writeFile(path.join(outDir, `${safe}_result.json`), JSON.stringify(result, null, 2));
  return result;
}

function printAggregateReport(results: ProjectBenchResult[]): void {
  console.log('\n\n══════════ 综合报告 ══════════');
  const dims = Object.keys(results[0].legacy.score.dimensions) as Array<keyof WritingQualityScore['dimensions']>;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

  const overallLegacy = avg(results.map((r) => r.legacy.score.overallScore));
  const overallNew = avg(results.map((r) => r.next.score.overallScore));
  console.log(`总体均分 ${overallLegacy.toFixed(2)} → ${overallNew.toFixed(2)} (Δ${(overallNew - overallLegacy).toFixed(2)})`);

  console.log('\n各维度均分：');
  for (const d of dims) {
    const l = avg(results.map((r) => r.legacy.score.dimensions[d]));
    const n = avg(results.map((r) => r.next.score.dimensions[d]));
    const delta = n - l;
    const mark = delta >= 0.5 ? '✓' : delta <= -0.3 ? '✗' : ' ';
    console.log(`  ${mark} ${d.padEnd(22)} ${l.toFixed(2)} → ${n.toFixed(2)}  (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);
  }

  const legacyDuration = avg(results.map((r) => r.legacy.durationMs));
  const newDuration = avg(results.map((r) => r.next.durationMs));
  console.log(`\n生成耗时 ${(legacyDuration / 1000).toFixed(1)}s → ${(newDuration / 1000).toFixed(1)}s`);

  console.log('\n每项目对比：');
  for (const r of results) {
    console.log(`  [${r.projectId.slice(0, 8)}] 第${r.chapterIndex}章《${r.projectName.slice(0, 16)}》: ${r.diff.summary}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const aiConfig = loadAiConfig();
  const judgeConfig = loadJudgeConfig(aiConfig);
  const outDir = path.join(process.cwd(), 'tmp', 'quality-bench');
  console.log(`生成模型: ${aiConfig.provider}/${aiConfig.model}`);
  console.log(`评测模型: ${judgeConfig.provider}/${judgeConfig.model}`);
  console.log(`产物目录: ${outDir}`);

  const results: ProjectBenchResult[] = [];

  if (args[0] === '--batch') {
    const limit = Number(process.env.BENCH_LIMIT || args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 5);
    const rows = d1(
      `SELECT p.id, s.next_chapter_index FROM projects p JOIN states s ON s.project_id=p.id
       WHERE p.deleted_at IS NULL AND s.next_chapter_index >= 2 AND s.next_chapter_index <= s.total_chapters
       ORDER BY p.updated_at DESC LIMIT ${limit}`,
    );
    console.log(`批量模式：${rows.length} 个项目`);
    for (const row of rows) {
      try {
        const r = await benchmarkOne(String(row.id), undefined, aiConfig, judgeConfig, outDir);
        results.push(r);
      } catch (err) {
        console.error(`项目 ${row.id} 失败:`, (err as Error).message);
      }
    }
  } else if (args[0]) {
    const chapterIndex = args[1] ? Number(args[1]) : undefined;
    results.push(await benchmarkOne(args[0], chapterIndex, aiConfig, judgeConfig, outDir));
  } else {
    console.error('用法: tsx src/qualityBenchmark.ts <projectId> [chapterIndex]  |  --batch');
    process.exit(1);
  }

  if (results.length > 1) {
    printAggregateReport(results);
  }

  await fs.writeFile(
    path.join(outDir, `summary_${Date.now()}.json`),
    JSON.stringify(results.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      chapterIndex: r.chapterIndex,
      legacyScore: r.legacy.score.overallScore,
      legacyDimensions: r.legacy.score.dimensions,
      newScore: r.next.score.overallScore,
      newDimensions: r.next.score.dimensions,
      diff: r.diff.dimensionDeltas,
      legacyDurationMs: r.legacy.durationMs,
      newDurationMs: r.next.durationMs,
    })), null, 2),
  );

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const deltaOverall = avg(results.map((r) => r.next.score.overallScore)) - avg(results.map((r) => r.legacy.score.overallScore));
  if (deltaOverall >= 0.5) {
    console.log(`\n✅ 升级成功：综合提升 +${deltaOverall.toFixed(2)}`);
  } else if (deltaOverall >= 0) {
    console.log(`\n⚠️ 提升有限：+${deltaOverall.toFixed(2)}，建议检查低分维度后继续迭代`);
  } else {
    console.log(`\n❌ 出现退化：${deltaOverall.toFixed(2)}，请勿上线`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
