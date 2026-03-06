import path from 'node:path';
import fs from 'node:fs/promises';
import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
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

function stripJsonCodeFence(raw: string): string {
  return raw.replace(/```json\s*|```\s*/gi, '').trim();
}

function extractBalancedJsonBlock(raw: string, opening: '{' | '['): string | null {
  const closing = opening === '{' ? '}' : ']';
  const start = raw.indexOf(opening);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === opening) {
      depth += 1;
      continue;
    }

    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseLooseJson(raw: string, preferredShape: 'object' | 'array'): unknown {
  const normalized = stripJsonCodeFence(raw);
  const attempts = [
    normalized,
    preferredShape === 'array'
      ? extractBalancedJsonBlock(normalized, '[')
      : extractBalancedJsonBlock(normalized, '{'),
    preferredShape === 'array'
      ? extractBalancedJsonBlock(normalized, '{')
      : extractBalancedJsonBlock(normalized, '['),
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));

  let lastError: Error | null = null;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError || new Error('Invalid JSON payload');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toShortText(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function stripCodeFenceText(raw: string): string {
  return raw.replace(/```[\w-]*\s*/gi, '').replace(/```/g, '').trim();
}

function isChapterOrdinalToken(value: string): boolean {
  const normalized = value.replace(/[：:.\-]/g, '').trim();
  return /^(?:第?\s*\d+\s*章?|\d+)$/.test(normalized);
}

function deriveHookFromGoal(goal: string): string {
  const normalized = goal.trim();
  if (!normalized) return '';
  const parts = normalized
    .split(/[，。！？!?；;]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const tail = parts[parts.length - 1] || normalized;
  return tail.length > 20 ? tail.slice(0, 20) : tail;
}

function parseStructuredVolumeChapterText(
  raw: string,
  startChapter: number,
  expectedCount: number
): ChapterOutline[] {
  const lines = stripCodeFenceText(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const chapters: ChapterOutline[] = [];

  for (const rawLine of lines) {
    const line = rawLine
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+\.\s*/, '')
      .trim();
    if (!line) continue;

    const parts = line
      .split(/[|｜]/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length < 2) {
      continue;
    }

    let titlePart = '';
    let goalPart = '';

    if (parts.length >= 3 && isChapterOrdinalToken(parts[0])) {
      titlePart = parts[1];
      goalPart = parts.slice(2).join('｜');
    } else {
      titlePart = parts[0];
      goalPart = parts.slice(1).join('｜');
    }

    titlePart = titlePart.replace(/^标题[:：]\s*/i, '').trim();
    goalPart = goalPart.replace(/^(?:描述|剧情|梗概|概要|内容)[:：]\s*/i, '').trim();

    if (!titlePart || !goalPart) {
      continue;
    }

    const index = startChapter + chapters.length;
    chapters.push({
      index,
      title: titlePart,
      goal: goalPart,
      hook: deriveHookFromGoal(goalPart),
    });

    if (chapters.length >= expectedCount) {
      break;
    }
  }

  return chapters;
}

function normalizeVolumeChapterPayload(payload: unknown, startChapter: number): ChapterOutline[] {
  let rawChapters: unknown = payload;
  const wrapped = asRecord(payload);
  if (wrapped) {
    rawChapters = wrapped.chapters ?? wrapped.items ?? wrapped.volumeChapters ?? payload;
  }

  if (!Array.isArray(rawChapters)) {
    throw new Error('Volume chapters payload is not an array');
  }

  return rawChapters.map((chapter, offset) => {
    const record = asRecord(chapter);
    const index = startChapter + offset;
    return {
      index: toNumber(record?.index ?? record?.chapterIndex ?? record?.chapter ?? record?.id, index),
      title: toShortText(record?.title, `第${index}章`),
      goal: toShortText(record?.goal ?? record?.summary ?? record?.description, ''),
      hook: toShortText(record?.hook ?? record?.cliffhanger, ''),
    };
  });
}

function normalizeAdditionalVolumePayload(
  payload: unknown,
  startChapterBase: number,
  chaptersPerVolume: number
): Omit<VolumeOutline, 'chapters'>[] {
  let rawVolumes: unknown = payload;
  const wrapped = asRecord(payload);
  if (wrapped) {
    rawVolumes = wrapped.volumes ?? wrapped.items ?? payload;
  }

  if (!Array.isArray(rawVolumes)) {
    throw new Error('Additional volumes payload is not an array');
  }

  let currentStart = startChapterBase;
  return rawVolumes.map((volume, offset) => {
    const record = asRecord(volume);
    const title = toShortText(record?.title, `第${offset + 1}卷`);
    const normalizedVolume: Omit<VolumeOutline, 'chapters'> = {
      title,
      startChapter: currentStart,
      endChapter: currentStart + chaptersPerVolume - 1,
      goal: toShortText(record?.goal ?? record?.summary, ''),
      conflict: toShortText(record?.conflict ?? record?.coreConflict, ''),
      climax: toShortText(record?.climax ?? record?.peak, ''),
      volumeEndState: typeof record?.volumeEndState === 'string' ? record.volumeEndState.trim() : undefined,
    };
    currentStart = normalizedVolume.endChapter + 1;
    return normalizedVolume;
  });
}

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
  "mainGoal": "整本书的终极目标/主线",
  "milestones": ["第100章里程碑", "第200章里程碑", ...],
  "volumes": [
    {
      "title": "第一卷：xxx",
      "startChapter": 1,
      "endChapter": 80,
      "goal": "本卷要完成什么（包含关键转折和阶段性目标）",
      "conflict": "本卷核心冲突（包含对立双方、stakes和冲突升级路径）",
      "climax": "本卷高潮（包含高潮场景、结果和代价）",
      "volumeEndState": "本卷结束时主角状态、世界格局变化、遗留悬念"
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

  try {
    return parseLooseJson(raw, 'object') as { volumes: Omit<VolumeOutline, 'chapters'>[]; mainGoal: string; milestones: string[] };
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
    /** 实际已生成章节的滚动摘要（优先于大纲计划数据） */
    actualStorySummary?: string;
  }
): Promise<ChapterOutline[]> {
  const { bible, masterOutline, volume, previousVolumeSummary, minChapterWords = 2500, actualStorySummary } = args;

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

不要输出 JSON。
请按“每章一行”的纯文本格式输出，不要有前言、总结、代码块。
每行固定格式：
章节序号|章节标题|章节描述

示例：
1|初入黑市|主角潜入黑市试探交易线索，却发现有人提前设局，离开前看到旧识留下的警告
2|假面买家|主角伪装身份接触幕后买家，套出关键情报，但对方突然提出危险交换条件
`.trim();

  const prompt = `
【Story Bible】
${bible.slice(0, 4000)}

【总目标】${masterOutline.mainGoal}

【本卷信息】
- ${volume.title}
- 章节范围: 第${volume.startChapter}章 ~ 第${volume.endChapter}章 (共${chapterCount}章)
- 本卷目标: ${volume.goal}
- 本卷冲突: ${volume.conflict}
- 本卷高潮: ${volume.climax}
- 每章最低字数: ${minChapterWords} 字

${actualStorySummary
    ? `【上卷实际剧情进展（以此为准，大纲计划可能已偏离）】\n${actualStorySummary}`
    : previousVolumeSummary ? `【上卷结尾摘要】\n${previousVolumeSummary}` : '【这是第一卷】'}

请生成本卷所有 ${chapterCount} 章的“章节标题 + 章节描述”：
`.trim();

  const raw = await generateTextWithRetry(aiConfig, {
    system,
    prompt,
    temperature: 0.7,
  });

  const textChapters = parseStructuredVolumeChapterText(raw, volume.startChapter, chapterCount);
  if (textChapters.length === chapterCount) {
    return textChapters;
  }

  try {
    return normalizeVolumeChapterPayload(
      parseLooseJson(raw, 'array'),
      volume.startChapter
    );
  } catch {
    if (textChapters.length > 0) {
      throw new Error(`Failed to parse volume chapters text: expected ${chapterCount}, got ${textChapters.length}`);
    }
    throw new Error('Failed to parse volume chapters response');
  }
}

/**
 * 基于已有大纲生成额外的卷骨架（不含章节细节）
 * 章节需要后续调用 generateVolumeChapters 逐卷填充
 */
export async function generateAdditionalVolumes(
  aiConfig: AIConfig,
  args: {
    bible: string;
    existingOutline: {
      mainGoal: string;
      milestones: string[];
      volumes: Omit<VolumeOutline, 'chapters'>[];
      totalChapters: number;
      targetWordCount: number;
    };
    newVolumeCount: number;
    chaptersPerVolume: number;
    minChapterWords?: number;
    /** 实际已生成章节的滚动摘要（优先于大纲计划数据） */
    actualStorySummary?: string;
  }
): Promise<{ volumes: Omit<VolumeOutline, 'chapters'>[] }> {
  const { bible, existingOutline, newVolumeCount, chaptersPerVolume, minChapterWords = 2500, actualStorySummary } = args;

  // 计算新卷的起始章节号
  const lastVolume = existingOutline.volumes[existingOutline.volumes.length - 1];
  const startChapterBase = lastVolume ? lastVolume.endChapter + 1 : 1;

  // 构建已有卷的摘要
  const existingVolumesSummary = existingOutline.volumes.map((vol, i) =>
    `第${i + 1}卷「${vol.title}」: 第${vol.startChapter}-${vol.endChapter}章 | 目标: ${vol.goal} | 高潮: ${vol.climax}`
  ).join('\n');

  const system = `
你是一个起点白金级网文大纲策划专家。你需要为一部已有大纲的小说追加新卷。

已有大纲的信息会提供给你，你必须确保新卷与已有内容自然衔接，冲突递进。

大纲设计原则：
1. 冲突递进：新卷的核心冲突必须比已有卷更大、更紧迫
2. 衔接连贯：新卷的开头必须自然承接上一卷的结局
3. 爽点节奏：每 3-5 章安排一个大爽点
4. 人物弧线：主角在每卷必须有明确的内在成长
5. 悬念管理：每卷结尾必须留大悬念
6. 禁止水卷：每卷都要有明确的核心矛盾和高潮
7. 篇幅规划：每章不少于 ${minChapterWords} 字

输出严格的 JSON 格式，不要有其他文字。

JSON 结构：
{
  "volumes": [
    {
      "title": "第X卷：xxx",
      "startChapter": 起始章节号,
      "endChapter": 结束章节号,
      "goal": "本卷要完成什么（包含关键转折和阶段性目标）",
      "conflict": "本卷核心冲突（包含对立双方、stakes和冲突升级路径）",
      "climax": "本卷高潮（包含高潮场景、结果和代价）",
      "volumeEndState": "本卷结束时主角状态、世界格局变化、遗留悬念"
    },
    ...
  ]
}
`.trim();

  const prompt = `
【Story Bible】
${bible}

【主线目标】${existingOutline.mainGoal}

【已有卷目（${existingOutline.volumes.length}卷，共${existingOutline.totalChapters}章）】
${existingVolumesSummary}

【上一卷结尾状态】
${actualStorySummary
    ? `【实际剧情进展（以此为准）】\n${actualStorySummary}`
    : lastVolume ? `${lastVolume.volumeEndState || lastVolume.climax}\n目标达成: ${lastVolume.goal}\n高潮: ${lastVolume.climax}` : '这是第一卷'}

【追加要求】
- 新增 ${newVolumeCount} 卷
- 每卷 ${chaptersPerVolume} 章
- 起始章节号: 第${startChapterBase}章
- 每章最低字数: ${minChapterWords} 字

请生成 ${newVolumeCount} 个新卷的大纲（JSON格式）：
`.trim();

  const raw = await generateTextWithRetry(aiConfig, {
    system,
    prompt,
    temperature: 0.7,
  });

  try {
    return {
      volumes: normalizeAdditionalVolumePayload(
        parseLooseJson(raw, 'object'),
        startChapterBase,
        chaptersPerVolume
      ),
    };
  } catch {
    throw new Error('Failed to parse additional volumes JSON');
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
    previousVolumeSummary = `${vol.title}\n目标: ${vol.goal}\n高潮: ${vol.climax}\n结束状态: ${vol.volumeEndState || vol.climax}`;

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
