import { Hono } from 'hono';
import type { Env } from '../worker.js';
import {
  acceptExtractProposal,
  createStoryEntity,
  createStoryThread,
  deleteStoryEntity,
  deleteStoryThread,
  extractFromText,
  getStoryVault,
  listExtractProposals,
  updateStoryEntity,
  updateStoryThread,
  type StoryEntityType,
} from '../services/storyVaultService.js';

export const storyVaultRoutes = new Hono<{ Bindings: Env }>();

function mapErrorStatus(message: string): 400 | 401 | 404 | 409 | 500 {
  const m = message.toLowerCase();
  if (m.includes('unauthorized')) return 401;
  if (m.includes('not found')) return 404;
  if (m.includes('required') || m.includes('invalid')) return 400;
  if (m.includes('already')) return 409;
  return 500;
}

storyVaultRoutes.get('/:name/vault', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const vault = await getStoryVault(c.env.DB, c.req.param('name'), userId);
    return c.json({ success: true, vault });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.post('/:name/vault/entities', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json();
    const entity = await createStoryEntity(c.req.param('name'), userId, {
      type: body.type as StoryEntityType,
      name: String(body.name || ''),
      content: body.content != null ? String(body.content) : '',
      aliases: Array.isArray(body.aliases) ? body.aliases.map(String) : undefined,
      triggerTerms: Array.isArray(body.triggerTerms) ? body.triggerTerms.map(String) : undefined,
      importance: body.importance != null ? Number(body.importance) : undefined,
      status: body.status && typeof body.status === 'object' ? body.status : undefined,
    });
    return c.json({ success: true, entity });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.put('/:name/vault/entities/:entityId', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json();
    const entity = await updateStoryEntity(c.req.param('name'), userId, c.req.param('entityId'), {
      type: body.type,
      name: body.name,
      content: body.content,
      aliases: body.aliases,
      triggerTerms: body.triggerTerms,
      importance: body.importance != null ? Number(body.importance) : undefined,
      status: body.status,
      lastReferencedChapter: body.lastReferencedChapter,
    });
    return c.json({ success: true, entity });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.delete('/:name/vault/entities/:entityId', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    await deleteStoryEntity(c.req.param('name'), userId, c.req.param('entityId'));
    return c.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.post('/:name/vault/threads', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json();
    const thread = await createStoryThread(c.req.param('name'), userId, {
      name: String(body.name || ''),
      kind: body.kind,
      status: body.status,
      summary: body.summary != null ? String(body.summary) : '',
      stakes: body.stakes != null ? String(body.stakes) : '',
    });
    return c.json({ success: true, thread });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.put('/:name/vault/threads/:threadId', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json();
    const thread = await updateStoryThread(c.req.param('name'), userId, c.req.param('threadId'), {
      name: body.name,
      kind: body.kind,
      status: body.status,
      summary: body.summary,
      stakes: body.stakes,
    });
    return c.json({ success: true, thread });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.delete('/:name/vault/threads/:threadId', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    await deleteStoryThread(c.req.param('name'), userId, c.req.param('threadId'));
    return c.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.post('/:name/vault/extract', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json();
    const proposal = await extractFromText(c.req.param('name'), userId, {
      text: String(body.text || ''),
      sourceType: body.sourceType,
      sourceRef: body.sourceRef != null ? String(body.sourceRef) : undefined,
    });
    return c.json({ success: true, proposal });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.get('/:name/vault/extract', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const proposals = await listExtractProposals(c.req.param('name'), userId);
    return c.json({ success: true, proposals });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});

storyVaultRoutes.post('/:name/vault/extract/:proposalId/accept', async (c) => {
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json().catch(() => ({}));
    const result = await acceptExtractProposal(
      c.req.param('name'),
      userId,
      c.req.param('proposalId'),
      {
        entityIndexes: Array.isArray(body.entityIndexes) ? body.entityIndexes.map(Number) : undefined,
        threadIndexes: Array.isArray(body.threadIndexes) ? body.threadIndexes.map(Number) : undefined,
        noteIndexes: Array.isArray(body.noteIndexes) ? body.noteIndexes.map(Number) : undefined,
      },
    );
    return c.json({ success: true, ...result });
  } catch (error) {
    const message = (error as Error).message;
    return c.json({ success: false, error: message }, mapErrorStatus(message));
  }
});
