/**
 * 视角控制器
 * 
 * 防止 POV 混乱，确保叙事视角一致性
 */

import type { CharacterStateRegistry } from '../types/characterState.js';

/**
 * 视角类型
 */
export type POVType = 
  | 'first_person'      // 第一人称
  | 'third_limited'     // 第三人称有限视角
  | 'third_omniscient'  // 第三人称全知视角
  | 'multiple';         // 多视角轮换

/**
 * 视角配置
 */
export interface POVConfig {
  /** 主要视角类型 */
  type: POVType;
  /** 主视角角色 ID */
  mainPOVCharacterId: string;
  /** 主视角角色名 */
  mainPOVCharacterName: string;
  /** 允许的视角角色列表（多视角时使用） */
  allowedPOVCharacters?: string[];
  /** 视角切换规则 */
  switchRules?: {
    /** 是否允许章内切换 */
    allowInChapterSwitch: boolean;
    /** 切换时是否需要分隔符 */
    requireSeparator: boolean;
    /** 分隔符样式 */
    separatorStyle?: string;
  };
}

/**
 * 视角分析结果
 */
export interface POVAnalysis {
  /** 检测到的视角类型 */
  detectedPOV: POVType;
  /** 当前视角角色 */
  currentPOVCharacter: string;
  /** 是否有视角违规 */
  hasViolation: boolean;
  /** 违规详情 */
  violations: POVViolation[];
  /** 建议 */
  suggestions: string[];
}

/**
 * 视角违规
 */
export interface POVViolation {
  /** 违规类型 */
  type: 'unexpected_thoughts' | 'pov_switch' | 'inconsistent_pronouns' | 'omniscient_leak';
  /** 描述 */
  description: string;
  /** 涉及角色 */
  character?: string;
  /** 严重程度 */
  severity: 'minor' | 'major' | 'critical';
}

/**
 * 默认视角配置（第三人称有限视角，跟随主角）
 */
export const DEFAULT_POV_CONFIG: POVConfig = {
  type: 'third_limited',
  mainPOVCharacterId: 'protagonist',
  mainPOVCharacterName: '主角',
  switchRules: {
    allowInChapterSwitch: false,
    requireSeparator: true,
    separatorStyle: '* * *',
  },
};

/**
 * 从 Story Bible 提取视角配置
 */
export function extractPOVConfigFromBible(bible: string, protagonistName?: string): POVConfig {
  const config = { ...DEFAULT_POV_CONFIG };
  
  // 检测第一人称标志
  if (/第一人称|我[的是]|以我为视角/.test(bible)) {
    config.type = 'first_person';
  }
  
  // 检测多视角标志
  if (/多视角|多POV|视角轮换|群像/.test(bible)) {
    config.type = 'multiple';
    config.switchRules = {
      allowInChapterSwitch: false,
      requireSeparator: true,
      separatorStyle: '* * *',
    };
  }
  
  // 检测全知视角
  if (/全知视角|上帝视角/.test(bible)) {
    config.type = 'third_omniscient';
  }
  
  // 提取主角名
  if (protagonistName) {
    config.mainPOVCharacterName = protagonistName;
  } else {
    const nameMatch = bible.match(/主角[：:]\s*([^\n,，]+)|姓名[：:]\s*([^\n,，]+)/);
    if (nameMatch) {
      config.mainPOVCharacterName = (nameMatch[1] || nameMatch[2]).trim();
    }
  }
  
  return config;
}

/**
 * 构建视角控制提示
 */
export function buildPOVControlPrompt(config: POVConfig, chapterIndex?: number): string {
  const parts: string[] = ['【视角控制规则】'];
  
  switch (config.type) {
    case 'first_person':
      parts.push(`本书采用第一人称视角，以"${config.mainPOVCharacterName}"的身份叙述。`);
      parts.push('规则：');
      parts.push('1. 全程使用"我"作为主语');
      parts.push('2. 只能描写主角的所见所闻、所思所想');
      parts.push('3. 其他角色的内心活动只能通过对话、表情、动作推测');
      parts.push('4. 不可出现主角不在场时发生的事件');
      break;
      
    case 'third_limited':
      parts.push(`本书采用第三人称有限视角，跟随"${config.mainPOVCharacterName}"。`);
      parts.push('规则：');
      parts.push(`1. 使用"${config.mainPOVCharacterName}"或"他/她"作为主语`);
      parts.push(`2. 只展示${config.mainPOVCharacterName}的内心想法`);
      parts.push('3. 其他角色的心理活动需通过外在表现暗示');
      parts.push('4. 场景切换必须跟随主视角角色');
      break;
      
    case 'third_omniscient':
      parts.push('本书采用第三人称全知视角。');
      parts.push('规则：');
      parts.push('1. 可以展示任何角色的内心活动');
      parts.push('2. 可以描写不同地点同时发生的事件');
      parts.push('3. 但应保持叙事焦点，避免频繁跳转');
      parts.push('4. 每个段落应聚焦于一个角色或场景');
      break;
      
    case 'multiple':
      parts.push('本书采用多视角轮换。');
      parts.push(`本章视角角色：${config.mainPOVCharacterName}`);
      parts.push('规则：');
      parts.push('1. 本章内保持单一视角');
      parts.push('2. 仅展示当前视角角色的内心');
      parts.push('3. 其他角色通过对话和行为展现');
      if (config.switchRules?.allowInChapterSwitch) {
        parts.push(`4. 如需切换视角，使用分隔符 "${config.switchRules.separatorStyle}"`);
      }
      break;
  }
  
  // 通用禁止事项
  parts.push('');
  parts.push('【禁止事项】');
  parts.push('- 禁止在非全知视角下描写视角角色不知道的信息');
  parts.push('- 禁止无过渡地切换视角角色');
  parts.push('- 禁止混用第一人称和第三人称');
  
  return parts.join('\n');
}

