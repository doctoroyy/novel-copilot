/**
 * 跨章节连续性检测 — 专门检测卷边界处的叙事断裂
 *
 * 比较相邻两章的结尾/开头，检测：
 * 1. 场景/地点跳变（前章在A，后章突然在B且无过渡）
 * 2. 时间线断裂（前章是夜晚战斗，后章突然变白天到达）
 * 3. 角色状态不一致（前章角色受伤，后章完好如初）
 * 4. 情节逻辑断裂（前章在做X，后章在做完全无关的Y）
 */

import {
  generateTextWithRetry,
  type AIConfig,
  type AICallOptions,
} from '../services/aiClient.js';
import type { QCIssue } from './multiDimensionalQC.js';

export type ContinuityCheckResult = {
  score: number;
  issues: QCIssue[];
};

/**
 * AI 检测两章之间的连续性
 */
export async function checkCrosschapterContinuity(
  aiConfig: AIConfig,
  prevChapterIndex: number,
  prevChapterEnding: string,
  nextChapterIndex: number,
  nextChapterOpening: string,
  isVolumeBoundary: boolean,
): Promise<ContinuityCheckResult> {
  const system = `你是一个专业的小说质量审查员。你的任务是检测两个相邻章节之间是否存在叙事断裂。

请严格检查以下维度：
1. **场景连续性**：前章结尾的场景/地点与后章开头的场景/地点是否衔接？如果发生了转换，是否有合理的过渡？
2. **时间连续性**：时间流向是否自然？有无突然的时间跳跃但缺乏说明？
3. **角色状态连续性**：角色在前章结尾的状态（受伤、情绪、正在做的事）是否在后章开头得到延续？
4. **情节逻辑连续性**：前章制造的悬念/危机/行动是否在后章得到承接？

输出格式（严格 JSON）：
{
  "score": <0-100 分，100=完美衔接，0=完全断裂>,
  "issues": [
    {
      "dimension": "scene|time|character|plot",
      "severity": "critical|major|minor",
      "description": "具体描述断裂之处",
      "prevChapterRef": "前章相关原文引用",
      "nextChapterRef": "后章相关原文引用"
    }
  ],
  "summary": "一句话总结连续性情况"
}

评分标准：
- 100分：自然衔接，读者无感知跳跃
- 80分：有小的过渡缺失，但不影响理解
- 60分：明显场景跳变但角色/情节连续
- 40分：严重断裂，读者会明显困惑
- 20分及以下：前后完全不像相邻章节`;

  const boundaryNote = isVolumeBoundary
    ? `\n⚠️ 这是卷边界（第${prevChapterIndex}章是上卷最后一章，第${nextChapterIndex}章是下卷第一章）。卷切换时允许一定时间跳跃，但场景和角色状态必须连贯。`
    : '';

  const prompt = `【第${prevChapterIndex}章 结尾部分】
${prevChapterEnding}

【第${nextChapterIndex}章 开头部分】
${nextChapterOpening}
${boundaryNote}
请检测这两段之间的连续性：`;

  const callOptions: AICallOptions = {
    phase: 'qc',
    timeoutMs: 30_000,
  };

  const raw = await generateTextWithRetry(aiConfig, {
    system,
    prompt,
    temperature: 0.3,
    maxTokens: 800,
  }, 2, callOptions);

  return parseContinuityResult(raw, prevChapterIndex, nextChapterIndex, isVolumeBoundary);
}

function parseContinuityResult(
  raw: string,
  prevChapterIndex: number,
  nextChapterIndex: number,
  isVolumeBoundary: boolean,
): ContinuityCheckResult {
  const issues: QCIssue[] = [];
  let score = 100;

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]);
    score = typeof parsed.score === 'number' ? Math.min(100, Math.max(0, parsed.score)) : 100;

    if (Array.isArray(parsed.issues)) {
      for (const issue of parsed.issues) {
        if (!issue.description) continue;

        const severity = issue.severity === 'critical' ? 'critical'
          : issue.severity === 'major' ? 'major' : 'minor';

        const locationTag = isVolumeBoundary ? '卷边界' : '章节衔接';

        issues.push({
          type: 'plot',
          severity,
          description: `[${locationTag}] 第${prevChapterIndex}→${nextChapterIndex}章: ${issue.description}`,
          location: [issue.prevChapterRef, issue.nextChapterRef].filter(Boolean).join(' → '),
          suggestion: issue.dimension === 'scene'
            ? '修复场景过渡，确保前后章地点转换有合理说明'
            : issue.dimension === 'time'
            ? '补充时间线说明，让时间流向自然'
            : issue.dimension === 'character'
            ? '确保角色状态（伤势、情绪、位置）在前后章一致'
            : '确保前章制造的悬念/危机在后章得到承接',
        });
      }
    }
  } catch {
    // AI 返回格式不对，回退到无问题
  }

  return { score, issues };
}
