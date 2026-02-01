/**
 * 角色一致性检查器
 * 
 * 检测和防止角色设定的前后矛盾
 */

import type { CharacterStateRegistry } from '../types/characterState.js';
import type { CharacterRelationGraph, CharacterProfile } from '../types/characters.js';

/**
 * 一致性检查结果
 */
export interface ConsistencyCheckResult {
  /** 是否通过 */
  passed: boolean;
  /** 分数 (0-100) */
  score: number;
  /** 问题列表 */
  issues: ConsistencyIssue[];
  /** 警告列表 */
  warnings: ConsistencyWarning[];
}

/**
 * 严重问题
 */
export interface ConsistencyIssue {
  /** 问题类型 */
  type: 'character_contradiction' | 'timeline_violation' | 'location_impossible' | 'trait_violation' | 'relation_conflict';
  /** 涉及角色 */
  characterName: string;
  /** 描述 */
  description: string;
  /** 引用的原文 */
  evidence?: string;
  /** 建议修复 */
  suggestion: string;
}

/**
 * 轻微警告
 */
export interface ConsistencyWarning {
  /** 警告类型 */
  type: 'potential_ooc' | 'unexplained_change' | 'missing_detail';
  /** 涉及角色 */
  characterName: string;
  /** 描述 */
  description: string;
}

/**
 * 检查关键词
 */
const TRAIT_KEYWORDS: Record<string, string[]> = {
  // 性格特征
  cold: ['冷漠', '冷淡', '冷酷', '不苟言笑'],
  warm: ['热情', '热心', '温暖', '友善'],
  arrogant: ['傲慢', '狂妄', '自大', '目中无人'],
  humble: ['谦逊', '谦虚', '低调'],
  brave: ['勇敢', '无畏', '胆大'],
  coward: ['胆小', '懦弱', '畏惧'],
  smart: ['聪明', '睿智', '机敏', '精明'],
  naive: ['天真', '单纯', '幼稚'],
};

/**
 * 从设定中提取角色特征
 */
export function extractCharacterTraits(
  character: CharacterProfile | undefined,
  bible?: string
): Map<string, string[]> {
  const traits = new Map<string, string[]>();
  
  if (!character) return traits;
  
  // 从角色性格特征和外貌描述中提取
  const description = [
    character.basic?.appearance || '',
    ...(character.personality?.traits || []),
    ...(character.personality?.flaws || []),
  ].join(' ');
  
  for (const [traitKey, keywords] of Object.entries(TRAIT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (description.includes(keyword)) {
        if (!traits.has(traitKey)) {
          traits.set(traitKey, []);
        }
        traits.get(traitKey)!.push(keyword);
      }
    }
  }
  
  return traits;
}

/**
 * 检查角色行为是否与人设矛盾
 */
export function checkCharacterBehavior(
  text: string,
  characterName: string,
  traits: Map<string, string[]>
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  
  // 矛盾特征对
  const contradictions: [string, string, string][] = [
    ['cold', 'warm', '冷漠角色表现得过于热情'],
    ['arrogant', 'humble', '傲慢角色表现得过于谦逊'],
    ['brave', 'coward', '勇敢角色表现得过于胆怯'],
    ['smart', 'naive', '聪明角色做出过于天真的行为'],
  ];
  
  for (const [trait1, trait2, desc] of contradictions) {
    // 角色设定是 trait1，但表现出 trait2
    if (traits.has(trait1)) {
      const trait2Keywords = TRAIT_KEYWORDS[trait2];
      for (const keyword of trait2Keywords) {
        const pattern = new RegExp(`${characterName}[^。]*${keyword}`, 'g');
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
          issues.push({
            type: 'trait_violation',
            characterName,
            description: `${desc}：${characterName} 设定为${traits.get(trait1)!.join('/')}，但文中表现${keyword}`,
            evidence: matches[0],
            suggestion: `调整 ${characterName} 的行为表现，使其符合${traits.get(trait1)!.join('/')}的人设`,
          });
        }
      }
    }
  }
  
  return issues;
}

/**
 * 检查角色位置一致性
 */
export function checkLocationConsistency(
  text: string,
  characterStates: CharacterStateRegistry,
  chapterIndex: number
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  
  for (const snapshot of Object.values(characterStates.snapshots)) {
    const { characterName, physical } = snapshot;
    const currentLocation = physical.location;
    
    // 检查角色是否出现在不同位置（同一场景内）
    const locationMentions = findLocationMentions(text, characterName);
    
    if (locationMentions.length > 1) {
      const uniqueLocations = [...new Set(locationMentions)];
      if (uniqueLocations.length > 2) {
        issues.push({
          type: 'location_impossible',
          characterName,
          description: `${characterName} 在单章内出现在多个不相关的地点：${uniqueLocations.join('、')}`,
          suggestion: `检查 ${characterName} 的移动是否合理，或添加场景转换描写`,
        });
      }
    }
  }
  
  return issues;
}

/**
 * 查找文本中角色的位置描述
 */
