/**
 * 人物状态追踪系统 - 类型定义
 *
 * 用于追踪每个角色在故事进程中的动态状态变化，
 * 解决人物不一致问题（性格突变、能力穿帮、状态矛盾）
 */

/**
 * 单个角色的状态快照
 */
export type CharacterStateSnapshot = {
  /** 快照对应的章节 */
  asOfChapter: number;

  /** 角色ID (对应 CharacterProfile.id) */
  characterId: string;

  /** 角色名 (冗余存储，方便展示) */
  characterName: string;

  /** 物理状态 */
  physical: {
    /** 当前位置 */
    location: string;
    /** 身体状态 (健康/轻伤/重伤/虚弱/昏迷) */
    condition: 'healthy' | 'minor_injury' | 'major_injury' | 'weak' | 'unconscious' | 'unknown';
    /** 携带的重要物品/武器 */
    equipment: string[];
    /** 已解锁/获得的能力 */
    abilities: string[];
    /** 能力等级/境界 (如适用) */
    powerLevel?: string;
  };

  /** 心理状态 */
  psychological: {
    /** 主要情绪 */
    mood: string;
    /** 当前核心动机 (最想做的事) */
    motivation: string;
    /** 已知的秘密 (知道了什么别人不知道的) */
    knownSecrets: string[];
    /** 当前信念/误解 (相信什么是真的，可能是错的) */
    beliefs: string[];
    /** 内心矛盾 (如果有) */
    innerConflict?: string;
  };

  /** 社会状态 */
  social: {
    /** 公开身份 */
    publicIdentity: string;
    /** 隐藏身份 (如果有) */
    hiddenIdentity?: string;
    /** 当前声望/名声 */
    reputation: string;
    /** 当前活跃的同盟关系 (角色ID列表) */
    activeAlliances: string[];
    /** 当前活跃的敌对关系 (角色ID列表) */
    activeEnemies: string[];
  };

  /** 近期重要变化记录 (最多保留5条) */
  recentChanges: CharacterStateChange[];
};

/**
 * 角色状态变化记录
 */
export type CharacterStateChange = {
  /** 发生变化的章节 */
  chapter: number;
  /** 变化描述 */
  change: string;
  /** 变化的字段路径 (如 "physical.location") */
  field: string;
  /** 旧值 */
  oldValue?: string;
  /** 新值 */
  newValue: string;
};

/**
 * 角色状态注册表 - 管理所有角色的状态
 */
export type CharacterStateRegistry = {
  /** 数据版本 */
  version: string;

  /** 最后更新的章节 */
  lastUpdatedChapter: number;

  /** 所有角色的状态快照 (key: characterId) */
  snapshots: Record<string, CharacterStateSnapshot>;

  /** 待处理的状态更新队列 (用于人工审核) */
  pendingUpdates: PendingStateUpdate[];
};

/**
 * 待处理的状态更新
 */
export type PendingStateUpdate = {
  /** 角色ID */
  characterId: string;
  /** 变化的字段路径 */
  field: string;
  /** 旧值 */
  oldValue: string;
  /** 新值 */
  newValue: string;
  /** 发生的章节 */
  chapter: number;
  /** 原文依据 */
  evidence: string;
  /** 置信度 (0-1) */
  confidence: number;
};

/**
 * AI 分析返回的状态变化
 */
export type AIStateChangeAnalysis = {
  changes: {
    characterId: string;
    characterName: string;
    field: string;
    oldValue: string;
    newValue: string;
    evidence: string;
    confidence: number;
  }[];
};

/**
 * 创建空的状态注册表
 */
export function createEmptyRegistry(): CharacterStateRegistry {
  return {
    version: '1.0.0',
    lastUpdatedChapter: 0,
    snapshots: {},
    pendingUpdates: [],
  };
}

/**
 * 创建角色的初始状态快照
 */
export function createInitialSnapshot(
  characterId: string,
  characterName: string,
  initialData?: Partial<CharacterStateSnapshot>
): CharacterStateSnapshot {
  return {
    asOfChapter: 0,
    characterId,
    characterName,
    physical: {
      location: '未知',
      condition: 'healthy',
      equipment: [],
      abilities: [],
      ...initialData?.physical,
    },
    psychological: {
      mood: '平静',
      motivation: '未知',
      knownSecrets: [],
      beliefs: [],
      ...initialData?.psychological,
    },
    social: {
      publicIdentity: '未知',
      reputation: '未知',
      activeAlliances: [],
      activeEnemies: [],
      ...initialData?.social,
    },
    recentChanges: [],
  };
}

/**
 * 格式化状态快照为 Prompt 片段
 */
