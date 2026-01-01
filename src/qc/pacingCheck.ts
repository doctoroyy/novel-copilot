/**
 * 节奏对齐检测模块
 *
 * 检测章节的实际节奏是否与目标节奏匹配：
 * - 紧张度对齐
 * - 情感基调对齐
 * - 字数范围对齐
 * - 场景切换频率
 */

import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import type { NarrativeGuide } from '../types/narrative.js';
import type { QCIssue } from './multiDimensionalQC.js';
import { z } from 'zod';

/**
 * 节奏检测结果
 */
export type PacingQCResult = {
  score: number;
  issues: QCIssue[];
  actualPacing: {
    tensionLevel: number;
    dialogueRatio: number;
    sceneCount: number;
    informationDensity: number;
  };
};

/**
 * AI 检测结果 Schema
 */
const PacingCheckSchema = z.object({
  actualPacing: z.object({
    tensionLevel: z.number().min(1).max(10),
    dialogueRatio: z.number().min(0).max(1),
    sceneCount: z.number().min(1),
    informationDensity: z.number().min(1).max(10),
    emotionalTone: z.string(),
  }),
  alignment: z.object({
    tensionMatch: z.boolean(),
    emotionalToneMatch: z.boolean(),
    wordCountMatch: z.boolean(),
  }),
  score: z.number().min(0).max(100),
  issues: z.array(z.string()),
});

/**
 * 检测节奏对齐
 */
export async function checkPacingAlignment(
  aiConfig: AIConfig,
  chapterText: string,
  guide: NarrativeGuide
): Promise<PacingQCResult> {
  const wordCount = chapterText.length;
  const wordCountMatch =
    wordCount >= guide.wordCountRange[0] && wordCount <= guide.wordCountRange[1];

  const system = `
你是一个专业的网文节奏分析师。分析章节的实际节奏指标，并与目标节奏对比。

【分析指标】
1. 紧张度 (tensionLevel): 1-10，基于冲突强度、危机程度、情节紧迫性
   - 1-2: 完全日常、舒缓
   - 3-4: 略有紧张、铺垫
   - 5-6: 中等紧张、有冲突
   - 7-8: 高度紧张、危机
   - 9-10: 极限高潮、生死攸关

2. 对话比例 (dialogueRatio): 0-1，对话文字占比

3. 场景数量 (sceneCount): 章节内的场景切换次数

4. 信息密度 (informationDensity): 1-10，新信息量
   - 1-3: 低密度，重复或铺垫
   - 4-6: 中密度，正常推进
   - 7-10: 高密度，大量新信息

5. 情感基调 (emotionalTone): 描述整体氛围

【输出格式】
只输出 JSON:
{
  "actualPacing": {
    "tensionLevel": 1-10,
    "dialogueRatio": 0-1,
    "sceneCount": 数字,
    "informationDensity": 1-10,
    "emotionalTone": "情感基调描述"
  },
  "alignment": {
    "tensionMatch": true/false,
    "emotionalToneMatch": true/false,
    "wordCountMatch": true/false
  },
  "score": 0-100,
  "issues": ["问题1", "问题2"]
}

【评分标准】
- 100: 完全匹配目标节奏
- 80-99: 基本匹配，略有偏差
- 60-79: 有明显偏差，但可接受
- 40-59: 偏差较大，建议调整
- 0-39: 严重不匹配，需要重写
`.trim();

  const prompt = `
【目标节奏】
- 紧张度目标: ${guide.pacingTarget}/10
- 节奏类型: ${guide.pacingType}
- 情感基调: ${guide.emotionalTone}
- 字数要求: ${guide.wordCountRange[0]}-${guide.wordCountRange[1]}
- 实际字数: ${wordCount}

${guide.sceneRequirements.length > 0 ? `【场景要求】\n${guide.sceneRequirements.map((s) => `- ${s.purpose}`).join('\n')}` : ''}

【待分析章节】
${chapterText.slice(0, 5000)}

请分析节奏对齐情况:
`.trim();

  try {
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.2,
    });

    const jsonText = raw.replace(/```json\s*|```\s*/g, '').trim();
    const result = PacingCheckSchema.parse(JSON.parse(jsonText));

    const issues: QCIssue[] = [];

    // 检查紧张度偏差
    const tensionDelta = Math.abs(
      result.actualPacing.tensionLevel - guide.pacingTarget
    );
    if (tensionDelta > 3) {
      issues.push({
        type: 'pacing',
        severity: 'major',
        description: `节奏偏差过大: 目标${guide.pacingTarget}, 实际${result.actualPacing.tensionLevel}`,
        suggestion:
          result.actualPacing.tensionLevel > guide.pacingTarget
            ? '节奏过于紧张，建议增加一些舒缓的描写或对话'
            : '节奏过于平淡，建议增加一些冲突或紧张元素',
      });
    } else if (tensionDelta > 2) {
      issues.push({
        type: 'pacing',
        severity: 'minor',
        description: `节奏略有偏差: 目标${guide.pacingTarget}, 实际${result.actualPacing.tensionLevel}`,
      });
    }

    // 检查情感基调
    if (!result.alignment.emotionalToneMatch) {
      issues.push({
        type: 'pacing',
        severity: 'minor',
        description: `情感基调不匹配: 期望"${guide.emotionalTone}", 实际"${result.actualPacing.emotionalTone}"`,
        suggestion: '请调整描写风格以匹配目标情感基调',
      });
    }

    // 检查字数
    if (!wordCountMatch) {
      const severity = wordCount < guide.wordCountRange[0] * 0.7 ? 'major' : 'minor';
      issues.push({
        type: 'pacing',
        severity,
        description: `字数${wordCount}不在目标范围${guide.wordCountRange[0]}-${guide.wordCountRange[1]}内`,
        suggestion:
          wordCount < guide.wordCountRange[0]
            ? '请扩充章节内容'
            : '请精简冗余描写',
      });
    }

    // 添加 AI 检测到的其他问题
    result.issues.forEach((issue) => {
      issues.push({
        type: 'pacing',
        severity: 'minor',
        description: issue,
      });
    });

    return {
      score: result.score,
      issues,
      actualPacing: {
        tensionLevel: result.actualPacing.tensionLevel,
        dialogueRatio: result.actualPacing.dialogueRatio,
        sceneCount: result.actualPacing.sceneCount,
        informationDensity: result.actualPacing.informationDensity,
      },
    };
  } catch (error) {
    console.warn('Pacing alignment check parsing failed:', error);

    // 使用基于规则的简单检测
    return runRuleBasedPacingCheck(chapterText, guide);
  }
}

