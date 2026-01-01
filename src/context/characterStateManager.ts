/**
 * 人物状态管理器
 *
 * 负责：
 * 1. 从章节内容中提取角色状态变化
 * 2. 更新状态注册表
 * 3. 生成用于 prompt 的角色状态上下文
 */

import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import type { CharacterRelationGraph, CharacterProfile } from '../types/characters.js';
import {
  type CharacterStateRegistry,
  type CharacterStateSnapshot,
  type AIStateChangeAnalysis,
  createEmptyRegistry,
  createInitialSnapshot,
  formatSnapshotForPrompt,
  getActiveCharacterSnapshots,
  applyChangesToSnapshot,
} from '../types/characterState.js';
import { z } from 'zod';

/**
 * AI 状态分析结果的 Schema
 */
const StateAnalysisSchema = z.object({
  changes: z.array(
    z.object({
      characterId: z.string(),
      characterName: z.string(),
      field: z.string(),
      oldValue: z.string(),
      newValue: z.string(),
      evidence: z.string(),
      confidence: z.number().min(0).max(1),
    })
  ),
});

/**
 * 从 CharacterRelationGraph 初始化状态注册表
 */
export function initializeRegistryFromGraph(
  graph: CharacterRelationGraph
): CharacterStateRegistry {
  const registry = createEmptyRegistry();

  // 处理主角
  for (const char of graph.protagonists) {
    registry.snapshots[char.id] = createSnapshotFromProfile(char);
  }

  // 处理重要配角
  for (const char of graph.mainCharacters) {
    registry.snapshots[char.id] = createSnapshotFromProfile(char);
  }

  return registry;
}

/**
 * 从 CharacterProfile 创建初始状态快照
 */
function createSnapshotFromProfile(profile: CharacterProfile): CharacterStateSnapshot {
  return createInitialSnapshot(profile.id, profile.name, {
    physical: {
      location: '未知',
      condition: 'healthy',
      equipment: [],
      abilities: profile.abilities || [],
      powerLevel: undefined,
    },
    psychological: {
      mood: '平静',
      motivation: profile.personality.desires?.[0] || '未知',
      knownSecrets: [],
      beliefs: [],
      innerConflict: undefined,
    },
    social: {
      publicIdentity: profile.basic.identity || '未知',
      hiddenIdentity: undefined,
      reputation: '未知',
      activeAlliances: [],
      activeEnemies: [],
    },
  });
}

/**
 * 分析章节内容，提取角色状态变化
 */
export async function analyzeChapterForStateChanges(
  aiConfig: AIConfig,
  chapterText: string,
  chapterIndex: number,
  currentRegistry: CharacterStateRegistry
): Promise<AIStateChangeAnalysis> {
  const system = `
你是一个专业的小说角色状态分析师。你的任务是分析章节内容，提取所有角色的状态变化。

【分析要点】
1. 物理状态变化:
   - physical.location: 角色位置移动
   - physical.condition: 身体状态变化 (healthy/minor_injury/major_injury/weak/unconscious)
   - physical.equipment: 获得或失去重要物品 (用 +物品 表示获得，-物品 表示失去)
   - physical.abilities: 获得新能力 (用 +能力 表示)
   - physical.powerLevel: 境界/等级变化

2. 心理状态变化:
   - psychological.mood: 情绪变化
   - psychological.motivation: 动机变化
   - psychological.knownSecrets: 发现新秘密 (用 +秘密 表示)
   - psychological.beliefs: 信念变化
   - psychological.innerConflict: 产生内心矛盾

3. 社会状态变化:
   - social.publicIdentity: 公开身份变化
   - social.hiddenIdentity: 隐藏身份被揭示或获得
   - social.reputation: 声望变化
   - social.activeAlliances: 结盟变化 (用 +角色ID 或 -角色ID)
   - social.activeEnemies: 敌对变化 (用 +角色ID 或 -角色ID)

【输出格式】
只输出 JSON，不要有任何其他文字:
{
  "changes": [
    {
      "characterId": "角色ID",
      "characterName": "角色名",
      "field": "字段路径",
      "oldValue": "旧值",
      "newValue": "新值",
      "evidence": "原文依据（简短引用）",
      "confidence": 0.0-1.0
    }
  ]
}

【注意事项】
- 只记录明确发生的变化，不要推测
- confidence 低于 0.6 的变化不要输出
- 每个角色每个字段最多一条变化
- 如果没有明显变化，返回空数组 {"changes": []}
`.trim();

  // 构建当前状态概要
  const currentStatesContext = Object.values(currentRegistry.snapshots)
    .slice(0, 10) // 最多10个角色
    .map((s) => `${s.characterName}(${s.characterId}): 位置=${s.physical.location}, 状态=${s.physical.condition}, 情绪=${s.psychological.mood}`)
    .join('\n');

  const prompt = `
【当前角色状态概要】
${currentStatesContext || '（无已知状态）'}

【本章内容 - 第${chapterIndex}章】
${chapterText.slice(0, 6000)}

请分析本章中的角色状态变化:
`.trim();

  try {
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.2, // 低温度确保稳定输出
    });

    // 清理可能的代码块标记
    const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
    const parsed = StateAnalysisSchema.parse(JSON.parse(jsonText));

    // 过滤低置信度的变化
    return {
      changes: parsed.changes.filter((c) => c.confidence >= 0.6),
    };
  } catch (error) {
    console.warn('State analysis parsing failed:', error);
    return { changes: [] };
  }
}

