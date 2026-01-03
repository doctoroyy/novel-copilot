/**
 * 时间线追踪系统 - 类型定义
 *
 * 用于追踪故事中的事件进展，防止 AI 重复生成已完成的事件。
 * 解决问题：章节3-4已经发生的事件，在第5章又被重写。
 */

import type { CharacterRelationGraph, CharacterProfile } from './characters.js';
import type { CharacterStateRegistry } from './characterState.js';

/**
 * 事件类型
 */
export type TimelineEventType =
  | 'ceremony'      // 仪式类 (觉醒仪式、登基、婚礼等)
  | 'battle'        // 战斗类
  | 'revelation'    // 揭示类 (秘密揭露、身份暴露等)
  | 'encounter'     // 相遇类 (初次见面、重逢等)
  | 'departure'     // 离开类 (离家、分别等)
  | 'acquisition'   // 获得类 (获得宝物、突破境界等)
  | 'death'         // 死亡类
  | 'decision'      // 决策类 (重要选择)
  | 'conflict'      // 冲突类 (争吵、对峙等)
  | 'alliance'      // 结盟类
  | 'betrayal'      // 背叛类
  | 'custom';       // 自定义事件

/**
 * 事件状态
 */
export type TimelineEventStatus =
  | 'planned'       // 大纲中计划的，尚未发生
  | 'foreshadowed'  // 已埋下伏笔，尚未正式发生
  | 'in_progress'   // 正在进行中 (跨多章的事件)
  | 'completed'     // 已完成，不可重复
  | 'cancelled';    // 被取消 (剧情变化导致)

/**
 * 时间线事件
 */
export type TimelineEvent = {
  /** 事件唯一标识 */
  id: string;

  /** 事件类型 */
  type: TimelineEventType;

  /** 事件简短描述 (用于提示词) */
  summary: string;

  /** 事件详细描述 */
  description: string;

  /** 涉及的角色ID列表 */
  characterIds: string[];

  /** 事件状态 */
  status: TimelineEventStatus;

  /** 计划发生的章节 (来自大纲) */
  plannedChapter?: number;

  /** 实际开始的章节 */
  startedChapter?: number;

  /** 实际完成的章节 */
  completedChapter?: number;

  /** 事件的唯一性标识符 (用于去重检测) */
  uniqueKey: string;

  /** 事件在原文中的关键证据 */
  evidence?: string;

  /** 创建时间 */
  createdAt: string;

  /** 最后更新时间 */
  updatedAt: string;
};

/**
 * 时间线状态
 */
export type TimelineState = {
  /** 数据版本 */
  version: string;

  /** 最后更新的章节 */
  lastUpdatedChapter: number;

  /** 当前故事时间点描述 */
  currentTimepoint: string;

  /** 所有事件列表 */
  events: TimelineEvent[];
};

/**
 * AI 分析返回的事件检测结果
 */
export type AIEventAnalysis = {
  /** 检测到的新事件 */
  newEvents: {
    type: TimelineEventType;
    summary: string;
    description: string;
    characterIds: string[];
    uniqueKey: string;
    evidence: string;
  }[];

  /** 状态更新的事件 */
  statusUpdates: {
    eventId: string;
    newStatus: TimelineEventStatus;
    reason: string;
  }[];

  /** 当前时间点描述 */
  currentTimepoint: string;
};

/**
 * 创建空的时间线状态
 */
export function createEmptyTimelineState(): TimelineState {
  return {
    version: '1.0.0',
    lastUpdatedChapter: 0,
    currentTimepoint: '故事开始',
    events: [],
  };
}

/**
 * 生成事件ID
 */
export function generateEventId(type: TimelineEventType, chapter: number): string {
  const timestamp = Date.now().toString(36);
  return `evt_${type}_ch${chapter}_${timestamp}`;
}

/**
 * 添加事件到时间线
 */
