import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import type { CharacterRelationGraph, CharacterProfile, Relationship } from './types/characters.js';
import type { NovelOutline } from './generateOutline.js';

/**
 * 核心人设生成（不依赖大纲）
 * 
 * 只需要 Story Bible 和目标规模，就能生成完整的人物关系图谱。
 * 用于「先建人物再写大纲」的工作流。
 */
export async function generateCoreCharacters(args: {
  aiConfig: AIConfig;
  bible: string;
  targetChapters: number;
  targetWordCount: number;
}): Promise<CharacterRelationGraph> {
  const { aiConfig, bible, targetChapters, targetWordCount } = args;

  const system = `
你是一个起点白金级小说人物架构师。你的任务是从 Story Bible 中提取并构建完整的人物关系图谱。

核心原则：
1. 每个角色都应该有清晰的性格模型（MBTI/大五人格思路）和完整的角色弧线
2. 关系必须是动态的，有发展空间和潜在冲突，不能一成不变
3. 张力来自人物之间的核心矛盾，而非外部事件
4. 每段重要关系都需要设计"秘密"或"未解之事"，制造悬念
5. 角色间要有清晰的利益冲突和价值观碰撞
6. 配角也要有自己的目标和动机，不能沦为工具人

人物弧线设计：
- 主角的弧线必须有"信念动摇"→"痛苦抉择"→"蜕变成长"的完整过程
- 重要配角至少要有一个转折点（立场变化/秘密揭露/牺牲/背叛）
- 反派要有合理的动机和魅力，不能是纯粹的恶

输出严格的 JSON 格式，符合 CharacterRelationGraph 结构。
`.trim();

  const prompt = `
【Story Bible】
${bible}

【目标规模】
- 总章数: ${targetChapters} 章
- 总字数: 约 ${targetWordCount} 万字

请生成完整的人物关系图谱 JSON，包括：
1. protagonists: 主角列表 (CharacterProfile[]) - 每个主角要有详细的 personality、arc、背景
2. mainCharacters: 重要配角列表 (CharacterProfile[]) - 至少 5-8 个有深度的配角
3. relationships: 关键关系矩阵 (Relationship[]) - 要体现关系张力和秘密
4. factions: 主要势力 (Faction[]) - 势力间的利益博弈
5. relationshipEvents: 关键关系事件规划 (RelationshipEvent[]) - 按故事进度排列

注意：由于此时还没有详细的分卷大纲，关系事件 (relationshipEvents) 中的 chapter 字段可以用估计值。

确保 JSON 结构符合 TypeScript 定义，不包含注释。
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.8 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const crg = JSON.parse(jsonText);
    crg.version = "1.0";
    crg.generatedAt = new Date().toISOString();
    return crg as CharacterRelationGraph;
  } catch (e) {
    throw new Error('Failed to parse character graph JSON: ' + (e as Error).message);
  }
}

/**
 * 从 Story Bible 生成人物关系图谱（完整版，需要大纲）
 * 
 * 保留向后兼容：当已有大纲时调用此函数可以生成更精确的人物时间线。
 */
export async function generateCharacterGraph(args: {
  aiConfig: AIConfig;
  bible: string;
  outline: NovelOutline;
}): Promise<CharacterRelationGraph> {
  const { aiConfig, bible, outline } = args;

  const system = `
你是一个起点白金级小说人物架构师。你的任务是从 Story Bible 中提取并构建完整的人物关系图谱。

核心原则：
1. 每个角色都应该有清晰的性格模型（MBTI/大五人格思路）和完整的角色弧线
2. 关系必须是动态的，有发展空间和潜在冲突，不能一成不变
3. 张力来自人物之间的核心矛盾，而非外部事件
4. 每段重要关系都需要设计"秘密"或"未解之事"
5. 角色间要有清晰的利益冲突和价值观碰撞
6. 配角也要有自己的目标和动机，不能沦为工具人

输出严格的 JSON 格式，符合 CharacterRelationGraph 结构。
`.trim();

  const prompt = `
【Story Bible】
${bible}

【目标规模】
- 总章数: ${outline.totalChapters}
- 分卷信息: ${outline.volumes.map(v => `${v.title} (${v.startChapter}-${v.endChapter})`).join(', ')}

请生成完整的人物关系图谱 JSON，包括：
1. protagonists: 主角列表 (CharacterProfile[])
2. mainCharacters: 重要配角列表 (CharacterProfile[])
3. relationships: 关键关系矩阵 (Relationship[])
4. factions: 主要势力 (Faction[])
5. relationshipEvents: 初始规划的关键关系事件 (RelationshipEvent[])

确保 JSON 结构符合 TypeScript 定义，不包含注释。
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.8 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const crg = JSON.parse(jsonText);
    crg.version = "1.0";
    crg.generatedAt = new Date().toISOString();
    return crg as CharacterRelationGraph;
  } catch (e) {
    throw new Error('Failed to parse character graph JSON: ' + (e as Error).message);
  }
}

