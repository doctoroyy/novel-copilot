import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { eventBus } from '../eventBus.js';

export const tasksRoutes = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

export type TaskType = 'chapters' | 'outline' | 'bible' | 'other';
type ActiveTaskStatus = 'running' | 'paused' | 'completed' | 'failed';

function toTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return Date.now();

    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }

    const parsedUtc = Date.parse(`${trimmed}Z`);
    if (Number.isFinite(parsedUtc)) {
      return parsedUtc;
    }
  }
  return Date.now();
}

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJsonNumberArray(value: unknown): number[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry));
    return Array.from(new Set(normalized)).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function emitTaskUpdateForTask(db: D1Database, taskId: number): Promise<void> {
  try {
    const row = await db.prepare(`
      SELECT user_id
      FROM generation_tasks
      WHERE id = ?
      LIMIT 1
    `).bind(taskId).first() as { user_id: string | null } | null;

    if (row?.user_id) {
      eventBus.taskUpdate(row.user_id);
    }
  } catch (error) {
    console.warn('Failed to emit scoped task update:', (error as Error).message);
  }
}

function mapGenerationTaskRow(task: any): GenerationTask {
  const createdAtMs = toTimestampMs(task.created_at);
  const updatedAtMs = toTimestampMs(task.updated_at);
  return {
    id: task.id,
    taskType: (task.task_type || 'chapters') as TaskType,
    projectId: String(task.project_id || ''),
    projectName: String(task.project_name || ''),
    userId: String(task.user_id || ''),
    targetCount: parseNumber(task.target_count, 0),
    startChapter: parseNumber(task.start_chapter, 0),
    completedChapters: parseJsonNumberArray(task.completed_chapters),
    failedChapters: parseJsonNumberArray(task.failed_chapters),
    currentProgress: parseNumber(task.current_progress, 0),
    currentMessage: task.current_message ? String(task.current_message) : null,
    cancelRequested: Boolean(task.cancel_requested),
    status: (task.status || 'running') as ActiveTaskStatus,
    errorMessage: task.error_message ? String(task.error_message) : null,
    createdAt: createdAtMs,
    updatedAt: updatedAtMs,
    updatedAtMs,
  };
}

function mapImagineTemplateJobRow(task: any): GenerationTask {
  const createdAtMs = toTimestampMs(task.created_at);
  const updatedAtMs = toTimestampMs(task.updated_at);
  const rawStatus = String(task.status || 'queued');
  const status: ActiveTaskStatus = rawStatus === 'running' ? 'running' : 'paused';
  const fallbackMessage = status === 'running'
    ? '正在抓取榜单并生成热点模板...'
    : '热点模板任务排队中...';
  const maxTemplates = parseNumber(task.max_templates, 0);
  const resultTemplateCount = parseNumber(task.result_template_count, 0);

  return {
    id: `template:${String(task.id || '')}`,
    taskType: 'other',
    projectId: 'system:ai-imagine-template',
    projectName: 'AI 热点模板',
    userId: String(task.requested_by_user_id || ''),
    targetCount: maxTemplates > 0 ? maxTemplates : 0,
    startChapter: 0,
    completedChapters: [],
    failedChapters: [],
    currentProgress: resultTemplateCount,
    currentMessage: task.message ? String(task.message) : fallbackMessage,
    cancelRequested: false,
    status,
    errorMessage: task.error_message ? String(task.error_message) : null,
    createdAt: createdAtMs,
    updatedAt: updatedAtMs,
    updatedAtMs,
  };
}

async function getProjectIdByRef(
  db: D1Database,
  projectRef: string,
  userId: string
): Promise<string | null> {
  const project = await db.prepare(`
    SELECT id
    FROM projects
    WHERE (id = ? OR name = ?) AND user_id = ? AND deleted_at IS NULL
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `).bind(projectRef, projectRef, userId, projectRef).first() as { id: string } | null;

  return project?.id || null;
}

