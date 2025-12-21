export type CharacterProfile = {
  /** 唯一标识 (snake_case) */
  id: string;
  /** 角色名 */
  name: string;
  /** 角色类型 */
  role: 'protagonist' | 'deuteragonist' | 'antagonist' | 'supporting' | 'minor';
  /** 首次登场章节 */
  debutChapter: number;
  
  /** 基础信息 */
  basic: {
    age: string;
    identity: string;  // 身份/职业
    appearance: string;  // 外貌特征（50字以内）
  };
  
  /** 性格模型 (核心) */
  personality: {
    /** 主要性格特质 (3-5个) */
    traits: string[];
    /** 核心欲望 (最想要什么) */
    desires: string[];
    /** 内心恐惧 (最害怕什么) */
    fears: string[];
    /** 性格缺陷 (让角色立体) */
    flaws: string[];
    /** 道德底线 (绝对不会做什么) */
    principles: string[];
  };
  
  /** 角色弧线 (Character Arc) */
  arc: {
    /** 起点：初始状态 */
    start: string;
    /** 中点：转折/成长 */
    middle: string;
    /** 终点：最终状态 */
    end: string;
    /** 关键转变触发事件 */
    turningPoints: string[];
  };
  
  /** 能力/技能 */
  abilities: string[];
  
  /** 口头禅/说话风格 */
  speechStyle: string;
};

export type Relationship = {
  /** 关系 ID (例如: char1_char2) */
  id: string;
  /** 发起方角色 ID */
  from: string;
  /** 接收方角色 ID */
  to: string;
  
  /** 关系类型 */
  type: 
    | 'family'      // 亲情
    | 'romance'     // 爱情
    | 'friendship'  // 友情
    | 'rivalry'     // 竞争
    | 'mentor'      // 师徒
    | 'subordinate' // 上下级
    | 'enemy'       // 敌对
    | 'ally'        // 同盟
    | 'complex';    // 复杂关系
  
  /** 羁绊强度 (1-10) */
  bondStrength: number;
  
  /** 关系动态描述 (如 "保护者↔被保护者") */
  dynamic: string;
  
  /** 核心张力/冲突 */
  tension: string;
  
  /** 秘密 (一方对另一方隐瞒的事) */
  secrets: string[];
  
  /** 关系演化阶段 */
  evolution: {
    /** 阶段名称 */
    phase: string;
    /** 对应章节范围 (例如 [1, 50]) */
    chapterRange: [number, number];
    /** 该阶段关系状态 */
    status: string;
  }[];
  
  /** 是否双向对称 */
  symmetric: boolean;
};

export type Faction = {
  id: string;
  name: string;
  description: string;
  /** 成员角色 ID 列表 */
  members: string[];
  /** 敌对势力 ID 列表 */
  enemies: string[];
  /** 同盟势力 ID 列表 */
  allies: string[];
};

export type RelationshipEvent = {
  /** 事件发生章节 */
  chapter: number;
  /** 涉及的关系 ID */
  relationshipId: string;
  /** 事件描述 */
  description: string;
  /** 对羁绊强度的影响 (-5 到 +5) */
  bondChange: number;
  /** 事件后的新状态 */
  newStatus?: string;
};

export type CharacterRelationGraph = {
  version: string;
  generatedAt: string;
  protagonists: CharacterProfile[];
  mainCharacters: CharacterProfile[];
  relationships: Relationship[];
  factions: Faction[];
  relationshipEvents: RelationshipEvent[];
};
