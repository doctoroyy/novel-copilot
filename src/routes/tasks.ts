import { Hono } from 'hono';
import type { Env } from '../worker.js';

export const tasksRoutes = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// Types
export type GenerationTask = {
  id: number;
  projectId: string;
  projectName: string;
  userId: string;
  targetCount: number;
  startChapter: number;
  completedChapters: number[];
  failedChapters: number[];
  currentProgress: number;
  currentMessage: string | null;
  status: 'running' | 'paused' | 'completed' | 'failed';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

// Get active task for a project
tasksRoutes.get('/projects/:name/active-task', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');

  try {
    // Get project ID first
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND user_id = ? AND deleted_at IS NULL
    `).bind(name, userId).first() as { id: string } | null;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Get the most recent running or paused task
    const task = await c.env.DB.prepare(`
      SELECT t.*, p.name as project_name
      FROM generation_tasks t
      JOIN projects p ON t.project_id = p.id
      WHERE t.project_id = ? AND t.user_id = ? AND t.status IN ('running', 'paused')
      ORDER BY t.created_at DESC
      LIMIT 1
    `).bind(project.id, userId).first() as any;

    if (!task) {
      return c.json({ success: true, task: null });
    }

    const result: GenerationTask = {
      id: task.id,
      projectId: task.project_id,
      projectName: task.project_name,
      userId: task.user_id,
      targetCount: task.target_count,
      startChapter: task.start_chapter,
      completedChapters: JSON.parse(task.completed_chapters || '[]'),
      failedChapters: JSON.parse(task.failed_chapters || '[]'),
      currentProgress: task.current_progress || 0,
      currentMessage: task.current_message || null,
      status: task.status,
      errorMessage: task.error_message,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    };

    return c.json({ success: true, task: result });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Mark task as paused (called when client disconnects gracefully)
tasksRoutes.post('/projects/:name/tasks/:id/pause', async (c) => {
  const taskId = c.req.param('id');
  const userId = c.get('userId');

  try {
    await c.env.DB.prepare(`
      UPDATE generation_tasks 
      SET status = 'paused', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND status = 'running'
    `).bind(taskId, userId).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Cancel/delete a task
tasksRoutes.delete('/projects/:name/tasks/:id', async (c) => {
  const taskId = c.req.param('id');
  const userId = c.get('userId');

  try {
    await c.env.DB.prepare(`
      DELETE FROM generation_tasks WHERE id = ? AND user_id = ?
    `).bind(taskId, userId).run();

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
  // First, mark any existing running tasks as paused
  await db.prepare(`
    UPDATE generation_tasks 
    SET status = 'paused', updated_at = CURRENT_TIMESTAMP
    WHERE project_id = ? AND user_id = ? AND status = 'running'
  `).bind(projectId, userId).run();

  // Create new task
  const result = await db.prepare(`
    INSERT INTO generation_tasks (project_id, user_id, target_count, start_chapter)
    VALUES (?, ?, ?, ?)
  `).bind(projectId, userId, targetCount, startChapter).run();

  return result.meta.last_row_id as number;
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
    const failedChapters = JSON.parse(task.failed_chapters || '[]');
    failedChapters.push(completedChapter);
    await db.prepare(`
      UPDATE generation_tasks 
      SET failed_chapters = ?, current_progress = ?, current_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(JSON.stringify(failedChapters), completedChapter, message || `第 ${completedChapter} 章生成失败`, taskId).run();
  } else {
    const completedChapters = JSON.parse(task.completed_chapters || '[]');
    completedChapters.push(completedChapter);
    await db.prepare(`
      UPDATE generation_tasks 
      SET completed_chapters = ?, current_progress = ?, current_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(JSON.stringify(completedChapters), completedChapter, message || `第 ${completedChapter} 章完成`, taskId).run();
  }
}

export async function completeTask(
  db: D1Database,
  taskId: number,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  await db.prepare(`
    UPDATE generation_tasks 
    SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(success ? 'completed' : 'failed', errorMessage || null, taskId).run();
}

// Check if there's a recently active running task (within last 2 minutes)
export async function checkRunningTask(
  db: D1Database,
  projectId: string
): Promise<{ isRunning: boolean; taskId?: number }> {
  const task = await db.prepare(`
    SELECT id, updated_at FROM generation_tasks 
    WHERE project_id = ? AND status = 'running'
    AND updated_at > datetime('now', '-2 minutes')
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(projectId).first() as { id: number; updated_at: string } | null;

  if (task) {
    return { isRunning: true, taskId: task.id };
  }
  return { isRunning: false };
}

// Update current progress message for live sync
export async function updateTaskMessage(
  db: D1Database,
  taskId: number,
  message: string
): Promise<void> {
  await db.prepare(`
    UPDATE generation_tasks 
    SET current_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(message, taskId).run();
}
