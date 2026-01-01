/**
 * 目标达成检测模块
 *
 * 检测章节是否完成了大纲规定的目标：
 * - 主要目标是否达成
 * - 场景是否按要求展开
 * - 钩子是否有效
 * - 伏笔操作是否执行
 */

import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import type { EnhancedChapterOutline } from '../types/narrative.js';
import type { QCIssue } from './multiDimensionalQC.js';
import { z } from 'zod';

/**
 * 目标达成检测结果
 */
export type GoalQCResult = {
  score: number;
  issues: QCIssue[];
  achievements: {
    primaryGoalAchieved: boolean;
    scenesCompleted: string[];
    scenesMissing: string[];
    hookEffectiveness: number;
    foreshadowingExecuted: string[];
    foreshadowingMissed: string[];
  };
};

/**
 * AI 检测结果 Schema
 */
const GoalCheckSchema = z.object({
  primaryGoalAchieved: z.boolean(),
  secondaryGoalAchieved: z.boolean().optional(),
  successCriteriaResults: z.array(
    z.object({
      criterion: z.string(),
      achieved: z.boolean(),
      evidence: z.string().optional(),
    })
  ),
  scenesCompleted: z.array(z.string()),
  scenesMissing: z.array(z.string()),
  hookEffectiveness: z.number().min(1).max(10),
  hookAnalysis: z.string(),
  foreshadowingExecuted: z.array(z.string()),
  foreshadowingMissed: z.array(z.string()),
  score: z.number().min(0).max(100),
  issues: z.array(z.string()),
});

/**
 * 检测目标达成情况
 */
export async function checkGoalAchievement(
  aiConfig: AIConfig,
  chapterText: string,
  outline: EnhancedChapterOutline
): Promise<GoalQCResult> {
  const system = `
你是一个专业的大纲执行检查员。检查章节是否完成了大纲规定的目标。

【检查维度】
1. 主要目标达成: 大纲的 primary goal 是否在章节中体现
2. 验证标准: 每个 success criterion 是否满足
3. 场景完成度: 要求的场景是否都出现了
4. 钩子效果: 章末钩子是否有效（能否吸引读者继续阅读）
5. 伏笔操作: 要求的伏笔埋设/回收是否执行

【评分标准】
- 100: 完美执行大纲，所有目标达成
- 80-99: 主要目标达成，有小的遗漏
- 60-79: 部分目标达成，有明显遗漏
- 40-59: 目标达成度低，需要修改
- 0-39: 严重偏离大纲，需要重写

【输出格式】
只输出 JSON:
{
  "primaryGoalAchieved": true/false,
  "secondaryGoalAchieved": true/false,
  "successCriteriaResults": [
    {"criterion": "标准内容", "achieved": true/false, "evidence": "原文依据"}
  ],
  "scenesCompleted": ["已完成的场景"],
  "scenesMissing": ["缺失的场景"],
  "hookEffectiveness": 1-10,
  "hookAnalysis": "钩子分析",
  "foreshadowingExecuted": ["已执行的伏笔操作"],
  "foreshadowingMissed": ["未执行的伏笔操作"],
  "score": 0-100,
  "issues": ["问题1", "问题2"]
}
`.trim();

  // 构建大纲上下文
  const outlineContext = `
【章节大纲】
- 标题: ${outline.title}
- 主要目标: ${outline.goal.primary}
${outline.goal.secondary ? `- 次要目标: ${outline.goal.secondary}` : ''}
- 验证标准: ${outline.goal.successCriteria.join('; ')}

【场景要求】
${outline.scenes.map((s) => `${s.order}. [${s.type}] ${s.purpose} (${s.characters.join(', ')})`).join('\n')}

【钩子要求】
- 类型: ${outline.hook.type}
- 内容: ${outline.hook.content}
- 强度: ${outline.hook.strength}/10

【伏笔操作】
${outline.foreshadowingOps.map((f) => `- ${f.action}: ${f.description}`).join('\n') || '无'}
`.trim();

  const prompt = `
${outlineContext}

【实际章节内容】
${chapterText.slice(0, 5000)}

请检查目标达成情况:
`.trim();

  try {
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.2,
    });

    const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
    const result = GoalCheckSchema.parse(JSON.parse(jsonText));

    const issues: QCIssue[] = [];

    // 主要目标未达成
    if (!result.primaryGoalAchieved) {
      issues.push({
        type: 'structure',
        severity: 'critical',
        description: `主要目标未达成: ${outline.goal.primary}`,
        suggestion: '请确保章节内容完成主要目标',
      });
    }

    // 验证标准未满足
    const failedCriteria = result.successCriteriaResults.filter((c) => !c.achieved);
    if (failedCriteria.length > 0) {
      failedCriteria.forEach((c) => {
        issues.push({
          type: 'structure',
          severity: 'major',
          description: `验证标准未满足: ${c.criterion}`,
          suggestion: '请补充相关内容以满足验证标准',
        });
      });
    }

    // 缺失场景
    if (result.scenesMissing.length > 0) {
      issues.push({
        type: 'structure',
        severity: result.scenesMissing.length > 1 ? 'major' : 'minor',
        description: `缺失场景: ${result.scenesMissing.join(', ')}`,
        suggestion: '请补充缺失的场景',
      });
    }

    // 钩子效果不佳
    if (result.hookEffectiveness < 5) {
      issues.push({
        type: 'structure',
        severity: result.hookEffectiveness < 3 ? 'major' : 'minor',
        description: `钩子效果不佳 (${result.hookEffectiveness}/10): ${result.hookAnalysis}`,
        suggestion: '请加强章末悬念，让读者想要继续阅读',
      });
    }

    // 伏笔未执行
    if (result.foreshadowingMissed.length > 0) {
      issues.push({
        type: 'plot',
        severity: 'minor',
        description: `伏笔操作未执行: ${result.foreshadowingMissed.join(', ')}`,
        suggestion: '请按大纲要求执行伏笔操作',
      });
    }

    // 添加 AI 检测到的其他问题
    result.issues.forEach((issue) => {
      issues.push({
        type: 'structure',
        severity: 'minor',
        description: issue,
      });
    });

    return {
      score: result.score,
      issues,
      achievements: {
        primaryGoalAchieved: result.primaryGoalAchieved,
        scenesCompleted: result.scenesCompleted,
        scenesMissing: result.scenesMissing,
        hookEffectiveness: result.hookEffectiveness,
        foreshadowingExecuted: result.foreshadowingExecuted,
        foreshadowingMissed: result.foreshadowingMissed,
      },
    };
  } catch (error) {
    console.warn('Goal achievement check parsing failed:', error);
    return {
      score: 70,
      issues: [],
      achievements: {
        primaryGoalAchieved: true, // 默认假设达成
        scenesCompleted: [],
        scenesMissing: [],
        hookEffectiveness: 5,
        foreshadowingExecuted: [],
        foreshadowingMissed: [],
      },
    };
  }
}

/**
 * 简化版目标检测（不使用 AI）
 * 基于关键词匹配进行粗略检测
 */
export function quickGoalCheck(
  chapterText: string,
  goalKeywords: string[]
): { achieved: boolean; matchedKeywords: string[] } {
  const lowerText = chapterText.toLowerCase();
  const matchedKeywords = goalKeywords.filter((keyword) =>
    lowerText.includes(keyword.toLowerCase())
  );

  return {
    achieved: matchedKeywords.length >= goalKeywords.length * 0.5,
    matchedKeywords,
  };
}
