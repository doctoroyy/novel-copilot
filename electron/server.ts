/**
 * 本地 HTTP 服务器
 *
 * 将现有 Hono 后端从 Cloudflare Workers 迁移到本地 Node.js HTTP 服务器。
 * 核心改动：
 * 1. 移除认证中间件（本地无需登录）
 * 2. D1Database → better-sqlite3（通过兼容层）
 * 3. Cloudflare Queue → 进程内队列
 * 4. R2 → 本地文件系统
 */

import { createServer, type Server } from 'node:http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { initializeLocalEnv, type LocalEnv } from './env.js';
import type { Env } from '../src/worker.js';

let server: ReturnType<typeof serve> | null = null;

// ========== Hono 应用 ==========

/**
 * 创建配置好的 Hono 应用
 */
async function createApp(): Promise<Hono<{ Bindings: Env }>> {
  const env = await initializeLocalEnv();

  // 确保本地默认用户存在（同步 better-sqlite3 API）
  const existingUser = env.DB.prepare('SELECT id FROM users WHERE id = ?').get('local-user');
  if (!existingUser) {
    env.DB.prepare(
      `INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
    ).run('local-user', 'local', 'local-no-password', 'admin');
    console.log('[Server] 已创建本地默认用户');
  }

  const app = new Hono<{ Bindings: Env }>();

  // CORS（允许前端开发服务器访问）
  app.use('*', cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'],
    credentials: true,
  }));

  // 将环境注入到每个请求的上下文中
  app.use('*', async (c, next) => {
    (c.env as any).DB = env.DB;
    (c.env as any).ANIME_VIDEOS = env.ANIME_VIDEOS;
    (c.env as any).GENERATION_QUEUE = env.GENERATION_QUEUE;
    (c.env as any).FANQIE_BROWSER = env.FANQIE_BROWSER;
    (c.env as any).JWT_SECRET = env.JWT_SECRET;

    // 本地模式：模拟已登录的用户
    (c as any).set('user', { userId: 'local-user', username: 'local', exp: Date.now() + 999999999 });
    (c as any).set('userId', 'local-user');

    await next();
  });

  // ========== 动态导入路由 ==========
  // 延迟导入以确保环境已初始化

  const { projectsRoutes } = await import('../src/routes/projects.js');
  const { configRoutes } = await import('../src/routes/config.js');
  const { generationRoutes } = await import('../src/routes/generation.js');
  const { charactersRoutes } = await import('../src/routes/characters.js');
  const { contextRoutes } = await import('../src/routes/context.js');
  const { tasksRoutes } = await import('../src/routes/tasks.js');
  const { editingRoutes } = await import('../src/routes/editing.js');
  const { agentRoutes } = await import('../src/routes/agent.js');
  const { qcRoutes } = await import('../src/routes/qc.js');
  const { adminRoutes } = await import('../src/routes/admin.js');
  const { creditRoutes } = await import('../src/routes/credit.js');
  const { animeRoutes } = await import('../src/routes/anime.js');

  // 挂载路由（不需要认证中间件，外层已注入用户上下文）
  app.route('/api/projects', projectsRoutes);
  app.route('/api/config', configRoutes);
  app.route('/api', generationRoutes);
  app.route('/api', tasksRoutes);
  app.route('/api', editingRoutes);
  app.route('/api/characters', charactersRoutes);
  app.route('/api/context', contextRoutes);
  app.route('/api/agent', agentRoutes);
  app.route('/api/projects', qcRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/credit', creditRoutes);
  app.route('/api/anime', animeRoutes);

  // SSE 事件流（本地简化版本）
  app.get('/api/events', async (c) => {
    const { eventBus } = await import('../src/eventBus.js');
    let cursor = Number.parseInt(c.req.query('cursor') || '0', 10);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

    const userId = 'local-user';
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        let pollInterval: ReturnType<typeof setInterval> | undefined;
        let keepaliveInterval: ReturnType<typeof setInterval> | undefined;
        let lastSendAt = 0;

        const close = () => {
          if (closed) return;
          closed = true;
          if (pollInterval) clearInterval(pollInterval);
          if (keepaliveInterval) clearInterval(keepaliveInterval);
          eventBus.off('event', handleEvent);
          try { controller.close(); } catch { /* no-op */ }
        };

        const sendChunk = (chunk: string) => {
          if (closed) return;
          lastSendAt = Date.now();
          controller.enqueue(encoder.encode(chunk));
        };

        const flushEvents = () => {
          if (closed) return;
          const { events, nextCursor } = eventBus.consumeSince(cursor, { userId });
          cursor = nextCursor;
          for (const event of events) {
            sendChunk(`data: ${JSON.stringify(event)}\n\n`);
          }
        };

        const handleEvent = (event: { id: number; userId?: string | null }) => {
          if (closed) return;
          if (typeof event.id !== 'number' || event.id <= cursor) return;
          cursor = event.id;
          try {
            sendChunk(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            close();
          }
        };

        eventBus.on('event', handleEvent);
        pollInterval = setInterval(() => {
          try { flushEvents(); } catch { close(); }
        }, 2000);
        keepaliveInterval = setInterval(() => {
          if (closed) return;
          if (Date.now() - lastSendAt < 15000) return;
          try { sendChunk(': ping\n\n'); } catch { close(); }
        }, 15000);

        c.req.raw.signal.addEventListener('abort', close);
        flushEvents();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  // Auth 路由（本地简化版 — 直接返回模拟用户）
  app.post('/api/auth/login', (c) => {
    return c.json({
      success: true,
      token: 'local-token',
      user: { id: 'local-user', username: 'local', role: 'admin' },
    });
  });

  app.post('/api/auth/register', (c) => {
    return c.json({
      success: true,
      token: 'local-token',
      user: { id: 'local-user', username: 'local', role: 'admin' },
    });
  });

  app.get('/api/auth/me', (c) => {
    return c.json({
      success: true,
      user: { id: 'local-user', username: 'local', role: 'admin' },
    });
  });

  app.get('/api/auth/user-count', (c) => {
    return c.json({ success: true, count: 1 });
  });

  // Health check
  app.get('/api/health', (c) => c.json({
    status: 'ok',
    mode: 'local',
    timestamp: new Date().toISOString(),
  }));

  // 404
  app.all('/api/*', (c) => c.json({ success: false, error: 'Not found' }, 404));

  // ========== 注册队列消费者 ==========
  registerQueueConsumer(env);

  return app;
}

/**
 * 注册队列消费者（替代 Cloudflare Queue Consumer）
 */
async function registerQueueConsumer(env: LocalEnv): Promise<void> {
  env.GENERATION_QUEUE.setHandler(async (batch) => {
    const {
      runChapterGenerationTaskInBackground,
      runOutlineGenerationTaskInBackground,
    } = await import('../src/routes/generation.js');
    const { runQCScanInBackground } = await import('../src/qc/qcAgent.js');
    const { runQCFixInBackground } = await import('../src/qc/qcFixAgent.js');
    const { runImagineTemplateRefreshJob } = await import('../src/services/imagineTemplateJobService.js');

    for (const message of batch.messages) {
      try {
        const payload = message.body;
        const taskType = payload.taskType || 'chapters';
        const taskRef = payload.taskId || payload.jobId || 'n/a';
        console.log(`[Queue] 处理任务: ref=${taskRef}, type=${taskType}`);

        if (taskType === 'imagine_templates') {
          if (!payload.jobId) {
            throw new Error('Missing jobId for imagine_templates queue payload');
          }
          await runImagineTemplateRefreshJob(env as any, payload.jobId);
        } else if (taskType === 'outline') {
          await runOutlineGenerationTaskInBackground({
            env: env as any,
            aiConfig: payload.aiConfig,
            userId: payload.userId,
            taskId: payload.taskId,
            projectId: payload.projectId,
            targetChapters: payload.targetChapters,
            targetWordCount: payload.targetWordCount,
            customPrompt: payload.customPrompt,
            minChapterWords: payload.minChapterWords,
            appendMode: payload.appendMode,
            newVolumeCount: payload.newVolumeCount,
            chaptersPerVolume: payload.chaptersPerVolume,
            refineMode: payload.refineMode,
            refineVolumeIndices: payload.refineVolumeIndices,
          });
        } else if (taskType === 'qc') {
          await runQCScanInBackground({
            env: env as any,
            taskId: payload.taskId,
            projectId: payload.projectId,
            userId: payload.userId,
            scanMode: payload.scanMode,
            reportId: payload.reportId,
          });
        } else if (taskType === 'qc_fix') {
          await runQCFixInBackground({
            env: env as any,
            taskId: payload.taskId,
            projectId: payload.projectId,
            userId: payload.userId,
            reportId: payload.reportId,
            chapterIndex: payload.chapterIndex,
            maxSeverity: payload.maxSeverity,
          });
        } else {
          await runChapterGenerationTaskInBackground({
            env: env as any,
            aiConfig: payload.aiConfig,
            fallbackConfigs: payload.fallbackConfigs,
            userId: payload.userId,
            taskId: payload.taskId,
            chaptersToGenerate: payload.chaptersToGenerate,
            enqueuedAt: payload.enqueuedAt,
            chapterAttemptCounts: payload.chapterAttemptCounts,
          });
        }

        message.ack();
      } catch (error) {
        console.error('[Queue] 任务处理失败:', error);
        message.retry();
      }
    }
  });
}

// ========== 服务器控制 ==========

/**
 * 启动 HTTP 服务器，返回端口号
 */
export async function startServer(): Promise<number> {
  const honoApp = await createApp();
  const port = Number(process.env.SIDECAR_PORT) || 8787;

  return new Promise((resolve, reject) => {
    try {
      server = serve({
        fetch: honoApp.fetch,
        port,
      }, (info) => {
        console.log(`[Server] 本地后端已启动: http://localhost:${info.port}`);
        resolve(info.port);
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 停止 HTTP 服务器
 */
export async function stopServer(): Promise<void> {
  if (server) {
    server.close();
    server = null;
    console.log('[Server] 本地后端已停止');
  }

  // 关闭数据库连接
  const { closeDb } = await import('../src/db/db.js');
  closeDb();
}
