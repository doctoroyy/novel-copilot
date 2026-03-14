import path from 'node:path';
import fs from 'node:fs/promises';
import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import { readBible, readState, writeState, type BookState } from './memory.js';
import type {
  StoryContract,
  StoryContractField,
  StoryContractScalar,
  StoryContractSection,
  VolumeStoryContract,
} from './types/narrative.js';

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
  /** 本卷剧情合同 */
  storyContract?: VolumeStoryContract;
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
  /** 本章剧情合同 */
  storyContract?: StoryContract;
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

function normalizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => toShortText(item, ''))
    .filter(Boolean);
}

function normalizeContractScalar(value: unknown): StoryContractScalar | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return undefined;
}

function normalizeContractField(value: unknown): StoryContractField | undefined {
  const scalar = normalizeContractScalar(value);
  if (scalar !== undefined) return scalar;
  if (!Array.isArray(value)) return undefined;

  const normalized = value
    .map((item) => normalizeContractScalar(item))
    .filter((item): item is StoryContractScalar => item !== undefined);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeContractSection(value: unknown): StoryContractSection | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const normalizedEntries = Object.entries(record)
    .map(([key, rawValue]) => [key.trim(), normalizeContractField(rawValue)] as const)
    .filter(([key, rawValue]) => key && rawValue !== undefined);

  if (normalizedEntries.length === 0) return undefined;
  return Object.fromEntries(normalizedEntries);
}

function normalizeStoryContract(value: unknown): StoryContract | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const scope = normalizeContractSection(record.scope);
  const crisis = normalizeContractSection(record.crisis);
  const threads = normalizeContractSection(record.threads);
  const stateTransition = normalizeContractSection(record.stateTransition);
  const notes = normalizeTextArray(record.notes);

  if (!scope && !crisis && !threads && !stateTransition && notes.length === 0) {
    return undefined;
  }

  return {
    scope,
    crisis,
    threads,
    stateTransition,
    notes: notes.length > 0 ? notes : undefined,
  };
}

function normalizeVolumeStoryContract(value: unknown): VolumeStoryContract | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const base = normalizeStoryContract(value);
  const chapterDefaults = normalizeStoryContract(record.chapterDefaults);

  if (!base && !chapterDefaults) return undefined;

  return {
    ...(base || {}),
    chapterDefaults,
  };
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

const TIMELINE_RESET_PATTERN = /(重置(?:了)?时间线|时间线(?:被)?重置|新的轮回|重新轮回|轮回重启|回到(?:故事)?开始|回到.*(?:过去|最初|起点|开端)|时光倒流|逆转时间|世界线改写|改写世界线|回档|读档重来|重来一次|从头再来)/;

function describeChapterForContinuation(chapter: Partial<ChapterOutline> | null | undefined): string | null {
  if (!chapter) return null;

  const index = Number(chapter.index);
  const title = typeof chapter.title === 'string' ? chapter.title.trim() : '';
  const goal = typeof chapter.goal === 'string' ? chapter.goal.trim() : '';
  const hook = typeof chapter.hook === 'string' ? chapter.hook.trim() : '';
  const chapterNo = Number.isFinite(index) && index > 0 ? `第${index}章` : '章节';
  const parts = [title ? `${chapterNo}「${title}」` : chapterNo];

  if (goal) parts.push(goal);
  if (hook) parts.push(`钩子: ${hook}`);

  return parts.join(' | ');
}

function buildVolumeContinuationSummary(
  volume: (Omit<VolumeOutline, 'chapters'> & { chapters?: ChapterOutline[] }) | null | undefined
): string {
  if (!volume) return '';

  const parts: string[] = [
    `卷名: ${volume.title}`,
    `章节范围: 第${volume.startChapter}-${volume.endChapter}章`,
  ];

  if (volume.goal) parts.push(`本卷目标: ${volume.goal}`);
  if (volume.conflict) parts.push(`核心冲突: ${volume.conflict}`);
  if (volume.climax) parts.push(`卷末高潮: ${volume.climax}`);
  if (volume.volumeEndState) parts.push(`卷末状态: ${volume.volumeEndState}`);

  const tailChapters = Array.isArray(volume.chapters)
    ? volume.chapters
        .slice()
        .sort((left, right) => left.index - right.index)
        .slice(-3)
        .map(describeChapterForContinuation)
        .filter((item): item is string => Boolean(item))
    : [];

  if (tailChapters.length > 0) {
    parts.push(`最后关键章节:\n- ${tailChapters.join('\n- ')}`);
  }

  const combined = parts.join('\n');
  if (TIMELINE_RESET_PATTERN.test(combined)) {
    parts.push('时间线规则: 上一卷已出现时间线重置/轮回重启信号，续写必须以重置后的世界状态为新的基线，不得直接沿用重置前已被覆盖的主冲突。');
  }

  return parts.join('\n');
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
      storyContract: normalizeStoryContract(record?.storyContract ?? record?.contract),
    };
  });
}