// Get all active tasks for the current user (global endpoint)
tasksRoutes.get('/active-tasks', async (c) => {
  const userId = c.get('userId');

  try {
    const { results: generationTasks } = await c.env.DB.prepare(`
      SELECT t.*, p.name as project_name
      FROM generation_tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = ? AND t.status = 'running'
      AND t.cancel_requested = 0
      ORDER BY t.created_at DESC
    `).bind(userId).all();

    const mergedTasks: GenerationTask[] = (generationTasks as any[]).map(mapGenerationTaskRow);

    // Template jobs are optional for old DBs that haven't run migration 0021 yet.
    try {
      const { results: templateJobs } = await c.env.DB.prepare(`
        SELECT
          id,
          snapshot_date,
          requested_by_user_id,
          max_templates,
          status,
          message,
          error_message,
          result_template_count,
          created_at,
          updated_at
        FROM ai_imagine_template_jobs
        WHERE requested_by_user_id = ?
          AND status IN ('queued', 'running')
        ORDER BY created_at DESC
        LIMIT 20
      `).bind(userId).all();

      mergedTasks.push(...((templateJobs as any[]).map(mapImagineTemplateJobRow)));
    } catch (error) {
      const message = (error as Error).message || '';
      if (!message.includes('no such table: ai_imagine_template_jobs')) {
        console.warn('Failed to load imagine template jobs for active tasks:', message);
      }
    }

    mergedTasks.sort((a, b) => b.createdAt - a.createdAt);
    return c.json({ success: true, tasks: mergedTasks });
  } catch (error) {
    console.error('Active tasks error:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get task history for the current user (global endpoint)
tasksRoutes.get('/history', async (c) => {
  const userId = c.get('userId');
  const limit = 50;

  try {
    // 1. Fetch history from generation_tasks
    // Use LEFT JOIN to include tasks even if project was deleted
    const { results: generationTasks } = await c.env.DB.prepare(`
      SELECT t.*, p.name as project_name
      FROM generation_tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.user_id = ?
      ORDER BY t.created_at DESC
      LIMIT ?
    `).bind(userId, limit).all();

    const mergedTasks: GenerationTask[] = (generationTasks as any[]).map(mapGenerationTaskRow);

    // 2. Fetch history from ai_imagine_template_jobs
    try {
      const { results: templateJobs } = await c.env.DB.prepare(`
        SELECT
          id,
          snapshot_date,
          requested_by_user_id,
          max_templates,
          status,
          message,
          error_message,
          result_template_count,
          created_at,
          updated_at
        FROM ai_imagine_template_jobs
        WHERE requested_by_user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(userId, limit).all();

      mergedTasks.push(...((templateJobs as any[]).map(mapImagineTemplateJobRow)));
    } catch (error) {
      // Ignore if table doesn't exist
    }

    // 3. Sort and limit combined results
    mergedTasks.sort((a, b) => b.createdAt - a.createdAt);
    const finalTasks = mergedTasks.slice(0, limit);

    return c.json({ success: true, tasks: finalTasks });
  } catch (error) {
    console.error('Task history error:', error);
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Types
export type GenerationTask = {
  id: number | string;
  taskType: TaskType;
  projectId: string;
  projectName: string;
  userId: string;
  targetCount: number;
  startChapter: number;
  completedChapters: number[];
  failedChapters: number[];
  currentProgress: number;
  currentMessage: string | null;
  cancelRequested: boolean;
  status: ActiveTaskStatus;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  updatedAtMs: number; // Unix timestamp in ms for reliable health check
};

// Cancel task by taskId (user-scoped, no project lookup needed)
tasksRoutes.post('/tasks/:id/cancel', async (c) => {
  const taskId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const task = await c.env.DB.prepare(`
      SELECT t.status, p.name as project_name
      FROM generation_tasks t
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = ? AND t.user_id = ?
    `).bind(taskId, userId).first() as { status: string; project_name: string | null } | null;

    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    if (task.status === 'running' || task.status === 'paused') {
      await c.env.DB.prepare(`
        UPDATE generation_tasks
        SET cancel_requested = 1, status = 'failed', current_message = '任务已取消', error_message = '任务已取消', updated_at = (unixepoch() * 1000)
        WHERE id = ? AND user_id = ?
      `).bind(taskId, userId).run();
      eventBus.taskUpdate(userId);
      
      if (task.project_name) {
        eventBus.progress({
          userId,
          projectName: task.project_name,
          current: 0,
          total: 100,
          chapterIndex: 0,
          status: 'error',
          message: '任务已取消',
        });
      }
      
      return c.json({ success: true, cancelled: true, message: '任务已取消' });
    }

    return c.json({ success: true, cancelled: true, message: '任务已结束' });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get task by taskId (user-scoped)
tasksRoutes.get('/tasks/:id', async (c) => {
  const taskId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const task = await c.env.DB.prepare(`
      SELECT t.*, p.name as project_name
      FROM generation_tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.id = ? AND t.user_id = ?
      LIMIT 1
    `).bind(taskId, userId).first() as any;

    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    const createdAtMs = toTimestampMs(task.created_at);
    const updatedAtMs = toTimestampMs(task.updated_at);

    return c.json({
      success: true,
      task: {
        id: task.id,
        taskType: (task.task_type || 'chapters') as TaskType,
        projectId: task.project_id,
        projectName: task.project_name,
        userId: task.user_id,
        targetCount: task.target_count,
        startChapter: task.start_chapter,
        completedChapters: JSON.parse(task.completed_chapters || '[]'),
        failedChapters: JSON.parse(task.failed_chapters || '[]'),
        currentProgress: task.current_progress || 0,
        currentMessage: task.current_message || null,
        cancelRequested: Boolean(task.cancel_requested),
        status: task.status,
        errorMessage: task.error_message,
        createdAt: createdAtMs,
        updatedAt: updatedAtMs,
        updatedAtMs,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get active task for a project
tasksRoutes.get('/projects/:name/active-task', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Get the most recent running or paused task
    const task = await c.env.DB.prepare(`
      SELECT t.*, p.name as project_name
      FROM generation_tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.project_id = ? AND t.user_id = ? AND t.status = 'running'
      AND t.task_type = 'chapters'
      AND t.cancel_requested = 0
      ORDER BY t.created_at DESC
      LIMIT 1
    `).bind(projectId, userId).first() as any;

    if (!task) {
      return c.json({ success: true, task: null });
    }

    const createdAtMs = toTimestampMs(task.created_at);
    const updatedAtMs = toTimestampMs(task.updated_at);
    const result: GenerationTask = {
      id: task.id,
      taskType: (task.task_type || 'chapters') as TaskType,
      projectId: task.project_id,
      projectName: task.project_name,
      userId: task.user_id,
      targetCount: task.target_count,
      startChapter: task.start_chapter,
      completedChapters: JSON.parse(task.completed_chapters || '[]'),
      failedChapters: JSON.parse(task.failed_chapters || '[]'),
      currentProgress: task.current_progress || 0,
      currentMessage: task.current_message || null,
      cancelRequested: Boolean(task.cancel_requested),
      status: task.status,
      errorMessage: task.error_message,
      createdAt: createdAtMs,
      updatedAt: updatedAtMs,
      updatedAtMs,
    };

    return c.json({ success: true, task: result });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Mark task as paused (called when client disconnects gracefully)
tasksRoutes.post('/projects/:name/tasks/:id/pause', async (c) => {
  const name = c.req.param('name');
  const taskId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    await c.env.DB.prepare(`
      UPDATE generation_tasks 
      SET status = 'paused', updated_at = (unixepoch() * 1000)
      WHERE id = ? AND project_id = ? AND user_id = ? AND status = 'running' AND cancel_requested = 0
    `).bind(taskId, projectId, userId).run();
    eventBus.taskUpdate(userId);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Request cancellation for a task (non-destructive)
tasksRoutes.post('/projects/:name/tasks/:id/cancel', async (c) => {
  const name = c.req.param('name');
  const taskId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const task = await c.env.DB.prepare(`
      SELECT status FROM generation_tasks WHERE id = ? AND project_id = ? AND user_id = ?
    `).bind(taskId, projectId, userId).first() as { status: string } | null;

    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    if (task.status === 'running') {
      await c.env.DB.prepare(`
        UPDATE generation_tasks
        SET cancel_requested = 1, status = 'failed', current_message = '任务已取消', error_message = '任务已取消', updated_at = (unixepoch() * 1000)
        WHERE id = ? AND project_id = ? AND user_id = ?
      `).bind(taskId, projectId, userId).run();
      eventBus.taskUpdate(userId);
      const project = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first() as { name: string } | null;
      if (project) {
        eventBus.progress({
          userId,
          projectName: project.name,
          current: 0,
          total: 100,
          chapterIndex: 0,
          status: 'error',
          message: '任务已取消',
        });
      }
      return c.json({ success: true, cancelled: true, message: '任务已取消' });
    }

    if (task.status === 'paused') {
      await c.env.DB.prepare(`
        UPDATE generation_tasks
        SET cancel_requested = 1, status = 'failed', current_message = '任务已取消', error_message = '任务已取消', updated_at = (unixepoch() * 1000)
        WHERE id = ? AND project_id = ? AND user_id = ?
      `).bind(taskId, projectId, userId).run();
      eventBus.taskUpdate(userId);
      const project = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first() as { name: string } | null;
      if (project) {
        eventBus.progress({
          userId,
          projectName: project.name,
          current: 0,
          total: 100,
          chapterIndex: 0,
          status: 'error',
          message: '任务已取消',
        });
      }
      return c.json({ success: true, cancelled: true, message: '任务已取消' });
    }

    return c.json({ success: true, cancelled: true, message: '任务已结束' });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Hard delete a task record
tasksRoutes.delete('/projects/:name/tasks/:id', async (c) => {
  const name = c.req.param('name');
  const taskId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    await c.env.DB.prepare(`
      DELETE FROM generation_tasks WHERE id = ? AND project_id = ? AND user_id = ?
    `).bind(taskId, projectId, userId).run();
    eventBus.taskUpdate(userId);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Request cancellation for ALL active tasks for a project (non-destructive)
tasksRoutes.post('/projects/:name/active-tasks/cancel', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    await c.env.DB.prepare(`
      UPDATE generation_tasks
      SET cancel_requested = 1, status = 'failed', current_message = '任务已取消', error_message = '任务已取消', updated_at = (unixepoch() * 1000)
      WHERE project_id = ? AND user_id = ? AND status = 'running'
    `).bind(projectId, userId).run();

    await c.env.DB.prepare(`
      UPDATE generation_tasks
      SET cancel_requested = 1, status = 'failed', current_message = '任务已取消', error_message = '任务已取消', updated_at = (unixepoch() * 1000)
      WHERE project_id = ? AND user_id = ? AND status = 'paused'
    `).bind(projectId, userId).run();
    eventBus.taskUpdate(userId);
    
    const project = await c.env.DB.prepare('SELECT name FROM projects WHERE id = ?').bind(projectId).first() as { name: string } | null;
    if (project) {
      eventBus.progress({
        userId,
        projectName: project.name,
        current: 0,
        total: 100,
        chapterIndex: 0,
        status: 'error',
        message: '任务已取消',
      });
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Hard delete ALL active tasks for a project (cleanup)
tasksRoutes.delete('/projects/:name/active-tasks', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    const projectId = await getProjectIdByRef(c.env.DB, name, userId);
    if (!projectId) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    await c.env.DB.prepare(`
      DELETE FROM generation_tasks 
      WHERE project_id = ? AND user_id = ? AND status IN ('running', 'paused')
    `).bind(projectId, userId).run();
    eventBus.taskUpdate(userId);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Helper functions for use in generation.ts
export async function createGenerationTask(
  db: D1Database,
  projectId: string,
  userId: string,
  targetCount: number,
  startChapter: number
): Promise<number> {
  // First, check if there's an existing running task for this project
  const existing = await db.prepare(`
    SELECT id, target_count, start_chapter, status, cancel_requested, completed_chapters
    FROM generation_tasks
    WHERE project_id = ? AND user_id = ? AND status = 'running' AND cancel_requested = 0
    AND task_type = 'chapters'
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(projectId, userId).first() as { id: number; target_count: number; start_chapter: number; completed_chapters: string } | null;

  if (existing) {
    const completedChapters = JSON.parse(existing.completed_chapters || '[]') as number[];
    const maxAttempted = Math.max(existing.start_chapter + existing.target_count - 1, ...completedChapters);

    // Case 1: The requested range is already covered by the existing task
    if (startChapter >= existing.start_chapter && startChapter + targetCount - 1 <= maxAttempted) {
      console.log(`Task ${existing.id} already covers requested range ${startChapter}-${startChapter + targetCount - 1}. Returning existing ID.`);
      return existing.id;
    }

    // Case 2: The request is an extension of the current task (sequential)
    // If the new startChapter is exactly after the currently planned range, we can just extend target_count
    if (startChapter === maxAttempted + 1) {
      const newTargetCount = existing.target_count + targetCount;
      console.log(`Extending task ${existing.id} target_count to ${newTargetCount}`);
      await db.prepare(`
        UPDATE generation_tasks 
        SET target_count = ?, updated_at = (unixepoch() * 1000)
        WHERE id = ?
      `).bind(newTargetCount, existing.id).run();
      return existing.id;
    }

    // Case 3: Non-contiguous or conflicting request. 
    // To maintain serial integrity, we terminate the old one and start new, 
    // OR we could queue it. For now, following the original "replace" logic but with logic check.
    console.log(`New task request ${startChapter} is not a simple extension of current task ${existing.start_chapter}-${maxAttempted}. Replacing.`);
    await db.prepare(`
      UPDATE generation_tasks 
      SET status = 'failed', cancel_requested = 1, current_message = '已被新任务替代，任务终止', error_message = '已被新任务替代，任务终止', updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(existing.id).run();
  }

  // Create new task
  const result = await db.prepare(`
    INSERT INTO generation_tasks (project_id, user_id, target_count, start_chapter, cancel_requested, task_type)
    VALUES (?, ?, ?, ?, 0, 'chapters')
  `).bind(projectId, userId, targetCount, startChapter).run();

  const newTaskId = result.meta.last_row_id as number;
  eventBus.taskUpdate(userId);
  return newTaskId;
}

export async function createBackgroundTask(
  db: D1Database,
  projectId: string,
  userId: string,
  taskType: TaskType,
  targetCount: number,
  startChapter: number = 0,
  initialMessage: string | null = null
): Promise<{ taskId: number; created: boolean }> {
  const existing = await db.prepare(`
    SELECT id
    FROM generation_tasks
    WHERE project_id = ? AND user_id = ? AND status = 'running' AND cancel_requested = 0 AND task_type = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(projectId, userId, taskType).first() as { id: number } | null;

  if (existing?.id) {
    eventBus.taskUpdate(userId);
    return { taskId: existing.id, created: false };
  }

  const result = await db.prepare(`
    INSERT INTO generation_tasks (
      project_id,
      user_id,
      target_count,
      start_chapter,
      cancel_requested,
      task_type,
      current_message
    )
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).bind(projectId, userId, targetCount, startChapter, taskType, initialMessage).run();

  const newTaskId = result.meta.last_row_id as number;
  eventBus.taskUpdate(userId);
  return { taskId: newTaskId, created: true };
}

export async function updateTaskProgress(
  db: D1Database,
  taskId: number,
  completedChapter: number,
  failed: boolean = false,
  message?: string
): Promise<void> {
  const task = await db.prepare(`
    SELECT completed_chapters, failed_chapters FROM generation_tasks WHERE id = ?
  `).bind(taskId).first() as { completed_chapters: string; failed_chapters: string } | null;

  if (!task) return;

  if (failed) {
    const failedChapters = parseJsonNumberArray(task.failed_chapters);
    failedChapters.push(completedChapter);
    const normalizedFailedChapters = Array.from(new Set(failedChapters)).sort((a, b) => a - b);
    await db.prepare(`
      UPDATE generation_tasks 
      SET failed_chapters = ?, current_progress = ?, current_message = ?, updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(JSON.stringify(normalizedFailedChapters), completedChapter, message || `第 ${completedChapter} 章生成失败`, taskId).run();
  } else {
    const completedChapters = parseJsonNumberArray(task.completed_chapters);
    completedChapters.push(completedChapter);
    const normalizedCompletedChapters = Array.from(new Set(completedChapters)).sort((a, b) => a - b);
    await db.prepare(`
      UPDATE generation_tasks 
      SET completed_chapters = ?, current_progress = ?, current_message = ?, updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(JSON.stringify(normalizedCompletedChapters), completedChapter, message || `第 ${completedChapter} 章完成`, taskId).run();
  }
  await emitTaskUpdateForTask(db, taskId);
}

export async function completeTask(
  db: D1Database,
  taskId: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  await db.prepare(`
    UPDATE generation_tasks 
    SET status = ?, error_message = ?, current_message = ?, updated_at = (unixepoch() * 1000)
    WHERE id = ?
  `).bind(
    success ? 'completed' : 'failed',
    errorMessage || null,
    success ? '任务完成' : (errorMessage || '任务失败'),
    taskId
  ).run();
  await emitTaskUpdateForTask(db, taskId);
}

// Check if there is a running task for a project (optionally scoped to a user)
export async function checkRunningTask(
  db: D1Database,
  projectId: string,
  userId?: string
): Promise<{ isRunning: boolean; taskId?: number; task?: any }> {
  const task = (userId
    ? await db.prepare(`
        SELECT * FROM generation_tasks
        WHERE project_id = ? AND user_id = ? AND status = 'running' AND cancel_requested = 0
        AND task_type = 'chapters'
        ORDER BY updated_at DESC
        LIMIT 1
      `).bind(projectId, userId).first()
    : await db.prepare(`
        SELECT * FROM generation_tasks
        WHERE project_id = ? AND status = 'running' AND cancel_requested = 0
        AND task_type = 'chapters'
        ORDER BY updated_at DESC
        LIMIT 1
      `).bind(projectId).first()) as any;

  if (task) {
    return {
      isRunning: true,
      taskId: task.id,
      task: {
        ...task,
        completedChapters: JSON.parse(task.completed_chapters || '[]'),
        failedChapters: JSON.parse(task.failed_chapters || '[]'),
        targetCount: task.target_count,
        taskType: (task.task_type || 'chapters') as TaskType,
        currentProgress: task.current_progress,
        currentMessage: task.current_message,
        cancelRequested: Boolean(task.cancel_requested),
        startChapter: task.start_chapter
      }
    };
  }
  return { isRunning: false };
}

// Update current progress message for live sync
export async function updateTaskMessage(
  db: D1Database,
  taskId: number,
  message: string,
  currentChapter?: number
): Promise<void> {
  if (currentChapter !== undefined) {
    await db.prepare(`
      UPDATE generation_tasks 
      SET current_message = ?, current_progress = ?, updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(message, currentChapter, taskId).run();
  } else {
    await db.prepare(`
      UPDATE generation_tasks 
      SET current_message = ?, updated_at = (unixepoch() * 1000)
      WHERE id = ?
    `).bind(message, taskId).run();
  }
  await emitTaskUpdateForTask(db, taskId);
}

export async function getTaskById(
  db: D1Database,
  taskId: number,
  userId: string
): Promise<GenerationTask | null> {
  const task = await db.prepare(`
    SELECT t.*, p.name as project_name
    FROM generation_tasks t
    JOIN projects p ON t.project_id = p.id
    WHERE t.id = ? AND t.user_id = ?
    LIMIT 1
  `).bind(taskId, userId).first() as any;

  if (!task) return null;

  const createdAtMs = toTimestampMs(task.created_at);
  const updatedAtMs = toTimestampMs(task.updated_at);
  return {
    id: task.id,
    taskType: (task.task_type || 'chapters') as TaskType,
    projectId: task.project_id,
    projectName: task.project_name,
    userId: task.user_id,
    targetCount: task.target_count,
    startChapter: task.start_chapter,
    completedChapters: JSON.parse(task.completed_chapters || '[]'),
    failedChapters: JSON.parse(task.failed_chapters || '[]'),
    currentProgress: task.current_progress || 0,
    currentMessage: task.current_message || null,
    cancelRequested: Boolean(task.cancel_requested),
    status: task.status,
    errorMessage: task.error_message,
    createdAt: createdAtMs,
    updatedAt: updatedAtMs,
    updatedAtMs,
  };
}
