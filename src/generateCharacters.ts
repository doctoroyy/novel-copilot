import { generateTextWithRetry, type AIConfig } from './services/aiClient.js';
import type { CharacterRelationGraph, CharacterProfile, Relationship } from './types/characters.js';
import type { NovelOutline } from './generateOutline.js';

/**
 * 从 Story Bible 生成人物关系图谱
 */
export async function generateCharacterGraph(args: {
  aiConfig: AIConfig;
  bible: string;
  outline: NovelOutline;
}): Promise<CharacterRelationGraph> {
  const { aiConfig, bible, outline } = args;

  const system = `
你是一个专业的小说人物架构师。你的任务是从 Story Bible 中提取并构建完整的人物关系图谱。

原则：
1. 每个角色都应该有清晰的性格模型和角色弧线
2. 关系必须是有发展空间的，不能一成不变
3. 张力来自人物之间的核心矛盾，而非外部事件
4. 每段重要关系都需要设计"秘密"或"未解之事"

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
    // 简单的补全
    crg.version = "1.0";
    crg.generatedAt = new Date().toISOString();
    return crg as CharacterRelationGraph;
  } catch (e) {
    throw new Error('Failed to parse character graph JSON: ' + (e as Error).message);
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
  const protagonist = crg.protagonists[0]; // 假设第一个是第一主角
  if (!protagonist) return '';

  // 2. 找出当前处于活跃期的关系
  const activeRelationships: string[] = [];
  
  for (const rel of crg.relationships) {
    // 检查是否涉及主角
    const isRelatedToProtagonist = rel.from === protagonist.id || rel.to === protagonist.id;
    if (!isRelatedToProtagonist) continue;

    // 找出当前章节对应的关系阶段
    const currentPhase = rel.evolution.find(
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
  let currentArc = protagonist.arc.middle;
  const turningPoints = protagonist.arc.turningPoints || [];
  // 简单逻辑：如果此时在早期，用 start，晚期用 end，中间用 middle
  // 这里可以根据 turningPoints 更精细判断，暂时简化
  if (chapterIndex < 50) currentArc = protagonist.arc.start;
  else if (chapterIndex > crg.relationshipEvents[crg.relationshipEvents.length - 1]?.chapter) currentArc = protagonist.arc.end;

  return `
【主角当前状态】
- 心理模型: ${protagonist.personality.traits.join(', ')}
- 当前弧线阶段: ${currentArc}
- 核心欲望: ${protagonist.personality.desires.join(', ')}

【本章活跃关系网】
${activeRelationships.length > 0 ? activeRelationships.join('\n') : '(暂无重点关系)'}
`.trim();
}

function findCharacterName(crg: CharacterRelationGraph, id: string): string {
  const p = crg.protagonists.find(c => c.id === id);
  if (p) return p.name;
  const m = crg.mainCharacters.find(c => c.id === id);
  if (m) return m.name;
  return id;
}
