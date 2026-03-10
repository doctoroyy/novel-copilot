import { z } from 'zod';
import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import type { EnhancedChapterOutline } from '../types/narrative.js';
import type { QCIssue } from './multiDimensionalQC.js';
import { formatStoryContractForQc, hasStoryContract } from '../utils/storyContract.js';

export type StoryContractQCResult = {
  score: number;
  issues: QCIssue[];
  violations: string[];
};

const StoryContractCheckSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  violations: z.array(z.string()).max(8),
  observations: z.array(z.string()).max(6).optional(),
});

export async function checkStoryContractCompliance(
  aiConfig: AIConfig,
  chapterText: string,
  outline: EnhancedChapterOutline,
): Promise<StoryContractQCResult> {
  if (!hasStoryContract(outline.storyContract)) {
    return { score: 100, issues: [], violations: [] };
  }

  const system = `
你是小说章节合同审查员。你的任务是只根据“章节合同”检查正文是否违规。

规则：
1. 只能根据提供的合同内容判定，不得自行发明额外规则
2. 如果正文明显触犯合同中的禁止项、遗漏必须项、跳过 requiredBridge、超出 maxConcurrent、或章末状态明显不符，必须判为不通过
3. 不要因为文风好、剧情爽就放过合同违规
4. 如果不确定是否违规，优先检查正文是否给出明确依据；没有依据就不要硬判违规

输出严格 JSON：
{
  "passed": true,
  "score": 100,
  "violations": ["违规点1"],
  "observations": ["补充观察"]
}
`.trim();

  const prompt = `
【章节合同】
${formatStoryContractForQc(outline.storyContract)}

【章节标题】
${outline.title}

【章节正文】
${chapterText}

请检查正文是否违反章节合同，只输出 JSON：
`.trim();

  try {
    const raw = await generateTextWithRetry(aiConfig, {
      system,
      prompt,
      temperature: 0.1,
      maxTokens: 500,
    });
    const parsed = JSON.parse(raw.replace(/```json\s*|```\s*/g, '').trim());
    const result = StoryContractCheckSchema.parse(parsed);

    const issues: QCIssue[] = [];
    if (result.violations.length > 0 || !result.passed) {
      issues.push({
        type: 'structure',
        severity: 'critical',
        description: `章节合同未遵守: ${result.violations.join('; ') || '合同审查未通过'}`,
        suggestion: '按章节合同重写本章，先修正范围越界、桥接缺失、线程遗漏或禁止引入项',
      });
    }

    if (result.observations?.length) {
      for (const observation of result.observations) {
        issues.push({
          type: 'structure',
          severity: 'minor',
          description: observation,
        });
      }
    }

    return {
      score: result.score,
      issues,
      violations: result.violations,
    };
  } catch (error) {
    console.warn('Story contract check failed:', error);
    return {
      score: 70,
      issues: [],
      violations: [],
    };
  }
}
