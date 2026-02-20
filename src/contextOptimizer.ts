/**
 * 上下文优化器
 *
 * 核心优化策略：
 * 1. 分层压缩 - 不同层次使用不同压缩率
 * 2. 动态窗口 - 根据章节类型调整上下文大小
 * 3. 优先级队列 - 按重要性排序上下文元素
 * 4. 语义去重 - 删除重复或冗余信息
 * 5. 主动遗忘 - 淘汰过时的上下文
 * 6. 语义缓存 - 缓存计算好的上下文，避免重复计算
 */

import type { CharacterStateRegistry, CharacterStateSnapshot } from './types/characterState.js';
import type { PlotGraph, PlotNode, PendingForeshadowing } from './types/plotGraph.js';
import type { NarrativeGuide, PacingType } from './types/narrative.js';
import type { TimelineState } from './types/timeline.js';
import type { CharacterRelationGraph } from './types/characters.js';
import {
  globalSemanticCache,
  detectContextChanges,
  buildIncrementalContext,
  computeStateVersion,
  type CacheEntry,
} from './context/semanticCache.js';
import {
  buildTimelineContext,
  getCharacterNameMap,
} from './context/timelineManager.js';
import { compressRollingSummaryRecency } from './utils/rollingSummary.js';

/**
 * 上下文预算配置
 */
export type ContextBudget = {
  /** 总 token 预算 */
  totalTokens: number;
  /** 各层分配比例 */
  allocation: {
    bible: number;           // Story Bible 占比
    characterState: number;  // 人物状态占比
    plotContext: number;     // 剧情图谱占比
    timeline: number;        // 时间线占比 (防止事件重复)
    rollingSummary: number;  // 滚动摘要占比
    lastChapters: number;    // 近章原文占比
    narrativeGuide: number;  // 叙事指导占比
  };
};

/**
 * 默认上下文预算 (基于现代大模型的大上下文窗口)
 *
 * 注意：现代模型（如 Claude 3.5/4, GPT-4o）支持 128k+ 上下文
 * 这里预算设置较为保守，可根据实际模型能力调整
 */
export const DEFAULT_BUDGET: ContextBudget = {
  totalTokens: 24000, // 总上下文预算（放宽），兼顾连贯性与输出空间
  allocation: {
    bible: 0.18,           // ~4320 tokens - 核心设定
    characterState: 0.12,  // ~2880 tokens - 人物状态
    plotContext: 0.10,     // ~2400 tokens - 剧情图谱
    timeline: 0.10,        // ~2400 tokens - 时间线（防重复）
    rollingSummary: 0.15,  // ~3600 tokens - 剧情摘要
    lastChapters: 0.25,    // ~6000 tokens - 近章原文
    narrativeGuide: 0.10,  // ~2400 tokens - 叙事指导
  },
};

/**
 * 根据节奏类型调整上下文预算
 */
export function adjustBudgetForPacing(
  baseBudget: ContextBudget,
  pacingType: PacingType
): ContextBudget {
  const adjusted = { ...baseBudget, allocation: { ...baseBudget.allocation } };

  switch (pacingType) {
    case 'action':
    case 'climax':
      // 动作/高潮章节：减少描述性上下文，增加近章原文
      adjusted.allocation.bible *= 0.7;
      adjusted.allocation.rollingSummary *= 0.8;
      adjusted.allocation.lastChapters *= 1.3;
      break;

    case 'revelation':
      // 揭示章节：增加剧情图谱，确保伏笔一致性
      adjusted.allocation.plotContext *= 1.5;
      adjusted.allocation.characterState *= 1.2;
      break;

    case 'emotional':
      // 情感章节：增加人物状态，确保情感连贯
      adjusted.allocation.characterState *= 1.5;
      adjusted.allocation.bible *= 0.8;
      break;

    case 'transition':
      // 过渡章节：平衡分配
      break;
  }

  // 归一化
  const total = Object.values(adjusted.allocation).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(adjusted.allocation) as (keyof typeof adjusted.allocation)[]) {
    adjusted.allocation[key] /= total;
  }

  return adjusted;
}

