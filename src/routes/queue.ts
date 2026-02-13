import { Hono } from 'hono';
import type { Env } from '../worker.js';
import type { QueuedTask } from '../durableObjects/TaskQueue.js';
import { nanoid } from 'nanoid';

export const queueRoutes = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// Helper to get AI config from headers
function getAIConfigFromHeaders(c: any) {
  const provider = c.req.header('X-AI-Provider');
  const model = c.req.header('X-AI-Model');
  const apiKey = c.req.header('X-AI-Key');
  const baseUrl = c.req.header('X-AI-BaseUrl');

  if (!provider || !model || !apiKey) {
    return null;
  }

  return { provider: provider as any, model, apiKey, baseUrl };
}

// Enqueue a chapter generation task
queueRoutes.post('/projects/:name/queue-chapters', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { chaptersToGenerate = 1 } = await c.req.json();

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT id, name FROM projects WHERE name = ? AND user_id = ? AND deleted_at IS NULL
    `).bind(name, userId).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Create task
    const task: QueuedTask = {
      id: nanoid(),
      type: 'chapter',
      projectId: project.id,
      projectName: project.name,
      userId,
      params: { chaptersToGenerate },
      aiConfig,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Get queue DO
    const queueId = c.env.TASK_QUEUE.idFromName('global-queue');
    const queue = c.env.TASK_QUEUE.get(queueId);

    // Enqueue task
    const response = await queue.fetch('https://task-queue/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });

    const result = await response.json() as { success: boolean; taskId: string };

    if (!result.success) {
      return c.json({ success: false, error: 'Failed to enqueue task' }, 500);
    }

    return c.json({ success: true, taskId: result.taskId });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Enqueue an outline generation task
queueRoutes.post('/projects/:name/queue-outline', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  const aiConfig = getAIConfigFromHeaders(c);

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const { targetChapters = 400, targetWordCount = 100, customPrompt } = await c.req.json();

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT id, name FROM projects WHERE name = ? AND user_id = ? AND deleted_at IS NULL
    `).bind(name, userId).first() as any;

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Create task
    const task: QueuedTask = {
      id: nanoid(),
      type: 'outline',
      projectId: project.id,
      projectName: project.name,
      userId,
      params: { targetChapters, targetWordCount, customPrompt },
      aiConfig,
      status: 'pending',
      progress: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Get queue DO
    const queueId = c.env.TASK_QUEUE.idFromName('global-queue');
    const queue = c.env.TASK_QUEUE.get(queueId);

    // Enqueue task
    const response = await queue.fetch('https://task-queue/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });

    const result = await response.json() as { success: boolean; taskId: string };

    if (!result.success) {
      return c.json({ success: false, error: 'Failed to enqueue task' }, 500);
    }

    return c.json({ success: true, taskId: result.taskId });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get all active queue tasks for the current user
queueRoutes.get('/queue/tasks', async (c) => {
  const userId = c.get('userId');

  try {
    // Get queue DO
    const queueId = c.env.TASK_QUEUE.idFromName('global-queue');
    const queue = c.env.TASK_QUEUE.get(queueId);

    // List tasks
    const response = await queue.fetch(`https://task-queue/list?userId=${encodeURIComponent(userId)}`, {
      method: 'GET',
    });

    const result = await response.json() as { success: boolean; tasks: QueuedTask[] };

    if (!result.success) {
      return c.json({ success: false, error: 'Failed to list tasks' }, 500);
    }

    return c.json({ success: true, tasks: result.tasks });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get a specific task by ID
queueRoutes.get('/queue/tasks/:taskId', async (c) => {
  const taskId = c.req.param('taskId');
  const userId = c.get('userId');

  try {
    // Get queue DO
    const queueId = c.env.TASK_QUEUE.idFromName('global-queue');
    const queue = c.env.TASK_QUEUE.get(queueId);

    // Get task
    const response = await queue.fetch(`https://task-queue/get?taskId=${encodeURIComponent(taskId)}`, {
      method: 'GET',
    });

    const result = await response.json() as { success: boolean; task: QueuedTask };

    if (!result.success) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    // Verify user owns this task
    if (result.task.userId !== userId) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    return c.json({ success: true, task: result.task });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Cancel a task
queueRoutes.post('/queue/tasks/:taskId/cancel', async (c) => {
  const taskId = c.req.param('taskId');
  const userId = c.get('userId');

  try {
    // Get queue DO
    const queueId = c.env.TASK_QUEUE.idFromName('global-queue');
    const queue = c.env.TASK_QUEUE.get(queueId);

    // Get task first to verify ownership
    const getResponse = await queue.fetch(`https://task-queue/get?taskId=${encodeURIComponent(taskId)}`, {
      method: 'GET',
    });

    const getResult = await getResponse.json() as { success: boolean; task: QueuedTask };

    if (!getResult.success || getResult.task.userId !== userId) {
      return c.json({ success: false, error: 'Task not found or unauthorized' }, 404);
    }

    // Cancel task
    const response = await queue.fetch('https://task-queue/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    const result = await response.json() as { success: boolean; error?: string };

    if (!result.success) {
      return c.json({ success: false, error: result.error || 'Failed to cancel task' }, 400);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete a task
queueRoutes.delete('/queue/tasks/:taskId', async (c) => {
  const taskId = c.req.param('taskId');
  const userId = c.get('userId');

  try {
    // Get queue DO
    const queueId = c.env.TASK_QUEUE.idFromName('global-queue');
    const queue = c.env.TASK_QUEUE.get(queueId);

    // Get task first to verify ownership
    const getResponse = await queue.fetch(`https://task-queue/get?taskId=${encodeURIComponent(taskId)}`, {
      method: 'GET',
    });

    const getResult = await getResponse.json() as { success: boolean; task: QueuedTask };

    if (!getResult.success || getResult.task.userId !== userId) {
      return c.json({ success: false, error: 'Task not found or unauthorized' }, 404);
    }

    // Delete task
    const response = await queue.fetch('https://task-queue/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    const result = await response.json() as { success: boolean };

    if (!result.success) {
      return c.json({ success: false, error: 'Failed to delete task' }, 500);
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
