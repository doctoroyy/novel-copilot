import { getAIConfigFromRegistry, type AIConfig } from '../services/aiClient.js';
import { updateTaskMessage, completeTask } from '../routes/tasks.js';
import { repairChapter, type RepairResult } from './repairLoop.js';
import { runQuickQC } from './multiDimensionalQC.js';
import type { QCReport, ActionableIssue, ChapterQCEntry } from './qcAgent.js';

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

  // Load chapter text
  const chapter = await db.prepare(`
    SELECT content FROM chapters
    WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
  `).bind(projectId, chapterIndex).first() as { content: string } | null;

  if (!chapter) throw new Error(`第 ${chapterIndex} 章未找到`);

  // Load project state for totalChapters
  const project = await db.prepare(`
    SELECT state_json FROM projects WHERE id = ?
  `).bind(projectId).first() as { state_json: string } | null;

  const stateJson = project?.state_json ? JSON.parse(project.state_json) : {};
  const totalChapters = stateJson.totalChapters || 100;
  const minChapterWords = stateJson.minChapterWords || 1500;

  // Run quick QC to get current issues
  const qcResult = runQuickQC(chapter.content, chapterIndex, totalChapters, minChapterWords);

  if (qcResult.passed) {
    await updateTaskMessage(db, taskId, `第 ${chapterIndex} 章已通过 QC，无需修复`);
    return;
  }

  // Repair
  const result = await repairChapter(
    aiConfig,
    chapter.content,
    qcResult,
    chapterIndex,
    totalChapters,
    2,
    minChapterWords,
  );

  if (result.success) {
    // Update chapter text in DB
    await db.prepare(`
      UPDATE chapters SET content = ?, updated_at = (unixepoch() * 1000)
      WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
    `).bind(result.repairedChapter, projectId, chapterIndex).run();

    // Update report
    await updateReportAfterFix(db, reportId, chapterIndex, result);
    await updateTaskMessage(db, taskId, `第 ${chapterIndex} 章修复成功 (评分: ${result.finalQC.score})`);
  } else {
    await updateTaskMessage(db, taskId, `第 ${chapterIndex} 章修复未完全成功 (评分: ${result.finalQC.score})`);
  }
}

export async function fixAllChapters(
  db: D1Database,
  projectId: string,
  reportId: string,
  taskId: number,
  maxSeverity: string = 'major',
): Promise<void> {
  // Load report
  const reportRow = await db.prepare(`
    SELECT report_json FROM qc_reports WHERE id = ?
  `).bind(reportId).first() as { report_json: string } | null;

  if (!reportRow) throw new Error('报告未找到');

  const report: QCReport = JSON.parse(reportRow.report_json);
  const severities = maxSeverity === 'critical' ? ['critical'] : ['critical', 'major'];

  // Filter chapters with issues to fix
  const chaptersToFix = report.actionableIssues
    .filter(i => !i.fixed && severities.includes(i.severity))
    .map(i => i.chapterIndex);
  const uniqueChapters = [...new Set(chaptersToFix)].sort((a, b) => a - b);

  if (uniqueChapters.length === 0) {
    await updateTaskMessage(db, taskId, '没有需要修复的章节');
    return;
  }

  const aiConfig = await getAIConfigFromRegistry(db, 'qc');
  if (!aiConfig) throw new Error('未配置 AI 模型');

  const project = await db.prepare(`
    SELECT state_json FROM projects WHERE id = ?
  `).bind(projectId).first() as { state_json: string } | null;

  const stateJson = project?.state_json ? JSON.parse(project.state_json) : {};
  const totalChapters = stateJson.totalChapters || 100;
  const minChapterWords = stateJson.minChapterWords || 1500;

  let fixedCount = 0;
  for (let i = 0; i < uniqueChapters.length; i++) {
    const chIdx = uniqueChapters[i];
    await updateTaskMessage(db, taskId, `修复第 ${chIdx} 章 (${i + 1}/${uniqueChapters.length})...`);

    const chapter = await db.prepare(`
      SELECT content FROM chapters
      WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
    `).bind(projectId, chIdx).first() as { content: string } | null;

    if (!chapter) continue;

    const qcResult = runQuickQC(chapter.content, chIdx, totalChapters, minChapterWords);
    if (qcResult.passed) {
      fixedCount++;
      continue;
    }

    try {
      const result = await repairChapter(
        aiConfig,
        chapter.content,
        qcResult,
        chIdx,
        totalChapters,
        2,
        minChapterWords,
      );

      if (result.success) {
        await db.prepare(`
          UPDATE chapters SET content = ?, updated_at = (unixepoch() * 1000)
          WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
        `).bind(result.repairedChapter, projectId, chIdx).run();

        await updateReportAfterFix(db, reportId, chIdx, result);
        fixedCount++;
      }
    } catch (err) {
      console.warn(`Fix failed for chapter ${chIdx}:`, err);
    }
  }

  await updateTaskMessage(db, taskId, `批量修复完成: ${fixedCount}/${uniqueChapters.length} 章修复成功`);
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

    // Update chapter entry
    report.chapters[chapterIndex] = {
      passed: result.finalQC.passed,
      score: result.finalQC.score,
      tier: report.chapters[chapterIndex]?.tier || 1,
      issues: result.finalQC.issues,
    };

    // Mark actionable issues as fixed
    for (const issue of report.actionableIssues) {
      if (issue.chapterIndex === chapterIndex && result.success) {
        issue.fixed = true;
      }
    }

    // Recalculate summary
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
    await completeTask(db, taskId, true);
  } catch (error) {
    const msg = (error as Error).message || '修复失败';
    await completeTask(db, taskId, false, msg);
  }
}
