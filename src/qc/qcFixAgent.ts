import { getAIConfigFromRegistry, generateTextWithRetry, type AIConfig } from '../services/aiClient.js';
import { updateTaskMessage, completeTask, getTaskRuntimeControl } from '../routes/tasks.js';
import { runQuickQC, type QCResult } from './multiDimensionalQC.js';
import type { QCReport, ActionableIssue, ChapterQCEntry } from './qcAgent.js';
import type { RepairResult } from './repairLoop.js';

/**
 * 加载项目的 total_chapters 和 min_chapter_words（从 states 表）
 */
async function loadProjectMeta(db: D1Database, projectId: string) {
  const row = await db.prepare(`
    SELECT total_chapters, min_chapter_words FROM states WHERE project_id = ?
  `).bind(projectId).first() as { total_chapters: number; min_chapter_words: number } | null;
  return {
    totalChapters: row?.total_chapters || 100,
    minChapterWords: row?.min_chapter_words || 1500,
  };
}

/**
 * 加载前后章内容，用于约束修复不破坏连续性
 */
async function loadSurroundingChapters(
  db: D1Database,
  projectId: string,
  chapterIndex: number,
): Promise<{ prevChapter: string | null; nextChapter: string | null }> {
  const rows = await db.prepare(`
    SELECT chapter_index, content FROM chapters
    WHERE project_id = ? AND chapter_index IN (?, ?) AND deleted_at IS NULL
  `).bind(projectId, chapterIndex - 1, chapterIndex + 1).all() as {
    results: { chapter_index: number; content: string }[];
  };

  let prevChapter: string | null = null;
  let nextChapter: string | null = null;
  for (const r of rows.results) {
    if (r.chapter_index === chapterIndex - 1) prevChapter = r.content;
    if (r.chapter_index === chapterIndex + 1) nextChapter = r.content;
  }
  return { prevChapter, nextChapter };
}

/**
 * 构建带前后章约束的修复 prompt
 */
function buildConstrainedRepairPrompt(
  chapterText: string,
  chapterIndex: number,
  totalChapters: number,
  issues: QCResult,
  prevChapter: string | null,
  nextChapter: string | null,
): { system: string; prompt: string } {
  const criticalIssues = issues.issues.filter(i => i.severity === 'critical');
  const majorIssues = issues.issues.filter(i => i.severity === 'major');

  const system = `你是一个专业的网文修复编辑。你的任务是做最小修复——只修复指出的问题，尽量保留原文。

核心原则：
1. 保持原有情节走向、角色名称、关系不变
2. 保持原有写作风格和语气
3. 只改动存在问题的部分，其余原文逐字保留
4. 修复后的章节必须与前一章的结尾自然衔接
5. 修复后的章节必须与后一章的开头保持兼容，不能引发新的断裂
6. 只输出修复后的完整章节正文，不要任何解释`.trim();

  const parts: string[] = [];
  parts.push(`【修复任务 - 第${chapterIndex}/${totalChapters}章】\n`);

  if (criticalIssues.length > 0) {
    parts.push('【必须修复的问题】');
    criticalIssues.forEach((issue, i) => {
      parts.push(`${i + 1}. ${issue.description}`);
      if (issue.suggestion) parts.push(`   建议: ${issue.suggestion}`);
    });
    parts.push('');
  }

  if (majorIssues.length > 0) {
    parts.push('【尽量修复的问题】');
    majorIssues.slice(0, 5).forEach((issue, i) => {
      parts.push(`${i + 1}. ${issue.description}`);
      if (issue.suggestion) parts.push(`   建议: ${issue.suggestion}`);
    });
    parts.push('');
  }

  // 前章约束
  if (prevChapter) {
    const prevEnding = prevChapter.slice(-800);
    parts.push('【前一章结尾（修复后必须与此衔接）】');
    parts.push(`...${prevEnding}\n`);
  }

  // 后章约束
  if (nextChapter) {
    const nextOpening = nextChapter.slice(0, 800);
    parts.push('【后一章开头（修复后必须与此兼容，不能矛盾）】');
    parts.push(`${nextOpening}...\n`);
  }

  parts.push('【待修复章节原文】');
  parts.push(chapterText);
  parts.push('\n请输出修复后的完整章节内容:');

  return { system, prompt: parts.join('\n') };
}

/**
 * 从 QC 报告加载指定章节的问题
 */