export function addEventToTimeline(
  state: TimelineState,
  event: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>,
  chapterIndex: number
): TimelineState {
  const now = new Date().toISOString();
  const newEvent: TimelineEvent = {
    ...event,
    id: generateEventId(event.type, chapterIndex),
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    lastUpdatedChapter: chapterIndex,
    events: [...state.events, newEvent],
  };
}

/**
 * 更新事件状态
 */
export function updateEventStatus(
  state: TimelineState,
  eventId: string,
  newStatus: TimelineEventStatus,
  chapterIndex: number,
  completedChapter?: number
): TimelineState {
  const now = new Date().toISOString();

  return {
    ...state,
    lastUpdatedChapter: chapterIndex,
    events: state.events.map((evt) =>
      evt.id === eventId
        ? {
            ...evt,
            status: newStatus,
            completedChapter: completedChapter ?? evt.completedChapter,
            updatedAt: now,
          }
        : evt
    ),
  };
}

/**
 * 获取已完成的事件 (用于防止重复)
 */
export function getCompletedEvents(state: TimelineState): TimelineEvent[] {
  return state.events.filter((evt) => evt.status === 'completed');
}

/**
 * 获取正在进行的事件
 */
export function getActiveEvents(state: TimelineState): TimelineEvent[] {
  return state.events.filter((evt) => evt.status === 'in_progress');
}

/**
 * 获取近期完成的事件 (用于上下文)
 */
export function getRecentlyCompletedEvents(
  state: TimelineState,
  currentChapter: number,
  lookbackChapters: number = 5
): TimelineEvent[] {
  return state.events.filter(
    (evt) =>
      evt.status === 'completed' &&
      evt.completedChapter !== undefined &&
      currentChapter - evt.completedChapter <= lookbackChapters
  );
}

/**
 * 检测事件是否重复
 * 通过 uniqueKey 匹配已完成的事件
 */
export function detectEventDuplication(
  state: TimelineState,
  uniqueKey: string
): TimelineEvent | undefined {
  return state.events.find(
    (evt) =>
      evt.uniqueKey === uniqueKey &&
      (evt.status === 'completed' || evt.status === 'in_progress')
  );
}

/**
 * 从角色图谱中提取所有角色名称
 * 用于在文本中检测角色
 */
export function extractCharacterNamesFromGraph(
  graph: CharacterRelationGraph
): Map<string, string> {
  const nameToId = new Map<string, string>();

  // 添加主角
  for (const char of graph.protagonists) {
    nameToId.set(char.name, char.id);
  }

  // 添加主要角色
  for (const char of graph.mainCharacters) {
    nameToId.set(char.name, char.id);
  }

  return nameToId;
}

/**
 * 从角色状态注册表中提取所有角色名称
 */
export function extractCharacterNamesFromRegistry(
  registry: CharacterStateRegistry
): Map<string, string> {
  const nameToId = new Map<string, string>();

  for (const snapshot of Object.values(registry.snapshots)) {
    nameToId.set(snapshot.characterName, snapshot.characterId);
  }

  return nameToId;
}

/**
 * 在文本中查找涉及的角色
 * @param text 要分析的文本
 * @param characterNames 角色名称到ID的映射
 */
export function findCharactersInText(
  text: string,
  characterNames: Map<string, string>
): string[] {
  const foundIds: string[] = [];

  for (const [name, id] of characterNames) {
    if (text.includes(name)) {
      foundIds.push(id);
    }
  }

  return [...new Set(foundIds)]; // 去重
}

/**
 * 格式化时间线上下文 (用于 AI Prompt)
 */
