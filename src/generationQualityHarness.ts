import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeEnhancedChapter } from './enhancedChapterEngine.js';
import { generateScript } from './routes/anime.js';
import type { AIConfig } from './services/aiClient.js';
import {
  evaluateAnimeStoryboard,
  evaluateNovelHeuristics,
  extractJsonArray,
  judgeAnimeStoryboardWithResearchRubric,
  judgeNovelWithResearchRubric,
  normalizeAnimeStoryboard,
  QUALITY_RESEARCH_SOURCES,
} from './evaluation/generationQuality.js';

type Row = Record<string, unknown>;

function runWranglerJson(args: string[]): Row[] {
  const raw = execFileSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.flatMap((entry) => entry.results || []) : [];
}

function localQuery(sql: string): Row[] {
  return runWranglerJson(['d1', 'execute', 'novel-copilot-db', '--local', '--json', '--command', sql]);
}

function loadAiConfig(featureKey: string): AIConfig {
  if (process.env.AI_API_KEY) {
    return {
      provider: (process.env.AI_PROVIDER || 'openai') as AIConfig['provider'],
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      apiKey: process.env.AI_API_KEY,
      baseUrl: process.env.AI_BASE_URL,
    };
  }

  const rows = localQuery(`
    SELECT p.id AS provider, p.api_key_encrypted AS apiKey, p.base_url AS baseUrl, m.model_name AS model
    FROM feature_model_mappings fmm
    JOIN model_registry m ON fmm.model_id = m.id
    JOIN provider_registry p ON m.provider_id = p.id
    WHERE fmm.feature_key = '${featureKey.replace(/'/g, "''")}' AND m.is_active = 1 AND COALESCE(p.enabled, 1) = 1
    LIMIT 1
  `);
  const row = rows[0] || localQuery(`
    SELECT p.id AS provider, p.api_key_encrypted AS apiKey, p.base_url AS baseUrl, m.model_name AS model
    FROM model_registry m
    JOIN provider_registry p ON m.provider_id = p.id
    WHERE m.is_active = 1 AND COALESCE(p.enabled, 1) = 1
    ORDER BY m.is_default DESC, p.display_order ASC
    LIMIT 1
  `)[0];

  if (!row?.apiKey || !row?.model || !row?.provider) {
    throw new Error('No local AI config found. Run: pnpm tsx src/syncProviderRegistry.ts, or set AI_API_KEY.');
  }

  return {
    provider: String(row.provider) as AIConfig['provider'],
    model: String(row.model),
    apiKey: String(row.apiKey),
    baseUrl: row.baseUrl ? String(row.baseUrl) : undefined,
  };
}

function maskConfig(config: AIConfig): string {
  return `${config.provider}/${config.model}${config.baseUrl ? ` @ ${config.baseUrl}` : ''}`;
}

