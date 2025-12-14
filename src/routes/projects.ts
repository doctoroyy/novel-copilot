import { Hono } from 'hono';
import type { Env } from '../worker.js';

export const projectsRoutes = new Hono<{ Bindings: Env }>();

// List all projects
projectsRoutes.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT 
        p.id, p.name, p.created_at,
        s.book_title, s.total_chapters, s.next_chapter_index, 
        s.rolling_summary, s.open_loops, s.need_human, s.need_human_reason,
        o.outline_json IS NOT NULL as has_outline
      FROM projects p
      LEFT JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      ORDER BY p.created_at DESC
    `).all();

    const projects = results.map((row: any) => ({
      name: row.name,
      path: row.id,
      state: {
        bookTitle: row.book_title || row.name,
        totalChapters: row.total_chapters || 100,
        nextChapterIndex: row.next_chapter_index || 1,
        rollingSummary: row.rolling_summary || '',
        openLoops: JSON.parse(row.open_loops || '[]'),
        needHuman: Boolean(row.need_human),
        needHumanReason: row.need_human_reason,
      },
      hasOutline: Boolean(row.has_outline),
      outlineSummary: null,
    }));

    return c.json({ success: true, projects });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get single project
projectsRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  
  try {
    const project = await c.env.DB.prepare(`
      SELECT p.*, s.*, o.outline_json
      FROM projects p
      LEFT JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      WHERE p.name = ?
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const { results: chapters } = await c.env.DB.prepare(`
      SELECT chapter_index FROM chapters 
      WHERE project_id = ? ORDER BY chapter_index
    `).bind((project as any).id).all();

    const result = {
      name: (project as any).name,
      path: (project as any).id,
      state: {
        bookTitle: (project as any).book_title || name,
        totalChapters: (project as any).total_chapters || 100,
        nextChapterIndex: (project as any).next_chapter_index || 1,
        rollingSummary: (project as any).rolling_summary || '',
        openLoops: JSON.parse((project as any).open_loops || '[]'),
        needHuman: Boolean((project as any).need_human),
        needHumanReason: (project as any).need_human_reason,
      },
      bible: (project as any).bible,
      outline: (project as any).outline_json ? JSON.parse((project as any).outline_json) : null,
      chapters: chapters.map((ch: any) => `${ch.chapter_index.toString().padStart(3, '0')}.md`),
    };

    return c.json({ success: true, project: result });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Create project
projectsRoutes.post('/', async (c) => {
  try {
    const { name, bible, totalChapters = 100 } = await c.req.json();
    
    if (!name || !bible) {
      return c.json({ success: false, error: 'Name and bible are required' }, 400);
    }

    const id = crypto.randomUUID();

    await c.env.DB.prepare(`
      INSERT INTO projects (id, name, bible) VALUES (?, ?, ?)
    `).bind(id, name, bible).run();

    await c.env.DB.prepare(`
      INSERT INTO states (project_id, book_title, total_chapters) VALUES (?, ?, ?)
    `).bind(id, name, totalChapters).run();

    return c.json({ success: true, project: { id, name } });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete project
projectsRoutes.delete('/:name', async (c) => {
  const name = c.req.param('name');
  
  try {
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ?
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    await c.env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind((project as any).id).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update bible
projectsRoutes.put('/:name/bible', async (c) => {
  const name = c.req.param('name');
  
  try {
    const { bible } = await c.req.json();
    
    await c.env.DB.prepare(`
      UPDATE projects SET bible = ? WHERE name = ?
    `).bind(bible, name).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Reset project state
projectsRoutes.put('/:name/reset', async (c) => {
  const name = c.req.param('name');
  
  try {
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ?
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const id = (project as any).id;

    await c.env.DB.prepare(`
      UPDATE states SET 
        next_chapter_index = 1,
        rolling_summary = '',
        open_loops = '[]',
        need_human = 0,
        need_human_reason = NULL
      WHERE project_id = ?
    `).bind(id).run();

    await c.env.DB.prepare(`DELETE FROM chapters WHERE project_id = ?`).bind(id).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get chapter content
projectsRoutes.get('/:name/chapters/:index', async (c) => {
  const name = c.req.param('name');
  const index = parseInt(c.req.param('index'), 10);
  
  try {
    const chapter = await c.env.DB.prepare(`
      SELECT c.content FROM chapters c
      JOIN projects p ON c.project_id = p.id
      WHERE p.name = ? AND c.chapter_index = ?
    `).bind(name, index).first();

    if (!chapter) {
      return c.json({ success: false, error: 'Chapter not found' }, 404);
    }

    return c.json({ success: true, content: (chapter as any).content });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Download all chapters as a single text file
projectsRoutes.get('/:name/download', async (c) => {
  const name = c.req.param('name');
  
  try {
    const project = await c.env.DB.prepare(`
      SELECT id, name FROM projects WHERE name = ?
    `).bind(name).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const { results: chapters } = await c.env.DB.prepare(`
      SELECT chapter_index, content FROM chapters 
      WHERE project_id = ? 
      ORDER BY chapter_index
    `).bind((project as any).id).all();

    if (chapters.length === 0) {
      return c.json({ success: false, error: 'No chapters to download' }, 400);
    }

    // Combine all chapters into one text file
    const content = chapters.map((ch: any) => 
      `${'='.repeat(50)}\n第${ch.chapter_index}章\n${'='.repeat(50)}\n\n${ch.content}\n\n`
    ).join('\n');

    const filename = `${(project as any).name}-全本.txt`;

    return new Response(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