function normalizeMasterOutlinePayload(payload: unknown): {
  mainGoal: string;
  milestones: string[];
  volumes: Omit<VolumeOutline, 'chapters'>[];
} {
  const record = asRecord(payload);
  if (!record) {
    throw new Error('Master outline payload is not an object');
  }

  const rawVolumes = Array.isArray(record.volumes) ? record.volumes : [];
  if (rawVolumes.length === 0) {
    throw new Error('Master outline payload has no volumes');
  }

  return {
    mainGoal: toShortText(record.mainGoal ?? record.goal, ''),
    milestones: normalizeTextArray(record.milestones),
    volumes: rawVolumes.map((volume, offset) => {
      const vol = asRecord(volume);
      if (!vol) {
        throw new Error(`Volume ${offset + 1} is invalid`);
      }

      return {
        title: toShortText(vol.title, `第${offset + 1}卷`),
        startChapter: toNumber(vol.startChapter, offset * 80 + 1),
        endChapter: toNumber(vol.endChapter, (offset + 1) * 80),
        goal: toShortText(vol.goal ?? vol.summary, ''),
        conflict: toShortText(vol.conflict ?? vol.coreConflict, ''),
        climax: toShortText(vol.climax ?? vol.peak, ''),
        volumeEndState: toShortText(vol.volumeEndState ?? vol.volume_end_state, '') || undefined,
        storyContract: normalizeVolumeStoryContract(vol.storyContract ?? vol.contract),
      };
    }),
  };
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
      storyContract: normalizeVolumeStoryContract(record?.storyContract ?? record?.contract),
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
      "volumeEndState": "本卷结束时主角状态、世界格局变化、遗留悬念",
      "storyContract": {
        "scope": { "ceiling": "本卷允许触达的叙事范围上限" },
        "crisis": { "maxConcurrent": 2, "requiredBridge": false },
        "threads": { "mustAdvance": ["本卷必须推进的线程"], "forbiddenIntroductions": ["本卷禁止突兀引入的内容"] },
        "stateTransition": { "target": "本卷结束时应落到的状态" },
        "notes": ["额外卷级约束"],
        "chapterDefaults": {
          "crisis": { "maxConcurrent": 1 }
        }
      }
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

请生成总大纲。所有合同字段都必须使用自由文本，不要发明固定枚举或分类表：
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.7 });

  try {
    return normalizeMasterOutlinePayload(parseLooseJson(raw, 'object'));
  } catch {
    throw new Error('Failed to parse master outline JSON');
  }
}

/**
 * 将解析出的章节数组补全到期望数量，缺失章节用占位信息填充
 */