/**
 * 基于规则的简单节奏检测（fallback）
 */
function runRuleBasedPacingCheck(
  chapterText: string,
  guide: NarrativeGuide
): PacingQCResult {
  const issues: QCIssue[] = [];
  let score = 80;

  const wordCount = chapterText.length;

  // 字数检查
  if (wordCount < guide.wordCountRange[0]) {
    issues.push({
      type: 'pacing',
      severity: 'minor',
      description: `字数偏少 (${wordCount}字)`,
      suggestion: '请扩充章节内容',
    });
    score -= 10;
  } else if (wordCount > guide.wordCountRange[1]) {
    issues.push({
      type: 'pacing',
      severity: 'minor',
      description: `字数偏多 (${wordCount}字)`,
      suggestion: '请精简冗余描写',
    });
    score -= 5;
  }

  // 简单对话比例检测
  const dialogueMatches = chapterText.match(/["「『"]/g) || [];
  const estimatedDialogueRatio = dialogueMatches.length / (wordCount / 100);

  // 简单场景计数（基于段落分隔）
  const sceneCount = chapterText.split(/\n\s*\n/).length;

  return {
    score: Math.max(0, score),
    issues,
    actualPacing: {
      tensionLevel: 5, // 无法准确判断，返回中等值
      dialogueRatio: Math.min(1, estimatedDialogueRatio / 10),
      sceneCount,
      informationDensity: 5,
    },
  };
}
