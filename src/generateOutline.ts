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
    minChapterWords?: number;
    characters?: any; // 可选：CharacterRelationGraph，先建人物再写大纲时传入
  }
): Promise<{ volumes: Omit<VolumeOutline, 'chapters'>[]; mainGoal: string; milestones: string[] }> {
  const { bible, targetChapters, targetWordCount, minChapterWords = 2500, characters } = args;

  // 估算分卷数 (通常每 50-100 章一卷)
  const volumeCount = Math.ceil(targetChapters / 80);

  const system = `
你是一个起点白金级网文大纲策划专家。你对网文的节奏、爽点、冲突设计有深刻理解。

大纲设计原则：
1. 冲突递进：每卷的核心冲突必须比上一卷更大、更紧迫
2. 爽点节奏：每 3-5 章安排一个大爽点（升级/反杀/获宝/揭秘），章节间有小爽点
3. 人物弧线：主角在每卷必须有明确的内在成长，而非只是实力提升
4. 悬念管理：每卷结尾必须留大悬念，牵引读者进入下一卷
5. 三幕结构：每卷遵循「铺垫(25%) → 发展(50%) → 高潮收尾(25%)」
6. 禁止水卷：每卷都要有明确的核心矛盾和高潮，不能有"过渡卷"
7. 篇幅规划：章节推进要匹配字数预算，默认每章不少于 ${minChapterWords} 字
${characters ? '8. 人物驱动：大纲必须围绕人物关系冲突展开，每卷的核心冲突应与人物关系变化绑定' : ''}

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

  // 构建人物关系摘要（如果有）
  let charactersSummary = '';
  if (characters) {
    const protags = (characters.protagonists || []).map((p: any) => 
      `${p.name}: ${p.personality?.traits?.join(', ') || p.role || '未定义'}`
    ).join('\n  ');
    const mainChars = (characters.mainCharacters || []).map((c: any) =>
      `${c.name}: ${c.role || '未定义'}`
    ).join('\n  ');
    const rels = (characters.relationships || []).slice(0, 10).map((r: any) => 
      `${r.from} ←→ ${r.to}: ${r.type} (${r.tension || '无张力说明'})`
    ).join('\n  ');
    
    charactersSummary = `
【核心人物设定（已确定）】
主角：
  ${protags || '未定义'}

重要配角：
  ${mainChars || '未定义'}

核心关系冲突：
  ${rels || '未定义'}

请在大纲规划时充分利用以上人物关系，让每卷的核心冲突与人物关系变化绑定。`;
  }

  const prompt = `
【Story Bible】
${bible}

【目标规模】
- 总章数: ${targetChapters} 章
- 总字数: ${targetWordCount} 万字
- 每章最低字数: ${minChapterWords} 字
- 预计分卷数: ${volumeCount} 卷
${charactersSummary}

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
    minChapterWords?: number;
  }
): Promise<ChapterOutline[]> {
  const { bible, masterOutline, volume, previousVolumeSummary, minChapterWords = 2500 } = args;

  const chapterCount = volume.endChapter - volume.startChapter + 1;

  const system = `
你是一个起点白金级网文章节大纲策划专家。请为一卷生成所有章节的大纲。

章节大纲设计原则：
1. 每章必须有明确的“本章爽点”（主角展现能力/获得收获/化解危机/揭露真相）
2. 每章结尾必须有钩子（悬念/反转/危机/揭示），让读者想看下一章
3. 节奏波浪：高潮章后要有 1-2 章缓冲，缓冲章仍需有小悬念
4. 冲突升级：核心冲突要逐步升级，不能一下子解决
5. 人物登场：新角色要安排合理的登场方式和动机
6. 禁止水章：每章都要推动剧情，不能有纯日常的章节
7. 篇幅意识：章节设计要支撑单章不少于 ${minChapterWords} 字，避免目标过散导致注水或空章

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

【总目标】${masterOutline.mainGoal}

【本卷信息】
- ${volume.title}
- 章节范围: 第${volume.startChapter}章 ~ 第${volume.endChapter}章 (共${chapterCount}章)
- 本卷目标: ${volume.goal}
- 本卷冲突: ${volume.conflict}
- 本卷高潮: ${volume.climax}
- 每章最低字数: ${minChapterWords} 字

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