/**
 * 分析文本中的视角一致性
 */
export function analyzePOV(
  text: string, 
  config: POVConfig,
  characterStates?: CharacterStateRegistry
): POVAnalysis {
  const violations: POVViolation[] = [];
  const suggestions: string[] = [];
  
  // 检测代词使用
  const firstPersonCount = (text.match(/[^""']我[^""']/g) || []).length;
  const thirdPersonPattern = new RegExp(`${config.mainPOVCharacterName}|他|她`, 'g');
  const thirdPersonCount = (text.match(thirdPersonPattern) || []).length;
  
  // 检测视角类型
  let detectedPOV: POVType = 'third_limited';
  if (firstPersonCount > thirdPersonCount * 2) {
    detectedPOV = 'first_person';
  }
  
  // 第一人称配置但检测到第三人称
  if (config.type === 'first_person' && detectedPOV !== 'first_person') {
    violations.push({
      type: 'inconsistent_pronouns',
      description: '配置为第一人称视角，但文本使用了第三人称叙述',
      severity: 'major',
    });
    suggestions.push('将叙述改为第一人称，使用"我"替代人名');
  }
  
  // 第三人称配置但检测到第一人称
  if (config.type !== 'first_person' && detectedPOV === 'first_person') {
    violations.push({
      type: 'inconsistent_pronouns',
      description: '配置为第三人称视角，但文本使用了第一人称叙述',
      severity: 'major',
    });
    suggestions.push('将叙述改为第三人称，删除"我"的使用');
  }
  
  // 检测非视角角色的内心描写（有限视角）
  if (config.type === 'third_limited' && characterStates) {
    const otherCharacters = Object.values(characterStates.snapshots)
      .filter(s => s.characterId !== config.mainPOVCharacterId)
      .map(s => s.characterName);
    
    for (const charName of otherCharacters) {
      // 检测"XX心想/想到/暗道"等模式
      const thoughtPattern = new RegExp(
        `${charName}[^。，]+(?:心想|想到|暗道|心中|内心|暗自|心里)`,
        'g'
      );
      const matches = text.match(thoughtPattern);
      
      if (matches && matches.length > 0) {
        violations.push({
          type: 'unexpected_thoughts',
          description: `有限视角下描写了非视角角色"${charName}"的内心活动`,
          character: charName,
          severity: 'major',
        });
        suggestions.push(`将"${charName}"的内心描写改为外在表现（表情、动作、语气）`);
      }
    }
  }
  
  return {
    detectedPOV,
    currentPOVCharacter: config.mainPOVCharacterName,
    hasViolation: violations.length > 0,
    violations,
    suggestions,
  };
}

/**
 * 获取视角修复提示
 */
export function getPOVRepairPrompt(analysis: POVAnalysis, config: POVConfig): string {
  if (!analysis.hasViolation) {
    return '';
  }
  
  const parts = ['【视角问题修复】'];
  parts.push(`当前视角配置：${getPOVTypeName(config.type)}，视角角色：${config.mainPOVCharacterName}`);
  parts.push('');
  parts.push('发现以下视角问题：');
  
  for (const v of analysis.violations) {
    parts.push(`- [${getSeverityLabel(v.severity)}] ${v.description}`);
  }
  
  parts.push('');
  parts.push('修复建议：');
  for (const s of analysis.suggestions) {
    parts.push(`- ${s}`);
  }
  
  return parts.join('\n');
}

function getPOVTypeName(type: POVType): string {
  const names: Record<POVType, string> = {
    first_person: '第一人称',
    third_limited: '第三人称有限',
    third_omniscient: '第三人称全知',
    multiple: '多视角',
  };
  return names[type];
}

function getSeverityLabel(severity: 'minor' | 'major' | 'critical'): string {
  const labels: Record<string, string> = {
    minor: '轻微',
    major: '重要',
    critical: '严重',
  };
  return labels[severity];
}

/**
 * 获取章节的推荐视角角色（用于多视角小说）
 */
export function getRecommendedPOVCharacter(
  config: POVConfig,
  chapterIndex: number,
  outlineHint?: string
): string {
  // 如果不是多视角，返回主视角角色
  if (config.type !== 'multiple') {
    return config.mainPOVCharacterName;
  }
  
  // 检查大纲中是否指定了视角
  if (outlineHint) {
    const povMatch = outlineHint.match(/视角[：:]\s*([^\n,，]+)/);
    if (povMatch) {
      return povMatch[1].trim();
    }
  }
  
  // 检查允许的视角列表
  if (config.allowedPOVCharacters && config.allowedPOVCharacters.length > 0) {
    // 简单轮换策略
    const index = (chapterIndex - 1) % config.allowedPOVCharacters.length;
    return config.allowedPOVCharacters[index];
  }
  
  return config.mainPOVCharacterName;
}
