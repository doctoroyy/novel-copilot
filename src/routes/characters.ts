import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateCharacterGraph } from '../generateCharacters.js';
import { getAIConfigFromHeaders } from '../services/aiClient.js';

export const charactersRoutes = new Hono<{ Bindings: Env }>();

// Get character graph
charactersRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  try {
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const record = await c.env.DB.prepare(`
      SELECT characters_json FROM characters WHERE project_id = ?
    `).bind(project.id).first();

    if (!record) {
      return c.json({ success: true, characters: null });
    }

    return c.json({ success: true, characters: JSON.parse(record.characters_json as string) });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Generate character graph
charactersRoutes.post('/:name/generate', async (c) => {
  const name = c.req.param('name');
  const aiConfig = getAIConfigFromHeaders(c.req.header());

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 401);
  }

  try {
    // 1. Get project info
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.bible, o.outline_json
      FROM projects p
      LEFT JOIN outlines o ON p.id = o.project_id
      WHERE p.name = ? AND p.deleted_at IS NULL
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    if (!project.outline_json) {
      return c.json({ success: false, error: 'Outline not found. Please generate outline first.' }, 400);
    }

    // 2. Generate CRG
    const crg = await generateCharacterGraph({
      aiConfig,
      bible: project.bible as string,
      outline: JSON.parse(project.outline_json as string),
    });

    // 3. Save to DB
    await c.env.DB.prepare(`
      INSERT INTO characters (project_id, characters_json) VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET characters_json = excluded.characters_json, updated_at = CURRENT_TIMESTAMP
    `).bind(project.id, JSON.stringify(crg)).run();

    return c.json({ success: true, characters: crg });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Manual update
charactersRoutes.put('/:name', async (c) => {
  const name = c.req.param('name');
  const { characters } = await c.req.json();

  try {
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    await c.env.DB.prepare(`
      INSERT INTO characters (project_id, characters_json) VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET characters_json = excluded.characters_json, updated_at = CURRENT_TIMESTAMP
    `).bind(project.id, JSON.stringify(characters)).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
