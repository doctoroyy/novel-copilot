import path from 'node:path';
import fs from 'node:fs/promises';
import { generateTextWithRetry, type AIConfig } from './aiClient.js';
import { readBible, readState, writeState, type BookState } from './memory.js';

/**
 * 大纲类型
 */
export type NovelOutline = {
  /** 总章数 */
  totalChapters: number;
  /** 总字数目标 */
  targetWordCount: number;
  /** 分卷大纲 */
  volumes: VolumeOutline[];
  /** 主线目标 */
  mainGoal: string;
  /** 阶段节点 (如第100章、第200章应该完成什么) */
  milestones: string[];
};

export type VolumeOutline = {
  /** 卷名 */
  title: string;
  /** 起始章节 */
  startChapter: number;
  /** 结束章节 */
  endChapter: number;
  /** 本卷目标 */
  goal: string;
  /** 本卷核心冲突 */
  conflict: string;
  /** 本卷高潮 */
  climax: string;
  /** 卷末状态（用于下一卷衔接） */
  volumeEndState?: string;
  /** 章节大纲 */
  chapters: ChapterOutline[];
};

export type ChapterOutline = {
  /** 章节序号 */
  index: number;
  /** 章节标题 */
  title: string;
  /** 本章目标 */
  goal: string;
  /** 章末钩子 */
  hook: string;
};

/**
 * 生成总大纲
 */
export async function generateMasterOutline(
  aiConfig: AIConfig,
  args: {
    bible: string;
    targetChapters: number;
    targetWordCount: number;
    revisionNotes?: string;
  }
): Promise<{ volumes: Omit<VolumeOutline, 'chapters'>[]; mainGoal: string; milestones: string[] }> {
  const { bible, targetChapters, targetWordCount, revisionNotes } = args;

  // 估算分卷数 (通常每 50-100 章一卷)
  const volumeCount = Math.ceil(targetChapters / 80);

  const system = `
你是一个网文大纲策划专家。请根据 Story Bible 生成一个完整的总大纲。
输出严格的 JSON 格式，不要有其他文字。

JSON 结构：
{
  "mainGoal": "整本书的终极目标/主线（50字以内）",
  "milestones": ["第100章里程碑", "第200章里程碑", ...],
  "volumes": [
    {
      "title": "第一卷：xxx",
      "startChapter": 1,
      "endChapter": 80,
      "goal": "本卷要完成什么（30字以内）",
      "conflict": "本卷核心冲突（30字以内）",
      "climax": "本卷高潮（30字以内）"
    },
    ...
  ]
}
`.trim();

  const prompt = `
【Story Bible】
${bible}

${revisionNotes ? `【本轮修订重点】\n${revisionNotes}\n` : ''}

【目标规模】
- 总章数: ${targetChapters} 章
- 总字数: ${targetWordCount} 万字
- 预计分卷数: ${volumeCount} 卷

请生成总大纲：
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.7 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('Failed to parse master outline JSON');
  }
}

/**
 * 生成单卷的章节大纲
 */
export async function generateVolumeChapters(
  aiConfig: AIConfig,
  args: {
    bible: string;
    masterOutline: { mainGoal: string; milestones: string[] };
    volume: Omit<VolumeOutline, 'chapters'>;
    previousVolumeSummary?: string;
    revisionNotes?: string;
  }
): Promise<ChapterOutline[]> {
  const { bible, masterOutline, volume, previousVolumeSummary, revisionNotes } = args;

  const chapterCount = volume.endChapter - volume.startChapter + 1;

  const system = `
你是一个网文章节大纲策划专家。请为一卷生成所有章节的大纲。
输出严格的 JSON 数组格式，不要有其他文字。

每章格式：
{
  "index": 章节序号,
  "title": "章节标题（不含序号）",
  "goal": "本章要完成什么（20字以内）",
  "hook": "章末钩子（20字以内）"
}
`.trim();

  const prompt = `
【Story Bible】
${bible.slice(0, 2000)}...

${revisionNotes ? `【本轮修订重点】\n${revisionNotes}\n` : ''}

【总目标】${masterOutline.mainGoal}

【本卷信息】
- ${volume.title}
- 章节范围: 第${volume.startChapter}章 ~ 第${volume.endChapter}章 (共${chapterCount}章)
- 本卷目标: ${volume.goal}
- 本卷冲突: ${volume.conflict}
- 本卷高潮: ${volume.climax}

${previousVolumeSummary ? `【上卷结尾摘要】\n${previousVolumeSummary}` : '【这是第一卷】'}

请生成本卷所有 ${chapterCount} 章的大纲（JSON数组）：
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.7 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('Failed to parse volume chapters JSON');
  }
}