function padChaptersToCount(chapters: ChapterOutline[], startChapter: number, expectedCount: number): ChapterOutline[] {
  if (chapters.length >= expectedCount) return chapters.slice(0, expectedCount);

  const padded = [...chapters];
  const existingIndices = new Set(chapters.map((c) => c.index));

  for (let offset = 0; padded.length < expectedCount; offset++) {
    const index = startChapter + offset;
    if (existingIndices.has(index)) continue;
    padded.push({
      index,
      title: `第${index}章`,
      goal: '（占位章节，待后续细化大纲时补全）',
      hook: '',
    });
  }

  return padded.sort((a, b) => a.index - b.index).slice(0, expectedCount);
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

优先输出严格的 JSON 格式，不要有其他文字。

JSON 结构：
{
  "chapters": [
    {
      "index": 1,
      "title": "章节标题",
      "goal": "本章目标/剧情描述",
      "hook": "章末钩子",
      "storyContract": {
        "scope": { "ceiling": "本章允许触达的叙事范围上限" },
        "crisis": { "maxConcurrent": 1, "requiredBridge": false },
        "threads": {
          "mustAdvance": ["本章必须推进的线程"],
          "forbiddenIntroductions": ["本章禁止新开的内容"]
        },
        "stateTransition": { "target": "章末应落到的状态" },
        "notes": ["额外说明"]
      }
    }
  ]
}

如果你无法稳定输出 JSON，再退化成“每章一行”的纯文本格式：
章节序号|章节标题|章节描述
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
- 本卷结束状态: ${volume.volumeEndState || '请围绕本卷目标收束出清晰的卷末状态'}
- 每章最低字数: ${minChapterWords} 字
${volume.storyContract ? `- 本卷合同:\n${JSON.stringify(volume.storyContract, null, 2)}` : ''}

${actualStorySummary
    ? `【上卷实际剧情进展（以此为准，大纲计划可能已偏离）】\n${actualStorySummary}`
    : previousVolumeSummary ? `【上卷结尾摘要】\n${previousVolumeSummary}` : '【这是第一卷】'}

【续写硬约束】
- 第一批章节必须直接承接上一卷最后一幕造成的局面变化，不能像没发生过一样切回旧冲突
- 如果上一卷信息中出现“时间线重置/轮回重启/回到开端/世界线改写”，则本卷前段必须按重置后的身份、关系、情报、敌我格局重新展开
- 除非上一卷明确保留，否则不要把旧时间线已经终结或被覆盖的势力冲突继续当成本卷主线

请生成本卷所有 ${chapterCount} 章的“章节标题 + 章节描述”，并尽量补全每章的 "storyContract"。
如果本卷已经提供卷级合同，章级合同应在其基础上细化，不要与卷级合同冲突：
`.trim();

  // 解析级重试：AI 可能返回成功但格式不可解析，需要重新生成
  const PARSE_RETRY_LIMIT = 3;
  let lastParseError: string = '';

  for (let parseAttempt = 0; parseAttempt < PARSE_RETRY_LIMIT; parseAttempt++) {
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.7 + parseAttempt * 0.05, // 每次重试稍微提高温度
    });

    // 尝试 JSON 解析
    try {
      const normalized = normalizeVolumeChapterPayload(
        parseLooseJson(raw, 'array'),
        volume.startChapter
      );
      if (normalized.length === chapterCount) {
        return normalized;
      }
      // JSON 解析成功但数量不符，尝试容错补全
      if (normalized.length > 0 && normalized.length >= chapterCount * 0.5) {
        console.warn(
          `[generateVolumeChapters] JSON 解析章节数不匹配：期望 ${chapterCount}，实际 ${normalized.length}，使用占位补全`
        );
        return padChaptersToCount(normalized, volume.startChapter, chapterCount);
      }
    } catch {
      // JSON 解析失败，继续尝试文本模式
    }

    // 尝试文本格式解析
    const textChapters = parseStructuredVolumeChapterText(raw, volume.startChapter, chapterCount);
    if (textChapters.length === chapterCount) {
      return textChapters;
    }
    // 文本解析有部分结果，尝试容错补全
    if (textChapters.length > 0 && textChapters.length >= chapterCount * 0.5) {
      console.warn(
        `[generateVolumeChapters] 文本解析章节数不匹配：期望 ${chapterCount}，实际 ${textChapters.length}，使用占位补全`
      );
      return padChaptersToCount(textChapters, volume.startChapter, chapterCount);
    }

    // 完全无法解析或结果太少，记录日志并重试
    lastParseError = `expected ${chapterCount}, got ${textChapters.length}`;
    console.warn(
      `[generateVolumeChapters] 解析尝试 ${parseAttempt + 1}/${PARSE_RETRY_LIMIT} 失败 (${lastParseError})，AI 原始返回前500字：${raw.slice(0, 500)}`
    );

    // 非最后一次重试时等待一下
    if (parseAttempt < PARSE_RETRY_LIMIT - 1) {
      await sleep(2000);
    }
  }

  throw new Error(`Failed to parse volume chapters response after ${PARSE_RETRY_LIMIT} attempts: ${lastParseError}`);
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
      volumes: Array<Omit<VolumeOutline, 'chapters'> & { chapters?: ChapterOutline[] }>;
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
    [
      `第${i + 1}卷「${vol.title}」: 第${vol.startChapter}-${vol.endChapter}章`,
      vol.goal ? `目标: ${vol.goal}` : '',
      vol.conflict ? `冲突: ${vol.conflict}` : '',
      vol.climax ? `高潮: ${vol.climax}` : '',
      vol.volumeEndState ? `结束状态: ${vol.volumeEndState}` : '',
    ].filter(Boolean).join(' | ')
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
8. 时间线一致：如果上一卷出现“时间线重置/轮回重启/回到开端”等设定，新卷必须以重置后的状态为新的起点，不能无理由回到旧时间线已经结束或被覆盖的冲突

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
      "volumeEndState": "本卷结束时主角状态、世界格局变化、遗留悬念",
      "storyContract": {
        "scope": { "ceiling": "本卷允许触达的叙事范围上限" },
        "crisis": { "maxConcurrent": 2, "requiredBridge": false },
        "threads": { "mustAdvance": ["本卷必须推进的线程"] },
        "stateTransition": { "target": "本卷结束时应落到的状态" },
        "notes": ["额外卷级约束"],
        "chapterDefaults": {
          "crisis": { "maxConcurrent": 1 }
        }
      }
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
    : lastVolume ? buildVolumeContinuationSummary(lastVolume) : '这是第一卷'}

【续写硬约束】
- 新卷必须从“上一卷结尾状态/最后关键章节”自然接续，先处理卷末遗留的直接后果，再展开新矛盾
- 如果上一卷已经发生时间线重置、回到开端、轮回重启，新卷第一阶段必须围绕“重置后的新处境”展开
- 已经被重置覆盖、已经解决、或明显属于旧时间线的冲突，不得直接拿来当新卷主线；除非你先写明它如何在新时间线中重新成立

【追加要求】
- 新增 ${newVolumeCount} 卷
- 每卷 ${chaptersPerVolume} 章
- 起始章节号: 第${startChapterBase}章
- 每章最低字数: ${minChapterWords} 字

请生成 ${newVolumeCount} 个新卷的大纲（JSON格式）。所有合同字段都必须使用自由文本，不要发明固定枚举或分类表：
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
    previousVolumeSummary = buildVolumeContinuationSummary({ ...vol, chapters });

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