/**
 * 压缩 Story Bible
 * 策略：提取核心设定，删除冗余描述
 */
export function compressBible(bible: string, maxTokens: number): string {
  const maxChars = maxTokens * 2; // 粗略估算：1 token ≈ 2 中文字符

  if (bible.length <= maxChars) {
    return bible;
  }

  // 按段落分割
  const paragraphs = bible.split(/\n\n+/);

  // 优先级标记
  const priorities: { text: string; priority: number }[] = paragraphs.map((p) => {
    let priority = 5; // 默认中等优先级

    // 高优先级关键词
    if (/主角|金手指|系统|能力|世界观|力量体系/.test(p)) {
      priority = 10;
    } else if (/配角|反派|关系/.test(p)) {
      priority = 8;
    } else if (/爽点|核心|目标|动机/.test(p)) {
      priority = 9;
    } else if (/背景|历史|设定/.test(p)) {
      priority = 6;
    } else if (/示例|参考|备注/.test(p)) {
      priority = 3;
    }

    return { text: p, priority };
  });

  // 按优先级排序
  priorities.sort((a, b) => b.priority - a.priority);

  // 贪心选择
  const selected: string[] = [];
  let currentLength = 0;

  for (const item of priorities) {
    if (currentLength + item.text.length + 2 <= maxChars) {
      selected.push(item.text);
      currentLength += item.text.length + 2;
    }
  }

  return selected.join('\n\n');
}

/**
 * 优化人物状态上下文
 * 策略：只包含本章相关角色，按活跃度排序
 */
export function optimizeCharacterContext(
  registry: CharacterStateRegistry,
  chapterIndex: number,
  chapterOutlineCharacters?: string[],
  maxTokens: number = 900
): string {
  const maxChars = maxTokens * 2;
  const snapshots = Object.values(registry.snapshots);

  if (snapshots.length === 0) {
    return '';
  }

  // 计算每个角色的相关性分数
  const scored = snapshots.map((s) => {
    let score = 0;

    // 如果在大纲指定的角色中，高分
    if (chapterOutlineCharacters?.some((c) =>
      c.includes(s.characterName) || c.includes(s.characterId)
    )) {
      score += 100;
    }

    // 近期有变化的角色更重要
    const recentChanges = s.recentChanges.filter(
      (c) => chapterIndex - c.chapter <= 5
    );
    score += recentChanges.length * 20;

    // 主角/重要角色加分
    if (s.characterId.includes('protagonist') || s.characterId.includes('main')) {
      score += 50;
    }

    return { snapshot: s, score };
  });

  // 按分数排序
  scored.sort((a, b) => b.score - a.score);

  // 构建上下文
  const parts: string[] = ['【本章相关角色状态】'];
  let currentLength = parts[0].length;

  for (const { snapshot } of scored) {
    const entry = formatCompactSnapshot(snapshot);
    if (currentLength + entry.length + 2 <= maxChars) {
      parts.push(entry);
      currentLength += entry.length + 2;
    } else {
      break;
    }
  }

  if (parts.length === 1) {
    return ''; // 没有添加任何角色
  }

  return parts.join('\n');
}

/**
 * 紧凑格式化角色快照
 */
function formatCompactSnapshot(s: CharacterStateSnapshot): string {
  const lines: string[] = [];
  lines.push(`■ ${s.characterName}`);
  lines.push(`  位置:${s.physical.location} | 状态:${formatConditionShort(s.physical.condition)} | 情绪:${s.psychological.mood}`);

  if (s.psychological.motivation && s.psychological.motivation !== '未知') {
    lines.push(`  动机:${s.psychological.motivation}`);
  }

  if (s.recentChanges.length > 0) {
    const lastChange = s.recentChanges[s.recentChanges.length - 1];
    lines.push(`  近期:${lastChange.change}`);
  }

  return lines.join('\n');
}

