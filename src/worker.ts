import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { projectsRoutes } from './routes/projects.js';
import { configRoutes } from './routes/config.js';
import { generationRoutes } from './routes/generation.js';
import { charactersRoutes } from './routes/characters.js';

export interface Env {
  DB: D1Database;
}

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', cors());

// Mount routes
app.route('/api/projects', projectsRoutes);
app.route('/api/config', configRoutes);
app.route('/api', generationRoutes);
app.route('/api/characters', charactersRoutes);

// SSE endpoint (stub - Workers have limited SSE support)
// For real-time updates, clients should poll or use Durable Objects
app.get('/api/events', (c) => {
  // Return a simple SSE response that closes after sending a ping
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

// 404 handler for API routes
app.all('/api/*', (c) => c.json({ success: false, error: 'Not found' }, 404));

// SPA routing is handled by wrangler.toml: not_found_handling = "single-page-application"

export default app;