/**
 * 大纲生成后回填人物时间线
 * 
 * 当先生成人物再生成大纲时，人物的 evolution/chapterRange 是估计值。
 * 大纲确定后，调用此函数精确更新人物时间线。
 */
export async function updateCharacterTimeline(args: {
  aiConfig: AIConfig;
  characters: CharacterRelationGraph;
  outline: NovelOutline;
}): Promise<CharacterRelationGraph> {
  const { aiConfig, characters, outline } = args;

  const system = `
你是一个小说人物时间线校准专家。现在大纲已经确定，请根据大纲更新人物关系图谱中的时间线信息。

任务：
1. 更新 relationships 中每段关系的 evolution（章节范围要与大纲对齐）
2. 更新 relationshipEvents 的 chapter 字段（对齐到具体大纲章节）
3. 保持所有人物的核心设定不变，只调整时间线数据

输出更新后的完整 JSON（CharacterRelationGraph 结构）。
`.trim();

  const prompt = `
【当前人物关系图谱】
${JSON.stringify(characters, null, 2)}

【确定的大纲】
- 总章数: ${outline.totalChapters}
- 分卷信息:
${outline.volumes.map(v => `  ${v.title} (${v.startChapter}-${v.endChapter}): ${v.goal || ''}`).join('\n')}

请更新人物时间线并输出完整的 JSON。
`.trim();

  const raw = await generateTextWithRetry(aiConfig, { system, prompt, temperature: 0.3 });
  const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();

  try {
    const updated = JSON.parse(jsonText);
    updated.version = characters.version || "1.0";
    updated.generatedAt = new Date().toISOString();
    return updated as CharacterRelationGraph;
  } catch (e) {
    // 回填失败不影响核心流程，返回原数据
    console.error('Failed to update character timeline:', e);
    return characters;
  }
}

/**
 * 获取本章的人物关系上下文
 */
export function getCharacterContext(
  crg: CharacterRelationGraph,
  chapterIndex: number
): string {
  if (!crg) return '';

  // 1. 找出主角
  const protagonist = (crg.protagonists || [])[0]; // 假设第一个是第一主角
  if (!protagonist) return '';

  // 2. 找出当前处于活跃期的关系
  const activeRelationships: string[] = [];
  
  for (const rel of (crg.relationships || [])) {
    // 检查是否涉及主角
    const isRelatedToProtagonist = rel.from === protagonist.id || rel.to === protagonist.id;
    if (!isRelatedToProtagonist) continue;

    // 找出当前章节对应的关系阶段
    const currentPhase = rel.evolution?.find(
      phase => chapterIndex >= phase.chapterRange[0] && chapterIndex <= phase.chapterRange[1]
    );

    if (currentPhase) {
      const otherCharId = rel.from === protagonist.id ? rel.to : rel.from;
      const otherCharName = findCharacterName(crg, otherCharId);
      
      activeRelationships.push(`
- 与【${otherCharName}】的关系 (${rel.type}):
  - 当前状态: ${currentPhase.status} (${currentPhase.phase})
  - 核心张力: ${rel.tension}
  - 秘密: ${rel.secrets.join(', ')}
`.trim());
    }
  }

  // 3. 找出当前阶段的主角弧线
  // 防御性检查：确保 arc 存在
  if (!protagonist.arc) {
    return `
【主角当前状态】
- 角色: ${protagonist.name}
- 核心欲望: ${protagonist.personality?.desires?.join(', ') || '未定义'}

【本章活跃关系网】
${activeRelationships.length > 0 ? activeRelationships.join('\n') : '(暂无重点关系)'}
`.trim();
  }
  
  let currentArc = protagonist.arc.middle || '发展中';
  const turningPoints = protagonist.arc.turningPoints || [];
  // 简单逻辑：如果此时在早期，用 start，晚期用 end，中间用 middle
  // 这里可以根据 turningPoints 更精细判断，暂时简化
  if (chapterIndex < 50) currentArc = protagonist.arc.start || currentArc;
  else if ((crg.relationshipEvents || []).length > 0 && chapterIndex > crg.relationshipEvents[crg.relationshipEvents.length - 1]?.chapter) currentArc = protagonist.arc.end || currentArc;

  return `
【主角当前状态】
- 心理模型: ${protagonist.personality?.traits?.join(', ') || '未定义'}
- 当前弧线阶段: ${currentArc}
- 核心欲望: ${protagonist.personality?.desires?.join(', ') || '未定义'}

【本章活跃关系网】
${activeRelationships.length > 0 ? activeRelationships.join('\n') : '(暂无重点关系)'}
`.trim();
}

function findCharacterName(crg: CharacterRelationGraph, id: string): string {
  const p = (crg.protagonists || []).find(c => c.id === id);
  if (p) return p.name;
  const m = (crg.mainCharacters || []).find(c => c.id === id);
  if (m) return m.name;
  return id;
}
