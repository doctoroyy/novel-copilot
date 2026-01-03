/**
 * 时间线管理器
 *
 * 负责：
 * 1. 分析章节内容，提取已完成的事件
 * 2. 更新时间线状态
 * 3. 构建时间线上下文（用于 AI Prompt）
 * 4. 检测事件重复
 */

import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import type { CharacterRelationGraph } from '../types/characters.js';
import type { CharacterStateRegistry } from '../types/characterState.js';
import {
  type TimelineState,
  type TimelineEvent,
  type TimelineEventType,
  type TimelineEventStatus,
  type AIEventAnalysis,
  createEmptyTimelineState,
  generateEventId,
  extractCharacterNamesFromGraph,
  extractCharacterNamesFromRegistry,
  findCharactersInText,
  generateUniqueKey,
  detectEventDuplication,
  formatTimelineContext,
  getCompletedEvents,
  inferEventType,
} from '../types/timeline.js';
import { z } from 'zod';

/**
 * AI 事件分析结果 Schema
 */
const EventAnalysisSchema = z.object({
  newEvents: z.array(z.object({
    type: z.enum([
      'ceremony', 'battle', 'revelation', 'encounter', 'departure',
      'acquisition', 'death', 'decision', 'conflict', 'alliance', 'betrayal', 'custom'
    ]),
    summary: z.string().max(50),
    description: z.string(),
    characterNames: z.array(z.string()),
    coreAction: z.string().max(30),
    evidence: z.string(),
    isCompleted: z.boolean(),
  })),
  currentTimepoint: z.string(),
});

/**
 * 从角色来源获取名称映射
 */
export function getCharacterNameMap(
  characters?: CharacterRelationGraph,
  characterStates?: CharacterStateRegistry
): Map<string, string> {
  if (characters) {
    return extractCharacterNamesFromGraph(characters);
  }
  if (characterStates) {
    return extractCharacterNamesFromRegistry(characterStates);
  }
  return new Map();
}

/**
 * 分析章节内容，提取事件
 */
export async function analyzeChapterForEvents(
  aiConfig: AIConfig,
  chapterText: string,
  chapterIndex: number,
  timeline: TimelineState,
  characterNames: Map<string, string>
): Promise<AIEventAnalysis> {
  // 构建角色名称列表供 AI 参考
  const charNameList = Array.from(characterNames.keys()).join('、');

  const system = `
你是小说剧情分析助手。你的任务是从章节内容中提取重要事件。

**重要规则**：
1. 只提取重要的、有标志性的事件，忽略日常对话和过渡性描写
2. 事件必须是明确发生的，不是角色的想法或计划
3. 用简洁的语言描述事件
4. 区分"已完成"和"进行中"的事件

只输出 JSON 格式，不要有任何其他文字。
`.trim();

  // 构建已完成事件列表，供 AI 参考避免重复
  const completedEvents = getCompletedEvents(timeline);
  const completedSummaries = completedEvents.slice(-10).map(e => e.summary).join('\n- ');

  const prompt = `
【本书角色列表】
${charNameList || '（未提供）'}

【已记录的完成事件】
${completedSummaries || '（暂无）'}

【第${chapterIndex}章原文】
${chapterText}

请分析本章发生的重要事件，输出 JSON 格式：
{
  "newEvents": [
    {
      "type": "事件类型: ceremony|battle|revelation|encounter|departure|acquisition|death|decision|conflict|alliance|betrayal|custom",
      "summary": "事件简述(50字以内)",
      "description": "事件详细描述",
      "characterNames": ["涉及的角色名"],
      "coreAction": "核心动作关键词(30字以内，用于去重)",
      "evidence": "原文中的关键句子",
      "isCompleted": true/false
    }
  ],
  "currentTimepoint": "故事当前时间点描述(如：觉醒仪式结束后)"
}
`.trim();

  const raw = await generateTextWithRetry(aiConfig, {
    system,
    prompt,
    temperature: 0.2,
  });

  // 解析 JSON
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const parsed = EventAnalysisSchema.parse(JSON.parse(jsonText));

    // 转换为标准格式
    const newEvents: AIEventAnalysis['newEvents'] = parsed.newEvents.map((evt) => {
      // 将角色名称转换为 ID
      const characterIds = evt.characterNames
        .map((name) => characterNames.get(name))
        .filter((id): id is string => id !== undefined);

      return {
        type: evt.type as TimelineEventType,
        summary: evt.summary,
        description: evt.description,
        characterIds,
        uniqueKey: generateUniqueKey(evt.type as TimelineEventType, characterIds, evt.coreAction),
        evidence: evt.evidence,
      };
    });

    return {
      newEvents,
      statusUpdates: [], // 暂不处理状态更新
      currentTimepoint: parsed.currentTimepoint,
    };
  } catch (error) {
    console.warn('Timeline event analysis parsing failed:', error);
    return {
      newEvents: [],
      statusUpdates: [],
      currentTimepoint: timeline.currentTimepoint,
    };
  }
}

/**
 * 应用事件分析结果到时间线
 */
export function applyEventAnalysis(
  timeline: TimelineState,
  analysis: AIEventAnalysis,
  chapterIndex: number
): TimelineState {
  const now = new Date().toISOString();
  let updated = { ...timeline };
  const newEvents: TimelineEvent[] = [];

  for (const evt of analysis.newEvents) {
    // 检查是否重复
    const existing = detectEventDuplication(timeline, evt.uniqueKey);
    if (existing) {
      console.log(`⚠️ 跳过重复事件: ${evt.summary} (与 ${existing.summary} 重复)`);
      continue;
    }

    const newEvent: TimelineEvent = {
      id: generateEventId(evt.type, chapterIndex),
      type: evt.type,
      summary: evt.summary,
      description: evt.description,
      characterIds: evt.characterIds,
      status: 'completed', // 章节中出现的事件默认为已完成
      startedChapter: chapterIndex,
      completedChapter: chapterIndex,
      uniqueKey: evt.uniqueKey,
      evidence: evt.evidence,
      createdAt: now,
      updatedAt: now,
    };

    newEvents.push(newEvent);
  }

  updated = {
    ...updated,
    lastUpdatedChapter: chapterIndex,
    currentTimepoint: analysis.currentTimepoint,
    events: [...updated.events, ...newEvents],
  };

  return updated;
}

