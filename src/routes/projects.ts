import { Hono } from 'hono';
import type { Env } from '../worker.js';

export const projectsRoutes = new Hono<{ Bindings: Env }>();

// List all projects for current user
projectsRoutes.get('/', async (c) => {
  const userId = c.get('userId');
  
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
      WHERE p.deleted_at IS NULL AND p.user_id = ?
      ORDER BY p.created_at DESC
    `).bind(userId).all();

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

// Get single project (user-scoped)
projectsRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    const project = await c.env.DB.prepare(`
      SELECT p.*, s.*, o.outline_json
      FROM projects p
      LEFT JOIN states s ON p.id = s.project_id
      LEFT JOIN outlines o ON p.id = o.project_id
      WHERE p.name = ? AND p.deleted_at IS NULL AND p.user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const { results: chapters } = await c.env.DB.prepare(`
      SELECT chapter_index FROM chapters 
      WHERE project_id = ? AND deleted_at IS NULL ORDER BY chapter_index
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
      background: (project as any).background,
      role_settings: (project as any).role_settings,
      outline: (project as any).outline_json ? JSON.parse((project as any).outline_json) : null,
      chapters: chapters.map((ch: any) => `${ch.chapter_index.toString().padStart(3, '0')}.md`),
    };

    return c.json({ success: true, project: result });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Create project (owned by current user)
projectsRoutes.post('/', async (c) => {
  const userId = c.get('userId');
  
  try {
    const { name, bible, totalChapters = 100 } = await c.req.json();
    
    if (!name || !bible) {
      return c.json({ success: false, error: 'Name and bible are required' }, 400);
    }

    const id = crypto.randomUUID();

    await c.env.DB.prepare(`
      INSERT INTO projects (id, name, bible, user_id) VALUES (?, ?, ?, ?)
    `).bind(id, name, bible, userId).run();

    await c.env.DB.prepare(`
      INSERT INTO states (project_id, book_title, total_chapters) VALUES (?, ?, ?)
    `).bind(id, name, totalChapters).run();

    return c.json({ success: true, project: { id, name } });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete project (user-scoped)
projectsRoutes.delete('/:name', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL AND user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    // Soft delete: set deleted_at timestamp
    await c.env.DB.prepare(`UPDATE projects SET deleted_at = datetime('now') WHERE id = ?`).bind((project as any).id).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Update bible (user-scoped)
projectsRoutes.put('/:name/bible', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    const { bible } = await c.req.json();
    
    await c.env.DB.prepare(`
      UPDATE projects SET bible = ? WHERE name = ? AND user_id = ?
    `).bind(bible, name, userId).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Reset project state (user-scoped)
projectsRoutes.put('/:name/reset', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL AND user_id = ?
    `).bind(name, userId).first();

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

    // Soft delete all chapters
    await c.env.DB.prepare(`UPDATE chapters SET deleted_at = datetime('now') WHERE project_id = ? AND deleted_at IS NULL`).bind(id).run();

    return c.json({ success: true });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Get chapter content (user-scoped)
projectsRoutes.get('/:name/chapters/:index', async (c) => {
  const name = c.req.param('name');
  const index = parseInt(c.req.param('index'), 10);
  const userId = c.get('userId');
  
  try {
    const chapter = await c.env.DB.prepare(`
      SELECT c.content FROM chapters c
      JOIN projects p ON c.project_id = p.id
      WHERE p.name = ? AND c.chapter_index = ? AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND p.user_id = ?
    `).bind(name, index, userId).first();

    if (!chapter) {
      return c.json({ success: false, error: 'Chapter not found' }, 404);
    }

    return c.json({ success: true, content: (chapter as any).content });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Delete chapter (user-scoped)
projectsRoutes.delete('/:name/chapters/:index', async (c) => {
  const name = c.req.param('name');
  const index = parseInt(c.req.param('index'), 10);
  const userId = c.get('userId');
  
  try {
    // Get project
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL AND user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const projectId = (project as any).id;

    // Check if chapter exists (and not deleted)
    const chapter = await c.env.DB.prepare(`
      SELECT id FROM chapters WHERE project_id = ? AND chapter_index = ? AND deleted_at IS NULL
    `).bind(projectId, index).first();

    if (!chapter) {
      return c.json({ success: false, error: 'Chapter not found' }, 404);
    }

    // Soft delete the chapter
    await c.env.DB.prepare(`
      UPDATE chapters SET deleted_at = datetime('now') WHERE project_id = ? AND chapter_index = ?
    `).bind(projectId, index).run();

    // Recalculate nextChapterIndex based on remaining (non-deleted) chapters
    const maxChapterResult = await c.env.DB.prepare(`
      SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
    `).bind(projectId).first();

    const maxChapter = (maxChapterResult as any)?.max_index || 0;
    const newNextChapterIndex = maxChapter + 1;

    // Update state
    await c.env.DB.prepare(`
      UPDATE states SET next_chapter_index = ? WHERE project_id = ?
    `).bind(newNextChapterIndex, projectId).run();

    return c.json({ 
      success: true, 
      message: `Chapter ${index} deleted`,
      newNextChapterIndex,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Batch delete chapters (user-scoped)
projectsRoutes.post('/:name/chapters/batch-delete', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    const { indices } = await c.req.json();
    
    if (!Array.isArray(indices) || indices.length === 0) {
      return c.json({ success: false, error: 'indices array is required' }, 400);
    }

    // Get project
    const project = await c.env.DB.prepare(`
      SELECT id FROM projects WHERE name = ? AND deleted_at IS NULL AND user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const projectId = (project as any).id;

    // Soft delete chapters in batch
    const placeholders = indices.map(() => '?').join(', ');
    await c.env.DB.prepare(`
      UPDATE chapters SET deleted_at = datetime('now') WHERE project_id = ? AND chapter_index IN (${placeholders}) AND deleted_at IS NULL
    `).bind(projectId, ...indices).run();

    // Recalculate nextChapterIndex based on remaining (non-deleted) chapters
    const maxChapterResult = await c.env.DB.prepare(`
      SELECT MAX(chapter_index) as max_index FROM chapters WHERE project_id = ? AND deleted_at IS NULL
    `).bind(projectId).first();

    const maxChapter = (maxChapterResult as any)?.max_index || 0;
    const newNextChapterIndex = maxChapter + 1;

    // Update state
    await c.env.DB.prepare(`
      UPDATE states SET next_chapter_index = ? WHERE project_id = ?
    `).bind(newNextChapterIndex, projectId).run();

    return c.json({ 
      success: true, 
      message: `Deleted ${indices.length} chapters`,
      deletedIndices: indices,
      newNextChapterIndex,
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});

// Download all chapters as a ZIP file
// Download all chapters as a ZIP file (user-scoped)
projectsRoutes.get('/:name/download', async (c) => {
  const name = c.req.param('name');
  const userId = c.get('userId');
  
  try {
    // 1. Fetch project details, bible, and outline
    const project = await c.env.DB.prepare(`
      SELECT p.id, p.name, p.bible, o.outline_json
      FROM projects p
      LEFT JOIN outlines o ON p.id = o.project_id
      WHERE p.name = ? AND p.deleted_at IS NULL AND p.user_id = ?
    `).bind(name, userId).first();

    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404);
    }

    const projectId = (project as any).id;
    const projectName = (project as any).name;
    const bibleContent = (project as any).bible;
    const outlineJson = (project as any).outline_json;

    // 2. Fetch all non-deleted chapters
    const { results: chapters } = await c.env.DB.prepare(`
      SELECT chapter_index, content FROM chapters 
      WHERE project_id = ? AND deleted_at IS NULL
      ORDER BY chapter_index
    `).bind(projectId).all();

    if (chapters.length === 0) {
      return c.json({ success: false, error: 'No chapters to download' }, 400);
    }

    // 3. Create ZIP using JSZip
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    
    // Create root folder matches project name
    const root = zip.folder(projectName);
    if (!root) throw new Error('Failed to create root folder in ZIP');

    // Add bible
    if (bibleContent) {
      root.file('bible.md', bibleContent);
    }

    // Add outline
    if (outlineJson) {
      // Beautify JSON
      root.file('outline.json', JSON.stringify(JSON.parse(outlineJson), null, 2));
    }

    // Add full concatenated text file
    let fullText = `${projectName}\n\n`;
    if (bibleContent) fullText += `【Story Bible】\n${bibleContent}\n\n`;
    
    const chaptersFolder = root.folder('chapters');
    
    chapters.forEach((ch: any) => {
      // Extract title for filename
      const content = ch.content as string;
      const titleMatch = content.match(/^#?\s*第?\d*[章回节]?\s*[：:.]?\s*(.+)$/m) || 
                         content.match(/^(.+)$/m);
      
      let title = `第${ch.chapter_index}章`;
      if (titleMatch && titleMatch[1]) {
        // Clean up title
        const rawTitle = titleMatch[1].trim()
          .replace(/[\\/:*?"<>|]/g, '_'); // Remove invalid filename chars
        
        // If title doesn't start with "第", add prefix
        if (!rawTitle.startsWith('第')) {
            title = `第${ch.chapter_index}章 ${rawTitle}`;
        } else {
            title = rawTitle;
        }
      }

      // Add to chapters folder
      const filename = `${title}.txt`;
      if (chaptersFolder) {
        chaptersFolder.file(filename, content);
      }

      // Append to full text
      fullText += `${'='.repeat(50)}\n${title}\n${'='.repeat(50)}\n\n${content}\n\n`;
    });

    // Add full text file to root
    root.file(`${projectName}.txt`, fullText);

    // 4. Generate and return ZIP
    const content = await zip.generateAsync({ type: 'uint8array' });
    const filename = `${projectName}.zip`;

    return new Response(content, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    return c.json({ success: false, error: (error as Error).message }, 500);
  }
});
