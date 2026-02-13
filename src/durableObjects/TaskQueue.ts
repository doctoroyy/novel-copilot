import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../worker.js';

export type ChapterTaskParams = {
  chaptersToGenerate: number;
};

export type OutlineTaskParams = {
  targetChapters: number;
  targetWordCount: number;
  customPrompt?: string;
};

export interface QueuedTask {
  id: string;
  type: 'chapter' | 'outline';
  projectId: string;
  projectName: string;
  userId: string;
  params: ChapterTaskParams | OutlineTaskParams;
  aiConfig: {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
  };
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  message?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export class TaskQueue extends DurableObject<Env> {
  private tasks: Map<string, QueuedTask> = new Map();
  private processingTaskId: string | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<Map<string, QueuedTask>>('tasks');
      if (stored) {
        this.tasks = new Map(stored);
      }
      const processing = await this.ctx.storage.get<string>('processingTaskId');
      // Handle empty string as null
      if (processing && processing !== '') {
        this.processingTaskId = processing;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/enqueue' && request.method === 'POST') {
        const task = await request.json() as QueuedTask;
        return this.enqueue(task);
      } else if (path === '/dequeue' && request.method === 'POST') {
        return this.dequeue();
      } else if (path === '/update' && request.method === 'POST') {
        const body = await request.json() as { taskId: string; updates: Partial<QueuedTask> };
        return this.updateTask(body.taskId, body.updates);
      } else if (path === '/get' && request.method === 'GET') {
        const taskId = url.searchParams.get('taskId');
        return this.getTask(taskId);
      } else if (path === '/list' && request.method === 'GET') {
        const userId = url.searchParams.get('userId');
        return this.listTasks(userId);
      } else if (path === '/delete' && request.method === 'POST') {
        const body = await request.json() as { taskId: string };
        return this.deleteTask(body.taskId);
      } else if (path === '/cancel' && request.method === 'POST') {
        const body = await request.json() as { taskId: string };
        return this.cancelTask(body.taskId);
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  private async enqueue(task: QueuedTask): Promise<Response> {
    task.status = 'pending';
    task.createdAt = Date.now();
    task.updatedAt = Date.now();
    
    this.tasks.set(task.id, task);
    await this.ctx.storage.put('tasks', Array.from(this.tasks.entries()));

    // Trigger processing if no task is currently being processed
    if (!this.processingTaskId) {
      await this.processNext();
    }

    return new Response(JSON.stringify({ success: true, taskId: task.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async dequeue(): Promise<Response> {
    // Find next pending task
    const nextTask = Array.from(this.tasks.values())
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)[0];

    if (!nextTask) {
      return new Response(JSON.stringify({ success: true, task: null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mark as processing
    nextTask.status = 'processing';
    nextTask.startedAt = Date.now();
    nextTask.updatedAt = Date.now();
    this.processingTaskId = nextTask.id;

    await this.ctx.storage.put('tasks', Array.from(this.tasks.entries()));
    await this.ctx.storage.put('processingTaskId', this.processingTaskId);

    return new Response(JSON.stringify({ success: true, task: nextTask }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async updateTask(taskId: string | null, updates: Partial<QueuedTask>): Promise<Response> {
    if (!taskId) {
      return new Response(JSON.stringify({ success: false, error: 'Task ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      return new Response(JSON.stringify({ success: false, error: 'Task not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    Object.assign(task, updates, { updatedAt: Date.now() });
    
    // If task is completed or failed, clear processing flag
    if (task.status === 'completed' || task.status === 'failed') {
      task.completedAt = Date.now();
      if (this.processingTaskId === taskId) {
        this.processingTaskId = null;
        await this.ctx.storage.put('processingTaskId', ''); // Use empty string instead of null
        // Trigger processing of next task
        await this.processNext();
      }
    }

    await this.ctx.storage.put('tasks', Array.from(this.tasks.entries()));

    return new Response(JSON.stringify({ success: true, task }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getTask(taskId: string | null): Promise<Response> {
    if (!taskId) {
      return new Response(JSON.stringify({ success: false, error: 'Task ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const task = this.tasks.get(taskId);
    if (!task) {
      return new Response(JSON.stringify({ success: false, error: 'Task not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, task }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async listTasks(userId: string | null): Promise<Response> {
    let tasks = Array.from(this.tasks.values());
    
    if (userId) {
      tasks = tasks.filter(t => t.userId === userId);
    }

    // Filter to active tasks only (not completed or failed from more than 1 hour ago)
    const oneHourAgo = Date.now() - 3600000;
    tasks = tasks.filter(t => {
      if (t.status === 'pending' || t.status === 'processing') return true;
      if ((t.status === 'completed' || t.status === 'failed') && (t.completedAt || 0) > oneHourAgo) return true;
      return false;
    });

    return new Response(JSON.stringify({ success: true, tasks }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async deleteTask(taskId: string): Promise<Response> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return new Response(JSON.stringify({ success: false, error: 'Task not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    this.tasks.delete(taskId);
    
    if (this.processingTaskId === taskId) {
      this.processingTaskId = null;
      await this.ctx.storage.put('processingTaskId', ''); // Use empty string instead of null
    }

    await this.ctx.storage.put('tasks', Array.from(this.tasks.entries()));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async cancelTask(taskId: string): Promise<Response> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return new Response(JSON.stringify({ success: false, error: 'Task not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (task.status === 'processing') {
      // Can't cancel a task that's currently being processed
      // It will need to complete or fail naturally
      return new Response(JSON.stringify({ success: false, error: 'Cannot cancel task that is currently processing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    task.status = 'failed';
    task.error = 'Cancelled by user';
    task.completedAt = Date.now();
    task.updatedAt = Date.now();

    await this.ctx.storage.put('tasks', Array.from(this.tasks.entries()));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async processNext(): Promise<void> {
    // Get the processor DO and tell it to process the next task
    const processorId = this.env.TASK_PROCESSOR.idFromName('global-processor');
    const processor = this.env.TASK_PROCESSOR.get(processorId);
    
    // Fire and forget - don't wait for response
    processor.fetch('https://task-processor/process-next').catch((err: Error) => {
      console.error('Failed to trigger processor:', err);
    });
  }
}
