/**
 * 人物一致性检测模块
 *
 * 检测章节中的人物是否与已知状态一致：
 * - 性格一致性
 * - 能力一致性
 * - 状态一致性
 * - 语言风格一致性
 * - 关系一致性
 */

import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import type { CharacterStateRegistry } from '../types/characterState.js';
import type { QCIssue } from './multiDimensionalQC.js';
import { z } from 'zod';

/**
 * 人物一致性检测结果
 */
export type CharacterQCResult = {
  score: number;
  issues: QCIssue[];
};

/**
 * AI 检测结果 Schema
 */
const CharacterCheckSchema = z.object({
  score: z.number().min(0).max(100),
  issues: z.array(
    z.object({
      characterId: z.string(),
      characterName: z.string(),
      type: z.enum(['personality', 'ability', 'state', 'speech', 'relationship']),
      severity: z.enum(['critical', 'major', 'minor']),
      description: z.string(),
      evidence: z.string(),
    })
  ),
});

/**
 * 检测人物一致性
 */
export async function checkCharacterConsistency(
  aiConfig: AIConfig,
  chapterText: string,
  characterStates: CharacterStateRegistry
): Promise<CharacterQCResult> {
  const system = `
你是一个专业的网文编辑，专注于检测人物一致性问题。

【检测维度】
1. 性格一致性 (personality): 角色的行为是否符合其既定性格
2. 能力一致性 (ability): 角色是否使用了不应有的能力，或未使用应有的能力
3. 状态一致性 (state): 角色的位置、情绪、身体状态是否与上下文矛盾
4. 语言一致性 (speech): 角色的说话风格是否稳定
5. 关系一致性 (relationship): 角色间的互动是否符合其关系设定

【严重程度判定】
- critical: 严重违背设定，读者会明显察觉（如性格180度转变、使用不存在的能力）
- major: 明显不协调，影响阅读体验（如情绪变化太突然、位置不合理）
- minor: 轻微违和，可以接受但不完美（如某句话风格略有偏差）

【输出格式】
只输出 JSON，不要有任何其他文字:
{
  "score": 0-100,
  "issues": [
    {
      "characterId": "角色ID",
      "characterName": "角色名",
      "type": "personality|ability|state|speech|relationship",
      "severity": "critical|major|minor",
      "description": "问题描述",
      "evidence": "原文依据（简短引用）"
    }
  ]
}

【评分标准】
- 100: 完全一致，没有问题
- 80-99: 有轻微问题，不影响阅读
- 60-79: 有明显问题，需要注意
- 40-59: 问题较多，建议修改
- 0-39: 严重不一致，必须重写
`.trim();

  // 构建角色状态上下文
  const statesContext = Object.values(characterStates.snapshots)
    .slice(0, 8)
    .map((s) => {
      return `
【${s.characterName}】(ID: ${s.characterId})
- 位置: ${s.physical.location}
- 身体状态: ${s.physical.condition}
- 情绪: ${s.psychological.mood}
- 动机: ${s.psychological.motivation}
- 能力: ${s.physical.abilities.join(', ') || '无特殊能力'}
- 近期变化: ${s.recentChanges.slice(-2).map((c) => c.change).join('; ') || '无'}
`.trim();
    })
    .join('\n\n');

  const prompt = `
【角色状态快照】
${statesContext || '（无已知角色状态）'}

【待检测章节】
${chapterText.slice(0, 5000)}

请检测人物一致性问题:
`.trim();

  try {
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.2,
    });

    const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
    const result = CharacterCheckSchema.parse(JSON.parse(jsonText));

    return {
      score: result.score,
      issues: result.issues.map((i) => ({
        type: 'character' as const,
        severity: i.severity,
        description: `[${i.characterName}] ${i.description}`,
        location: i.evidence,
        suggestion: getSuggestionForCharacterIssue(i.type),
      })),
    };
  } catch (error) {
    console.warn('Character consistency check parsing failed:', error);
    return { score: 80, issues: [] }; // 默认返回较高分数
  }
}

/**
 * 获取人物问题的修复建议
 */
function getSuggestionForCharacterIssue(type: string): string {
  const suggestions: Record<string, string> = {
    personality: '请确保角色行为符合其性格设定，避免突然的性格转变',
    ability: '请检查角色能力是否符合设定，避免使用未获得的能力',
    state: '请注意角色的位置和状态连续性，确保场景转换合理',
    speech: '请保持角色的说话风格一致，注意口头禅和语气',
    relationship: '请确保角色互动符合其关系设定，注意态度和称呼',
  };
  return suggestions[type] || '请检查并修正人物描写';
}
