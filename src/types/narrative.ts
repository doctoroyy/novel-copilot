/**
 * 叙事控制系统 - 类型定义
 *
 * 用于控制章节的节奏、情感基调、场景结构，解决节奏失控问题
 */

/**
 * 节奏类型
 */
export type PacingType =
  | 'action'      // 动作场景 - 快节奏，紧张刺激
  | 'tension'     // 紧张铺垫 - 中快节奏，压迫感
  | 'revelation'  // 揭示场景 - 中等节奏，信息密集
  | 'emotional'   // 情感场景 - 慢节奏，细腻描写
  | 'transition'  // 过渡场景 - 慢节奏，喘息调整
  | 'climax';     // 高潮场景 - 最快节奏，情感爆发

/**
 * 节奏配置
 */
export type PacingProfile = {
  /** 节奏类型 */
  type: PacingType;

  /** 紧张度 1-10 */
  tensionLevel: number;

  /** 信息密度 1-10 (每千字新信息量) */
  informationDensity: number;

  /** 对话/描写比例 0-1 (1 = 全对话) */
  dialogueRatio: number;

  /** 场景切换频率 */
  sceneSwitchFrequency: 'low' | 'medium' | 'high';

  /** 建议字数范围 */
  wordCountRange: [number, number];
};

/**
 * 章节叙事指导
 */
export type NarrativeGuide = {
  /** 章节序号 */
  chapterIndex: number;

  /** 本章节奏目标 (1-10) */
  pacingTarget: number;

  /** 节奏类型 */
  pacingType: PacingType;

  /** 情感基调 */
  emotionalTone: string;

  /** 场景序列要求 */
  sceneRequirements: SceneRequirement[];

  /** 禁止事项 */
  prohibitions: string[];

  /** POV 视角角色 */
  povCharacter?: string;

  /** 字数建议区间 */
  wordCountRange: [number, number];

  /** 节奏说明 (给 AI 的指导) */
  pacingGuidance: string;
};

/**
 * 场景要求
 */
export type SceneRequirement = {
  /** 场景顺序 */
  order: number;

  /** 场景类型 */
  type: 'setup' | 'confrontation' | 'resolution' | 'transition' | 'flashback' | 'revelation';

  /** 场景目的 */
  purpose: string;

  /** 涉及角色 */
  characters?: string[];

  /** 预估字数 */
  estimatedWords?: number;
};

/**
 * 叙事弧线 (全书/卷级)
 */
export type NarrativeArc = {
  /** 数据版本 */
  version: string;

  /** 总章数 */
  totalChapters: number;

  /** 卷级节奏曲线 */
  volumePacing: VolumePacingCurve[];

  /** 关键高潮章节 */
  climaxChapters: number[];

  /** 过渡/喘息章节 */
  transitionChapters: number[];

  /** 情感转折点 */
  emotionalTurningPoints: EmotionalTurningPoint[];
};

/**
 * 卷级节奏曲线
 */
export type VolumePacingCurve = {
  /** 卷号 */
  volumeIndex: number;

  /** 起始章节 */
  startChapter: number;

  /** 结束章节 */
  endChapter: number;

  /** 每章的目标紧张度 */
  pacingCurve: number[];

  /** 卷高潮章节 (相对于卷起始的偏移) */
  volumeClimaxOffset: number;
};

/**
 * 情感转折点
 */
export type EmotionalTurningPoint = {
  /** 章节 */
  chapter: number;

  /** 转折类型 */
  type: 'hope_to_despair' | 'despair_to_hope' | 'revelation' | 'betrayal' | 'sacrifice' | 'reunion';

  /** 描述 */
  description: string;
};

/**
 * 增强型章节大纲
 */
export type EnhancedChapterOutline = {
  /** 章节序号 */
  index: number;

  /** 章节标题 */
  title: string;

  /** 本章目标 */
  goal: ChapterGoal;

  /** 章末钩子 */
  hook: ChapterHook;

  /** 场景拆解 */
  scenes: SceneOutline[];

  /** POV 视角角色 */
  povCharacter: string;

  /** 节奏类型 */
  pacingType: PacingType;

  /** 伏笔操作 */
  foreshadowingOps: ForeshadowingOperation[];

  /** 角色弧线推进 */
  characterArcProgress: CharacterArcProgress[];
};

/**
 * 章节目标
 */
export type ChapterGoal = {
  /** 主要目标 (必须达成) */
  primary: string;

  /** 次要目标 (最好达成) */
  secondary?: string;

  /** 验证标准 */
  successCriteria: string[];
};

/**
 * 章末钩子
 */
export type ChapterHook = {
  /** 钩子类型 */
  type: 'cliffhanger' | 'revelation' | 'question' | 'threat' | 'promise' | 'mystery';

  /** 钩子内容 */
  content: string;

  /** 强度 1-10 */
  strength: number;
};

/**
 * 场景大纲
 */
export type SceneOutline = {
  /** 场景顺序 */
  order: number;

  /** 场景地点 */
  location: string;

  /** 涉及角色 */
  characters: string[];

  /** 场景目的 */
  purpose: string;

  /** 预估字数 */
  estimatedWords: number;

  /** 场景类型 */
  type: SceneRequirement['type'];
};

