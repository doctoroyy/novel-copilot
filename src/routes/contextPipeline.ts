/**
 * Context Pipeline routes — chapter blueprints, context packages (Context
 * Inspector) and the AI job ledger (cost/token traceability).
 */

import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { getDb } from '../db/db.js';
import {
  buildContextPackage,
  serializeContextPackage,
  loadContextPackage,
  listContextPackages,
} from '../agent/contextBuilder.js';
import {
  getBlueprint,
  listBlueprints,
  upsertBlueprint,
  deleteBlueprint,
  setBlueprintStatus,
  type ChapterBlueprint,
} from '../services/chapterBlueprintService.js';
import {
  listLedgerJobs,
  getLedgerSummary,
} from '../services/aiJobLedger.js';
import { resolveProjectForUser } from '../services/storyVaultService.js';

export const contextPipelineRoutes = new Hono<{ Bindings: Env }>();

function errStatus(message: string): 400 | 401 | 404 | 500 {
  const m = message.toLowerCase();
  if (m.includes('unauthorized')) return 401;
  if (m.includes('not found')) return 404;
  if (m.includes('required') || m.includes('invalid')) return 400;
  return 500;
}

function requireUser(c: any): string | null {
  const userId = c.get('userId') as string | null;
  return userId;
}

// ---------------------------------------------------------------------------
// Chapter Blueprints
// ---------------------------------------------------------------------------

contextPipelineRoutes.get('/:name/blueprints', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const blueprints = await listBlueprints(c.req.param('name'), userId);
    return c.json({ success: true, blueprints });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

contextPipelineRoutes.get('/:name/blueprints/:chapter', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const chapter = Number(c.req.param('chapter'));
    const blueprint = await getBlueprint(c.req.param('name'), userId, chapter);
    return c.json({ success: true, blueprint });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

contextPipelineRoutes.put('/:name/blueprints/:chapter', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const chapter = Number(c.req.param('chapter'));
    const body = await c.req.json();
    const blueprint = await upsertBlueprint(c.req.param('name'), userId, chapter, {
      title: body.title,
      goal: body.goal,
      conflict: body.conflict,
      hook: body.hook,
      sceneBeats: body.sceneBeats,
      stateDeltaPlan: body.stateDeltaPlan,
      acceptanceCriteria: body.acceptanceCriteria,
      authorNotes: body.authorNotes,
      status: body.status,
    });
    return c.json({ success: true, blueprint });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

contextPipelineRoutes.post('/:name/blueprints/:chapter/status', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const chapter = Number(c.req.param('chapter'));
    const body = await c.req.json();
    const blueprint = await setBlueprintStatus(c.req.param('name'), userId, chapter, body.status);
    return c.json({ success: true, blueprint });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

contextPipelineRoutes.delete('/:name/blueprints/:chapter', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    await deleteBlueprint(c.req.param('name'), userId, Number(c.req.param('chapter')));
    return c.json({ success: true });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

// ---------------------------------------------------------------------------
// Context Packages (Context Inspector)
// ---------------------------------------------------------------------------

/**
 * Build (and persist) a context package for a chapter on demand — this is what
 * the Context Inspector calls to preview "what the AI will see".
 */
contextPipelineRoutes.post('/:name/context-package', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const body = await c.req.json();
    const db = getDb();
    const project = await resolveProjectForUser(db, c.req.param('name'), userId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);

    const chapterIndex = Number(body.chapterIndex ?? 1);
    const blueprint = body.blueprint ? typeof body.blueprint === 'string' ? body.blueprint : JSON.stringify(body.blueprint) : undefined;

    const pkg = buildContextPackage({
      taskId: body.taskId || `inspect-${chapterIndex}-${Date.now()}`,
      projectId: project.id,
      chapterIndex,
      taskType: body.taskType || 'chapter_draft',
      rollingSummary: body.rollingSummary || '',
      currentBlueprint: blueprint,
      goalHint: body.goalHint || '',
      writingStyleRules: body.writingStyleRules || '',
      totalChapters: body.totalChapters,
      recentChapterIndices: body.recentChapterIndices,
      db,
      persist: true,
    });

    return c.json({
      success: true,
      package: pkg,
      serialized: serializeContextPackage(pkg),
    });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

contextPipelineRoutes.get('/:name/context-packages', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const db = getDb();
    const project = await resolveProjectForUser(db, c.req.param('name'), userId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const chapter = c.req.query('chapter');
    const taskType = c.req.query('taskType') || undefined;
    const packages = listContextPackages(db, project.id, {
      chapterIndex: chapter ? Number(chapter) : undefined,
      taskType,
      limit: Number(c.req.query('limit') || 30),
    });
    return c.json({ success: true, packages });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

contextPipelineRoutes.get('/:name/context-packages/:packageId', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const db = getDb();
    const pkg = loadContextPackage(db, c.req.param('packageId'));
    if (!pkg) return c.json({ success: false, error: 'Package not found' }, 404);
    return c.json({ success: true, package: pkg, serialized: serializeContextPackage(pkg) });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

// ---------------------------------------------------------------------------
// AI Job Ledger (cost / token traceability)
// ---------------------------------------------------------------------------

contextPipelineRoutes.get('/:name/ledger', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const db = getDb();
    const project = await resolveProjectForUser(db, c.req.param('name'), userId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const phase = c.req.query('phase') as any;
    const jobs = listLedgerJobs(project.id, { phase, limit: Number(c.req.query('limit') || 50) });
    return c.json({ success: true, jobs });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});

contextPipelineRoutes.get('/:name/ledger/summary', async (c) => {
  const userId = requireUser(c);
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const db = getDb();
    const project = await resolveProjectForUser(db, c.req.param('name'), userId);
    if (!project) return c.json({ success: false, error: 'Project not found' }, 404);
    const summary = getLedgerSummary(project.id);
    return c.json({ success: true, summary });
  } catch (e) { return c.json({ success: false, error: (e as Error).message }, errStatus((e as Error).message)); }
});
