import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { getAIConfigFromHeaders, getAIConfigFromRegistry } from '../services/aiClient.js';
import {
  confirmCopilotProposal,
  createCopilotSession,
  getCopilotSessionDetail,
  getCopilotWorkspace,
  sendCopilotMessage,
  streamCopilotMessage,
  updateCopilotSettings,
} from '../services/agentCopilotService.js';

export const agentRoutes = new Hono<{ Bindings: Env }>();

function mapErrorStatus(message: string): 400 | 404 | 409 | 500 {
  const normalized = message.toLowerCase();
  if (normalized.includes('not found')) return 404;
  if (normalized.includes('required')) return 400;
  if (normalized.includes('disabled')) return 400;
  if (normalized.includes('already')) return 409;
  return 500;
}

function wantsStream(c: { req: { query: (key: string) => string | undefined; header: (name: string) => string | undefined } }): boolean {
  return c.req.query('stream') === '1' || (c.req.header('Accept') || '').includes('text/event-stream');
}

agentRoutes.get('/projects/:name/workspace', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const workspace = await getCopilotWorkspace(c.env.DB, c.req.param('name'), userId);
    return c.json({ success: true, workspace });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

agentRoutes.put('/projects/:name/settings', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json();
    const enabledSkillIds = Array.isArray(body.enabledSkillIds)
      ? body.enabledSkillIds.map((value: unknown) => String(value))
      : undefined;
    const settings = await updateCopilotSettings(c.env.DB, c.req.param('name'), userId, {
      enabled: body.enabled == null ? undefined : Boolean(body.enabled),
      enabledSkillIds,
    });
    return c.json({ success: true, settings });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

agentRoutes.post('/projects/:name/sessions', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const body = await c.req.json().catch(() => ({}));
    const session = await createCopilotSession(
      c.env.DB,
      c.req.param('name'),
      userId,
      typeof body.title === 'string' ? body.title : undefined,
    );
    return c.json({ success: true, session });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

agentRoutes.get('/sessions/:sessionId', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const detail = await getCopilotSessionDetail(c.env.DB, c.req.param('sessionId'), userId);
    return c.json({ success: true, detail });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

agentRoutes.post('/sessions/:sessionId/messages', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let aiConfig = getAIConfigFromHeaders(c.req.header());
  if (!aiConfig) {
    aiConfig = await getAIConfigFromRegistry(c.env.DB, 'ai_chat');
  }
  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 400);
  }

  try {
    const body = await c.req.json();
    if (wantsStream(c)) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          let closed = false;
          const send = (payload: unknown) => {
            if (closed) return;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          };
          const close = () => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              // ignore close races
            }
          };

          c.req.raw.signal.addEventListener('abort', () => {
            close();
          });

          void streamCopilotMessage({
            db: c.env.DB,
            sessionId: c.req.param('sessionId'),
            userId,
            content: String(body.content || ''),
            aiConfig,
            emit: async (event) => {
              send(event);
            },
          }).catch((error) => {
            send({
              type: 'error',
              error: (error as Error).message,
            });
          }).finally(() => {
            close();
          });
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    const detail = await sendCopilotMessage({
      db: c.env.DB,
      sessionId: c.req.param('sessionId'),
      userId,
      content: String(body.content || ''),
      aiConfig,
    });
    return c.json({ success: true, detail });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

agentRoutes.post('/proposals/:proposalId/confirm', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const detail = await confirmCopilotProposal(c.env.DB, c.req.param('proposalId'), userId);
    return c.json({ success: true, detail });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});