/**
 * 构建时间线上下文（用于 AI Prompt）
 */
export function buildTimelineContext(
  timeline: TimelineState,
  currentChapter: number,
  characterNames: Map<string, string>
): string {
  return formatTimelineContext(timeline, currentChapter, characterNames);
}

/**
 * 事件重复检测 QC
 * 检查生成的章节是否包含已完成事件的重复
 */
export function checkEventDuplication(
  chapterText: string,
  timeline: TimelineState,
  characterNames: Map<string, string>
): {
  hasDuplication: boolean;
  duplicatedEvents: TimelineEvent[];
  warnings: string[];
} {
  const completedEvents = getCompletedEvents(timeline);
  const duplicatedEvents: TimelineEvent[] = [];
  const warnings: string[] = [];

  // ID -> 名称的反向映射
  const idToName = new Map<string, string>();
  for (const [name, id] of characterNames) {
    idToName.set(id, name);
  }

  for (const evt of completedEvents) {
    // 检查事件的核心动作是否在新章节中出现
    const charNamesInEvent = evt.characterIds
      .map((id) => idToName.get(id))
      .filter((name): name is string => name !== undefined);

    // 简单匹配：检查角色名+事件关键词是否同时出现
    const hasCharacter = charNamesInEvent.some((name) => chapterText.includes(name));
    const hasAction = evt.summary.split(/[，,。、]/).some((part) =>
      part.length > 2 && chapterText.includes(part)
    );

    if (hasCharacter && hasAction) {
      // 更精确的检查：事件类型相关的关键词
      const typeKeywords = getTypeKeywords(evt.type);
      const hasTypeKeyword = typeKeywords.some((kw) => chapterText.includes(kw));

      if (hasTypeKeyword) {
        duplicatedEvents.push(evt);
        warnings.push(
          `疑似重复事件: "${evt.summary}" (第${evt.completedChapter}章已完成)`
        );
      }
    }
  }

  return {
    hasDuplication: duplicatedEvents.length > 0,
    duplicatedEvents,
    warnings,
  };
}

/**
 * 获取事件类型的关键词
 */
function getTypeKeywords(type: TimelineEventType): string[] {
  const keywordMap: Record<TimelineEventType, string[]> = {
    ceremony: ['仪式', '典礼', '开始', '进行', '举行'],
    battle: ['战斗', '交手', '打', '攻击', '防御'],
    revelation: ['发现', '得知', '揭露', '原来', '真相'],
    encounter: ['遇到', '见到', '初次', '重逢', '相见'],
    departure: ['离开', '告别', '分别', '离去', '出发'],
    acquisition: ['获得', '得到', '突破', '觉醒', '习得'],
    death: ['死', '亡', '牺牲', '陨落', '殒命'],
    decision: ['决定', '选择', '决心', '下定'],
    conflict: ['争吵', '冲突', '对峙', '矛盾', '激烈'],
    alliance: ['结盟', '联手', '合作', '共同'],
    betrayal: ['背叛', '出卖', '反水', '叛变'],
    custom: [],
  };
  return keywordMap[type] || [];
}

/**
 * 初始化时间线（从大纲提取计划事件）
 */
export function initializeTimelineFromOutline(
  outline: any,
  characterNames: Map<string, string>
): TimelineState {
  const timeline = createEmptyTimelineState();

  if (!outline?.volumes) return timeline;

  const now = new Date().toISOString();
  const events: TimelineEvent[] = [];

  for (const volume of outline.volumes) {
    if (!volume.chapters) continue;

    for (const chapter of volume.chapters) {
      if (!chapter.goal) continue;

      // 从章节目标提取事件
      const characterIds = findCharactersInText(chapter.goal, characterNames);
      const eventType = inferEventType(chapter.goal);

      const event: TimelineEvent = {
        id: generateEventId(eventType, chapter.index),
        type: eventType,
        summary: chapter.goal.slice(0, 50),
        description: chapter.goal,
        characterIds,
        status: 'planned',
        plannedChapter: chapter.index,
        uniqueKey: generateUniqueKey(eventType, characterIds, chapter.goal.slice(0, 30)),
        createdAt: now,
        updatedAt: now,
      };

      events.push(event);
    }
  }

  return {
    ...timeline,
    events,
  };
}

/**
 * 获取时间线统计信息
 */
export function getTimelineStats(timeline: TimelineState): {
  totalEvents: number;
  completedEvents: number;
  activeEvents: number;
  plannedEvents: number;
  byType: Record<TimelineEventType, number>;
} {
  const stats = {
    totalEvents: timeline.events.length,
    completedEvents: 0,
    activeEvents: 0,
    plannedEvents: 0,
    byType: {} as Record<TimelineEventType, number>,
  };

  for (const evt of timeline.events) {
    if (evt.status === 'completed') stats.completedEvents++;
    else if (evt.status === 'in_progress') stats.activeEvents++;
    else if (evt.status === 'planned') stats.plannedEvents++;

    stats.byType[evt.type] = (stats.byType[evt.type] || 0) + 1;
  }

  return stats;
}