function findLocationMentions(text: string, characterName: string): string[] {
  const locations: string[] = [];
  
  // 常见位置模式
  const patterns = [
    new RegExp(`${characterName}[^。]*(?:在|来到|走进|进入|站在|坐在)([^。，]{2,10})`, 'g'),
    new RegExp(`([^。，]{2,10})(?:里|中|内)[^。]*${characterName}`, 'g'),
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      locations.push(match[1].trim());
    }
  }
  
  return locations;
}

/**
 * 检查角色状态变化是否合理
 */
export function checkStateTransition(
  characterStates: CharacterStateRegistry,
  text: string
): ConsistencyWarning[] {
  const warnings: ConsistencyWarning[] = [];
  
  for (const snapshot of Object.values(characterStates.snapshots)) {
    const { characterName, psychological, recentChanges } = snapshot;
    
    // 检查情绪突变
    if (recentChanges.length >= 2) {
      const lastTwo = recentChanges.slice(-2);
      const emotionWords = {
        positive: ['高兴', '开心', '喜悦', '兴奋', '满意'],
        negative: ['愤怒', '悲伤', '沮丧', '恐惧', '绝望'],
      };
      
      let prevEmotion: 'positive' | 'negative' | 'neutral' = 'neutral';
      let currEmotion: 'positive' | 'negative' | 'neutral' = 'neutral';
      
      for (const word of emotionWords.positive) {
        if (lastTwo[0].change.includes(word)) prevEmotion = 'positive';
        if (lastTwo[1].change.includes(word)) currEmotion = 'positive';
      }
      for (const word of emotionWords.negative) {
        if (lastTwo[0].change.includes(word)) prevEmotion = 'negative';
        if (lastTwo[1].change.includes(word)) currEmotion = 'negative';
      }
      
      // 情绪反转无过渡
      if (prevEmotion !== 'neutral' && currEmotion !== 'neutral' && prevEmotion !== currEmotion) {
        warnings.push({
          type: 'unexplained_change',
          characterName,
          description: `${characterName} 的情绪从${prevEmotion === 'positive' ? '正面' : '负面'}突变为${currEmotion === 'positive' ? '正面' : '负面'}，可能需要铺垫`,
        });
      }
    }
  }
  
  return warnings;
}

/**
 * 综合一致性检查
 */
export function checkConsistency(
  text: string,
  characters: CharacterRelationGraph | undefined,
  characterStates: CharacterStateRegistry | undefined,
  chapterIndex: number,
  bible?: string
): ConsistencyCheckResult {
  const issues: ConsistencyIssue[] = [];
  const warnings: ConsistencyWarning[] = [];
  
  // 角色行为检查
  if (characters) {
    const allChars = [...characters.protagonists, ...characters.mainCharacters];
    for (const char of allChars) {
      const traits = extractCharacterTraits(char, bible);
      if (traits.size > 0) {
        const behaviorIssues = checkCharacterBehavior(text, char.name, traits);
        issues.push(...behaviorIssues);
      }
    }
  }
  
  // 位置一致性检查
  if (characterStates) {
    const locationIssues = checkLocationConsistency(text, characterStates, chapterIndex);
    issues.push(...locationIssues);
    
    // 状态转变检查
    const stateWarnings = checkStateTransition(characterStates, text);
    warnings.push(...stateWarnings);
  }
  
  // 计算分数
  let score = 100;
  score -= issues.length * 15;
  score -= warnings.length * 5;
  score = Math.max(0, score);
  
  return {
    passed: issues.length === 0,
    score,
    issues,
    warnings,
  };
}

/**
 * 生成一致性修复提示
 */
export function buildConsistencyRepairPrompt(result: ConsistencyCheckResult): string {
  if (result.passed && result.warnings.length === 0) {
    return '';
  }
  
  const parts = ['【角色一致性修复】'];
  
  if (result.issues.length > 0) {
    parts.push('');
    parts.push('严重问题（必须修复）：');
    for (const issue of result.issues) {
      parts.push(`- ${issue.description}`);
      parts.push(`  修复建议：${issue.suggestion}`);
    }
  }
  
  if (result.warnings.length > 0) {
    parts.push('');
    parts.push('警告（建议处理）：');
    for (const warning of result.warnings) {
      parts.push(`- [${warning.characterName}] ${warning.description}`);
    }
  }
  
  return parts.join('\n');
}

/**
 * 快速角色一致性检查（用于 QC）
 */
export function quickConsistencyCheck(
  text: string,
  protagonistName: string
): { passed: boolean; mainIssue?: string } {
  // 检查主角是否在场
  const protagonistMentions = text.split(protagonistName).length - 1;
  if (protagonistMentions < 2) {
    return {
      passed: false,
      mainIssue: `主角 "${protagonistName}" 出场次数过少（仅 ${protagonistMentions} 次）`,
    };
  }
  
  // 检查是否有人物凭空消失
  const characterPattern = /「(.{1,4})」|"(.{1,4})说道/g;
  const speakingChars = new Set<string>();
  let match;
  while ((match = characterPattern.exec(text)) !== null) {
    speakingChars.add(match[1] || match[2]);
  }
  
  // 如果有超过 5 个不同角色说话，可能有问题
  if (speakingChars.size > 5) {
    return {
      passed: true, // 不算失败，只是警告
      mainIssue: `本章有较多角色对话 (${speakingChars.size} 人)，请确认角色身份清晰`,
    };
  }
  
  return { passed: true };
}
