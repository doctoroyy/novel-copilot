import fs from 'node:fs/promises';
import path from 'node:path';
import 'dotenv/config';
import { writeEnhancedChapter } from './enhancedChapterEngine.js';
import { readBible, readLastChapters, readState } from './memory.js';
import { getChapterOutline, readOutline } from './generateOutline.js';
import type { AIConfig } from './services/aiClient.js';

type OptionalJson = Record<string, unknown> | Array<unknown> | null;

async function readOptionalJson(filePath: string): Promise<OptionalJson> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as OptionalJson;
  } catch {
    return null;
  }
}

function buildAiConfigFromEnv(): AIConfig {
  return {
    provider: (process.env.AI_PROVIDER || 'gemini') as AIConfig['provider'],
    model: process.env.AI_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-preview',
    apiKey: process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL,
  };
}

function parsePositiveInt(input: string | undefined): number | undefined {
  if (!input) return undefined;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

async function main(): Promise<void> {
  const aiConfig = buildAiConfigFromEnv();
  if (!aiConfig.apiKey) {
    throw new Error('Missing AI_API_KEY or GEMINI_API_KEY environment variable');
  }

  const projectDir = process.argv[2] || path.join(process.cwd(), 'projects', 'demo-book');
  const requestedChapterIndex = parsePositiveInt(process.argv[3]);
  const state = await readState(projectDir);
  const bible = await readBible(projectDir);
  const lastChapters = await readLastChapters(projectDir, 2);
  const outline = await readOutline(projectDir);

  const chapterIndex = requestedChapterIndex || state.nextChapterIndex;
  const totalChapters = state.totalChapters;
  const chapterOutline = outline ? getChapterOutline(outline, chapterIndex) : null;
  const chapterTitle = chapterOutline?.title;
  const chapterGoalHint = chapterOutline
    ? [
      '【章节大纲】',
      `- 标题: ${chapterOutline.title}`,
      `- 目标: ${chapterOutline.goal}`,
      `- 章末钩子: ${chapterOutline.hook}`,
    ].join('\n')
    : undefined;

  const characters = await readOptionalJson(path.join(projectDir, 'characters.json'));
  const characterStates = await readOptionalJson(path.join(projectDir, 'character_states.json'));
  const plotGraph = await readOptionalJson(path.join(projectDir, 'plot_graph.json'));
  const narrativeArc = await readOptionalJson(path.join(projectDir, 'narrative_arc.json'));

  const benchmarkStartedAt = Date.now();
  const result = await writeEnhancedChapter({
    aiConfig,
    bible,
    rollingSummary: state.rollingSummary,
    openLoops: state.openLoops,
    lastChapters,
    chapterIndex,
    totalChapters,
    minChapterWords: state.minChapterWords,
    chapterGoalHint,
    chapterTitle,
    characters: (characters || undefined) as any,
    characterStates: (characterStates || undefined) as any,
    plotGraph: (plotGraph || undefined) as any,
    timeline: state.timeline,
    narrativeArc: (narrativeArc || undefined) as any,
    enableContextOptimization: true,
    enablePlanning: true,
    enableSelfReview: true,
    enableFullQC: false,
    enableAutoRepair: false,
  });

  const report = {
    projectDir,
    chapterIndex,
    totalChapters,
    title: chapterTitle || null,
    model: `${aiConfig.provider}/${aiConfig.model}`,
    outputChars: result.chapterText.length,
    wallClockMs: Date.now() - benchmarkStartedAt,
    generationDurationMs: result.generationDurationMs,
    summaryDurationMs: result.summaryDurationMs,
    totalDurationMs: result.totalDurationMs,
    wasRewritten: result.wasRewritten,
    rewriteCount: result.rewriteCount,
    skippedSummary: result.skippedSummary,
    diagnostics: result.diagnostics,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('[benchmark:chapter] failed:', (error as Error).message);
  process.exit(1);
});
