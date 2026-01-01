/**
 * 语义级上下文缓存系统
 *
 * 核心功能：
 * 1. 缓存计算好的上下文段落
 * 2. 基于章节索引和状态版本进行缓存失效
 * 3. 支持增量更新，避免重复计算
 * 4. 提供上下文复用策略
 */

import type { CharacterStateRegistry, CharacterStateSnapshot } from '../types/characterState.js';
import type { PlotGraph, PendingForeshadowing } from '../types/plotGraph.js';
import type { NarrativeGuide, NarrativeArc } from '../types/narrative.js';

/**
 * 缓存条目类型
 */
export type CacheEntryType =
  | 'character_context'    // 人物上下文
  | 'plot_context'         // 剧情上下文
  | 'narrative_guide'      // 叙事指导
  | 'rolling_summary'      // 滚动摘要
  | 'bible_compressed'     // 压缩后的 Bible
  | 'full_context';        // 完整上下文

/**
 * 缓存条目
 */
export type CacheEntry = {
  /** 缓存类型 */
  type: CacheEntryType;

  /** 缓存内容 */
  content: string;

  /** 章节索引（用于失效判断） */
  chapterIndex: number;

  /** 状态版本（用于失效判断） */
  stateVersion: number;

  /** 创建时间 */
  createdAt: number;

  /** 过期时间 (ms) */
  ttl: number;

  /** 内容哈希（用于判断内容是否变化） */
  contentHash: string;

  /** 元数据 */
  metadata?: Record<string, any>;
};

/**
 * 语义缓存管理器
 */
export class SemanticCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private defaultTTL: number;

  constructor(options: {
    maxSize?: number;
    defaultTTL?: number;
  } = {}) {
    this.maxSize = options.maxSize || 100;
    this.defaultTTL = options.defaultTTL || 30 * 60 * 1000; // 30 分钟
  }

  /**
   * 生成缓存键
   */
  private generateKey(
    projectId: string,
    type: CacheEntryType,
    chapterIndex: number
  ): string {
    return `${projectId}:${type}:${chapterIndex}`;
  }

  /**
   * 计算内容哈希（简单版本）
   */
  private computeHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * 设置缓存
   */
  set(
    projectId: string,
    type: CacheEntryType,
    chapterIndex: number,
    content: string,
    stateVersion: number,
    metadata?: Record<string, any>,
    ttl?: number
  ): void {
    // 清理过期缓存
    this.cleanup();

    // 如果超过最大容量，删除最旧的条目
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.findOldestEntry();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const key = this.generateKey(projectId, type, chapterIndex);
    const entry: CacheEntry = {
      type,
      content,
      chapterIndex,
      stateVersion,
      createdAt: Date.now(),
      ttl: ttl || this.defaultTTL,
      contentHash: this.computeHash(content),
      metadata,
    };

    this.cache.set(key, entry);
  }

  /**
   * 获取缓存
   */
  get(
    projectId: string,
    type: CacheEntryType,
    chapterIndex: number,
    currentStateVersion: number
  ): CacheEntry | null {
    const key = this.generateKey(projectId, type, chapterIndex);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // 检查状态版本是否匹配
    if (entry.stateVersion !== currentStateVersion) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * 检查缓存是否有效
   */
  isValid(
    projectId: string,
    type: CacheEntryType,
    chapterIndex: number,
    currentStateVersion: number
  ): boolean {
    return this.get(projectId, type, chapterIndex, currentStateVersion) !== null;
  }

  /**
   * 失效指定项目的所有缓存
   */
  invalidateProject(projectId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * 失效指定章节之后的所有缓存
   */
  invalidateFromChapter(projectId: string, fromChapter: number): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(`${projectId}:`) && entry.chapterIndex >= fromChapter) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * 清理过期缓存
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.createdAt > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
  }

  /**
   * 查找最旧的缓存条目
   */
  private findOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * 获取缓存统计
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    entries: { type: CacheEntryType; count: number }[];
  } {
    const typeCounts: Record<CacheEntryType, number> = {
      character_context: 0,
      plot_context: 0,
      narrative_guide: 0,
      rolling_summary: 0,
      bible_compressed: 0,
      full_context: 0,
    };

    for (const entry of this.cache.values()) {
      typeCounts[entry.type]++;
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // 需要额外追踪
      entries: Object.entries(typeCounts)
        .filter(([_, count]) => count > 0)
        .map(([type, count]) => ({ type: type as CacheEntryType, count })),
    };
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }
}

// 全局缓存实例
export const globalSemanticCache = new SemanticCache();

/**
 * 缓存键生成器
 */
export function generateCacheKey(
  projectId: string,
  chapterIndex: number,
  components: {
    hasCharacterStates: boolean;
    hasPlotGraph: boolean;
    hasNarrativeArc: boolean;
  }
): string {
  const flags = [
    components.hasCharacterStates ? 'C' : '',
    components.hasPlotGraph ? 'P' : '',
    components.hasNarrativeArc ? 'N' : '',
  ].filter(Boolean).join('');

  return `${projectId}:ch${chapterIndex}:${flags || 'base'}`;
}

/**
 * 计算状态版本号
 * 基于各个组件的最后更新章节计算
 */
export function computeStateVersion(
  characterStatesChapter: number,
  plotGraphChapter: number,
  lastSummaryChapter: number
): number {
  // 简单组合：各章节号的加权和
  return characterStatesChapter * 10000 + plotGraphChapter * 100 + lastSummaryChapter;
}

/**
 * 上下文差异检测器
 * 判断是否需要重新生成上下文
 */
