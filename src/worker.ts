import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { configRoutes } from './routes/config.js';
import { generationRoutes } from './routes/generation.js';

export interface Env {
  // No D1 binding needed anymore
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());

// Mount routes
app.route('/api/config', configRoutes);
app.route('/api', generationRoutes);

// SSE endpoint (stub - keeping for potential future streaming)
app.get('/api/events', (c) => {
  return new Response(': connected\n\n', {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404 handler
app.all('/api/*', (c) => c.json({ success: false, error: 'Not found' }, 404));

export default app;
