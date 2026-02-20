import { Hono } from 'hono';
import type { Env } from '../worker.js';
import { generateCharacterGraph, generateCoreCharacters } from '../generateCharacters.js';
import { getAIConfigFromHeaders, getAIConfigFromRegistry } from '../services/aiClient.js';
import { consumeCredit } from '../services/creditService.js';

export const charactersRoutes = new Hono<{ Bindings: Env }>();

// Get character graph
charactersRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const project = await c.env.DB.prepare(`
      SELECT id
      FROM projects
      WHERE (id = ? OR name = ?) AND deleted_at IS NULL AND user_id = ?
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first();

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
  const userId = c.get('userId') as string;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  let aiConfig = getAIConfigFromHeaders(c.req.header());

  if (!aiConfig) {
    aiConfig = await getAIConfigFromRegistry(c.env.DB, 'generate_characters');
  }

  if (!aiConfig) {
    return c.json({ success: false, error: 'Missing AI configuration' }, 401);
  }

  try {
    // 1. 获取项目信息
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.name, p.bible, o.outline_json
      FROM projects p
      LEFT JOIN outlines o ON p.id = o.project_id
      WHERE (p.id = ? OR p.name = ?) AND p.deleted_at IS NULL AND p.user_id = ?
      ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // 0. 消耗积分
    try {
        await consumeCredit(c.env.DB, userId, 'generate_characters', `生成角色设定: ${(project as any).name}`);
    } catch (error) {
        return c.json({ success: false, error: (error as Error).message }, 402);
    }

    // 2. 根据是否有大纲选择不同的生成方式
    let crg;
    if (project.outline_json) {
      // 有大纲：使用完整版生成（包含精确的时间线）
      crg = await generateCharacterGraph({
        aiConfig,
        bible: project.bible as string,
        outline: JSON.parse(project.outline_json as string),
      });
    } else {
      // 无大纲：使用核心人设生成（不依赖大纲）
      // 从请求体获取目标规模，或使用默认值
      const body = await c.req.json().catch(() => ({}));
      crg = await generateCoreCharacters({
        aiConfig,
        bible: project.bible as string,
        targetChapters: body.targetChapters || 200,
        targetWordCount: body.targetWordCount || 80,
      });
    }

    // 3. 保存到数据库
    await c.env.DB.prepare(`
      INSERT INTO characters (project_id, characters_json) VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET characters_json = excluded.characters_json, updated_at = (unixepoch() * 1000)
    `).bind(project.id, JSON.stringify(crg)).run();

    return c.json({ success: true, characters: crg });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Manual update
charactersRoutes.put('/:name', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId') as string | null;
  if (!userId) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const { characters } = await c.req.json();

  try {
    const project = await c.env.DB.prepare(`
      SELECT id
      FROM projects
      WHERE (id = ? OR name = ?) AND deleted_at IS NULL AND user_id = ?
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
    `).bind(name, name, userId, name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    await c.env.DB.prepare(`
      INSERT INTO characters (project_id, characters_json) VALUES (?, ?)
      ON CONFLICT(project_id) DO UPDATE SET characters_json = excluded.characters_json, updated_at = (unixepoch() * 1000)
    `).bind(project.id, JSON.stringify(characters)).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
