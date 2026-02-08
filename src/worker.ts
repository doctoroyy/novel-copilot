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
import { authMiddleware, optionalAuthMiddleware } from './middleware/authMiddleware.js';

export interface Env {
  DB: D1Database;
  ANIME_VIDEOS: R2Bucket;
}

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
app.use('/api/active-tasks', authMiddleware());

// Mount routes
app.route('/api/projects', projectsRoutes);
app.route('/api/config', configRoutes);
app.route('/api', generationRoutes);
app.route('/api', tasksRoutes);
app.route('/api/characters', charactersRoutes);
app.route('/api/context', contextRoutes);
app.route('/api/anime', animeRoutes);
app.route('/api/admin', adminRoutes);

// SSE endpoint (stub - Workers have limited SSE support)
// For real-time updates, clients should poll or use Durable Objects
// SSE endpoint - supports token auth via query param (EventSource doesn't support headers)
app.get('/api/events', async (c) => {
  const { eventBus } = await import('./eventBus.js');
  const { verifyToken } = await import('./middleware/authMiddleware.js');
  
  // Get token from query param (EventSource cannot send headers)
  const token = c.req.query('token');
  let userId: string | null = null;
  
  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      userId = payload.userId;
    }
  }
  
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      
      const send = (data: any) => {
        try {
          // Check if controller is still valid (best effort)
          // encode and enqueue
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (err) {
          // Controller might be closed or cross-request error
          // e.g. "The controller is already closed" or "Invalid state" or "Promise resolved from different context"
          // We can just stop listening if it's broken
          console.warn('SSE send failed, unsubscribing:', (err as Error).message);
          eventBus.off('event', send);
        }
      };

      // Polling loop to check for events in the queue
      // This ensures we write to the controller from the request's own context
      const pollInterval = setInterval(() => {
        try {
          // Consume events from the bus
          const events = eventBus.consume();
          
          if (events.length > 0) {
             for (const event of events) {
               // TODO: In a multi-user environment, filter events by userId
               // For now, broadcast all events to all connected clients
               controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
             }
          } else {
             // Optional: keep alive ping every few ticks if no events
             // But we can just use a separate ping or just rely on standard keepalive
             // Let's explicitly ping every ~30 polls (30 * 500ms = 15s)
             if (Math.random() < 0.05) { 
               controller.enqueue(encoder.encode(': ping\n\n')); 
             }
          }
        } catch (err) {
          console.warn('SSE polling failed:', (err as Error).message);
          clearInterval(pollInterval);
        }
      }, 500); // Check every 500ms

      c.req.raw.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        try {
          // controller.close(); 
        } catch {}
      });


    },
    cancel() {
      // Cleanup happen in abort listener usually, but here too for safety
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

export default app;