export function formatSnapshotForPrompt(snapshot: CharacterStateSnapshot): string {
  const parts: string[] = [];

  parts.push(`## ${snapshot.characterName} (ID: ${snapshot.characterId})`);
  parts.push(`【物理状态】`);
  parts.push(`  - 位置: ${snapshot.physical.location}`);
  parts.push(`  - 身体: ${formatCondition(snapshot.physical.condition)}`);
  if (snapshot.physical.equipment.length > 0) {
    parts.push(`  - 装备: ${snapshot.physical.equipment.join(', ')}`);
  }
  if (snapshot.physical.abilities.length > 0) {
    parts.push(`  - 能力: ${snapshot.physical.abilities.join(', ')}`);
  }
  if (snapshot.physical.powerLevel) {
    parts.push(`  - 境界: ${snapshot.physical.powerLevel}`);
  }

  parts.push(`【心理状态】`);
  parts.push(`  - 情绪: ${snapshot.psychological.mood}`);
  parts.push(`  - 动机: ${snapshot.psychological.motivation}`);
  if (snapshot.psychological.knownSecrets.length > 0) {
    parts.push(`  - 已知秘密: ${snapshot.psychological.knownSecrets.join('; ')}`);
  }
  if (snapshot.psychological.beliefs.length > 0) {
    parts.push(`  - 信念: ${snapshot.psychological.beliefs.join('; ')}`);
  }
  if (snapshot.psychological.innerConflict) {
    parts.push(`  - 内心矛盾: ${snapshot.psychological.innerConflict}`);
  }

  parts.push(`【社会状态】`);
  parts.push(`  - 身份: ${snapshot.social.publicIdentity}`);
  if (snapshot.social.hiddenIdentity) {
    parts.push(`  - 隐藏身份: ${snapshot.social.hiddenIdentity}`);
  }
  parts.push(`  - 声望: ${snapshot.social.reputation}`);

  if (snapshot.recentChanges.length > 0) {
    parts.push(`【近期重要变化】`);
    snapshot.recentChanges.slice(-3).forEach((change) => {
      parts.push(`  - 第${change.chapter}章: ${change.change}`);
    });
  }

  return parts.join('\n');
}

/**
 * 格式化身体状况
 */
function formatCondition(condition: CharacterStateSnapshot['physical']['condition']): string {
  const conditionMap: Record<typeof condition, string> = {
    healthy: '健康',
    minor_injury: '轻伤',
    major_injury: '重伤',
    weak: '虚弱',
    unconscious: '昏迷',
    unknown: '未知',
  };
  return conditionMap[condition] || condition;
}

/**
 * 获取本章活跃角色的状态快照
 * 基于近期变化和登场信息筛选
 */
export function getActiveCharacterSnapshots(
  registry: CharacterStateRegistry,
  chapterIndex: number,
  maxCharacters: number = 5
): CharacterStateSnapshot[] {
  const snapshots = Object.values(registry.snapshots);

  // 按近期活跃度排序 (近期有变化的优先)
  const sorted = snapshots.sort((a, b) => {
    const aLastChange = a.recentChanges.length > 0
      ? a.recentChanges[a.recentChanges.length - 1].chapter
      : 0;
    const bLastChange = b.recentChanges.length > 0
      ? b.recentChanges[b.recentChanges.length - 1].chapter
      : 0;

    // 优先返回近期有变化的
    return bLastChange - aLastChange;
  });

  return sorted.slice(0, maxCharacters);
}

/**
 * 合并状态变化到快照
 */
export function applyChangesToSnapshot(
  snapshot: CharacterStateSnapshot,
  changes: AIStateChangeAnalysis['changes'],
  chapterIndex: number
): CharacterStateSnapshot {
  const updated = { ...snapshot };
  updated.asOfChapter = chapterIndex;
  updated.recentChanges = [...snapshot.recentChanges];

  for (const change of changes) {
    if (change.characterId !== snapshot.characterId) continue;

    // 解析字段路径并更新
    const pathParts = change.field.split('.');
    let target: any = updated;

    for (let i = 0; i < pathParts.length - 1; i++) {
      target = target[pathParts[i]];
      if (!target) break;
    }

    if (target) {
      const lastKey = pathParts[pathParts.length - 1];
      const oldValue = target[lastKey];

      // 更新值
      if (Array.isArray(target[lastKey])) {
        // 数组类型：追加或替换
        if (change.newValue.startsWith('+')) {
          target[lastKey] = [...target[lastKey], change.newValue.slice(1)];
        } else if (change.newValue.startsWith('-')) {
          target[lastKey] = target[lastKey].filter((v: string) => v !== change.newValue.slice(1));
        } else {
          target[lastKey] = [change.newValue];
        }
      } else {
        target[lastKey] = change.newValue;
      }

      // 记录变化
      updated.recentChanges.push({
        chapter: chapterIndex,
        change: `${change.field}: ${oldValue} → ${change.newValue}`,
        field: change.field,
        oldValue: String(oldValue),
        newValue: change.newValue,
      });
    }
  }

  // 只保留最近5条变化
  if (updated.recentChanges.length > 5) {
    updated.recentChanges = updated.recentChanges.slice(-5);
  }

  return updated;
}