export function formatTimelineContext(
  state: TimelineState,
  currentChapter: number,
  characterNames: Map<string, string>
): string {
  const parts: string[] = [];

  // 反向映射：ID -> 名称
  const idToName = new Map<string, string>();
  for (const [name, id] of characterNames) {
    idToName.set(id, name);
  }

  // 当前时间点
  parts.push(`【当前故事时间点】`);
  parts.push(state.currentTimepoint);
  parts.push('');

  // 已完成的重要事件 (防止重复)
  const completedEvents = getCompletedEvents(state);
  if (completedEvents.length > 0) {
    parts.push(`【已完成事件 - 严禁重复】`);
    for (const evt of completedEvents.slice(-10)) { // 最多显示最近10个
      const charNames = evt.characterIds
        .map((id) => idToName.get(id) || id)
        .join('、');
      parts.push(`• [第${evt.completedChapter}章] ${evt.summary}（涉及：${charNames}）`);
    }
    parts.push('');
  }

  // 正在进行的事件
  const activeEvents = getActiveEvents(state);
  if (activeEvents.length > 0) {
    parts.push(`【进行中事件】`);
    for (const evt of activeEvents) {
      const charNames = evt.characterIds
        .map((id) => idToName.get(id) || id)
        .join('、');
      parts.push(`• ${evt.summary}（涉及：${charNames}，从第${evt.startedChapter}章开始）`);
    }
    parts.push('');
  }

  // 近期完成的事件 (保持连贯性)
  const recentEvents = getRecentlyCompletedEvents(state, currentChapter, 3);
  if (recentEvents.length > 0) {
    parts.push(`【近期发生】`);
    for (const evt of recentEvents) {
      parts.push(`• 第${evt.completedChapter}章: ${evt.summary}`);
    }
  }

  return parts.join('\n');
}

/**
 * 生成事件的唯一键
 * 用于检测重复事件
 */
export function generateUniqueKey(
  type: TimelineEventType,
  characterIds: string[],
  coreAction: string
): string {
  const sortedChars = [...characterIds].sort().join('_');
  const normalizedAction = coreAction.toLowerCase().replace(/\s+/g, '_');
  return `${type}:${sortedChars}:${normalizedAction}`;
}

/**
 * 从大纲中提取计划事件
 */
export function extractPlannedEventsFromOutline(
  outline: any,
  characterNames: Map<string, string>
): Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>[] {
  const events: Omit<TimelineEvent, 'id' | 'createdAt' | 'updatedAt'>[] = [];

  if (!outline?.volumes) return events;

  for (const volume of outline.volumes) {
    if (!volume.chapters) continue;

    for (const chapter of volume.chapters) {
      // 从章节目标中提取事件
      if (chapter.goal) {
        const characterIds = findCharactersInText(chapter.goal, characterNames);
        const eventType = inferEventType(chapter.goal);

        events.push({
          type: eventType,
          summary: chapter.goal.slice(0, 50),
          description: chapter.goal,
          characterIds,
          status: 'planned',
          plannedChapter: chapter.index,
          uniqueKey: generateUniqueKey(eventType, characterIds, chapter.goal.slice(0, 30)),
        });
      }
    }
  }

  return events;
}

/**
 * 从文本推断事件类型
 */
export function inferEventType(text: string): TimelineEventType {
  const typePatterns: [TimelineEventType, RegExp][] = [
    ['ceremony', /仪式|典礼|登基|婚礼|葬礼|祭祀|觉醒|测试/],
    ['battle', /战斗|打|杀|击败|对战|交手|比武|决斗/],
    ['revelation', /揭露|暴露|发现|真相|秘密|身份|得知/],
    ['encounter', /相遇|初见|重逢|邂逅|遇到|碰到/],
    ['departure', /离开|分别|告别|离去|出发|远行/],
    ['acquisition', /获得|得到|突破|晋升|觉醒|习得/],
    ['death', /死亡|牺牲|陨落|去世|殒命/],
    ['decision', /决定|选择|抉择|决心/],
    ['conflict', /争吵|冲突|对峙|矛盾|撕破脸/],
    ['alliance', /结盟|联手|合作|同盟/],
    ['betrayal', /背叛|出卖|反水|叛变/],
  ];

  for (const [type, pattern] of typePatterns) {
    if (pattern.test(text)) {
      return type;
    }
  }

  return 'custom';
}