export function detectContextChanges(
  cached: CacheEntry | null,
  current: {
    characterStates?: CharacterStateRegistry;
    plotGraph?: PlotGraph;
    rollingSummary: string;
    chapterIndex: number;
  }
): {
  needsRegeneration: boolean;
  changedComponents: string[];
  reason: string;
} {
  if (!cached) {
    return {
      needsRegeneration: true,
      changedComponents: ['all'],
      reason: '无缓存',
    };
  }

  const changedComponents: string[] = [];

  // 检查章节索引
  if (cached.chapterIndex !== current.chapterIndex) {
    return {
      needsRegeneration: true,
      changedComponents: ['chapter'],
      reason: `章节变化 ${cached.chapterIndex} -> ${current.chapterIndex}`,
    };
  }

  // 检查人物状态变化
  if (current.characterStates) {
    const cachedVersion = cached.metadata?.characterStatesVersion || 0;
    const currentVersion = current.characterStates.lastUpdatedChapter;
    if (cachedVersion !== currentVersion) {
      changedComponents.push('characterStates');
    }
  }

  // 检查剧情图谱变化
  if (current.plotGraph) {
    const cachedVersion = cached.metadata?.plotGraphVersion || 0;
    const currentVersion = current.plotGraph.lastUpdatedChapter;
    if (cachedVersion !== currentVersion) {
      changedComponents.push('plotGraph');
    }
  }

  // 检查摘要变化（通过哈希比较）
  const summaryHash = hashString(current.rollingSummary);
  if (cached.metadata?.summaryHash !== summaryHash) {
    changedComponents.push('rollingSummary');
  }

  return {
    needsRegeneration: changedComponents.length > 0,
    changedComponents,
    reason: changedComponents.length > 0
      ? `组件变化: ${changedComponents.join(', ')}`
      : '无变化',
  };
}

/**
 * 简单字符串哈希
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(str.length, 1000); i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

/**
 * 增量上下文更新器
 * 只更新变化的部分，复用未变化的缓存
 */
export function buildIncrementalContext(
  cached: CacheEntry | null,
  changedComponents: string[],
  newParts: {
    characterContext?: string;
    plotContext?: string;
    narrativeGuide?: string;
    rollingSummary?: string;
    bible?: string;
    lastChapters?: string;
  }
): string {
  // 如果没有缓存或所有组件都变化了，直接构建新的
  if (!cached || changedComponents.includes('all')) {
    return buildFullContext(newParts);
  }

  // 解析缓存的上下文结构
  const cachedParts = parseCachedContext(cached.content);

  // 增量更新变化的部分
  const updatedParts = { ...cachedParts };

  if (changedComponents.includes('characterStates') && newParts.characterContext) {
    updatedParts.characterContext = newParts.characterContext;
  }

  if (changedComponents.includes('plotGraph') && newParts.plotContext) {
    updatedParts.plotContext = newParts.plotContext;
  }

  if (changedComponents.includes('rollingSummary') && newParts.rollingSummary) {
    updatedParts.rollingSummary = newParts.rollingSummary;
  }

  // 章节和 bible 总是使用最新的
  if (newParts.lastChapters) {
    updatedParts.lastChapters = newParts.lastChapters;
  }

  return buildFullContext(updatedParts);
}

/**
 * 构建完整上下文
 */
function buildFullContext(parts: {
  bible?: string;
  characterContext?: string;
  plotContext?: string;
  narrativeGuide?: string;
  rollingSummary?: string;
  lastChapters?: string;
}): string {
  const sections: string[] = [];

  if (parts.bible) {
    sections.push(`【核心设定】\n${parts.bible}`);
  }

  if (parts.characterContext) {
    sections.push(parts.characterContext);
  }

  if (parts.plotContext) {
    sections.push(parts.plotContext);
  }

  if (parts.narrativeGuide) {
    sections.push(parts.narrativeGuide);
  }

  if (parts.rollingSummary) {
    sections.push(`【剧情摘要】\n${parts.rollingSummary}`);
  }

  if (parts.lastChapters) {
    sections.push(parts.lastChapters);
  }

  return sections.join('\n\n');
}

/**
 * 解析缓存的上下文结构
 */
function parseCachedContext(content: string): Record<string, string> {
  const parts: Record<string, string> = {};
  const sectionPattern = /【([^】]+)】\n([\s\S]*?)(?=\n【|$)/g;

  let match;
  while ((match = sectionPattern.exec(content)) !== null) {
    const sectionName = match[1];
    const sectionContent = match[2].trim();

    // 映射到标准键名
    switch (sectionName) {
      case '核心设定':
        parts.bible = sectionContent;
        break;
      case '本章相关角色状态':
        parts.characterContext = `【${sectionName}】\n${sectionContent}`;
        break;
      case '伏笔回收提醒⚠️':
      case '主线剧情':
      case '近期事件':
        parts.plotContext = (parts.plotContext || '') + `【${sectionName}】\n${sectionContent}\n\n`;
        break;
      case '本章叙事要求':
        parts.narrativeGuide = `【${sectionName}】\n${sectionContent}`;
        break;
      case '剧情摘要':
        parts.rollingSummary = sectionContent;
        break;
      case '上一章原文':
      case '上一章原文(节选)':
      case '前一章结尾':
        parts.lastChapters = (parts.lastChapters || '') + `【${sectionName}】\n${sectionContent}\n\n`;
        break;
    }
  }

  return parts;
}

/**
 * 预热缓存
 * 在生成章节前预先计算常用的上下文组件
 */
export async function warmupCache(
  cache: SemanticCache,
  projectId: string,
  startChapter: number,
  endChapter: number,
  computeContext: (chapterIndex: number) => Promise<string>
): Promise<void> {
  for (let i = startChapter; i <= endChapter; i++) {
    const content = await computeContext(i);
    cache.set(projectId, 'full_context', i, content, 0);
  }
}