/**
 * 一键生成完整大纲
 */
export async function generateFullOutline(args: {
  aiConfig: AIConfig;
  projectDir: string;
  targetChapters?: number;
  targetWordCount?: number;
}): Promise<NovelOutline> {
  const { aiConfig, projectDir, targetChapters = 400, targetWordCount = 100 } = args;

  console.log('\n📋 开始生成大纲...');
  console.log(`   目标: ${targetChapters} 章 / ${targetWordCount} 万字\n`);

  const bible = await readBible(projectDir);

  // 1. 生成总大纲
  console.log('1️⃣ 生成总大纲...');
  const master = await generateMasterOutline(aiConfig, { bible, targetChapters, targetWordCount });
  console.log(`   ✅ 主线: ${master.mainGoal}`);
  console.log(`   ✅ 分卷数: ${master.volumes.length}`);

  // 2. 逐卷生成章节大纲
  const volumes: VolumeOutline[] = [];
  let previousVolumeSummary = '';

  for (let i = 0; i < master.volumes.length; i++) {
    const vol = master.volumes[i];
    console.log(`\n2️⃣ 生成 ${vol.title} 的章节大纲 (第${vol.startChapter}-${vol.endChapter}章)...`);

    const chapters = await generateVolumeChapters(aiConfig, {
      bible,
      masterOutline: master,
      volume: vol,
      previousVolumeSummary,
    });

    volumes.push({ ...vol, chapters });
    console.log(`   ✅ 生成了 ${chapters.length} 章大纲`);

    // 为下一卷准备摘要
    previousVolumeSummary = `${vol.title} 完成: ${vol.climax}`;

    // 卷间延迟
    if (i < master.volumes.length - 1) {
      await sleep(2000);
    }
  }

  const outline: NovelOutline = {
    totalChapters: targetChapters,
    targetWordCount,
    volumes,
    mainGoal: master.mainGoal,
    milestones: master.milestones,
  };

  // 3. 保存大纲
  const outlinePath = path.join(projectDir, 'outline.json');
  await fs.writeFile(outlinePath, JSON.stringify(outline, null, 2), 'utf-8');
  console.log(`\n✅ 大纲已保存: ${outlinePath}`);

  // 4. 更新 state.json 的总章数
  const state = await readState(projectDir);
  state.totalChapters = targetChapters;
  await writeState(projectDir, state);

  return outline;
}

/**
 * 读取已保存的大纲
 */
export async function readOutline(projectDir: string): Promise<NovelOutline | null> {
  const outlinePath = path.join(projectDir, 'outline.json');
  try {
    const raw = await fs.readFile(outlinePath, 'utf-8');
    return JSON.parse(raw) as NovelOutline;
  } catch {
    return null;
  }
}

/**
 * 获取指定章节的大纲
 */
export function getChapterOutline(outline: NovelOutline, chapterIndex: number): ChapterOutline | null {
  for (const vol of outline.volumes) {
    const chapter = vol.chapters?.find((c) => c.index === chapterIndex);
    if (chapter) return chapter;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// CLI 入口
const isMain = import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  console.log('CLI mode not supported without AI config. Use the web interface.');
}