/**
 * 更新状态注册表
 */
export function updateRegistry(
  registry: CharacterStateRegistry,
  changes: AIStateChangeAnalysis,
  chapterIndex: number
): CharacterStateRegistry {
  const updated: CharacterStateRegistry = {
    ...registry,
    lastUpdatedChapter: chapterIndex,
    snapshots: { ...registry.snapshots },
  };

  // 按角色分组变化
  const changesByCharacter = new Map<string, AIStateChangeAnalysis['changes']>();
  for (const change of changes.changes) {
    const existing = changesByCharacter.get(change.characterId) || [];
    existing.push(change);
    changesByCharacter.set(change.characterId, existing);
  }

  // 应用变化到每个角色
  for (const [characterId, charChanges] of changesByCharacter) {
    const snapshot = updated.snapshots[characterId];
    if (snapshot) {
      updated.snapshots[characterId] = applyChangesToSnapshot(
        snapshot,
        charChanges,
        chapterIndex
      );
    } else {
      // 新角色：创建初始快照
      const firstChange = charChanges[0];
      if (firstChange) {
        const newSnapshot = createInitialSnapshot(
          characterId,
          firstChange.characterName
        );
        updated.snapshots[characterId] = applyChangesToSnapshot(
          newSnapshot,
          charChanges,
          chapterIndex
        );
      }
    }
  }

  return updated;
}

/**
 * 生成用于章节生成 prompt 的角色状态上下文
 */
export function buildCharacterStateContext(
  registry: CharacterStateRegistry,
  chapterIndex: number,
  maxCharacters: number = 5
): string {
  if (Object.keys(registry.snapshots).length === 0) {
    return '';
  }

  const activeSnapshots = getActiveCharacterSnapshots(
    registry,
    chapterIndex,
    maxCharacters
  );

  if (activeSnapshots.length === 0) {
    return '';
  }

  const parts: string[] = [
    '【本章活跃角色状态】',
    '以下是主要角色的当前状态，请在写作时保持一致性：',
    '',
  ];

  for (const snapshot of activeSnapshots) {
    parts.push(formatSnapshotForPrompt(snapshot));
    parts.push('');
  }

  parts.push('【状态一致性要求】');
  parts.push('- 角色的位置变化必须合理（不能瞬移）');
  parts.push('- 角色的能力使用必须符合已有设定');
  parts.push('- 角色的情绪和行为必须符合其性格和当前心理状态');
  parts.push('- 如果角色状态发生重大变化，请在情节中明确体现');

  return parts.join('\n');
}

/**
 * 获取特定角色的状态快照
 */
export function getCharacterState(
  registry: CharacterStateRegistry,
  characterId: string
): CharacterStateSnapshot | undefined {
  return registry.snapshots[characterId];
}

/**
 * 手动更新角色状态（用于人工修正）
 */
export function manualUpdateCharacterState(
  registry: CharacterStateRegistry,
  characterId: string,
  updates: Partial<CharacterStateSnapshot>,
  chapterIndex: number
): CharacterStateRegistry {
  const snapshot = registry.snapshots[characterId];
  if (!snapshot) {
    return registry;
  }

  const updated: CharacterStateRegistry = {
    ...registry,
    lastUpdatedChapter: chapterIndex,
    snapshots: {
      ...registry.snapshots,
      [characterId]: {
        ...snapshot,
        ...updates,
        asOfChapter: chapterIndex,
        physical: { ...snapshot.physical, ...updates.physical },
        psychological: { ...snapshot.psychological, ...updates.psychological },
        social: { ...snapshot.social, ...updates.social },
      },
    },
  };

  return updated;
}

/**
 * 验证状态一致性（检测潜在问题）
 */
export function validateStateConsistency(
  registry: CharacterStateRegistry
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  for (const snapshot of Object.values(registry.snapshots)) {
    // 检查昏迷角色是否有活跃行动
    if (snapshot.physical.condition === 'unconscious') {
      if (snapshot.psychological.motivation !== '昏迷中' &&
          snapshot.psychological.motivation !== '未知') {
        issues.push(
          `${snapshot.characterName} 处于昏迷状态但动机为"${snapshot.psychological.motivation}"，建议修正`
        );
      }
    }

    // 检查位置是否为空
    if (!snapshot.physical.location || snapshot.physical.location === '') {
      issues.push(`${snapshot.characterName} 的位置未设置`);
    }

    // 检查最近变化是否有矛盾
    const recentChanges = snapshot.recentChanges;
    if (recentChanges.length >= 2) {
      const lastTwo = recentChanges.slice(-2);
      if (
        lastTwo[0].field === lastTwo[1].field &&
        lastTwo[0].newValue === lastTwo[1].oldValue
      ) {
        // 可能是状态反复，需要关注
        issues.push(
          `${snapshot.characterName} 的 ${lastTwo[0].field} 状态在近期发生反复变化，请确认是否合理`
        );
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
