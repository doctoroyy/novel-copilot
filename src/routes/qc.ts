import type { Database } from 'better-sqlite3';
import { getDb } from '../db/db.js';
import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { createBackgroundTask } from './tasks.js';
import type { ScanMode } from '../qc/qcAgent.js';

export const qcRoutes = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

function generateReportId(): string {
  return `qcr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function getProjectIdByRef(
  db: Database,
  projectRef: string,
  userId: string
): Promise<string | null> {
  const project = db.prepare(`
    SELECT id FROM projects
    WHERE (id = ? OR name = ?) AND user_id = ? AND deleted_at IS NULL
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `).get(projectRef, projectRef, userId, projectRef) as { id: string } | null;
  return project?.id || null;
}

// POST /scan - Start QC scan
qcRoutes.post('/:name/qc/scan', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const scanMode: ScanMode = ['quick', 'standard', 'full'].includes(body.scanMode)
      ? body.scanMode
      : 'standard';

    const reportId = generateReportId();

    // Create background task
    const { taskId } = await createBackgroundTask(
      c.env.DB,
      projectId,
      userId,
      'qc',
      1,
      0,
      '准备开始质量扫描...',
    );

    // Create report row
    getDb().prepare(`
      INSERT INTO qc_reports (id, project_id, user_id, scan_mode, report_json, status, task_id)
      VALUES (?, ?, ?, ?, '{}', 'running', ?)
    `).run(reportId, projectId, userId, scanMode, taskId);

    // Enqueue
    await c.env.GENERATION_QUEUE.send({
      taskType: 'qc',
      taskId,
      projectId,
      userId,
      scanMode,
      reportId,
    });

    return c.json({ success: true, taskId, reportId });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// GET /report - Get latest report
qcRoutes.get('/:name/qc/report', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const report = getDb().prepare(`
      SELECT id, scan_mode, report_json, overall_score, total_issues,
             critical_count, major_count, minor_count, status, created_at, updated_at, task_id
      FROM qc_reports
      WHERE project_id = ? AND user_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(projectId, userId) as any;

    if (!report) {
      return c.json({ success: true, report: null });
    }

    // 同步检查关联 task 状态：如果 task 已被取消/失败，修正 report 状态
    if ((report.status === 'running' || report.status === 'repairing') && report.task_id) {
      const task = getDb().prepare(
        'SELECT status, cancel_requested FROM generation_tasks WHERE id = ?'
      ).get(report.task_id) as { status: string; cancel_requested: number } | null;
      if (task && (task.cancel_requested || task.status === 'failed' || task.status === 'completed')) {
        const newStatus = task.status === 'completed' ? 'completed' : 'failed';
        getDb().prepare(
          'UPDATE qc_reports SET status = ?, updated_at = (unixepoch() * 1000) WHERE id = ?'
        ).run(newStatus, report.id);
        report.status = newStatus;
      }
    }

    let reportData = null;
    try {
      reportData = JSON.parse(report.report_json);
    } catch { /* empty report for running status */ }

    return c.json({
      success: true,
      report: {
        reportId: report.id,
        scanMode: report.scan_mode,
        overallScore: report.overall_score,
        totalIssues: report.total_issues,
        criticalCount: report.critical_count,
        majorCount: report.major_count,
        minorCount: report.minor_count,
        status: report.status,
        createdAt: report.created_at,
        taskId: report.task_id,
        data: reportData,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// GET /report/:reportId - Get specific report
qcRoutes.get('/:name/qc/report/:reportId', async (c) => {
  const name = c.req.param('name');
  const reportId = c.req.param('reportId');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const report = getDb().prepare(`
      SELECT id, scan_mode, report_json, overall_score, total_issues,
             critical_count, major_count, minor_count, status, created_at, updated_at, task_id
      FROM qc_reports
      WHERE id = ? AND project_id = ? AND user_id = ?
    `).get(reportId, projectId, userId) as any;

    if (!report) {
      return c.json({ success: false, error: 'Report not found' }, 404);
    }

    // 同步检查关联 task 状态
    if ((report.status === 'running' || report.status === 'repairing') && report.task_id) {
      const task = getDb().prepare(
        'SELECT status, cancel_requested FROM generation_tasks WHERE id = ?'
      ).get(report.task_id) as { status: string; cancel_requested: number } | null;
      if (task && (task.cancel_requested || task.status === 'failed' || task.status === 'completed')) {
        const newStatus = task.status === 'completed' ? 'completed' : 'failed';
        getDb().prepare(
          'UPDATE qc_reports SET status = ?, updated_at = (unixepoch() * 1000) WHERE id = ?'
        ).run(newStatus, report.id);
        report.status = newStatus;
      }
    }

    let reportData = null;
    try {
      reportData = JSON.parse(report.report_json);
    } catch { /* empty */ }

    return c.json({
      success: true,
      report: {
        reportId: report.id,
        scanMode: report.scan_mode,
        overallScore: report.overall_score,
        totalIssues: report.total_issues,
        criticalCount: report.critical_count,
        majorCount: report.major_count,
        minorCount: report.minor_count,
        status: report.status,
        createdAt: report.created_at,
        taskId: report.task_id,
        data: reportData,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// POST /fix - Fix single chapter
qcRoutes.post('/:name/qc/fix', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const { chapterIndex, reportId } = body;

    if (chapterIndex === undefined || !reportId) {
      return c.json({ success: false, error: 'Missing chapterIndex or reportId' }, 400);
    }

    const { taskId } = await createBackgroundTask(
      c.env.DB,
      projectId,
      userId,
      'qc_fix',
      1,
      chapterIndex,
      `准备修复第 ${chapterIndex} 章...`,
    );

    // Mark report as repairing so frontend can poll
    getDb().prepare(`
      UPDATE qc_reports SET status = 'repairing', task_id = ?, updated_at = (unixepoch() * 1000) WHERE id = ?
    `).run(taskId, reportId);

    await c.env.GENERATION_QUEUE.send({
      taskType: 'qc_fix',
      taskId,
      projectId,
      userId,
      reportId,
      chapterIndex,
    });

    return c.json({ success: true, taskId });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// POST /fix-all - Batch fix all issues
qcRoutes.post('/:name/qc/fix-all', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const body = await c.req.json();
    const { reportId, maxSeverity } = body;

    if (!reportId) {
      return c.json({ success: false, error: 'Missing reportId' }, 400);
    }

    const { taskId } = await createBackgroundTask(
      c.env.DB,
      projectId,
      userId,
      'qc_fix',
      1,
      0,
      '准备批量修复...',
    );

    // Mark report as repairing so frontend can poll
    getDb().prepare(`
      UPDATE qc_reports SET status = 'repairing', task_id = ?, updated_at = (unixepoch() * 1000) WHERE id = ?
    `).run(taskId, reportId);

    await c.env.GENERATION_QUEUE.send({
      taskType: 'qc_fix',
      taskId,
      projectId,
      userId,
      reportId,
      maxSeverity: maxSeverity || 'major',
    });

    return c.json({ success: true, taskId });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