function formatConditionShort(condition: string): string {
  const map: Record<string, string> = {
    healthy: '健康',
    minor_injury: '轻伤',
    major_injury: '重伤',
    weak: '虚弱',
    unconscious: '昏迷',
    unknown: '?',
  };
  return map[condition] || condition;
}

/**
 * 优化剧情图谱上下文
 * 策略：优先包含紧急伏笔和活跃剧情线
 */
export function optimizePlotContext(
  graph: PlotGraph,
  chapterIndex: number,
  maxTokens: number = 600
): string {
  const maxChars = maxTokens * 2;

  if (graph.nodes.length === 0) {
    return '';
  }

  const parts: string[] = [];
  let currentLength = 0;

  // 1. 紧急伏笔（最高优先级）
  const urgentForeshadowing = graph.pendingForeshadowing.filter(
    (p) => p.urgency === 'critical' || p.urgency === 'high'
  );

  if (urgentForeshadowing.length > 0) {
    const section = formatUrgentForeshadowing(urgentForeshadowing.slice(0, 3));
    if (currentLength + section.length <= maxChars) {
      parts.push(section);
      currentLength += section.length;
    }
  }

  // 2. 活跃主线剧情
  const mainPlots = graph.activeMainPlots
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter(Boolean) as PlotNode[];

  if (mainPlots.length > 0 && currentLength < maxChars * 0.7) {
    const section = formatActivePlots(mainPlots.slice(0, 3), '主线');
    if (currentLength + section.length <= maxChars) {
      parts.push(section);
      currentLength += section.length;
    }
  }

  // 3. 近期事件（用于因果连贯）
  const recentEvents = graph.nodes
    .filter((n) => n.status === 'active' && chapterIndex - n.introducedAt <= 5)
    .sort((a, b) => b.introducedAt - a.introducedAt)
    .slice(0, 3);

  if (recentEvents.length > 0 && currentLength < maxChars * 0.9) {
    const section = `【近期事件】\n${recentEvents.map((e) => `• 第${e.introducedAt}章: ${e.content}`).join('\n')}`;
    if (currentLength + section.length <= maxChars) {
      parts.push(section);
    }
  }

  return parts.join('\n\n');
}

function formatUrgentForeshadowing(items: PendingForeshadowing[]): string {
  return `【伏笔回收提醒⚠️】
${items.map((p) => `• ${p.summary} (已${p.ageInChapters}章，${p.urgency === 'critical' ? '紧急' : '重要'})`).join('\n')}`;
}

function formatActivePlots(plots: PlotNode[], label: string): string {
  return `【${label}剧情】
${plots.map((p) => `• ${p.content}`).join('\n')}`;
}

/**
 * 优化滚动摘要
 * 策略：按章节距离加权，近期详细，远期概括
 */
export function optimizeRollingSummary(
  summary: string,
  chapterIndex: number,
  maxTokens: number = 900
): string {
  void chapterIndex;
  return compressRollingSummaryRecency(summary || '', maxTokens);
}

/**
 * 优化近章原文
 * 策略：最近一章完整，前一章压缩
 */