async function loadReportIssues(
  db: D1Database,
  reportId: string,
  chapterIndex: number,
): Promise<{ issues: QCResult['issues']; score: number } | null> {
  const reportRow = await db.prepare(`
    SELECT report_json FROM qc_reports WHERE id = ?
  `).bind(reportId).first() as { report_json: string } | null;

  if (!reportRow) return null;

  try {
    const report: QCReport = JSON.parse(reportRow.report_json);
    const entry = report.chapters[chapterIndex];
    if (!entry) return null;
    return { issues: entry.issues, score: entry.score };
  } catch {
    return null;
  }
}

/**
 * 修复单章（带前后文约束）
 */
export async function fixChapter(
  db: D1Database,
  projectId: string,
  chapterIndex: number,
  reportId: string,
  taskId: number,
): Promise<void> {
  const aiConfig = await getAIConfigFromRegistry(db, 'qc');
  if (!aiConfig) throw new Error('未配置 AI 模型');

  await updateTaskMessage(db, taskId, `修复第 ${chapterIndex} 章...`);

  const chapter = await db.prepare(`
    SELECT content FROM chapters
    WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
  `).bind(projectId, chapterIndex).first() as { content: string } | null;

  if (!chapter) throw new Error(`第 ${chapterIndex} 章未找到`);

  const { totalChapters, minChapterWords } = await loadProjectMeta(db, projectId);

  // Load issues from the QC report (includes AI-detected issues from Tier 2)
  const reportIssues = await loadReportIssues(db, reportId, chapterIndex);

  // Determine issues: prefer report issues (which include AI analysis),
  // fall back to runQuickQC only if report has no data for this chapter
  let issues: QCResult['issues'];
  let baseScore: number;

  if (reportIssues && reportIssues.issues.length > 0) {
    issues = reportIssues.issues;
    baseScore = reportIssues.score;
  } else {
    const qcResult = runQuickQC(chapter.content, chapterIndex, totalChapters, minChapterWords);
    issues = qcResult.issues;
    baseScore = qcResult.score;
  }

  const hasCriticalOrMajor = issues.some(i => i.severity === 'critical' || i.severity === 'major');
  if (!hasCriticalOrMajor) {
    await updateTaskMessage(db, taskId, `第 ${chapterIndex} 章无 critical/major 问题，跳过`);
    return;
  }

  // 加载前后章
  const { prevChapter, nextChapter } = await loadSurroundingChapters(db, projectId, chapterIndex);

  // 构建带约束的修复 prompt（使用报告中的完整问题列表）
  const qcResultForPrompt: QCResult = {
    passed: !hasCriticalOrMajor,
    score: baseScore,
    issues,
    suggestions: [],
    dimensionScores: { ending: 100, character: 100, pacing: 100, goal: 100, structure: 100 },
    timestamp: new Date().toISOString(),
  };
  const { system, prompt } = buildConstrainedRepairPrompt(
    chapter.content, chapterIndex, totalChapters, qcResultForPrompt, prevChapter, nextChapter,
  );

  const repairedText = await generateTextWithRetry(aiConfig, {
    system, prompt, temperature: 0.7,
  });

  // 验证修复结果（用 runQuickQC 做基本完整性检查）
  const finalQC = runQuickQC(repairedText, chapterIndex, totalChapters, minChapterWords);

  // Accept repair if it doesn't introduce structural regressions
  if (finalQC.score >= 60 && !finalQC.issues.some(i => i.severity === 'critical')) {
    await db.prepare(`
      UPDATE chapters SET content = ?
      WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
    `).bind(repairedText, projectId, chapterIndex).run();

    await updateReportAfterFix(db, reportId, chapterIndex, {
      repairedChapter: repairedText, attempts: 1, finalQC, success: true, repairLog: [],
    });
    await updateTaskMessage(db, taskId, `第 ${chapterIndex} 章修复成功 (评分: ${baseScore} → ${finalQC.score})`);
  } else {
    await updateTaskMessage(db, taskId, `第 ${chapterIndex} 章修复后结构检查未通过 (${finalQC.score})，已回滚`);
  }
}

/**
 * 批量修复（按章节顺序，带前后章约束）
 */
