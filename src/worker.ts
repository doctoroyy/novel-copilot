import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { projectsRoutes } from './routes/projects.js';
import { configRoutes } from './routes/config.js';
import { generationRoutes } from './routes/generation.js';
import { charactersRoutes } from './routes/characters.js';
import { contextRoutes } from './routes/context.js';
import { animeRoutes } from './routes/anime.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { tasksRoutes } from './routes/tasks.js';
import { editingRoutes } from './routes/editing.js';
import { creditRoutes } from './routes/credit.js';
import { authMiddleware, optionalAuthMiddleware } from './middleware/authMiddleware.js';

export interface Env {
  DB: D1Database;
  ANIME_VIDEOS: R2Bucket;
  GENERATION_QUEUE: Queue<any>;
  FANQIE_BROWSER?: Fetcher;
}

const EVENTS_STREAM_POLL_INTERVAL_MS = 2000;
const EVENTS_STREAM_KEEPALIVE_MS = 15000;

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());

// Auth routes (no auth required)
app.route('/api/auth', authRoutes);

// Protected routes (require authentication)
app.use('/api/projects/*', authMiddleware());
app.use('/api/characters/*', authMiddleware());
app.use('/api/context/*', authMiddleware());
app.use('/api/anime/*', async (c, next) => {
  const path = c.req.path;
  // Exempt image/video/audio assets from strict auth
  if (path.endsWith('.png') || path.endsWith('/video') || path.endsWith('/audio')) {
    // Optional: still try to set user context if token is present, but don't error
    return optionalAuthMiddleware()(c, next);
  }
  // Enforce auth for all other anime routes
  return authMiddleware()(c, next);
});
app.use('/api/admin/*', authMiddleware());
app.use('/api/credit/*', authMiddleware());
app.use('/api/active-tasks', authMiddleware());
app.use('/api/tasks/*', authMiddleware());
app.use('/api/bible-templates/refresh', authMiddleware());
app.use('/api/bible-templates/refresh-jobs', authMiddleware());
app.use('/api/bible-templates/refresh-jobs/*', authMiddleware());

// Mount routes
app.route('/api/projects', projectsRoutes);
app.route('/api/config', configRoutes);
app.route('/api', generationRoutes);
app.route('/api', tasksRoutes);
app.route('/api', editingRoutes);
app.route('/api/characters', charactersRoutes);
app.route('/api/context', contextRoutes);
app.route('/api/anime', animeRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/credit', creditRoutes);

app.get('/api/events', async (c) => {
  const { eventBus } = await import('./eventBus.js');
  const { verifyToken } = await import('./middleware/authMiddleware.js');

  const token = c.req.query('token');
  if (!token) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const payload = await verifyToken(token);
  if (!payload?.userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let cursor = Number.parseInt(c.req.query('cursor') || '0', 10);
  if (!Number.isFinite(cursor) || cursor < 0) {
    cursor = 0;
  }

  const userId = payload.userId;
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
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = undefined;
        }
        if (keepaliveInterval) {
          clearInterval(keepaliveInterval);
          keepaliveInterval = undefined;
        }
        eventBus.off('event', handleEvent);
        try {
          controller.close();
        } catch {
          // no-op
        }
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
        if (event.userId !== userId) return;
        if (typeof event.id !== 'number' || event.id <= cursor) return;
        cursor = event.id;
        try {
          sendChunk(`data: ${JSON.stringify(event)}\n\n`);
        } catch (err) {
          console.warn('SSE push failed:', (err as Error).message);
          close();
        }
      };

      eventBus.on('event', handleEvent);

      pollInterval = setInterval(() => {
        try {
          flushEvents();
        } catch (err) {
          console.warn('SSE polling failed:', (err as Error).message);
          close();
        }
      }, EVENTS_STREAM_POLL_INTERVAL_MS);

      keepaliveInterval = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastSendAt < EVENTS_STREAM_KEEPALIVE_MS) return;
        try {
          sendChunk(': ping\n\n');
        } catch (err) {
          console.warn('SSE keepalive failed:', (err as Error).message);
          close();
        }
      }, EVENTS_STREAM_KEEPALIVE_MS);

      c.req.raw.signal.addEventListener('abort', () => {
        close();
      });
      flushEvents();
    },
    cancel() {
      // Cleanup happens through abort/close.
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});


// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404 handler for API routes
app.all('/api/*', (c) => c.json({ success: false, error: 'Not found' }, 404));

// SPA routing is handled by wrangler.toml: not_found_handling = "single-page-application"

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const runDate = new Date(controller.scheduledTime).toISOString();
    console.log(`[CRON] imagine template refresh started at ${runDate}`);

    const {
      createImagineTemplateRefreshJob,
      enqueueImagineTemplateRefreshJob,
    } = await import('./services/imagineTemplateJobService.js');

    const { job, created } = await createImagineTemplateRefreshJob(env.DB, {
      force: false,
      requestedByRole: 'system',
      source: 'cron',
    });

    if (!created) {
      console.log(`[CRON] imagine template refresh already queued/running: job=${job.id}, snapshot=${job.snapshotDate}`);
      return;
    }

    await enqueueImagineTemplateRefreshJob({
      env,
      jobId: job.id,
      executionCtx: ctx,
    });

    console.log(`[CRON] imagine template refresh queued: job=${job.id}, snapshot=${job.snapshotDate}`);
  },
  async queue(batch: MessageBatch<any>, env: Env, ctx: ExecutionContext) {
    const {
      runChapterGenerationTaskInBackground,
      runOutlineGenerationTaskInBackground,
    } = await import('./routes/generation.js');
    const { runImagineTemplateRefreshJob } = await import('./services/imagineTemplateJobService.js');

    for (const message of batch.messages) {
      try {
        const payload = message.body;
        const taskType = payload.taskType || 'chapters';
        const taskRef = payload.taskId || payload.jobId || 'n/a';
        console.log(`Processing queue message: ref=${taskRef}, type=${taskType}`);

        if (taskType === 'imagine_templates') {
          if (!payload.jobId) {
            throw new Error('Missing jobId for imagine_templates queue payload');
          }
          await runImagineTemplateRefreshJob(env, payload.jobId);
        } else if (taskType === 'outline') {
          await runOutlineGenerationTaskInBackground({
            env,
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
          });
        } else {
          await runChapterGenerationTaskInBackground({
            env,
            aiConfig: payload.aiConfig,
            userId: payload.userId,
            taskId: payload.taskId,
            chaptersToGenerate: payload.chaptersToGenerate
          });
        }

        message.ack(); // Acknowledge successful processing
      } catch (error) {
        console.error('Error processing queue message:', error);
        message.retry(); // Retry on failure
      }
    }
  }
};