/**
 * 伏笔操作
 */
export type ForeshadowingOperation = {
  /** 操作类型 */
  action: 'plant' | 'hint' | 'resolve';

  /** 伏笔ID (如果是 hint 或 resolve) */
  foreshadowingId?: string;

  /** 伏笔描述 (如果是 plant) */
  description: string;

  /** 重要程度 */
  importance: number;
};

/**
 * 角色弧线推进
 */
export type CharacterArcProgress = {
  /** 角色ID */
  characterId: string;

  /** 本章前状态 */
  from: string;

  /** 本章后状态 */
  to: string;

  /** 触发转变的事件 */
  trigger?: string;
};

/**
 * 预定义的节奏配置
 */
export const PACING_PROFILES: Record<PacingType, PacingProfile> = {
  action: {
    type: 'action',
    tensionLevel: 8,
    informationDensity: 4,
    dialogueRatio: 0.3,
    sceneSwitchFrequency: 'high',
    wordCountRange: [2000, 2800],
  },
  tension: {
    type: 'tension',
    tensionLevel: 7,
    informationDensity: 6,
    dialogueRatio: 0.4,
    sceneSwitchFrequency: 'medium',
    wordCountRange: [2200, 3000],
  },
  revelation: {
    type: 'revelation',
    tensionLevel: 6,
    informationDensity: 9,
    dialogueRatio: 0.5,
    sceneSwitchFrequency: 'low',
    wordCountRange: [2500, 3200],
  },
  emotional: {
    type: 'emotional',
    tensionLevel: 4,
    informationDensity: 3,
    dialogueRatio: 0.6,
    sceneSwitchFrequency: 'low',
    wordCountRange: [2800, 3500],
  },
  transition: {
    type: 'transition',
    tensionLevel: 3,
    informationDensity: 5,
    dialogueRatio: 0.5,
    sceneSwitchFrequency: 'medium',
    wordCountRange: [2500, 3200],
  },
  climax: {
    type: 'climax',
    tensionLevel: 10,
    informationDensity: 7,
    dialogueRatio: 0.35,
    sceneSwitchFrequency: 'high',
    wordCountRange: [2500, 3500],
  },
};

/**
 * 情感基调映射
 */
export const EMOTIONAL_TONE_MAP: Record<string, string> = {
  '1-2': '舒缓、日常、温馨',
  '3-4': '平稳、略有紧张、期待',
  '5-6': '紧张、压迫、危机感',
  '7-8': '高度紧张、生死攸关、热血沸腾',
  '9-10': '极限高潮、情感爆发、命运转折',
};

/**
 * 获取情感基调
 */
export function getEmotionalTone(pacingTarget: number): string {
  if (pacingTarget <= 2) return EMOTIONAL_TONE_MAP['1-2'];
  if (pacingTarget <= 4) return EMOTIONAL_TONE_MAP['3-4'];
  if (pacingTarget <= 6) return EMOTIONAL_TONE_MAP['5-6'];
  if (pacingTarget <= 8) return EMOTIONAL_TONE_MAP['7-8'];
  return EMOTIONAL_TONE_MAP['9-10'];
}

/**
 * 根据节奏等级获取节奏类型
 */
export function getPacingTypeFromLevel(pacingLevel: number): PacingType {
  if (pacingLevel >= 9) return 'climax';
  if (pacingLevel >= 7) return 'action';
  if (pacingLevel >= 5) return 'tension';
  if (pacingLevel >= 3) return 'revelation';
  if (pacingLevel >= 2) return 'emotional';
  return 'transition';
}

/**
 * 创建空的叙事弧线
 */
export function createEmptyNarrativeArc(totalChapters: number): NarrativeArc {
  return {
    version: '1.0.0',
    totalChapters,
    volumePacing: [],
    climaxChapters: [],
    transitionChapters: [],
    emotionalTurningPoints: [],
  };
}

/**
 * 格式化叙事指导为 Prompt 片段
 */
export function formatNarrativeGuideForPrompt(guide: NarrativeGuide): string {
  const parts: string[] = ['【本章叙事指导】'];

  parts.push(`节奏目标: ${guide.pacingTarget}/10 (${guide.pacingType})`);
  parts.push(`情感基调: ${guide.emotionalTone}`);
  parts.push(`字数范围: ${guide.wordCountRange[0]}-${guide.wordCountRange[1]}字`);

  if (guide.povCharacter) {
    parts.push(`视角角色: ${guide.povCharacter}`);
  }

  if (guide.sceneRequirements.length > 0) {
    parts.push('场景序列:');
    guide.sceneRequirements.forEach((scene, i) => {
      parts.push(`  ${i + 1}. [${scene.type}] ${scene.purpose}`);
    });
  }

  if (guide.prohibitions.length > 0) {
    parts.push('本章禁止:');
    guide.prohibitions.forEach((p) => {
      parts.push(`  - ${p}`);
    });
  }

  parts.push('');
  parts.push(`节奏说明: ${guide.pacingGuidance}`);

  return parts.join('\n');
}
