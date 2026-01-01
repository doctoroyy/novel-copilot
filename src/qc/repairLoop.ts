/**
 * 修复反馈循环模块
 *
 * 根据 QC 检测结果自动尝试修复章节问题
 */

import { generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import {
  type QCResult,
  type QCIssue,
  runQuickQC,
} from './multiDimensionalQC.js';

/**
 * 修复结果
 */
export type RepairResult = {
  /** 修复后的章节文本 */
  repairedChapter: string;

  /** 尝试修复的次数 */
  attempts: number;

  /** 最终的 QC 结果 */
  finalQC: QCResult;

  /** 是否成功修复 */
  success: boolean;

  /** 修复日志 */
  repairLog: string[];
};

/**
 * 尝试修复章节
 */
export async function repairChapter(
  aiConfig: AIConfig,
  originalChapter: string,
  qcResult: QCResult,
  chapterIndex: number,
  totalChapters: number,
  maxAttempts: number = 2
): Promise<RepairResult> {
  let currentChapter = originalChapter;
  let attempts = 0;
  let lastQC = qcResult;
  const repairLog: string[] = [];

  repairLog.push(`开始修复章节 ${chapterIndex}，初始评分: ${qcResult.score}`);

  while (attempts < maxAttempts && !lastQC.passed) {
    attempts++;
    repairLog.push(`\n修复尝试 ${attempts}/${maxAttempts}`);

    // 获取需要修复的问题
    const criticalIssues = lastQC.issues.filter((i) => i.severity === 'critical');
    const majorIssues = lastQC.issues.filter((i) => i.severity === 'major');

    if (criticalIssues.length === 0 && majorIssues.length === 0) {
      repairLog.push('没有严重问题需要修复');
      break;
    }

    repairLog.push(`发现 ${criticalIssues.length} 个严重问题，${majorIssues.length} 个重要问题`);

    // 构建修复指令
    const repairInstruction = buildRepairInstruction(
      criticalIssues,
      majorIssues,
      chapterIndex,
      totalChapters
    );

    // 调用 AI 进行修复
    try {
      const system = `
你是一个专业的网文修复编辑。
根据 QC 反馈修复章节内容，保持原有风格和语气。
只输出修复后的章节内容，不要有任何解释或标记。
不要改变章节的主要情节和结构，只修复指出的问题。
`.trim();

      const prompt = `
${repairInstruction}

【原始章节】
${currentChapter}

请输出修复后的完整章节内容:
`.trim();

      currentChapter = await generateTextWithRetry(aiConfig, {
        system,
        prompt,
        temperature: 0.7,
      });

      repairLog.push('AI 修复完成，重新进行 QC 检测...');

      // 重新进行 QC
      lastQC = runQuickQC(currentChapter, chapterIndex, totalChapters);
      repairLog.push(`修复后评分: ${lastQC.score}`);

      if (lastQC.passed) {
        repairLog.push('修复成功！所有严重问题已解决');
      } else {
        const remainingCritical = lastQC.issues.filter(
          (i) => i.severity === 'critical'
        ).length;
        repairLog.push(`仍有 ${remainingCritical} 个严重问题`);
      }
    } catch (error) {
      repairLog.push(`修复失败: ${error}`);
      break;
    }
  }

  const success = lastQC.passed || lastQC.score >= 70;
  repairLog.push(`\n修复${success ? '成功' : '未完全成功'}，最终评分: ${lastQC.score}`);

  return {
    repairedChapter: currentChapter,
    attempts,
    finalQC: lastQC,
    success,
    repairLog,
  };
}

/**
 * 构建修复指令
 */
function buildRepairInstruction(
  criticalIssues: QCIssue[],
  majorIssues: QCIssue[],
  chapterIndex: number,
  totalChapters: number
): string {
  const parts: string[] = [];

  parts.push(`【修复要求 - 第${chapterIndex}/${totalChapters}章】`);
  parts.push('请根据以下问题修复章节内容：\n');

  if (criticalIssues.length > 0) {
    parts.push('【严重问题 - 必须修复】');
    criticalIssues.forEach((issue, i) => {
      parts.push(`${i + 1}. ${issue.description}`);
      if (issue.suggestion) {
        parts.push(`   建议: ${issue.suggestion}`);
      }
      if (issue.location) {
        parts.push(`   位置: "${issue.location}"`);
      }
    });
    parts.push('');
  }

  if (majorIssues.length > 0) {
    parts.push('【重要问题 - 尽量修复】');
    majorIssues.slice(0, 5).forEach((issue, i) => {
      parts.push(`${i + 1}. ${issue.description}`);
      if (issue.suggestion) {
        parts.push(`   建议: ${issue.suggestion}`);
      }
    });
    parts.push('');
  }

  parts.push('【修复原则】');
  parts.push('1. 保持原有的情节走向和角色设定');
  parts.push('2. 保持原有的写作风格和语气');
  parts.push('3. 只修改存在问题的部分');
  parts.push('4. 确保修复后的内容自然流畅');

  if (chapterIndex < totalChapters) {
    parts.push('5. 这不是最终章，严禁出现完结/终章/尾声等词汇');
    parts.push('6. 结尾必须保留悬念和钩子');
  }

  return parts.join('\n');
}

/**
 * 批量修复多个章节
 */
export async function batchRepairChapters(
  aiConfig: AIConfig,
  chapters: { index: number; text: string; qcResult: QCResult }[],
  totalChapters: number,
  onProgress?: (index: number, result: RepairResult) => void
): Promise<RepairResult[]> {
  const results: RepairResult[] = [];

  for (const chapter of chapters) {
    if (chapter.qcResult.passed) {
      // 已通过的章节不需要修复
      results.push({
        repairedChapter: chapter.text,
        attempts: 0,
        finalQC: chapter.qcResult,
        success: true,
        repairLog: ['章节已通过 QC，无需修复'],
      });
      continue;
    }

    const result = await repairChapter(
      aiConfig,
      chapter.text,
      chapter.qcResult,
      chapter.index,
      totalChapters
    );

    results.push(result);

    if (onProgress) {
      onProgress(chapter.index, result);
    }
  }

  return results;
}

/**
 * 获取修复统计
 */
export function getRepairStats(results: RepairResult[]): {
  total: number;
  successful: number;
  failed: number;
  totalAttempts: number;
  averageScoreImprovement: number;
} {
  const successful = results.filter((r) => r.success).length;
  const totalAttempts = results.reduce((sum, r) => sum + r.attempts, 0);

  return {
    total: results.length,
    successful,
    failed: results.length - successful,
    totalAttempts,
    averageScoreImprovement: 0, // 需要原始分数才能计算
  };
}