export function optimizeLastChapters(
  chapters: string[],
  maxTokens: number = 1800
): string {
  if (chapters.length === 0) {
    return '';
  }

  const maxChars = maxTokens * 2;
  const parts: string[] = [];
  let currentLength = 0;

  // 最近一章：尽量完整
  if (chapters.length >= 1) {
    const lastChapter = chapters[chapters.length - 1];
    const lastChapterBudget = Math.floor(maxChars * 0.7);

    if (lastChapter.length <= lastChapterBudget) {
      parts.push(`【上一章原文】\n${lastChapter}`);
      currentLength = lastChapter.length + 10;
    } else {
      // 截取末尾部分（通常是最重要的悬念和钩子）
      const truncated = '...' + lastChapter.slice(-lastChapterBudget + 3);
      parts.push(`【上一章原文(节选)】\n${truncated}`);
      currentLength = truncated.length + 15;
    }
  }

  // 前一章：仅保留结尾
  if (chapters.length >= 2 && currentLength < maxChars * 0.9) {
    const prevChapter = chapters[chapters.length - 2];
    const remainingBudget = maxChars - currentLength - 20;

    if (remainingBudget > 200) {
      const endingLength = Math.min(remainingBudget, 500);
      const ending = '...' + prevChapter.slice(-endingLength);
      parts.push(`【前一章结尾】\n${ending}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * 构建优化后的完整上下文
 */
export function buildOptimizedContext(params: {
  bible: string;
  characterStates?: CharacterStateRegistry;
  plotGraph?: PlotGraph;
  timeline?: TimelineState;
  characters?: CharacterRelationGraph;
  rollingSummary: string;
  lastChapters: string[];
  narrativeGuide?: NarrativeGuide;
  chapterIndex: number;
  totalChapters: number;
  chapterOutlineCharacters?: string[];
  budget?: ContextBudget;
}): string {
  const {
    bible,
    characterStates,
    plotGraph,
    timeline,
    characters,
    rollingSummary,
    lastChapters,
    narrativeGuide,
    chapterIndex,
    totalChapters,
    chapterOutlineCharacters,
  } = params;

  // 根据节奏调整预算
  let budget = params.budget || DEFAULT_BUDGET;
  if (narrativeGuide) {
    budget = adjustBudgetForPacing(budget, narrativeGuide.pacingType);
  }

  const parts: string[] = [];

  // 章节信息
  parts.push(`【章节信息】
- 当前章节: 第${chapterIndex}/${totalChapters}章
- 是否终章: ${chapterIndex === totalChapters ? '是' : '否'}`);

  // Story Bible (压缩)
  const compressedBible = compressBible(
    bible,
    Math.floor(budget.totalTokens * budget.allocation.bible)
  );
  parts.push(`【核心设定】\n${compressedBible}`);

  // 人物状态 (优化)
  if (characterStates && Object.keys(characterStates.snapshots).length > 0) {
    const charContext = optimizeCharacterContext(
      characterStates,
      chapterIndex,
      chapterOutlineCharacters,
      Math.floor(budget.totalTokens * budget.allocation.characterState)
    );
    if (charContext) {
      parts.push(charContext);
    }
  }

  // 剧情图谱 (优化)
  if (plotGraph && plotGraph.nodes.length > 0) {
    const plotContext = optimizePlotContext(
      plotGraph,
      chapterIndex,
      Math.floor(budget.totalTokens * budget.allocation.plotContext)
    );
    if (plotContext) {
      parts.push(plotContext);
    }
  }

  // 时间线上下文 (防止事件重复)
  if (timeline && timeline.events.length > 0) {
    const characterNameMap = getCharacterNameMap(characters, characterStates);
    const timelineContext = buildTimelineContext(timeline, chapterIndex, characterNameMap);
    if (timelineContext) {
      parts.push(timelineContext);
    }
  }

  // 叙事指导
  if (narrativeGuide) {
    parts.push(`【本章叙事要求】
- 节奏: ${narrativeGuide.pacingTarget}/10 (${narrativeGuide.pacingType})
- 基调: ${narrativeGuide.emotionalTone}
- 字数: ${narrativeGuide.wordCountRange[0]}-${narrativeGuide.wordCountRange[1]}
${narrativeGuide.prohibitions.length > 0 ? `- 禁止: ${narrativeGuide.prohibitions.join('; ')}` : ''}`);
  }

  // 滚动摘要 (优化)
  const optSummary = optimizeRollingSummary(
    rollingSummary,
    chapterIndex,
    Math.floor(budget.totalTokens * budget.allocation.rollingSummary)
  );
  if (optSummary) {
    parts.push(`【剧情摘要】\n${optSummary}`);
  }

  // 近章原文 (优化)
  const optLastChapters = optimizeLastChapters(
    lastChapters,
    Math.floor(budget.totalTokens * budget.allocation.lastChapters)
  );
  if (optLastChapters) {
    parts.push(optLastChapters);
  }

  return parts.join('\n\n');
}

/**
 * 估算上下文 token 数
 */
export function estimateTokens(text: string): number {
  // 粗略估算：中文约 0.5 token/字符，英文约 0.25 token/字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 0.5 + otherChars * 0.25);
}

/**
 * 获取上下文使用统计
 */
export function getContextStats(context: string): {
  totalChars: number;
  estimatedTokens: number;
  sections: { name: string; chars: number }[];
} {
  const totalChars = context.length;
  const estimatedTokens = estimateTokens(context);

  // 解析各部分
  const sectionPattern = /【([^】]+)】/g;
  const sections: { name: string; chars: number }[] = [];
  let match;
  let lastIndex = 0;
  let lastName = 'header';

  while ((match = sectionPattern.exec(context)) !== null) {
    if (lastIndex > 0) {
      sections.push({
        name: lastName,
        chars: match.index - lastIndex,
      });
    }
    lastName = match[1];
    lastIndex = match.index;
  }

  if (lastIndex > 0) {
    sections.push({
      name: lastName,
      chars: context.length - lastIndex,
    });
  }

  return { totalChars, estimatedTokens, sections };
}

/**
 * 带缓存的优化上下文构建
 * 优先使用缓存，只在必要时重新计算
 */
export function buildOptimizedContextWithCache(
  projectId: string,
  params: Parameters<typeof buildOptimizedContext>[0]
): {
  context: string;
  fromCache: boolean;
  cacheStats?: {
    changedComponents: string[];
    reason: string;
  };
} {
  const { chapterIndex, characterStates, plotGraph, rollingSummary } = params;

  // 计算状态版本
  const stateVersion = computeStateVersion(
    characterStates?.lastUpdatedChapter || 0,
    plotGraph?.lastUpdatedChapter || 0,
    chapterIndex
  );

  // 尝试从缓存获取
  const cached = globalSemanticCache.get(
    projectId,
    'full_context',
    chapterIndex,
    stateVersion
  );

  // 检测变化
  const changeDetection = detectContextChanges(cached, {
    characterStates,
    plotGraph,
    rollingSummary,
    chapterIndex,
  });

  if (!changeDetection.needsRegeneration && cached) {
    return {
      context: cached.content,
      fromCache: true,
    };
  }

  // 需要重新生成
  const context = buildOptimizedContext(params);

  // 更新缓存
  globalSemanticCache.set(
    projectId,
    'full_context',
    chapterIndex,
    context,
    stateVersion,
    {
      characterStatesVersion: characterStates?.lastUpdatedChapter || 0,
      plotGraphVersion: plotGraph?.lastUpdatedChapter || 0,
      summaryHash: hashSimple(rollingSummary),
    }
  );

  return {
    context,
    fromCache: false,
    cacheStats: {
      changedComponents: changeDetection.changedComponents,
      reason: changeDetection.reason,
    },
  };
}

/**
 * 简单哈希函数
 */
function hashSimple(str: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 500); i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats() {
  return globalSemanticCache.getStats();
}

/**
 * 清除项目缓存
 */
export function clearProjectCache(projectId: string) {
  globalSemanticCache.invalidateProject(projectId);
}

/**
 * 清除指定章节之后的缓存
 */
export function invalidateCacheFromChapter(projectId: string, fromChapter: number) {
  globalSemanticCache.invalidateFromChapter(projectId, fromChapter);
}