export async function fixAllChapters(
  db: D1Database,
  projectId: string,
  reportId: string,
  taskId: number,
  maxSeverity: string = 'major',
): Promise<void> {
  const reportRow = await db.prepare(`
    SELECT report_json FROM qc_reports WHERE id = ?
  `).bind(reportId).first() as { report_json: string } | null;

  if (!reportRow) throw new Error('报告未找到');

  const report: QCReport = JSON.parse(reportRow.report_json);
  const severities = maxSeverity === 'critical' ? ['critical'] : ['critical', 'major'];

  const chaptersToFix = report.actionableIssues
    .filter(i => !i.fixed && severities.includes(i.severity))
    .map(i => i.chapterIndex);
  const uniqueChapters = [...new Set(chaptersToFix)].sort((a, b) => a - b);

  if (uniqueChapters.length === 0) {
    await updateTaskMessage(db, taskId, '没有需要修复的章节');
    return;
  }

  let fixedCount = 0;
  for (let i = 0; i < uniqueChapters.length; i++) {
    const chIdx = uniqueChapters[i];
    await updateTaskMessage(db, taskId, `修复第 ${chIdx} 章 (${i + 1}/${uniqueChapters.length})...`);

    const runtime = await getTaskRuntimeControl(db, taskId);
    if (runtime.cancelRequested) {
      throw new Error('任务已取消');
    }

    try {
      await fixChapter(db, projectId, chIdx, reportId, taskId);
      fixedCount++;
    } catch (err) {
      console.warn(`Fix failed for chapter ${chIdx}:`, err);
    }
  }

  await updateTaskMessage(db, taskId, `批量修复完成: ${fixedCount}/${uniqueChapters.length} 章`);
}

async function updateReportAfterFix(
  db: D1Database,
  reportId: string,
  chapterIndex: number,
  result: RepairResult,
): Promise<void> {
  const reportRow = await db.prepare(`
    SELECT report_json FROM qc_reports WHERE id = ?
  `).bind(reportId).first() as { report_json: string } | null;

  if (!reportRow) return;

  try {
    const report: QCReport = JSON.parse(reportRow.report_json);

    report.chapters[chapterIndex] = {
      passed: result.finalQC.passed,
      score: result.finalQC.score,
      tier: report.chapters[chapterIndex]?.tier || 1,
      issues: result.finalQC.issues,
    };

    for (const issue of report.actionableIssues) {
      if (issue.chapterIndex === chapterIndex && result.success) {
        issue.fixed = true;
      }
    }

    const entries = Object.values(report.chapters);
    const allIssues = entries.flatMap(e => e.issues);
    report.summary.overallScore = entries.length > 0
      ? Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length)
      : 0;
    report.summary.passRate = entries.length > 0
      ? Math.round((entries.filter(e => e.passed).length / entries.length) * 100)
      : 0;
    report.summary.criticalCount = allIssues.filter(i => i.severity === 'critical').length;
    report.summary.majorCount = allIssues.filter(i => i.severity === 'major').length;
    report.summary.minorCount = allIssues.filter(i => i.severity === 'minor').length;

    await db.prepare(`
      UPDATE qc_reports
      SET report_json = ?,
          overall_score = ?,
          total_issues = ?,
          critical_count = ?,
          major_count = ?,
          minor_count = ?,
          updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(
      JSON.stringify(report),
      report.summary.overallScore,
      report.summary.criticalCount + report.summary.majorCount + report.summary.minorCount,
      report.summary.criticalCount,
      report.summary.majorCount,
      report.summary.minorCount,
      reportId,
    ).run();
  } catch (err) {
    console.warn('Failed to update report after fix:', err);
  }
}

export async function runQCFixInBackground(params: {
  env: { DB: D1Database };
  taskId: number;
  projectId: string;
  userId: string;
  reportId: string;
  chapterIndex?: number;
  maxSeverity?: string;
}): Promise<void> {
  const { env, taskId, projectId, reportId, chapterIndex, maxSeverity } = params;
  const db = env.DB;

  try {
    if (chapterIndex !== undefined) {
      await fixChapter(db, projectId, chapterIndex, reportId, taskId);
    } else {
      await fixAllChapters(db, projectId, reportId, taskId, maxSeverity);
    }
    // Mark report status back to completed
    await db.prepare(`
      UPDATE qc_reports SET status = 'completed', updated_at = (unixepoch() * 1000) WHERE id = ?
    `).bind(reportId).run();
    await completeTask(db, taskId, true);
  } catch (error) {
    const msg = (error as Error).message || '修复失败';
    // Still mark report back to completed on error
    await db.prepare(`
      UPDATE qc_reports SET status = 'completed', updated_at = (unixepoch() * 1000) WHERE id = ?
    `).bind(reportId).run().catch(() => {});
    await completeTask(db, taskId, false, msg);
  }
}