async function runNovel(outDir: string, minScore: number): Promise<void> {
  const aiConfig = loadAiConfig('generate_chapter');
  console.log(`Novel model: ${maskConfig(aiConfig)}`);

  const sample = {
    bible: [
      '书名：《夜航档案》',
      '类型：现代悬疑都市异能。',
      '主角：林砚，旧案档案员，能在接触遗物时听见死者最后一句话。弱点是每次使用能力都会失去一段自己的记忆。',
      '核心卖点：旧案重启、记忆代价、城市暗线组织。',
      '当前主线：林砚查到十年前沉船案和母亲失踪有关，反派组织“白塔”正在销毁幸存者名单。',
      '文风：短句、强场景、低解释、高悬念。',
    ].join('\n'),
    rollingSummary: '上一章林砚在旧码头仓库找到母亲留下的铜船票，却被白塔清理员发现。好友姜晚在电话里提醒他，档案馆内鬼已经开始删库。',
    openLoops: ['铜船票上的编号对应哪艘船？', '档案馆内鬼是谁？', '林砚母亲是否还活着？'],
    lastChapters: [
      '雨水砸在铁皮屋顶上。\n\n林砚把铜船票攥进掌心，耳边忽然响起女人断断续续的声音。\n\n“别上船。”\n\n仓库外，手电光一盏接一盏亮起。\n\n有人说：“找到他了。”',
    ],
    chapterGoalHint: '林砚必须带着铜船票逃出码头，同时发现姜晚可能被内鬼控制。章末钩子：船票编号指向一艘不存在的夜航船。',
  };

  let bestText = '';
  let bestReport = evaluateNovelHeuristics({ chapterText: '', minChapterWords: 900 });
  let custom = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await writeEnhancedChapter({
      aiConfig,
      ...sample,
      chapterIndex: 7,
      totalChapters: 180,
      minChapterWords: 900,
      chapterTitle: '不存在的夜航船',
      chapterPromptProfile: 'suspense',
      chapterPromptCustom: custom,
      enablePlanning: true,
      enableSelfReview: true,
      maxSelfReviewAttempts: 1,
      skipSummaryUpdate: true,
      skipStateUpdate: true,
    });
    const heuristic = evaluateNovelHeuristics({
      chapterText: result.chapterText,
      minChapterWords: 900,
      chapterGoal: sample.chapterGoalHint,
      lastChapterTail: sample.lastChapters[0],
      protagonistNames: ['林砚'],
    });
    const report = await judgeNovelWithResearchRubric({
      aiConfig,
      chapterText: result.chapterText,
      chapterIndex: 7,
      totalChapters: 180,
      chapterGoal: sample.chapterGoalHint,
      lastChapterTail: sample.lastChapters[0],
      protagonistNames: ['林砚'],
      fallbackHeuristic: heuristic,
    });
    if (report.overallScore > bestReport.overallScore) {
      bestText = result.chapterText;
      bestReport = report;
    }
    console.log(`Novel attempt ${attempt}: score=${report.overallScore}, rec=${report.recommendation}`);
    if (report.overallScore >= minScore && report.gateFailures.length === 0) break;
    custom = `上一版质检问题：${[...report.gateFailures, ...report.issues].join('；')}。重写时优先补强冲突代价、主角主动选择、章末钩子和角色声音。`;
  }

  await fs.writeFile(path.join(outDir, 'novel-sample.txt'), bestText);
  await fs.writeFile(path.join(outDir, 'novel-report.json'), JSON.stringify(bestReport, null, 2));
}

async function runAnime(outDir: string, minScore: number): Promise<void> {
  const aiConfig = loadAiConfig('generate_video');
  console.log(`Anime model: ${maskConfig(aiConfig)}`);
  const novelChunk = [
    '雨夜，旧码头的警戒线被风吹得啪啪作响。',
    '林砚握着一张发黑的铜船票，从仓库后门冲出来。',
    '他身后，白塔清理员戴着透明雨衣，手里的电击枪蓝光跳动。',
    '姜晚的电话忽然接通，却传来陌生男人的声音：“把票交出来，她还能活。”',
    '林砚低头看见船票编号：N-000。档案里没有这艘船。',
  ].join('\n');

  const raw = await generateScript(novelChunk, 1, aiConfig);
  const shots = normalizeAnimeStoryboard(extractJsonArray(raw));
  const heuristic = evaluateAnimeStoryboard(shots);
  const report = await judgeAnimeStoryboardWithResearchRubric({
    aiConfig,
    storyboard: shots,
    novelChunk,
    heuristic,
  });
  console.log(`Anime storyboard score=${report.overallScore}, rec=${report.recommendation}`);
  if (report.overallScore < minScore || report.gateFailures.length) {
    console.log(`Anime storyboard still below target after repair loop: target=${minScore}`);
  }

  await fs.writeFile(path.join(outDir, 'anime-storyboard.json'), JSON.stringify(report.normalizedShots, null, 2));
  await fs.writeFile(path.join(outDir, 'anime-report.json'), JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--novel-only') ? 'novel' : args.includes('--anime-only') ? 'anime' : 'all';
  const minScoreArg = args.find((arg) => arg.startsWith('--min-score='));
  const minScore = minScoreArg ? Number(minScoreArg.split('=')[1]) : 78;
  const outDir = path.join(process.cwd(), 'tmp', 'generation-quality', String(Date.now()));
  await fs.mkdir(outDir, { recursive: true });

  await fs.writeFile(path.join(outDir, 'research-sources.json'), JSON.stringify(QUALITY_RESEARCH_SOURCES, null, 2));
  console.log(`Output: ${outDir}`);

  if (mode === 'novel' || mode === 'all') await runNovel(outDir, minScore);
  if (mode === 'anime' || mode === 'all') await runAnime(outDir, minScore);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
